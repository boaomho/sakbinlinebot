import { describe, it, expect } from "vitest";
import {
  resolveRuntimeVars,
  formatOrderSummary,
  formatLinesForSheet,
  calculatePrice,
} from "@/lib/core/pricing";
import { computeQuote, hasUnresolvedPricingVars, replyNumbersConsistent } from "@/lib/agent/quote";
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
    });
    expect(out).toBe("ปลาทู x4 รวม 367 บาท จ่าย โอนเงิน · สินค้า {ชื่อสินค้า}");
  });

  it("ctx = null → คงวงเล็บไว้ (ให้ guard ปลายทางจับ)", () => {
    const out = resolveRuntimeVars("ยอด {ยอดรวม} บาท", { summary: null, total: null, payment: null });
    expect(out).toBe("ยอด {ยอดรวม} บาท");
  });
});

describe("formatOrderSummary / formatLinesForSheet — หลาย sku ต่อกันถูก", () => {
  const lines = [
    { sku: "A", name: "ปลาทู", qty: 4, basePromoId: null, unitPrice: 90, lineTotal: 360, exactPromoMessage: null },
    { sku: "B", name: "ปลาร้า", qty: 2, basePromoId: null, unitPrice: 100, lineTotal: 200, exactPromoMessage: null },
  ];
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

describe("guard 2 — replyNumbersConsistent (เลข 3-5 หลักต้องตรง Core)", () => {
  const price = calculatePrice({ items: [{ sku: "NPT-10G", qty: 4 }], paymentMethod: "โอน", now: NOW }, promoRows(), productsRows(), testConfigMap());
  it("reply พูด total ถูก (367) → ผ่าน", () => {
    expect(replyNumbersConsistent("รับ 4 ถ้วย 367 บาทค่ะ", price, "น้ำพริกปลาทู x4")).toBe(true);
  });
  it("reply พูดเลขมั่ว (999) → ไม่ผ่าน (บล็อก)", () => {
    expect(replyNumbersConsistent("รับ 4 ถ้วย 999 บาทค่ะ", price, null)).toBe(false);
  });
  it("เลขจาก {สรุปรายการ}/ข้อความโชว์ (เช่น 475 จากปกติ) → ผ่าน", () => {
    expect(replyNumbersConsistent("จากปกติ 475 ลดเหลือ 367 บาท", price, "จากปกติ 475 บาท")).toBe(true);
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
