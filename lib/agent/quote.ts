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
  const vars: RuntimeVarContext = {
    summary: ok ? formatOrderSummary(price.lines) : null,
    total: ok ? price.total : null,
    payment: pending["การชำระเงิน"] ? formatPayment(pending["การชำระเงิน"]) : null,
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

/**
 * guard 2 — ตัวเลข "ราคา" (3-5 หลัก) ใน outgoing ต้องเป็นเลขที่ Core รู้จักเท่านั้น
 * allowed = total/subtotal/shippingFee/lineTotals + เลขที่อยู่ใน {สรุปรายการ} ที่ resolve มา
 * (เช่น "จากปกติ 475 ลดเหลือ 440" ใน ข้อความโชว์ = ถูกต้อง) · เลขแปลกปลอม = บอทมั่ว → บล็อก
 * คืน true = ผ่าน (เลขตรง Core) · false = มีเลขที่ Core ไม่รู้จัก
 */
export function replyNumbersConsistent(outgoing: string, price: PriceResult, resolvedSummary: string | null): boolean {
  const allowed = new Set<string>();
  const add = (n: number) => allowed.add(String(n));
  add(price.total);
  add(price.subtotal);
  add(price.shippingFee);
  for (const l of price.lines) {
    add(l.lineTotal);
    add(l.qty);
  }
  // เลขที่มากับข้อความโชว์ (auto) ที่ resolve มา = ราคาปกติ/ประหยัด ที่คนเทรนเขียนในชีต = ถูกต้อง
  if (resolvedSummary) for (const m of resolvedSummary.match(/\d{3,5}/g) ?? []) allowed.add(m);
  for (const m of outgoing.match(/\d{3,5}/g) ?? []) {
    if (!allowed.has(m)) return false;
  }
  return true;
}
