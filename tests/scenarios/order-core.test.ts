import { describe, it, expect } from "vitest";
import {
  sanitizePhone,
  nameComplete,
  addressComplete,
  evaluateOrderGate,
  buildPriceStuckAdminText,
} from "@/lib/core/orders";

/**
 * โดเมนออเดอร์ (pure) — กติกาใหม่หลังเคสออเดอร์หายเงียบ
 * เดิม addressComplete บังคับ ตำบล/อำเภอ/จังหวัด แยกเป็นฟิลด์ → ลูกค้าพิมพ์ที่อยู่ก้อนเดียว
 * = complete=false ตลอดกาล ทั้งที่จ่ายเงินแล้ว
 */

describe("sanitizePhone — strip เหลือแต่ตัวเลข ไม่เช็คอะไรเลย", () => {
  it.each([
    ["081-112 2334", "0811122334"],
    ["081-112-2334", "0811122334"],
    ["081 112 2334", "0811122334"],
    ["0811122334", "0811122334"],
    ["(081) 112-2334", "0811122334"],
    ["02-1234567", "021234567"],   // เบอร์บ้าน 9 หลัก
    ["038-123456", "038123456"],
    ["เบอร์ 081 112 2334 ค่ะ", "0811122334"], // มีตัวหนังสือปน
  ])("%s → %s", (input, expected) => {
    expect(sanitizePhone(input)).toBe(expected);
  });

  it("ไม่มีตัวเลขเลย → ว่าง", () => {
    expect(sanitizePhone("ไม่มีเบอร์")).toBe("");
    expect(sanitizePhone("")).toBe("");
    expect(sanitizePhone(undefined)).toBe("");
  });
});

describe("nameComplete — ≥2 ตัวอักษร รับชื่อเล่น/ร้าน/บริษัท", () => {
  it.each([
    ["สมหญิง ใจดี", true],
    ["บี", true],
    ["ร้านป้าแดง", true],
    ["ก", false],
    ["", false],
  ])("%s → %s", (name, expected) => {
    expect(nameComplete({ ชื่อ: name })).toBe(expected);
  });
});

describe("addressComplete — ก้อนไม่ว่างพอ ไม่บังคับ ต./อ./จ.", () => {
  it("🔴 เคสจริงที่พัง: ก้อนเดียวไม่มี ต./อ./จ. นำ → ต้องผ่าน", () => {
    expect(addressComplete({ ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540" })).toBe(true);
  });
  it("ที่อยู่สั้น ๆ ก็ผ่าน (แอดมิน/ขนส่งตามต่อเอง)", () => {
    expect(addressComplete({ ที่อยู่: "123 หมู่บ้านสุขใจ" })).toBe(true);
  });
  it("ว่าง → ไม่ผ่าน", () => {
    expect(addressComplete({ ที่อยู่: "  " })).toBe(false);
    expect(addressComplete({})).toBe(false);
  });
});

describe("evaluateOrderGate (D-15: items + priceOk)", () => {
  // base = ข้อมูลจัดส่ง + items · gate ครบ = shipping + itemsOk + priceOk
  const base = {
    ชื่อ: "สมหญิง ใจดี",
    ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540",
    items: [{ sku: "NPT-10G", qty: 3 }],
  };

  it("COD + จัดส่งครบ + items + priceOk → complete", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "081-112 2334", การชำระเงิน: "COD" }, slipPresent: false, priceOk: true });
    expect(g.complete).toBe(true);
    expect(g.missing).toEqual([]);
    expect(g.brokenOrder).toBe(false);
  });

  it("🔴 bug B regression: จัดส่งครบ แต่ไม่มี items → complete=false + brokenOrder + push", () => {
    // AI extract แค่ ชื่อ/ที่อยู่/เบอร์ (ไม่มี items) — เคสที่ gate เคยปล่อยผ่านผิด
    const g = evaluateOrderGate({
      pending: { ชื่อ: "บูม", ที่อยู่: "1 ถ.เจริญ กทม.", เบอร์: "0912345678", การชำระเงิน: "COD" },
      slipPresent: false,
      priceOk: false,
    });
    expect(g.complete, "ไม่มี items = ห้าม complete").toBe(false);
    expect(g.missing).toContain("รายการสินค้า");
    expect(g.brokenOrder, "จัดส่งครบแต่ไม่มี items → แจ้งแอดมิน").toBe(true);
  });

  it("มี items แต่ pricing ล้ม (priceOk=false) → complete=false (ยอด/เพดานคำนวณไม่ได้)", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "0912345678", การชำระเงิน: "COD" }, slipPresent: false, priceOk: false });
    expect(g.complete).toBe(false);
    // items มีอยู่ → ไม่ใช่ brokenOrder (ผู้เรียกจัดการ price ล้มแยกจาก priceResult)
    expect(g.brokenOrder).toBe(false);
  });

  it("COD + เบอร์บ้าน → complete (ไม่เช็คมือถือแล้ว แอดมินตรวจเอง)", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "02-1234567", การชำระเงิน: "COD" }, slipPresent: false, priceOk: true });
    expect(g.complete).toBe(true);
  });

  it("โอน + เบอร์บ้าน + สลิป → complete (เกณฑ์เบอร์เหมือน COD)", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "021234567", การชำระเงิน: "โอน" }, slipPresent: true, priceOk: true });
    expect(g.complete).toBe(true);
  });

  it("ขาดเบอร์ → ไม่ครบ · missing มี เบอร์ (บอทขอเบอร์ต่อ)", () => {
    const g = evaluateOrderGate({ pending: { ...base, การชำระเงิน: "COD" }, slipPresent: false, priceOk: true });
    expect(g.complete).toBe(false);
    expect(g.missing).toContain("เบอร์");
  });

  it("โอน + ที่อยู่ + ไม่มีสลิป → ไม่ครบ + รอโอน · missing มี สลิป", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "0811122334", การชำระเงิน: "โอน" }, slipPresent: false, priceOk: true });
    expect(g.complete).toBe(false);
    expect(g.waitTag).toBe("รอโอน");
    expect(g.missing).toContain("สลิป");
  });

  it("โอน + สลิป + ไม่มีที่อยู่ → ไม่ครบ · missing มี ที่อยู่ (บอทขอที่อยู่ · แอดมินรู้จากสลิปแล้ว)", () => {
    const g = evaluateOrderGate({ pending: { การชำระเงิน: "โอน", เบอร์: "0811122334", ชื่อ: "สมหญิง", items: base.items }, slipPresent: true, priceOk: true });
    expect(g.complete).toBe(false);
    expect(g.missing).toContain("ที่อยู่");
  });

  it("ยังไม่เลือกวิธีจ่าย → ไม่ครบ ไม่มีแท็กรอ", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "0811122334" }, slipPresent: false, priceOk: true });
    expect(g.complete).toBe(false);
    expect(g.waitTag).toBeNull();
  });

  it("ได้แค่ที่อยู่ → ไม่ครบ · missing มี ชื่อ+เบอร์ (บอทต้องขอทั้งคู่ต่อ)", () => {
    const g = evaluateOrderGate({ pending: { ที่อยู่: base.ที่อยู่, การชำระเงิน: "COD" }, slipPresent: false, priceOk: false });
    expect(g.complete).toBe(false);
    expect(g.missing).toContain("ชื่อ");
    expect(g.missing).toContain("เบอร์");
  });
});

