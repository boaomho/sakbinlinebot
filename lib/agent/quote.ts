/**
 * lib/agent/quote.ts — สะพานระหว่าง lib/core/pricing (pure) กับ route (I/O + prompt)
 *
 * 🔴 D-15: ยอดเงินคิดโดย pricing.ts เท่านั้น · ไฟล์นี้แค่จัด input จาก pending/lib/config
 *   แล้วเตรียมค่าไป resolve ตัวแปร {สรุปรายการ}/{ยอดรวม}/{การชำระเงิน} + guard ปลายทาง
 */
import {
  calculatePrice,
  PriceResult,
  RuntimeVarContext,
  formatOrderSummary,
  formatPayment,
  buildBreakdownVars,
  PRICING_RUNTIME_VARS,
  resolveRuntimeVars,
  resolveCatalogVars,
  resolveDeliveryVar,
  buildPromoInviteVar,
  PROMO_INVITE_VAR,
  CATALOG_TEXT_VARS,
  DELIVERY_VARS,
} from "@/lib/core/pricing";
import { PendingOrder, LastOrder, normalizeItems } from "@/lib/core/orders";
import { AppConfig } from "@/lib/config";
import { BotLibrary } from "@/lib/sheets/loader";
import { cleanHeader } from "@/lib/sheets/clean";

export interface Quote {
  price: PriceResult;
  /** ค่าไปแทนตัวแปร — summary/total = null เมื่อ pricing ยังไม่พร้อม (error/handoff) → ปล่อยวงเล็บให้ guard จับ */
  vars: RuntimeVarContext;
  /** pricing พร้อมพูดยอดได้ไหม (error===null && !needsHandoff) */
  ok: boolean;
}

/**
 * คำนวณราคาจาก pending_order · null = ไม่มี items (ยังไม่ต้องคิดราคา — ไม่ resolve ตัวแปรเงิน)
 * @param now วันอ้างอิงเช็คช่วงโปร (route ส่งเวลาไทยเข้ามา)
 */
export function computeQuote(pending: PendingOrder, lib: BotLibrary | null, config: AppConfig, now: Date): Quote | null {
  const items = pending.items ?? [];
  if (items.length === 0) return null;
  const price = calculatePrice(
    { items, paymentMethod: pending["การชำระเงิน"] ?? "", now },
    lib?.CSV_Promo ?? [],
    lib?.CSV_Products ?? [],
    Object.fromEntries(config.raw),
  );
  const ok = price.error === null && !price.needsHandoff;
  const bd = ok ? buildBreakdownVars(price) : null;
  const vars: RuntimeVarContext = {
    summary: ok ? formatOrderSummary(price.lines) : null,
    total: ok ? price.total : null,
    payment: pending["การชำระเงิน"] ? formatPayment(pending["การชำระเงิน"]) : null,
    breakdown: bd ? bd.breakdown : null,
    nextTierOffer: bd ? bd.nextTierOffer : null,
  };
  return { price, vars, ok };
}

/**
 * guard 5 — ข้อความ "ที่จะส่งออก" ต้องไม่เหลือตัวแปรเงินที่ resolve ไม่ได้
 * 🔴 เช็คเฉพาะ outgoing เท่านั้น (ไม่ใช่ prompt — prompt มี {...} ของประตูอื่นเป็นเรื่องปกติ)
 */
export function hasUnresolvedPricingVars(outgoing: string): boolean {
  return PRICING_RUNTIME_VARS.some((v) => outgoing.includes(v));
}

