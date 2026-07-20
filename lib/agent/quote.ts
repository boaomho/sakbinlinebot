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
} from "@/lib/core/pricing";
import { PendingOrder } from "@/lib/core/orders";
import { AppConfig } from "@/lib/config";
import { BotLibrary } from "@/lib/sheets/loader";

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