describe("🔴 readyExceptPrice — แจ้งแอดมิน 'ราคาคำนวณไม่ได้' ตอนข้อมูลครบ ไม่ใช่ระหว่างทาง", () => {
  const full = {
    ชื่อ: "สมหญิง ใจดี",
    ที่อยู่: "123/45 ม.6 บางพลี สมุทรปราการ 10540",
    เบอร์: "0811122334",
    items: [{ sku: "NPT-10G", qty: 3 }],
  };

  it("COD + ข้อมูลลูกค้าครบ + items (priceOk=false) → readyExceptPrice=true (แจ้งแอดมินพร้อมข้อมูลเต็ม)", () => {
    const g = evaluateOrderGate({ pending: { ...full, การชำระเงิน: "COD" }, slipPresent: false, priceOk: false });
    expect(g.readyExceptPrice).toBe(true);
    expect(g.complete).toBe(false); // ราคายังไม่ผ่าน = ยังไม่เขียนชีต
  });

  it("🔴 เทิร์นแรก: มีแค่ items ยังไม่มีที่อยู่/เบอร์ → readyExceptPrice=false (ห้ามแจ้งเร็ว-เผา flag)", () => {
    const g = evaluateOrderGate({ pending: { items: full.items, การชำระเงิน: "COD" }, slipPresent: false, priceOk: false });
    expect(g.readyExceptPrice, "ข้อมูลติดต่อยังไม่ครบ = ยังไม่ต้องแจ้ง").toBe(false);
  });

  it("โอน: ครบทุกอย่าง + สลิป → true · ไม่มีสลิป → false", () => {
    const withSlip = evaluateOrderGate({ pending: { ...full, การชำระเงิน: "โอน" }, slipPresent: true, priceOk: false });
    const noSlip = evaluateOrderGate({ pending: { ...full, การชำระเงิน: "โอน" }, slipPresent: false, priceOk: false });
    expect(withSlip.readyExceptPrice).toBe(true);
    expect(noSlip.readyExceptPrice).toBe(false);
  });

  it("ยังไม่เลือกวิธีจ่าย → false", () => {
    const g = evaluateOrderGate({ pending: { ...full }, slipPresent: false, priceOk: false });
    expect(g.readyExceptPrice).toBe(false);
  });

  it("ไม่มี items (brokenOrder แทน) → readyExceptPrice=false", () => {
    const g = evaluateOrderGate({ pending: { ชื่อ: "บูม", ที่อยู่: "1 ถ.เจริญ", เบอร์: "0811122334", การชำระเงิน: "COD" }, slipPresent: false, priceOk: false });
    expect(g.readyExceptPrice).toBe(false);
    expect(g.brokenOrder).toBe(true); // คนละเคส — ไม่มี items
  });
});

describe("buildPriceStuckAdminText — แอดมินได้ข้อมูลติดต่อลูกค้าเต็ม", () => {
  it("มี ชื่อ/เบอร์/ที่อยู่/รายการ + เหตุผลราคา + บอกว่ายังไม่บันทึก", () => {
    const text = buildPriceStuckAdminText(
      { ชื่อ: "สมหญิง ใจดี", เบอร์: "081-112 2334", ที่อยู่: "123/45 ม.6 สมุทรปราการ", การชำระเงิน: "COD" },
      "เกินเพดานจำนวน",
      "LINE สมหญิง",
      "น้ำพริกปลาทู x12",
    );
    expect(text).toContain("สมหญิง ใจดี");
    expect(text).toContain("0811122334"); // sanitize เบอร์
    expect(text).toContain("123/45 ม.6 สมุทรปราการ");
    expect(text).toContain("น้ำพริกปลาทู x12");
    expect(text).toContain("เกินเพดานจำนวน");
    expect(text).toMatch(/ยังไม่ถูกบันทึก|รอแอดมิน/);
  });
});