// ---- ตัวแปรข้อมูลโอนเงิน (โค้ด resolve จาก CSV_Config · guard ร้ายแรง ต่างจากราคาที่แค่ log) ----
// {เลขที่บัญชี} = ชื่อใหม่ · {เลขพร้อมเพย์} = alias เก่า (กันหน้าต่างที่ชีต/สเต็ปยังไม่ตรงกัน)
// 🔴 ค่าจริงเป็นเลขบัญชีธนาคาร ไม่ใช่พร้อมเพย์ — ปล่อยให้บอทพูด "โอนเข้าพร้อมเพย์ <เลข>" = ลูกค้าโอนไม่ได้
const ACCOUNT_NO_TOKENS = ["{เลขที่บัญชี}", "{เลขพร้อมเพย์}"];
const ACCOUNT_NAME_TOKEN = "{ชื่อบัญชี}";
const BANK_TOKEN = "{ธนาคาร}";
/** ตัวแปรโอนเงินทั้งหมด — ถ้าเหลือค้างในข้อความส่งออก = resolve ไม่ได้ (config ขาด) → ห้ามส่ง */
export const TRANSFER_VARS = [...ACCOUNT_NO_TOKENS, ACCOUNT_NAME_TOKEN, BANK_TOKEN] as const;

const TRANSFER_KEYS = {
  accountNo: ["เลขที่บัญชี", "เลขพร้อมเพย์"], // อ่านค่าใหม่ก่อน · เก่าเป็น fallback
  accountName: ["ชื่อบัญชี"],
  bank: ["ธนาคาร"],
};

/** อ่านค่าจาก config.raw ตามลำดับ candidate · คืน "" ถ้าไม่มี/ว่าง (ว่าง = ถือว่า resolve ไม่ได้) */
function pickConfig(config: AppConfig, keys: string[]): string {
  for (const k of keys) {
    const v = config.raw.get(k);
    if (v && v.trim() !== "") return v.trim();
  }
  return "";
}

/**
 * แทนตัวแปรข้อมูลโอนเงินในข้อความด้วยค่าจริงจาก CSV_Config (โค้ด resolve เอง ไม่พึ่ง AI)
 * 🔴 แทนเฉพาะเมื่อ config มีค่า (ไม่ว่าง) · ค่าว่าง/ไม่มี = ปล่อยวงเล็บค้างไว้ให้ guard จับ (กันส่ง "โอนเข้า ")
 */
export function resolveTransferVars(text: string, config: AppConfig): string {
  const accountNo = pickConfig(config, TRANSFER_KEYS.accountNo);
  const accountName = pickConfig(config, TRANSFER_KEYS.accountName);
  const bank = pickConfig(config, TRANSFER_KEYS.bank);
  let out = text;
  if (accountNo) for (const t of ACCOUNT_NO_TOKENS) out = out.split(t).join(accountNo);
  if (accountName) out = out.split(ACCOUNT_NAME_TOKEN).join(accountName);
  if (bank) out = out.split(BANK_TOKEN).join(bank);
  return out;
}

/** ตัวแปรโอนเงินที่ยัง resolve ไม่ได้ (เหลือค้าง) — ไม่ว่าง = ห้ามส่งข้อความออก + แจ้งแอดมิน */
export function unresolvedTransferVars(outgoing: string): string[] {
  return TRANSFER_VARS.filter((t) => outgoing.includes(t));
}

// ---- ตัวแปร "ข้อมูลออเดอร์ล่าสุด" (D-32) — โค้ด resolve จาก last_order ให้ Step ทวน/แก้ ----
// เจ้าของอ้างตัวแปรพวกนี้ในแถว S_EDIT ของ CSV_Step (ทวนข้อมูลใหม่ให้ลูกค้าหลังแก้)
/** @param itemsText สรุปรายการที่ผู้เรียก resolve ชื่อสินค้าแล้ว ("น้ำพริกปลาทู x3") */
export function resolveOrderVars(text: string, order: LastOrder | null, itemsText: string): string {
  if (!order) return text;
  const map: [string, string][] = [
    ["{ออเดอร์_ชื่อ}", order["ชื่อ"] ?? ""],
    ["{ออเดอร์_ที่อยู่}", order["ที่อยู่"] ?? ""],
    ["{ออเดอร์_เบอร์}", order["เบอร์"] ?? ""],
    ["{ออเดอร์_รายการ}", itemsText],
    ["{ออเดอร์_ยอด}", order.total != null ? String(order.total) : ""],
    ["{ออเดอร์_เลขที่}", order.order_id],
  ];
  let out = text;
  // D-49: ค่าว่าง = ไม่ replace (คง token ไว้) → var-guard ทิ้งบอลลูนนั้นตามกลไกเดิม · ห้ามโชว์ค่าว่าง/เลขปลอม
  //   (เช่น snapshot ทวนสด order_id ว่าง เพราะ cron ยังไม่แจกเลข → {ออเดอร์_เลขที่} ตกบอลลูนไป)
  for (const [k, v] of map) if (v !== "") out = out.split(k).join(v);
  return out;
}

