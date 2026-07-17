import { describe, it, expect } from "vitest";
import {
  sanitizePhone,
  isMobilePhone,
  nameComplete,
  addressComplete,
  evaluateOrderGate,
} from "@/lib/core/orders";

/**
 * โดเมนออเดอร์ (pure) — กติกาใหม่หลังเคสออเดอร์หายเงียบ
 * เดิม addressComplete บังคับ ตำบล/อำเภอ/จังหวัด แยกเป็นฟิลด์ → ลูกค้าพิมพ์ที่อยู่ก้อนเดียว
 * = complete=false ตลอดกาล ทั้งที่จ่ายเงินแล้ว
 */

describe("sanitizePhone — รับเบอร์ได้ทุกรูปแบบ (มือถือ 10 / เบอร์บ้าน 9)", () => {
  it.each([
    ["081-112 2334", "0811122334"],
    ["081-112-2334", "0811122334"],
    ["081 112 2334", "0811122334"],
    ["0811122334", "0811122334"],
    ["(081) 112-2334", "0811122334"],
    // เบอร์บ้านไทย = 9 หลักเสมอ (02 + 7 ตัว) — เดิมบังคับ 10 หลัก ทำให้ตกหมด
    ["02-1234567", "021234567"],
    ["021234567", "021234567"],
    ["038-123456", "038123456"],
  ])("%s → %s", (input, expected) => {
    expect(sanitizePhone(input)).toBe(expected);
  });

  it("สั้น/ยาวเกินช่วง 9-10 → ว่าง", () => {
    expect(sanitizePhone("08111223")).toBe(""); // 8 หลัก
    expect(sanitizePhone("081112233445")).toBe(""); // 12 หลัก
    expect(sanitizePhone("")).toBe("");
    expect(sanitizePhone(undefined)).toBe("");
  });
});

describe("isMobilePhone — COD ต้องมือถือ 06/08/09", () => {
  it.each([
    ["0811122334", true],
    ["081-112 2334", true],
    ["0611122334", true],
    ["0911122334", true],
    ["021234567", false], // เบอร์บ้าน กทม. (9 หลัก)
    ["02-1234567", false],
    ["0711122334", false], // 07 ไม่ใช่มือถือ
    ["081112233", false], // ขึ้นต้น 08 แต่แค่ 9 หลัก = มือถือไม่ครบ
  ])("%s → %s", (input, expected) => {
    expect(isMobilePhone(input)).toBe(expected);
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

describe("evaluateOrderGate — 2 ระดับ", () => {
  const base = { ชื่อ: "สมหญิง ใจดี", ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540" };

  it("COD + มือถือ + ที่อยู่ก้อน → complete", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "081-112 2334", การชำระเงิน: "COD" }, slipPresent: false });
    expect(g.complete).toBe(true);
    expect(g.missing).toEqual([]);
  });

  it("COD + เบอร์บ้าน → ไม่ complete + block (บอทถามเอง ไม่ push)", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "021234567", การชำระเงิน: "COD" }, slipPresent: false });
    expect(g.complete).toBe(false);
    expect(g.codPhoneBlocked).toBe(true);
    expect(g.incompleteWithIntent, "บอทกำลังถามเบอร์เอง ยังไม่กวนแอดมิน").toBe(false);
    expect(g.missing).toContain("เบอร์มือถือ");
  });

  it("โอน + เบอร์บ้าน + สลิป → complete (เบอร์บ้านผ่านถ้าไม่ใช่ COD)", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "021234567", การชำระเงิน: "โอน" }, slipPresent: true });
    expect(g.complete).toBe(true);
  });

  it("โอน + ที่อยู่ + ไม่มีสลิป → ไม่ครบ + รอโอน + แจ้งแอดมิน", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "0811122334", การชำระเงิน: "โอน" }, slipPresent: false });
    expect(g.complete).toBe(false);
    expect(g.waitTag).toBe("รอโอน");
    expect(g.incompleteWithIntent).toBe(true);
    expect(g.missing).toContain("สลิป");
  });

  it("โอน + สลิป + ไม่มีที่อยู่ → แจ้งแอดมิน (จ่ายแล้วห้ามเงียบ)", () => {
    const g = evaluateOrderGate({ pending: { การชำระเงิน: "โอน", เบอร์: "0811122334", ชื่อ: "สมหญิง" }, slipPresent: true });
    expect(g.complete).toBe(false);
    expect(g.incompleteWithIntent).toBe(true);
    expect(g.missing).toContain("ที่อยู่");
  });

  it("ยังไม่เลือกวิธีจ่าย → เงียบได้ (ยังไม่ใช่ลูกค้าที่ตกลงซื้อ)", () => {
    const g = evaluateOrderGate({ pending: { ...base, เบอร์: "0811122334" }, slipPresent: false });
    expect(g.complete).toBe(false);
    expect(g.incompleteWithIntent, "ยังไม่สั่ง = ไม่ต้องกวนแอดมิน").toBe(false);
    expect(g.waitTag).toBeNull();
  });

  it("ขาดชื่อ + สั่งแล้ว → แจ้งแอดมิน", () => {
    const g = evaluateOrderGate({ pending: { ที่อยู่: base.ที่อยู่, เบอร์: "0811122334", การชำระเงิน: "COD" }, slipPresent: false });
    expect(g.complete).toBe(false);
    expect(g.missing).toContain("ชื่อ");
    expect(g.incompleteWithIntent).toBe(true);
  });
});
