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
const PRODUCT_COLS = { sku: "sku", name: "ชื่อสินค้า", unit: "หน่วย", normalPrice: "ราคาปกติ_ต่อหน่วย", status: "สถานะ" };
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
  extraPricing: "จำนวนที่ไม่มีโปร_คิดยังไง", // Step 3 · วิธีคิด "เศษ" ที่เกินชั้นโปรฐาน
};
const STATUS_LIVE = "live";
const PAYMENT_COD = "COD";
// ค่าที่ชีตพิมพ์ได้ในคีย์ extraPricing (เลือก "วิธี" ไม่ใช่ตัวเลข — ระบุค่าคงที่ได้)
const EXTRA_METHOD_PROMO_BASE = "เทียบโปรฐาน"; // เศษ = ราคาต่อหน่วยของโปรฐาน (default · พฤติกรรมเดิม)
const EXTRA_METHOD_NORMAL = "ราคาปกติ"; // เศษ = ราคาปกติต่อหน่วย

export interface OrderItem {
  sku: string;
  qty: number;
}

/** สิ่งที่ AI ส่ง (D-20): แค่ qty — โค้ดใส่ sku เอง (ลดภาระ AI · sku code AI แมปไม่เก่ง) */
export interface AiOrderItem {
  qty: number;
}

/** sku ของสินค้า live ทั้งหมดใน CSV_Products (pure) */
export function liveProductSkus(productRows: string[][]): string[] {
  const pCols = resolveCols(productRows, [PRODUCT_COLS.sku, PRODUCT_COLS.status]);
  if (!pCols) return [];
  const out: string[] = [];
  for (let i = pCols.headerRow + 1; i < productRows.length; i++) {
    const sku = cleanCell(productRows[i][pCols.cols[PRODUCT_COLS.sku]]);
    const status = cleanCell(productRows[i][pCols.cols[PRODUCT_COLS.status]]);
    if (sku && status === STATUS_LIVE) out.push(sku);
  }
  return out;
}

/**
 * ใส่ sku ให้ items ที่ AI ส่งมา (มีแค่ qty) — D-20
 * 🔴 live ตัวเดียว → ใส่ sku นั้นทุก element (รองรับหลายรายการ) · live หลาย/ไม่มี → log เตือน + [] (ไม่เดา)
 */
export function resolveAiItems(aiItems: AiOrderItem[] | undefined, productRows: string[][]): OrderItem[] {
  const clean = (aiItems ?? []).filter((it) => it && Number.isFinite(it.qty) && it.qty > 0);
  if (clean.length === 0) return [];
  const live = liveProductSkus(productRows);
  if (live.length === 1) return clean.map((it) => ({ sku: live[0], qty: it.qty }));
  console.warn(JSON.stringify({ scope: "pricing", warning: "resolveAiItems: สินค้า live ไม่ใช่ 1 ตัว — ใส่ sku อัตโนมัติไม่ได้ (ไม่เดา)", liveCount: live.length }));
  return [];
}

/** ชั้นโปรที่ใช้เป็นฐานคิดราคาของ line */
export interface BasePromo {
  promoId: string;
  qty: number;
  price: number; // ราคาโปรของชั้นฐาน
}

/** ชั้นโปรที่สูงกว่า qty ปัจจุบัน (ใช้เสนอทางเลือก upsell) — ระดับบิล (คิดเฉพาะออเดอร์ sku เดียว) */
export interface NextTier {
  promoId: string;
  qty: number;
  price: number; // ยอดรวมที่ลูกค้าจ่ายถ้าเลือกชั้นนี้
  addQty: number; // qty ชั้นนี้ − qty ปัจจุบัน
  addAmount: number; // price ชั้นนี้ − total ปัจจุบัน (บวกแล้วเท่ายอดชั้นนี้เสมอ)
}