// ---- ตัวแปรออเดอร์ล่าสุดทั้งหมด (D-32) — snapshot last_order (คนละชุดกับ pending!) ----
export const ORDER_VARS = [
  "{ออเดอร์_ชื่อ}",
  "{ออเดอร์_ที่อยู่}",
  "{ออเดอร์_เบอร์}",
  "{ออเดอร์_รายการ}",
  "{ออเดอร์_ยอด}",
  "{ออเดอร์_เลขที่}",
] as const;

// ---- ตัวแปร "ออเดอร์ที่กำลังคุย" (pending ปัจจุบัน · D-39) — สรุปก่อนบันทึก ----
// 🔴 {ชื่อ}/{ที่อยู่เต็ม}/{เบอร์} = pending (กำลังเก็บ) · ต่างจาก {ออเดอร์_*} = snapshot ที่บันทึกแล้ว
// {การชำระเงินใหม่} = วิธีจ่ายที่เพิ่งเปลี่ยน (เคส X1) · ต่างจาก {การชำระเงิน}(R1 · ต้องมี items)
export const PENDING_VARS = ["{ชื่อ}", "{ที่อยู่เต็ม}", "{เบอร์}", "{การชำระเงินใหม่}"] as const;

/**
 * แทนตัวแปร pending ปัจจุบัน (D-39) — จาก pending_order ที่กำลังเก็บ (ไม่ใช่ last_order)
 * 🔴 แทนเฉพาะเมื่อมีค่า (ว่าง = คงวงเล็บ → var-guard จับ · ไม่ส่งช่องว่างให้ลูกค้า)
 */
export function resolvePendingVars(text: string, pending: PendingOrder): string {
  if (!PENDING_VARS.some((v) => text.includes(v))) return text;
  let out = text;
  const name = (pending["ชื่อ"] ?? "").trim();
  const addr = (pending["ที่อยู่"] ?? "").trim();
  const phone = (pending["เบอร์"] ?? "").trim();
  const pay = (pending["การชำระเงิน"] ?? "").trim();
  if (name) out = out.split("{ชื่อ}").join(name);
  if (addr) out = out.split("{ที่อยู่เต็ม}").join(addr);
  if (phone) out = out.split("{เบอร์}").join(phone);
  if (pay) out = out.split("{การชำระเงินใหม่}").join(formatPayment(pay));
  return out;
}

// ---- ตัวแปร config (D-43) — ค่าส่ง/ยอดขั้นต่ำ อ่านตรงจาก config + ประโยคประกอบ ----
export const CONFIG_TEXT_VARS = ["{ค่าส่ง_มาตรฐาน}", "{ยอดขั้นต่ำส่งฟรี_บาท}", "{นโยบายค่าส่ง}"] as const;

