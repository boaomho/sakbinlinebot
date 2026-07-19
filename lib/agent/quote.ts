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
