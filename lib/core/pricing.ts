/**
 * lib/core/pricing.ts — คำนวณราคาออเดอร์ (pure · โดเมนล้วน)
 *
 * 🔴 เหตุผลที่มีไฟล์นี้ (D-15): AI คำนวณเงินถูกแต่กรอกฟอร์มผิดช่อง (เอา "5" จาก "5 ถ้วย"
 * ยัดช่องเบอร์) แก้ prompt 3 รอบไม่หาย → ย้ายงานคิดเงินออกจาก AI มาบังคับด้วยโครงสร้าง (กฎ C6)
 *
 * 🔴 pure: ห้าม import LINE / Gemini / googleapis / lib/sheets — รับ rows + config ดิบเข้ามา
 *   (header-resolve ทำเองในไฟล์นี้ · normalize ให้ตรงกับ lib/sheets/clean.ts เป๊ะ)
 * 🔴 ห้าม hardcode ตัวเลขราคา/ค่าส่ง/เพดาน — อ่านจาก rows/config ที่ caller ส่งมาจากชีตเท่านั้น
 */

// ── ชื่อคอลัมน์/คีย์ (identifier ไม่ใช่ค่าตัวเลข — ระบุชื่อได้) ──
const PRODUCT_COLS = { sku: "sku", name: "ชื่อสินค้า", normalPrice: "ราคาปกติ_ต่อหน่วย", status: "สถานะ" };
const PROMO_COLS = {
  promoId: "promo_id",
  sku: "sku",
  qty: "จำนวน",
  promoPrice: "ราคาโปร",
  start: "เริ่มใช้",
  end: "สิ้นสุด",
  status: "สถานะ",
  showText: "ข้อความโชว์", // (auto) — stripKeyAnnotation ตัดวงเล็บออกแล้ว
};
const CONFIG_KEYS = {
  freeShipMin: "ยอดขั้นต่ำส่งฟรี_บาท",
  standardShipping: "ค่าส่ง_มาตรฐาน",
  codSurcharge: "ค่าส่ง_COD_เพิ่ม",
  ceilingMultiplier: "เพดานจำนวน_คูณโปรใหญ่สุด",
};
const STATUS_LIVE = "live";
const PAYMENT_COD = "COD";

export interface OrderItem {
  sku: string;
  qty: number;
}

export interface PriceLine {
  sku: string;
  name: string;
  qty: number;
  basePromoId: string | null; // promo_id ของฐาน (null = คิดราคาปกติ)
  unitPrice: number; // ต่อหน่วยของฐาน (หรือราคาปกติ)
  lineTotal: number; // ceil เต็มบาทที่ระดับ line
  /** ข้อความโชว์ (auto) ของโปร เมื่อ qty ตรงชั้นโปรพอดี (ใช้เป็นคำพูดบอทตรง ๆ) · ไม่ตรง = null */
  exactPromoMessage: string | null;
}

export interface PriceResult {
  lines: PriceLine[];
  subtotal: number;
  shippingFee: number;
  total: number;
  error: string | null; // != null → ห้ามเขียนชีต ห้ามพูดยอด → push แอดมิน
  needsHandoff: boolean; // เกินเพดาน / ไม่มีโปร live เลย → ห้ามปิดออเดอร์เอง
}

export interface PriceInput {
  items: OrderItem[];
  paymentMethod: string; // "COD" | "โอน" | ""
  /** วันอ้างอิงเช็คช่วงโปร (เริ่มใช้/สิ้นสุด) · default = ตอนนี้ — inject เพื่อความ pure/testable */
  now?: Date;
}