/** แทนตัวแปร config (D-43): ค่าส่ง/ยอดขั้นต่ำ (ตรง) + {นโยบายค่าส่ง} (ประกอบ · 🔴 ไม่รองรับ COD เพิ่ม) */
export function resolveConfigVars(text: string, config: AppConfig): string {
  if (!CONFIG_TEXT_VARS.some((v) => text.includes(v))) return text;
  const ship = (config.raw.get("ค่าส่ง_มาตรฐาน") ?? "").trim();
  const freeMin = (config.raw.get("ยอดขั้นต่ำส่งฟรี_บาท") ?? "").trim();
  let out = text;
  if (ship) out = out.split("{ค่าส่ง_มาตรฐาน}").join(ship);
  if (freeMin) out = out.split("{ยอดขั้นต่ำส่งฟรี_บาท}").join(freeMin);
  if (out.includes("{นโยบายค่าส่ง}") && ship && freeMin) {
    out = out.split("{นโยบายค่าส่ง}").join(`ค่าส่ง ${ship} บาทค่ะ สั่งครบ ${freeMin} บาท ส่งฟรีเลยค่ะ`);
  }
  return out;
}

// ---- CSV_Vars (D-43) — ตัวแปรข้อความเจ้าของนิยามเอง · โหลดเฉพาะ live · ตัวแปรระบบชนะ ----
/** โหลด CSV_Vars เฉพาะ สถานะ=live + ชื่อมีปีกกา (กรอง draft/แถวกติกา) — pure */
export function loadLiveVars(varsRows: string[][]): { name: string; value: string }[] {
  if (!varsRows || varsRows.length < 2) return [];
  const header = varsRows[0].map(cleanHeader);
  const nameI = header.indexOf("ตัวแปร"), valI = header.indexOf("ค่า"), statI = header.indexOf("สถานะ");
  if (nameI === -1 || valI === -1) return [];
  const out: { name: string; value: string }[] = [];
  for (let i = 1; i < varsRows.length; i++) {
    const name = (varsRows[i][nameI] ?? "").trim();
    if (!name.startsWith("{")) continue; // แถวกติกา/ว่าง (ชื่อไม่มีปีกกา)
    if (statI >= 0 && (varsRows[i][statI] ?? "").trim().toLowerCase() !== "live") continue; // 🔴 strict live (draft ทิ้ง)
    out.push({ name, value: (varsRows[i][valI] ?? "").trim() });
  }
  return out;
}

/** แทนตัวแปร CSV_Vars (D-43) — 🔴 ชื่อชนตัวแปรระบบ (knownVars) → ข้าม+log (ระบบชนะ) */
export function resolveCsvVars(text: string, varsRows: string[][], knownVars: readonly string[]): string {
  const live = loadLiveVars(varsRows);
  if (live.length === 0) return text;
  let out = text;
  for (const { name, value } of live) {
    if (knownVars.includes(name)) {
      console.warn(JSON.stringify({ scope: "vars", event: "csv-var-collision-system-wins", name }));
      continue;
    }
    if (value && out.includes(name)) out = out.split(name).join(value);
  }
  return out;
}

/**
 * D-39/D-43 var-guard — ตัวแปร "ที่ resolver ระบบรู้จัก" (pricing+transfer+order+catalog+pending+delivery+config)
 * 🔴 กันเฉพาะชุดนี้ ไม่ใช่ `{...}` ทุกตัว · CSV_Vars (dynamic) ไม่อยู่ในนี้ (resolve หมดก่อน · draft กรองตอนโหลด)
 */
export const KNOWN_RUNTIME_VARS = [
  ...PRICING_RUNTIME_VARS, ...TRANSFER_VARS, ...ORDER_VARS,
  ...CATALOG_TEXT_VARS, ...PENDING_VARS, ...DELIVERY_VARS, ...CONFIG_TEXT_VARS,
  PROMO_INVITE_VAR, // D-45c
] as const;

/**
 * D-39 · resolver รวม pass เดียว — ทั้ง AI reply (โหมดเปิด) + verbatim (โหมดปิด) เรียกตัวนี้
 * 🔴 ลำดับ R1→R2→R3 คงเดิมเป๊ะ (AI mode ไม่ regression) · Group X (catalog/pending/delivery) ต่อท้าย
 *    ตัวแปรใหม่อนาคต = เพิ่มที่นี่ที่เดียว → ผ่านทั้ง 2 path อัตโนมัติ
 */
