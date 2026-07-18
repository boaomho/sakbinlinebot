import { describe, it, expect } from "vitest";
import {
  resolveRuntimeVars,
  formatOrderSummary,
  formatLinesForSheet,
  calculatePrice,
} from "@/lib/core/pricing";
import { computeQuote, hasUnresolvedPricingVars, checkReplyNumbers } from "@/lib/agent/quote";
import { productsRows, promoRows } from "../harness/botlib-fixture";
import { testConfig } from "../harness/fixtures";
import type { BotLibrary } from "@/lib/sheets/loader";

/**
 * D-15 resolver + quote (pure) — ตัวแปรเงิน, guard 2/5, computeQuote จาก fixture ชีตจริง
 * รวม "แถวอันตราย" (blank/note/coming_soon/สิ้นสุดว่าง) + กันชีตเปลี่ยนแล้วโค้ดไม่รู้ตัว
 */

const NOW = new Date("2026-07-18T03:00:00Z"); // ไทย 2026-07-18
const lib = (promoOverride: Record<string, string> = {}): BotLibrary => ({
  CSV_Step: [], CSV_Objections: [], CSV_Examples: [], CSV_FAQ: [], CSV_Follow: [], CSV_Config: [],
  CSV_Products: productsRows(),
  CSV_Promo: promoRows(promoOverride),
});

describe("resolveRuntimeVars — แทนเฉพาะ 3 ตัวแปรเงิน · ตัวอื่นปล่อยผ่าน", () => {
  it("{สรุปรายการ}/{ยอดรวม}/{การชำระเงิน} ถูกแทน · {ชื่อสินค้า} ปล่อยผ่านให้ AI", () => {
    const out = resolveRuntimeVars("{สรุปรายการ} รวม {ยอดรวม} บาท จ่าย {การชำระเงิน} · สินค้า {ชื่อสินค้า}", {
      summary: "ปลาทู x4",
      total: 367,
      payment: "โอนเงิน",
      breakdown: null,
      nextTierOffer: null,
    });
    expect(out).toBe("ปลาทู x4 รวม 367 บาท จ่าย โอนเงิน · สินค้า {ชื่อสินค้า}");
  });

  it("ctx = null → คงวงเล็บไว้ (ให้ guard ปลายทางจับ)", () => {
    const out = resolveRuntimeVars("ยอด {ยอดรวม} บาท", { summary: null, total: null, payment: null, breakdown: null, nextTierOffer: null });
    expect(out).toBe("ยอด {ยอดรวม} บาท");
  });
});

describe("formatOrderSummary / formatLinesForSheet — หลาย sku ต่อกันถูก", () => {
  const mk = (sku: string, name: string, qty: number, lineTotal: number) => ({
    sku, name, unit: "ถ้วย", qty, basePromoId: null, basePromo: null, extraQty: qty, extraAmount: 0,
    isExactTier: false, unitPrice: 0, lineTotal, exactPromoMessage: null,
  });
  const lines = [mk("A", "ปลาทู", 4, 360), mk("B", "ปลาร้า", 2, 200)];
  it("{สรุปรายการ} คั่น ' · '", () => {
    expect(formatOrderSummary(lines)).toBe("ปลาทู x4 · ปลาร้า x2");
  });
  it("ชีต I คั่น ' | '", () => {
    expect(formatLinesForSheet(lines)).toBe("ปลาทู x4 | ปลาร้า x2");
  });
});

describe("guard 5 — hasUnresolvedPricingVars (เฉพาะตัวแปรเงิน)", () => {
  it("เหลือ {ยอดรวม} → true", () => {
    expect(hasUnresolvedPricingVars("ยอด {ยอดรวม} บาท")).toBe(true);
  });
  it("เหลือ {ชื่อสินค้า} (ไม่ใช่ตัวแปรเงิน) → false (ไม่บล็อก)", () => {
    expect(hasUnresolvedPricingVars("สินค้า {ชื่อสินค้า}")).toBe(false);
  });
  it("ไม่มีวงเล็บ → false", () => {
    expect(hasUnresolvedPricingVars("ยอด 367 บาท")).toBe(false);
  });
});