// ── helpers (normalize ให้ตรง lib/sheets/clean.ts) ──
function cleanCell(v: string | undefined): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/[​-‍﻿ ]/g, "").trim();
}
function normHeader(v: string | undefined): string {
  // stripKeyAnnotation: ตัด " (auto)" ท้ายชื่อ + cleanCell
  return cleanCell(v).replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function toNum(v: string | undefined): number {
  const s = cleanCell(v);
  if (s === "") return NaN; // ค่าว่าง/ขาด ≠ 0 (กัน Number("")=0 ทำ config หายกลายเป็นส่งฟรี)
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
/** YYYY-MM-DD ตามเวลาไทย (UTC+7) จาก Date — เทียบช่วงโปรแบบ date-only */
function toBangkokYMD(d: Date): string {
  const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** map ชื่อคอลัมน์ (normalize) → index · คืน null ถ้าขาด required ตัวใดตัวหนึ่ง */
function resolveCols(rows: string[][], required: string[]): { cols: Record<string, number>; headerRow: number } | null {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const header = rows[i].map(normHeader);
    const cols: Record<string, number> = {};
    for (const name of required) {
      const idx = header.indexOf(name);
      if (idx !== -1) cols[name] = idx;
    }
    if (required.every((name) => name in cols)) return { cols, headerRow: i };
  }
  return null;
}

interface LivePromo {
  promoId: string;
  sku: string;
  qty: number;
  promoPrice: number;
  showText: string;
}

/**
 * คำนวณราคาออเดอร์ — กฎ a–k ตาม D-15 (เจ้าของตัดสินแล้ว)
 * @param promoRows  CSV_Promo ดิบ (มี header + แถวหมายเหตุ — ข้ามให้เอง)
 * @param productRows CSV_Products ดิบ
 * @param config     key→value ดิบจาก CSV_Config (เช่น Object.fromEntries(appConfig.raw))
 */
export function calculatePrice(
  input: PriceInput,
  promoRows: string[][],
  productRows: string[][],
  config: Record<string, string>,
): PriceResult {
  const empty: PriceResult = { lines: [], subtotal: 0, shippingFee: 0, total: 0, error: null, needsHandoff: false };
  const now = input.now ?? new Date();
  const today = toBangkokYMD(now);

  // items ว่าง = ยังไม่ได้สั่ง (ปกติในช่วงต้นบทสนทนา) — ไม่ใช่ error ไม่ push
  if (!input.items || input.items.length === 0) return empty;

  // ── โครงสร้างชีต ──
  const pCols = resolveCols(productRows, [PRODUCT_COLS.sku, PRODUCT_COLS.name, PRODUCT_COLS.normalPrice, PRODUCT_COLS.status]);
  if (!pCols) return { ...empty, error: "โครงสร้าง CSV_Products ผิด (คอลัมน์ไม่ครบ)", needsHandoff: true };
  const prCols = resolveCols(promoRows, [
    PROMO_COLS.promoId, PROMO_COLS.sku, PROMO_COLS.qty, PROMO_COLS.promoPrice,
    PROMO_COLS.start, PROMO_COLS.end, PROMO_COLS.status,
  ]);
  if (!prCols) return { ...empty, error: "โครงสร้าง CSV_Promo ผิด (คอลัมน์ไม่ครบ)", needsHandoff: true };
  const showTextIdx = promoRows[prCols.headerRow].map(normHeader).indexOf(PROMO_COLS.showText);

  // ── product map (ข้าม sku ว่าง / แถวหมายเหตุ) ──
  const products = new Map<string, { name: string; normalPrice: number; status: string }>();
  for (let i = pCols.headerRow + 1; i < productRows.length; i++) {
    const row = productRows[i];
    const sku = cleanCell(row[pCols.cols[PRODUCT_COLS.sku]]);
    if (!sku) continue;
    products.set(sku, {
      name: cleanCell(row[pCols.cols[PRODUCT_COLS.name]]),
      normalPrice: toNum(row[pCols.cols[PRODUCT_COLS.normalPrice]]),
      status: cleanCell(row[pCols.cols[PRODUCT_COLS.status]]),
    });
  }

  // ── live promos (ข้าม sku ว่าง / สถานะ≠live / นอกช่วงวันที่) ──
  const livePromos: LivePromo[] = [];
  for (let i = prCols.headerRow + 1; i < promoRows.length; i++) {
    const row = promoRows[i];
    const sku = cleanCell(row[prCols.cols[PROMO_COLS.sku]]);
    if (!sku) continue; // แถวหมายเหตุ (ข้อความอยู่คอลัมน์ A เท่านั้น) / แถวว่าง
    if (cleanCell(row[prCols.cols[PROMO_COLS.status]]) !== STATUS_LIVE) continue;
    const start = cleanCell(row[prCols.cols[PROMO_COLS.start]]);
    const end = cleanCell(row[prCols.cols[PROMO_COLS.end]]);
    if (start && today < start) continue; // ยังไม่ถึงวันเริ่ม
    if (end && today > end) continue; // หมดอายุแล้ว (end ว่าง = ไม่มีวันหมด)
    const qty = toNum(row[prCols.cols[PROMO_COLS.qty]]);
    const promoPrice = toNum(row[prCols.cols[PROMO_COLS.promoPrice]]);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(promoPrice)) continue; // โปรอ่านไม่ได้ = ข้าม
    livePromos.push({
      promoId: cleanCell(row[prCols.cols[PROMO_COLS.promoId]]),
      sku, qty, promoPrice,
      showText: showTextIdx !== -1 ? cleanCell(row[showTextIdx]) : "",
    });
  }

  // ── config ตัวเลข (ห้าม hardcode fallback) ──
  const freeShipMin = toNum(config[CONFIG_KEYS.freeShipMin]);
  const standardShipping = toNum(config[CONFIG_KEYS.standardShipping]);
  const ceilingMultiplier = toNum(config[CONFIG_KEYS.ceilingMultiplier]);
  const isCod = cleanCell(input.paymentMethod) === PAYMENT_COD;
  const codSurcharge = toNum(config[CONFIG_KEYS.codSurcharge]);
  if (!Number.isFinite(freeShipMin) || !Number.isFinite(standardShipping) || !Number.isFinite(ceilingMultiplier)) {
    return { ...empty, error: "CSV_Config ราคา/เพดาน อ่านไม่ได้ (ยอดขั้นต่ำส่งฟรี/ค่าส่ง/เพดาน)", needsHandoff: true };
  }
  if (isCod && !Number.isFinite(codSurcharge)) {
    return { ...empty, error: "CSV_Config ค่าส่ง_COD_เพิ่ม อ่านไม่ได้", needsHandoff: true };
  }

  // ── เพดานจำนวน (กฎ j) ──
  let needsHandoff = false;
  if (livePromos.length === 0) {
    // ไม่มีโปร live เลย = สถานะผิดปกติ ต้องมีคนดู (ห้าม fallback เลขคงที่)
    console.warn(JSON.stringify({ scope: "pricing", warning: "ไม่มีโปร live เลย — คำนวณเพดานไม่ได้ → handoff ทุกออเดอร์" }));
    needsHandoff = true;
  } else {
    const maxPromoQty = Math.max(...livePromos.map((p) => p.qty));
    const ceiling = Math.floor(maxPromoQty * ceilingMultiplier);
    const totalQty = input.items.reduce((s, it) => s + (Number.isFinite(it.qty) ? it.qty : 0), 0);
    if (totalQty > ceiling) needsHandoff = true;
  }

  // ── คิดราคาต่อ item ──
  const lines: PriceLine[] = [];
  for (const item of input.items) {
    const sku = cleanCell(item.sku);
    const qty = item.qty;
    if (!Number.isInteger(qty) || qty <= 0) {
      return { ...empty, error: `จำนวนไม่ถูกต้อง (sku=${sku || "?"}, qty=${qty})`, needsHandoff: true };
    }
    const product = products.get(sku);
    if (!product) return { ...empty, error: `sku ไม่รู้จัก: ${sku || "(ว่าง)"}`, needsHandoff: true };
    if (product.status !== STATUS_LIVE) return { ...empty, error: `sku ไม่ได้ขาย (สถานะ=${product.status || "?"}): ${sku}`, needsHandoff: true };

    // ฐาน = โปร live ของ sku นี้ที่ "จำนวน" มากสุดแต่ไม่เกิน qty
    const skuPromos = livePromos.filter((p) => p.sku === sku && p.qty <= qty);
    let line: PriceLine;
    if (skuPromos.length > 0) {
      const base = skuPromos.reduce((a, b) => (b.qty > a.qty ? b : a));
      const unitPrice = base.promoPrice / base.qty;
      const lineTotal = Math.ceil(base.promoPrice + (qty - base.qty) * unitPrice);
      line = {
        sku, name: product.name, qty,
        basePromoId: base.promoId,
        unitPrice,
        lineTotal,
        exactPromoMessage: qty === base.qty && base.showText ? base.showText : null,
      };
    } else {
      // ไม่มีโปร ≤ qty (หรือ sku ไม่มีโปรเลย) → ราคาปกติ × qty
      if (!Number.isFinite(product.normalPrice)) {
        return { ...empty, error: `ราคาปกติอ่านไม่ได้: ${sku}`, needsHandoff: true };
      }
      line = {
        sku, name: product.name, qty,
        basePromoId: null,
        unitPrice: product.normalPrice,
        lineTotal: Math.ceil(product.normalPrice * qty),
        exactPromoMessage: null,
      };
    }
    lines.push(line);
  }

  // ── รวมบิล ──
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  let shippingFee = subtotal >= freeShipMin ? 0 : standardShipping;
  if (isCod) shippingFee += codSurcharge;
  const total = subtotal + shippingFee;

  return { lines, subtotal, shippingFee, total, error: null, needsHandoff };
}

// ── formatters + runtime-variable resolver (D-15 · commit 2-pass) ──

/** "<ชื่อ> x<qty>" ต่อรายการ · คั่นด้วย sep — คนอ่าน (" · ") vs ชีต (" | ") */
function joinLines(lines: PriceLine[], sep: string): string {
  return lines.map((l) => `${l.name} x${l.qty}`).join(sep);
}
/** {สรุปรายการ} ฝั่งลูกค้า — คั่น " · " */
export function formatOrderSummary(lines: PriceLine[]): string {
  return joinLines(lines, " · ");
}
/** คอลัมน์ I ชีต Orders — คั่น " | " (contract 5) */
export function formatLinesForSheet(lines: PriceLine[]): string {
  return joinLines(lines, " | ");
}

/** แสดงช่องทางชำระให้ลูกค้าอ่าน — COD → "เก็บเงินปลายทาง" · โอน → "โอนเงิน" */
export function formatPayment(payment: string): string {
  const p = cleanCell(payment);
  if (p === PAYMENT_COD) return "เก็บเงินปลายทาง";
  if (p === "โอน") return "โอนเงิน";
  return p;
}

/** ตัวแปร runtime ที่ "โค้ดเป็นเจ้าของ" ในรอบนี้ (D-15) — เงิน/รายการเท่านั้น */
export const PRICING_RUNTIME_VARS = ["{สรุปรายการ}", "{ยอดรวม}", "{การชำระเงิน}"] as const;

export interface RuntimeVarContext {
  summary: string | null; // {สรุปรายการ} — null = ยังไม่มี items ให้ resolve (คงวงเล็บไว้)
  total: number | null; // {ยอดรวม}
  payment: string | null; // {การชำระเงิน}
}

/**
 * แทนเฉพาะ 3 ตัวแปรเงิน/รายการ ({สรุปรายการ}/{ยอดรวม}/{การชำระเงิน}) ในข้อความ
 * 🔴 ตัวแปรอื่น ({ชื่อสินค้า}/{เลข อย.}/…) ปล่อยผ่าน — เป็นหน้าที่ AI ชั่วคราวจน resolver เต็ม (D-16)
 * ค่า null = ไม่แทน (คงวงเล็บ) เพื่อให้ guard ปลายทางจับได้ว่ายัง resolve ไม่ครบ
 */
export function resolveRuntimeVars(text: string, ctx: RuntimeVarContext): string {
  let out = text;
  if (ctx.summary !== null) out = out.split("{สรุปรายการ}").join(ctx.summary);
  if (ctx.total !== null) out = out.split("{ยอดรวม}").join(String(ctx.total));
  if (ctx.payment !== null) out = out.split("{การชำระเงิน}").join(ctx.payment);
  return out;
}