export interface AllVarsContext {
  priceVars: RuntimeVarContext;
  config: AppConfig;
  lastOrder: LastOrder | null;
  lastOrderItemsText: string;
  pending: PendingOrder;
  products: string[][];
  promo: string[][];
  /** D-43: CSV_Vars ดิบ (ตัวแปรข้อความเจ้าของ) */
  varsRows: string[][];
  now: Date;
}
export function resolveAllVars(text: string, ctx: AllVarsContext): string {
  let out = text;
  out = resolveRuntimeVars(out, ctx.priceVars); // R1 เงิน/รายการ
  out = resolveTransferVars(out, ctx.config); // R2 บัญชี
  out = resolveOrderVars(out, ctx.lastOrder, ctx.lastOrderItemsText); // R3 ออเดอร์ snapshot
  out = resolveCatalogVars(out, ctx.products, ctx.promo, ctx.now); // catalog (D-43 ขยาย)
  out = resolvePendingVars(out, ctx.pending); // pending ปัจจุบัน
  out = resolveDeliveryVar(out, ctx.config.raw.get("เวลาตัดรอบออเดอร์") ?? ctx.config.raw.get("เวลารอบตัดออเดอร์") ?? "", ctx.now); // วันจัดส่ง
  out = resolveConfigVars(out, ctx.config); // D-43 config/นโยบายค่าส่ง
  // D-45c {ชวนเลือกโปร}: contextQty = จำนวนล่าสุดใน pending (ไม่มี → 1) · เลขจาก calculatePrice เท่านั้น · คำนวณไม่ได้ → คงวงเล็บ (var-guard ทิ้ง)
  if (out.includes(PROMO_INVITE_VAR)) {
    const ctxQty = normalizeItems(ctx.pending.items)[0]?.qty ?? 1;
    const invite = buildPromoInviteVar(ctx.products, ctx.promo, Object.fromEntries(ctx.config.raw), ctx.pending["การชำระเงิน"] ?? "", ctxQty, ctx.now);
    if (invite) out = out.split(PROMO_INVITE_VAR).join(invite);
  }
  out = resolveCsvVars(out, ctx.varsRows, KNOWN_RUNTIME_VARS); // D-43 CSV_Vars (ระบบชนะ) · ท้ายสุด
  return out;
}

/**
 * แยกบอลลูน ([[เว้น]]/[[แยก]]) แล้วทิ้งบอลลูนที่ยังเหลือตัวแปร "ที่รู้จัก" resolve ไม่ได้
 * → ลูกค้าไม่มีวันเห็น `{ออเดอร์_ที่อยู่}` ดิบ (typo ตัวแปรผิด step / order ยังไม่มี)
 * คง separator เดิมของบอลลูนที่รอด (บอลลูนแรกไม่มี separator นำหน้า)
 */
export function dropUnresolvedVarBubbles(
  text: string,
  knownVars: readonly string[] = KNOWN_RUNTIME_VARS,
): { clean: string; dropped: string[] } {
  const parts = text.split(/(\[\[เว้น\]\]|\[\[แยก\]\])/);
  const dropped: string[] = [];
  const kept: { sep: string; body: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i];
    const sep = i === 0 ? "" : parts[i - 1];
    const hit = knownVars.filter((v) => body.includes(v));
    if (hit.length > 0) {
      dropped.push(...hit);
      continue;
    }
    kept.push({ sep, body });
  }
  const clean = kept.map((k, idx) => (idx === 0 ? "" : k.sep) + k.body).join("");
  return { clean: clean.trim(), dropped };
}