export interface PriceLine {
  sku: string;
  name: string;
  unit: string; // หน่วย (เช่น "ถ้วย") จาก CSV_Products — ใช้ในข้อความแจกแจง
  qty: number;
  basePromoId: string | null; // promo_id ของฐาน (null = คิดราคาปกติ)
  basePromo: BasePromo | null; // ชั้นฐานแบบละเอียด
  extraQty: number; // qty − qty ชั้นฐาน (0 ถ้าไม่มีฐาน/ตรงชั้น)
  extraAmount: number; // 🔴 = lineTotal − basePromo.price เท่านั้น (บวกแล้วเท่ายอดเสมอ) · ไม่มีฐาน = 0
  isExactTier: boolean; // qty ตรงชั้นโปรพอดี
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
  /** ชั้นโปรถัดไปที่สูงกว่า (เสนอ upsell) · null = ตรงโปรใหญ่สุด/หลาย sku/ไม่มีโปร */
  nextTier: NextTier | null;
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
  const empty: PriceResult = { lines: [], subtotal: 0, shippingFee: 0, total: 0, nextTier: null, error: null, needsHandoff: false };
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
  const unitIdx = productRows[pCols.headerRow].map(normHeader).indexOf(PRODUCT_COLS.unit); // optional

  // ── product map (ข้าม sku ว่าง / แถวหมายเหตุ) ──
  const products = new Map<string, { name: string; unit: string; normalPrice: number; status: string }>();
  for (let i = pCols.headerRow + 1; i < productRows.length; i++) {
    const row = productRows[i];
    const sku = cleanCell(row[pCols.cols[PRODUCT_COLS.sku]]);
    if (!sku) continue;
    products.set(sku, {
      name: cleanCell(row[pCols.cols[PRODUCT_COLS.name]]),
      unit: unitIdx !== -1 ? cleanCell(row[unitIdx]) || "ชิ้น" : "ชิ้น",
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

  // ── วิธีคิด "เศษ" ที่เกินชั้นโปรฐาน (Step 3 · จำนวนที่ไม่มีโปร_คิดยังไง) ──
  // 🔴 ว่าง/ไม่มี key = เทียบโปรฐาน (พฤติกรรมเดิม) — เลือก "วิธี" ที่ documented ไม่ใช่ hardcode ราคา
  //    (ต่างจากคีย์ตัวเลขด้านบนที่ค่าเริ่มต้นไม่มี "วิธีปลอดภัย" · ที่นี่มี = พฤติกรรมเดิมที่พิสูจน์แล้ว)
  //    ค่าอื่นที่พิมพ์มาแต่ไม่รู้จัก = misconfiguration → handoff (ห้ามเดาเงียบแบบ D-15)
  const extraMethodRaw = cleanCell(config[CONFIG_KEYS.extraPricing]);
  let extraMethod: "promoBase" | "normal";
  if (extraMethodRaw === "" || extraMethodRaw === EXTRA_METHOD_PROMO_BASE) {
    extraMethod = "promoBase";
  } else if (extraMethodRaw === EXTRA_METHOD_NORMAL) {
    extraMethod = "normal";
  } else {
    return { ...empty, error: `CSV_Config จำนวนที่ไม่มีโปร_คิดยังไง: ค่าไม่รู้จัก "${extraMethodRaw}" (ใช้ "${EXTRA_METHOD_PROMO_BASE}" หรือ "${EXTRA_METHOD_NORMAL}")`, needsHandoff: true };
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
      const basePerUnit = base.promoPrice / base.qty;
      // เศษที่เกินชั้นฐาน (qty − base.qty) คิดตามวิธีที่ชีตกำหนด · ตรงชั้นพอดี = ไม่มีเศษ (สองวิธีเท่ากัน)
      if (qty > base.qty && extraMethod === "normal" && !Number.isFinite(product.normalPrice)) {
        return { ...empty, error: `ราคาปกติอ่านไม่ได้ (วิธีคิดเศษ "${EXTRA_METHOD_NORMAL}" ต้องใช้): ${sku}`, needsHandoff: true };
      }
      const extraUnitPrice = extraMethod === "normal" ? product.normalPrice : basePerUnit;
      const lineTotal = Math.ceil(base.promoPrice + (qty - base.qty) * extraUnitPrice);
      line = {
        sku, name: product.name, unit: product.unit, qty,
        basePromoId: base.promoId,
        basePromo: { promoId: base.promoId, qty: base.qty, price: base.promoPrice },
        extraQty: qty - base.qty,
        extraAmount: lineTotal - base.promoPrice, // 🔴 บวกแล้วเท่ายอดเสมอ (ไม่ใช่ ceil ต่อหน่วย × extraQty)
        isExactTier: qty === base.qty,
        unitPrice: basePerUnit,
        lineTotal,
        exactPromoMessage: qty === base.qty && base.showText ? base.showText : null,
      };
    } else {
      // ไม่มีโปร ≤ qty (หรือ sku ไม่มีโปรเลย) → ราคาปกติ × qty
      if (!Number.isFinite(product.normalPrice)) {
        return { ...empty, error: `ราคาปกติอ่านไม่ได้: ${sku}`, needsHandoff: true };
      }
      line = {
        sku, name: product.name, unit: product.unit, qty,
        basePromoId: null,
        basePromo: null,
        extraQty: qty,
        extraAmount: 0,
        isExactTier: false,
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

  // ── ชั้นโปรถัดไป (upsell) — เฉพาะออเดอร์ sku เดียว (ธรรมชาติร้าน) ──
  let nextTier: NextTier | null = null;
  if (lines.length === 1) {
    const sku = lines[0].sku;
    const higher = livePromos.filter((p) => p.sku === sku && p.qty > lines[0].qty);
    if (higher.length > 0) {
      const near = higher.reduce((a, b) => (b.qty < a.qty ? b : a)); // ชั้นใกล้สุดที่สูงกว่า
      // ยอดรวมถ้าเลือกชั้นนี้ = คิดใหม่ด้วยกฎเดียวกัน (เพื่อรวมค่าส่ง/COD ให้ถูก)
      const tierPrice = calculatePrice({ items: [{ sku, qty: near.qty }], paymentMethod: input.paymentMethod, now }, promoRows, productRows, config).total;
      nextTier = {
        promoId: near.promoId,
        qty: near.qty,
        price: tierPrice,
        addQty: near.qty - lines[0].qty,
        addAmount: tierPrice - total,
      };
    }
  }

  return { lines, subtotal, shippingFee, total, nextTier, error: null, needsHandoff };
}

// ── ตารางราคาสำเร็จรูป (D-24 · C6 เต็มรูป: โค้ดคำนวณ ยัดให้บอทหยิบเลข ไม่ต้องคิดเอง) ──

export interface PriceTableRow {
  qty: number;
  subtotal: number; // ยอดสินค้า (ก่อนค่าส่ง)
  shippingFee: number;
  total: number; // ยอดที่ลูกค้าจ่ายจริง (= เลขที่ gate เขียนชีต)
  freeShip: boolean;
}

export interface PriceTable {
  sku: string;
  name: string;
  unit: string;
  ceiling: number; // จำนวนสูงสุดที่ปิดออเดอร์เองได้ (เกินนี้ = handoff)
  rows: PriceTableRow[];
  error: string | null; // != null → คำนวณไม่ได้ (config พัง/ไม่มีโปร) → ผู้เรียกไม่ยัดตาราง + บอก handoff
}

/**
 * enumerate ราคา qty 1..เพดาน ของ sku เดียว — เรียก calculatePrice ตัวเดียวกับ gate ทุกแถว
 * 🔴 เลขในตาราง = เลขที่ระบบจะบันทึกเป๊ะ (แหล่งเดียว) · เปลี่ยน config → ตารางเปลี่ยนตาม ไม่ต้อง deploy
 * หยุดที่ needsHandoff (เกินเพดาน) · เจอ error (config พัง) → คืน error ทันที (ผู้เรียกไม่ยัดตาราง)
 * @param paymentMethod ใช้ตัวเดียวกับ pending (COD บวกค่าส่งเพิ่ม) → ตารางตรงกับที่จะบันทึก
 */
export function buildPriceTable(
  sku: string,
  promoRows: string[][],
  productRows: string[][],
  config: Record<string, string>,
  paymentMethod: string,
  now?: Date,
): PriceTable {
  const rows: PriceTableRow[] = [];
  let name = sku;
  let unit = "";
  const SAFETY = 500; // กันวนไม่จบถ้า config เพี้ยน (ปกติหยุดที่ needsHandoff)
  for (let qty = 1; qty <= SAFETY; qty++) {
    const p = calculatePrice({ items: [{ sku, qty }], paymentMethod, now }, promoRows, productRows, config);
    if (p.error !== null) return { sku, name, unit, ceiling: rows.length, rows: [], error: p.error };
    if (p.needsHandoff) break; // qty นี้เกินเพดาน = จบตาราง (เพดาน = qty ก่อนหน้า)
    if (p.lines[0]) {
      name = p.lines[0].name;
      unit = p.lines[0].unit;
    }
    rows.push({ qty, subtotal: p.subtotal, shippingFee: p.shippingFee, total: p.total, freeShip: p.shippingFee === 0 });
  }
  if (rows.length === 0) return { sku, name, unit, ceiling: 0, rows: [], error: "คำนวณราคาไม่ได้ (ไม่มีโปร live/เพดานเป็น 0)" };
  return { sku, name, unit, ceiling: rows[rows.length - 1].qty, rows, error: null };
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

/**
 * ตัวแปร runtime ที่ "โค้ดเป็นเจ้าของ" ในรอบนี้ — เงิน/รายการ + แจกแจง/เสนอทางเลือก
 * 🔴 ค่า(ถ้อยคำ)มาจากโค้ด แต่ "เมื่อไหร่/ประตูไหนใช้" อยู่ในชีต Step (ท่าขาย = ชีต · D-15/§3)
 */
export const PRICING_RUNTIME_VARS = ["{สรุปรายการ}", "{ยอดรวม}", "{การชำระเงิน}", "{วิธีคิดยอด}", "{ทางเลือกถัดไป}"] as const;

export interface RuntimeVarContext {
  summary: string | null; // {สรุปรายการ} — null = ยังไม่มี items ให้ resolve (คงวงเล็บไว้)
  total: number | null; // {ยอดรวม}
  payment: string | null; // {การชำระเงิน}
  breakdown: string | null; // {วิธีคิดยอด} — "" ถ้า qty ตรงชั้นโปร
  nextTierOffer: string | null; // {ทางเลือกถัดไป} — "" ถ้าไม่มีชั้นสูงกว่า
}

/** สร้างค่า {วิธีคิดยอด}/{ทางเลือกถัดไป} จากผล pricing (ถ้อยคำในโค้ด · การใช้อยู่ในชีต) */
export function buildBreakdownVars(price: PriceResult): { breakdown: string; nextTierOffer: string } {
  const parts = price.lines
    .filter((l) => l.basePromo && !l.isExactTier)
    .map((l) => `(โปร ${l.basePromo!.qty} ${l.unit} ${l.basePromo!.price} บาท + เพิ่ม ${l.extraQty} ${l.unit} ${l.extraAmount} บาท)`);
  const breakdown = parts.join(" · ");
  const n = price.nextTier;
  const unit = price.lines[0]?.unit ?? "ชิ้น";
  const nextTierOffer = n ? `หรือรับโปร ${n.qty} ${unit} ${n.price} บาท เพิ่มอีก ${n.addAmount} บาท ได้เพิ่ม ${n.addQty} ${unit}ค่ะ` : "";
  return { breakdown, nextTierOffer };
}

/**
 * แทนตัวแปรเงิน/รายการที่โค้ดเป็นเจ้าของในข้อความ
 * 🔴 ตัวแปรอื่น ({ชื่อสินค้า}/{เลข อย.}/…) ปล่อยผ่าน — เป็นหน้าที่ AI ชั่วคราวจน resolver เต็ม (D-16)
 * ค่า null = ไม่แทน (คงวงเล็บ) เพื่อให้ guard ปลายทางจับได้ว่ายัง resolve ไม่ครบ
 */
export function resolveRuntimeVars(text: string, ctx: RuntimeVarContext): string {
  let out = text;
  if (ctx.summary !== null) out = out.split("{สรุปรายการ}").join(ctx.summary);
  if (ctx.total !== null) out = out.split("{ยอดรวม}").join(String(ctx.total));
  if (ctx.payment !== null) out = out.split("{การชำระเงิน}").join(ctx.payment);
  if (ctx.breakdown !== null) out = out.split("{วิธีคิดยอด}").join(ctx.breakdown);
  if (ctx.nextTierOffer !== null) out = out.split("{ทางเลือกถัดไป}").join(ctx.nextTierOffer);
  return out;
}

/** map sku → ชื่อสินค้า (CSV_Products) — ใช้แทน sku ในข้อความแจ้งแอดมิน (pure) */
export function buildProductNameMap(productRows: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  const pCols = resolveCols(productRows, [PRODUCT_COLS.sku, PRODUCT_COLS.name]);
  if (!pCols) return map;
  for (let i = pCols.headerRow + 1; i < productRows.length; i++) {
    const sku = cleanCell(productRows[i][pCols.cols[PRODUCT_COLS.sku]]);
    if (sku) map.set(sku, cleanCell(productRows[i][pCols.cols[PRODUCT_COLS.name]]));
  }
  return map;
}