describe("guard 2 — checkReplyNumbers (whitelist = เลขในบล็อกที่ inject จริง)", () => {
  // บล็อก qty4: total 367 · วิธีคิด (โปร 3 ถ้วย 275 + เพิ่ม 1 ถ้วย 92) · ทางเลือก 5 ถ้วย 440 เพิ่ม 73
  const block = "ยอดรวม 367 บาท · วิธีคิด (โปร 3 ถ้วย 275 บาท + เพิ่ม 1 ถ้วย 92 บาท) · ทางเลือก 5 ถ้วย 440 บาท เพิ่มอีก 73 บาท";
  it("พูดเลขในบล็อก (367/275/440) → ผ่าน", () => {
    expect(checkReplyNumbers("โปร 3 ถ้วย 275 เพิ่ม 92 รวม 367 · หรือ 5 ถ้วย 440 เพิ่ม 73", block).ok).toBe(true);
  });
  it("พูดเลขนอกบล็อก (450) → บล็อก + รายงาน offending", () => {
    const r = checkReplyNumbers("รับ 4 ถ้วย 450 บาท", block);
    expect(r.ok).toBe(false);
    expect(r.offending).toContain("450");
  });
  it("เลข 1-2 หลัก (qty 4/5) ไม่ทำให้บล็อกโดยไม่จำเป็น", () => {
    expect(checkReplyNumbers("รับ 4 ถ้วย เพิ่มเป็น 5 ก็ได้นะคะ", block).ok).toBe(true);
  });
});

describe("computeQuote — จาก fixture ชีตจริง (มีแถวอันตราย)", () => {
  it("items ว่าง → null (ยังไม่คิดราคา)", () => {
    expect(computeQuote({ items: [] }, lib(), testConfig(), NOW)).toBeNull();
  });

  it("qty3 → ok · total 275 · vars.summary มีชื่อสินค้า (ข้าม blank/note row ได้)", () => {
    const q = computeQuote({ items: [{ sku: "NPT-10G", qty: 3 }], การชำระเงิน: "โอน" }, lib(), testConfig(), NOW);
    expect(q?.ok).toBe(true);
    expect(q?.price.total).toBe(275);
    expect(q?.vars.total).toBe(275);
    expect(q?.vars.summary).toContain("น้ำพริกปลาทูฟรีซดราย x3");
    expect(q?.vars.payment).toBe("โอนเงิน");
  });

  it("🔴 coming_soon (NPR-200ML) → error ok=false (ขายไม่ได้)", () => {
    const q = computeQuote({ items: [{ sku: "NPR-200ML", qty: 1 }] }, lib(), testConfig(), NOW);
    expect(q?.ok).toBe(false);
    expect(q?.price.error).toMatch(/ไม่ได้ขาย|coming_soon/);
  });

  it("🔴 แถวหมายเหตุ/แถวว่าง ไม่ถูก parse เป็นโปร → qty1 ยังได้ 125", () => {
    const q = computeQuote({ items: [{ sku: "NPT-10G", qty: 1 }], การชำระเงิน: "COD" }, lib(), testConfig(), NOW);
    expect(q?.price.total).toBe(125);
  });
});

describe("🔴 กันชีตเปลี่ยนแล้วโค้ดไม่รู้ตัว — ไม่มีเลข hardcode", () => {
  it("เปลี่ยนราคา P5 440→400 ใน fixture → total qty5 เปลี่ยนตาม (440→400)", () => {
    const before = computeQuote({ items: [{ sku: "NPT-10G", qty: 5 }], การชำระเงิน: "โอน" }, lib(), testConfig(), NOW);
    const after = computeQuote({ items: [{ sku: "NPT-10G", qty: 5 }], การชำระเงิน: "โอน" }, lib({ P5: "400" }), testConfig(), NOW);
    expect(before?.price.total).toBe(440);
    expect(after?.price.total, "ราคาต้องมาจากชีต ไม่ hardcode").toBe(400);
  });
});

// helper: config เป็น key→value map (pricing รับ Record<string,string>)
function testConfigMap(): Record<string, string> {
  return Object.fromEntries(testConfig().raw);
}