/**
 * KI-02 price guard (D-27) — เลข "X บาท" ที่บอทพูดต้องอยู่ใน allowed (raw+ตาราง+derived จาก buildAllowedPriceStrings)
 * คืนเลขที่ไม่อยู่ (มั่ว/injection) — route ตัดสินตาม `โหมดราคาผิด` (เตือน=ส่ง+log+push · บล็อก=พักสาย+push)
 * 🔴 เทียบเฉพาะ "X บาท" (extractBahtNumbers 2-5 หลัก) — qty/รหัสไปรษณีย์ไม่ตามด้วย "บาท" ไม่โดน
 */
export function findBadPrices(outgoing: string, allowed: Set<string>): string[] {
  return extractBahtNumbers(outgoing).filter((n) => !allowed.has(n));
}

// ---- claims blocklist (พ.ร.บ.อาหาร · D-26) — คำโฆษณาต้องห้ามจากชีต ----

/** แยกลิสต์คั่นด้วย comma จาก config → วลี (trim · ตัดว่าง) */
export function parseClaimsList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * หา "วลีโฆษณาต้องห้าม" ในข้อความส่งออก — match แบบ **วลี** ไม่ใช่คำเดี่ยว (เจ้าของตั้งลิสต์เป็นวลี)
 * 🔴 ยกเว้นชนะ: ถ้าวลีต้องห้าม b เป็นส่วนหนึ่งของ "วลียกเว้น" e ที่ปรากฏในข้อความ → ไม่นับ
 *    (กัน "รักษา" ใน "วิธีเก็บรักษา" ชนแบบ KI-01 ซ้ำรอย · เจ้าของคุมทั้ง 2 ลิสต์ในชีต)
 */
export function findBannedClaims(text: string, banned: string[], exceptions: string[]): string[] {
  const hits: string[] = [];
  for (const b of banned) {
    if (!b || !text.includes(b)) continue;
    const excused = exceptions.some((e) => e.includes(b) && text.includes(e));
    if (!excused) hits.push(b);
  }
  return hits;
}

/** ดึงตัวเลข "ราคา" (3-5 หลัก) จากข้อความ */
export function extractPriceNumbers(text: string): string[] {
  return text.match(/\d{3,5}/g) ?? [];
}

/**
 * ดึงตัวเลขที่บอท "นำเสนอเป็นยอดเงิน" — เลข 2-5 หลักที่ตามด้วย "บาท"
 * 🔴 เจาะจงบริบทเงินเท่านั้น กันเลขที่อยู่/รหัสไปรษณีย์/เบอร์มา false-positive (D-18 guard 2)
 */
export function extractBahtNumbers(text: string): string[] {
  return [...text.matchAll(/(\d{2,5})\s*บาท/g)].map((m) => m[1]);
}

/**
 * guard 2 — ตัวเลขราคา (3-5 หลัก) ใน outgoing ต้องเป็นเลขที่ "อยู่ในบล็อกที่ inject ให้ pass 2" เท่านั้น
 * 🔴 whitelist = regex ดึงจาก string จริงที่ inject ไป (ตัวเลขทุกตัวจาก calculatePrice ตัวเดียวกัน)
 *    ไม่ใช่ลิสต์ field ที่เลือกมือ — เพราะเราสั่ง pass 2 ให้ "แจกแจง" ตัวเลขในบล็อกเอง
 * @param allowedText ข้อความที่ Core inject ไป (note + ค่าตัวแปรที่ resolve: summary/total/breakdown/nextTierOffer)
 * @param extraNums เลขเพิ่ม (เช่น qty จาก items)
 */
export function checkReplyNumbers(
  outgoing: string,
  allowedText: string,
  extraNums: number[] = [],
): { ok: boolean; offending: string[]; allowed: string[] } {
  const allowed = new Set<string>([...extractPriceNumbers(allowedText), ...extraNums.map(String)]);
  const offending = extractPriceNumbers(outgoing).filter((n) => !allowed.has(n));
  return { ok: offending.length === 0, offending, allowed: [...allowed] };
}
