import { describe, it, expect, vi } from "vitest";
import {
  resolveRuntimeVars,
  formatOrderSummary,
  formatLinesForSheet,
  calculatePrice,
  resolveAiItems,
  liveProductSkus,
  buildPriceTable,
} from "@/lib/core/pricing";
import { computeQuote, hasUnresolvedPricingVars, checkReplyNumbers } from "@/lib/agent/quote";
import { productsRows, promoRows, PRICING_CONFIG } from "../harness/botlib-fixture";
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

describe("Step 3 · จำนวนที่ไม่มีโปร_คิดยังไง — วิธีคิดเศษเกินชั้นโปร (คุมด้วยชีต ไม่ hardcode)", () => {
  // 4 ถ้วย: ฐาน P3 (3 ถ้วย 275) + เศษ 1 ถ้วย · วิธีต่างกัน → ยอดต่างกัน
  const cfg = (extra?: string): Record<string, string> => ({
    ...PRICING_CONFIG,
    ...(extra !== undefined ? { จำนวนที่ไม่มีโปร_คิดยังไง: extra } : {}),
  });
  const four = (config: Record<string, string>) =>
    calculatePrice({ items: [{ sku: "NPT-10G", qty: 4 }], paymentMethod: "โอน", now: NOW }, promoRows(), productsRows(), config);

  it("ไม่มี key → default เทียบโปรฐาน → 4 ถ้วย = 367 (พฤติกรรมเดิม · ไม่ regression)", () => {
    expect(four(cfg()).total).toBe(367); // 275 + 1×(275/3=91.67) → ceil 367
  });
  it('ค่า "เทียบโปรฐาน" → 367 (เท่ากับ default)', () => {
    expect(four(cfg("เทียบโปรฐาน")).total).toBe(367);
  });
  it('🔴 ค่า "ราคาปกติ" → เศษคิด 95 → 4 ถ้วย = 370 (เปลี่ยนชีต เลขเปลี่ยน ไม่แตะโค้ด)', () => {
    const r = four(cfg("ราคาปกติ"));
    expect(r.error).toBeNull();
    expect(r.total).toBe(370); // 275 + 1×95
  });
  it("🔴 ค่าที่พิมพ์ผิด/ไม่รู้จัก → error + handoff (ไม่เดาเงียบแบบ D-15)", () => {
    const r = four(cfg("มั่วๆ"));
    expect(r.error).toMatch(/จำนวนที่ไม่มีโปร/);
    expect(r.needsHandoff).toBe(true);
    expect(r.total).toBe(0); // ห้ามพูดยอด
  });
  it("ตรงชั้นโปรพอดี (3 ถ้วย · ไม่มีเศษ) → 275 เท่ากันทั้งสองวิธี", () => {
    const three = (c: Record<string, string>) =>
      calculatePrice({ items: [{ sku: "NPT-10G", qty: 3 }], paymentMethod: "โอน", now: NOW }, promoRows(), productsRows(), c);
    expect(three(cfg("เทียบโปรฐาน")).total).toBe(275);
    expect(three(cfg("ราคาปกติ")).total).toBe(275);
  });
});

describe("buildPriceTable — D-24: ตารางราคา = calculatePrice ทุกแถว (เลข = ที่ gate บันทึก)", () => {
  const cfg = (extra?: Record<string, string>) => ({ ...PRICING_CONFIG, ...(extra ?? {}) });

  it("enumerate 1..เพดาน(20) · เลขแต่ละแถว = calculatePrice ตัวเดียวกัน (แหล่งเดียว)", () => {
    const t = buildPriceTable("NPT-10G", promoRows(), productsRows(), cfg(), "โอน", NOW);
    expect(t.error).toBeNull();
    expect(t.ceiling).toBe(20); // maxPromoQty 10 × mult 2
    expect(t.rows).toHaveLength(20);
    // ตรวจ invariant: ทุกแถว total ตรงกับ calculatePrice(qty) เป๊ะ
    for (const r of t.rows) {
      const p = calculatePrice({ items: [{ sku: "NPT-10G", qty: r.qty }], paymentMethod: "โอน", now: NOW }, promoRows(), productsRows(), cfg());
      expect(r.total, `qty ${r.qty}`).toBe(p.total);
    }
    expect(t.rows.find((r) => r.qty === 4)?.total).toBe(367);
    expect(t.rows.find((r) => r.qty === 3)?.freeShip).toBe(true);
    expect(t.rows.find((r) => r.qty === 1)).toMatchObject({ subtotal: 95, shippingFee: 30, total: 125, freeShip: false });
  });

  it("ราคาปกติ → qty4 total 370 (config เปลี่ยน ตารางเปลี่ยน)", () => {
    const t = buildPriceTable("NPT-10G", promoRows(), productsRows(), cfg({ จำนวนที่ไม่มีโปร_คิดยังไง: "ราคาปกติ" }), "โอน", NOW);
    expect(t.rows.find((r) => r.qty === 4)?.total).toBe(370);
  });

  it("config ราคาหาย → error + ไม่มีแถว (ผู้เรียกไม่ยัดตาราง)", () => {
    const t = buildPriceTable("NPT-10G", promoRows(), productsRows(), cfg({ ค่าส่ง_มาตรฐาน: "" }), "โอน", NOW);
    expect(t.error).not.toBeNull();
    expect(t.rows).toHaveLength(0);
  });

  it("sku coming_soon → error (ขายไม่ได้ ไม่ยัดตาราง)", () => {
    const t = buildPriceTable("NPR-200ML", promoRows(), productsRows(), cfg(), "โอน", NOW);
    expect(t.error).not.toBeNull();
  });
});

describe("resolveAiItems — D-20: AI ส่งแค่ qty · โค้ดใส่ sku (สินค้า live)", () => {
  it("live ตัวเดียว (fixture: NPT-10G live · NPR-200ML coming_soon) → ใส่ sku ให้ทุก element", () => {
    expect(liveProductSkus(productsRows())).toEqual(["NPT-10G"]);
    expect(resolveAiItems([{ qty: 4 }], productsRows())).toEqual([{ sku: "NPT-10G", qty: 4 }]);
    // หลาย element → ได้ sku เดียวกันทุกอัน (รองรับหลายรายการ)
    expect(resolveAiItems([{ qty: 2 }, { qty: 3 }], productsRows())).toEqual([
      { sku: "NPT-10G", qty: 2 },
      { sku: "NPT-10G", qty: 3 },
    ]);
  });

  it("qty<=0 / ว่าง → กรองทิ้ง", () => {
    expect(resolveAiItems([{ qty: 0 }, { qty: -1 }], productsRows())).toEqual([]);
    expect(resolveAiItems([], productsRows())).toEqual([]);
    expect(resolveAiItems(undefined, productsRows())).toEqual([]);
  });

  it("🔴 live หลายตัว → log เตือน + [] (ไม่เดา · design เผื่อสินค้าที่ 2)", () => {
    const twoLive = [
      ["sku", "ชื่อสินค้า", "ราคาปกติ_ต่อหน่วย", "สถานะ"],
      ["NPT-10G", "น้ำพริกปลาทู", "95", "live"],
      ["NPR-200ML", "น้ำปลาร้า", "90", "live"], // สมมติ ต.ค. live
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveAiItems([{ qty: 3 }], twoLive)).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).toContain("ไม่ใช่ 1 ตัว");
    warn.mockRestore();
  });
});

// helper: config เป็น key→value map (pricing รับ Record<string,string>)
function testConfigMap(): Record<string, string> {
  return Object.fromEntries(testConfig().raw);
}
