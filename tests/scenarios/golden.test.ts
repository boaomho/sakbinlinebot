import { describe, it, expect, beforeEach } from "vitest";
import { sendText, sendImage } from "../harness/replay";
import { scriptGemini, turn, sheetsCalls, geminiState, adminPushes, lineCalls } from "../harness/state";
import { orderCount, orderRowAt } from "../harness/sheet";
import { FULL_ADDRESS, REAL_BROKEN_CASE } from "../harness/fixtures";
import { seedBotLib } from "../harness/botlib-fixture";
import { assertCentral, assertStageInEnum } from "../harness/assert";
import { readCustomer } from "../harness/db";

/**
 * Golden scenarios (D-18: 1-pass · AI พูดเอง โค้ดเป็นเจ้าของเงิน)
 * - order_data ใช้ items:[{sku,qty}] · ยอด/ค่าส่ง ที่เขียนชีต/แจ้งแอดมิน มาจาก lib/core/pricing
 * - 1 Gemini call/เทิร์น (ไม่มี 2-pass · ไม่มี "ขอคิดยอด")
 * Gemini scripted → เทส "โค้ดเรา" (gate/pricing/สลิป/บอลลูน) ไม่ใช่ LLM
 */

const U = "Uharnesstestcustomer0000000000001";
const NPT = (qty: number) => ({ items: [{ qty }] });

beforeEach(() => seedBotLib());

describe("บท 1 — ซื้อลื่น: ทัก→สั่ง→โอน→สลิป→ที่อยู่ → 1 แถว ยอดจาก Core", () => {
  it("เขียนออเดอร์ 1 แถว · ยอด/สินค้า+จำนวน มาจาก pricing (qty3 = 275 ส่งฟรี)", async () => {
    scriptGemini([
      turn({ reply: "สวัสดีค่ะ สนใจตัวไหนดีคะ", stage: "1" }),
      turn({ reply: "น้ำพริกปลาทู 3 ถ้วย 275 บาท ส่งฟรีค่ะ[[เว้น]]สะดวกโอนหรือเก็บปลายทางดีคะ", stage: "2", orderData: NPT(3) }),
      turn({ reply: "โอนมาที่บัญชีนี้ได้เลยค่ะ", stage: "3", paymentMethod: "โอน" }),
      turn({ reply: "ได้รับสลิปแล้วค่ะ ขอที่อยู่จัดส่งหน่อยนะคะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip", imageNote: "ยอด 275 บาท" }),
      turn({ reply: "สรุปที่อยู่จัดส่งนะคะ\nสมชาย ใจดี\n123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.ชลบุรี 20000\n0811122334[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ ขอบคุณมากค่ะ", stage: "4b", paymentMethod: "โอน", orderData: { ...FULL_ADDRESS } }),
    ]);

    await sendText(U, "สวัสดีค่ะ สนใจน้ำพริก");
    await sendText(U, "เอา 3 กระปุกค่ะ");
    await sendText(U, "โอนนะคะ");
    await sendImage(U);
    await sendText(U, "สมชาย ใจดี 123/45 หมู่ 6 บางรัก เมือง ชลบุรี 20000 เบอร์ 0811122334");

    expect(orderCount(), "ต้องเขียนชีตครั้งเดียว").toBe(1);
    expect(sheetsCalls.appends[0].range, "layout จริง 24 คอลัมน์ A–X").toBe("Orders!A:X");
    const row = orderRowAt(0);
    expect(row["ชื่อ-นามสกุล"]).toBe("สมชาย ใจดี");
    expect(row["เบอร์โทร"]).toBe("0811122334");
    expect(row["ที่อยู่"]).toBe("123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.ชลบุรี 20000");
    expect(row["จังหวัด"], "G ปล่อยว่าง (ที่อยู่ก้อนเดียวใน F)").toBe("");
    expect(row["ยอดเงิน"], "ยอดจาก pricing (qty3 = 275) ไม่ใช่จาก AI").toBe("275");
    expect(row["การชำระเงิน"]).toBe("โอน");
    expect(row["สินค้า+จำนวน"]).toBe("น้ำพริกปลาทูฟรีซดราย x3");
    expect(row["ค่าส่ง"], "T = ส่งฟรี").toBe("0");
    expect(row["items_json"], "S = items JSON").toContain("NPT-10G");
    expect(row["รูปSlip"], "โอน = ผูกสลิป").toBeTruthy();

    const c = await readCustomer(U);
    expect(c?.has_written_order).toBe(true);
    expect(c?.pending_order).toBeNull();

    const adminText = JSON.stringify(adminPushes());
    expect(adminText).toContain("มีลูกค้าส่งสลิปมา");
    expect(adminText).toContain("ออเดอร์ใหม่");

    assertCentral(U);
    assertStageInEnum(c?.stage);
    expect(geminiState.overflowCalls, "1 call/เทิร์น = 5 script พอดี").toBe(0);
  });
});

describe("บท 7 — ส่งสลิปซ้ำ 2 รอบ → 1 ออเดอร์", () => {
  it("สลิปใบที่ 2 ไม่ทำให้เกิดออเดอร์ซ้ำ", async () => {
    scriptGemini([
      turn({ reply: "รับ 3 ถ้วย 275 บาท ส่งฟรีค่ะ รอสลิปนะคะ", stage: "3", paymentMethod: "โอน", orderData: { ...NPT(3), ...FULL_ADDRESS } }),
      turn({ reply: "ได้รับสลิปแล้วค่ะ ขอบคุณมากค่ะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip" }),
      turn({ reply: "ได้รับแล้วนะคะ ปลาทูตรวจสอบให้อยู่ค่ะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip" }),
    ]);

    await sendText(U, "เอา 3 กระปุก โอนนะคะ สมชาย ใจดี 123/45 หมู่ 6 บางรัก เมือง ชลบุรี 20000 0811122334");
    expect(orderCount(), "ยังไม่มีสลิป = ยังไม่เขียน").toBe(0);

    await sendImage(U);
    expect(orderCount(), "สลิปใบแรก → เขียน 1 แถว").toBe(1);

    await sendImage(U);
    expect(orderCount(), "สลิปใบที่ 2 ต้องไม่เกิดออเดอร์ซ้ำ").toBe(1);

    assertCentral(U);
  });
});

describe("บท 8 — ส่งรูปที่ไม่ใช่สลิป → ไม่พัง ไม่สร้างออเดอร์", () => {
  it("รูป other: ไม่อัปโหลด ไม่ push แอดมิน ไม่เขียนชีต แต่ยังตอบลูกค้า", async () => {
    scriptGemini([
      turn({ reply: "รูปนี้คือน้ำพริกปลาทูค่ะ สนใจกี่กระปุกดีคะ", stage: "2", imageIntent: "other", imageNote: "รูปสินค้า" }),
    ]);

    const res = await sendImage(U);
    expect(res.status, "handler ต้องไม่พัง").toBe(200);
    expect(orderCount(), "รูปไม่ใช่สลิป = ห้ามสร้างออเดอร์").toBe(0);
    expect(adminPushes().length, "รูป other ไม่ต้องรบกวนแอดมิน").toBe(0);
    expect(lineCalls.replies.length).toBe(1);
    assertCentral(U);

    const c = await readCustomer(U);
    expect(c?.last_slip_pathname).toBeNull();
  });
});

describe("บท 14 — 🔴 COD + ที่อยู่ก้อนเดียว (ไม่มี ต./อ./จ. นำ) → เขียนชีต", () => {
  it("ที่อยู่ก้อนดิบ + เบอร์มีขีด → ครบ → เขียน + push · ยอดจาก pricing", async () => {
    scriptGemini([
      turn({ reply: "น้ำพริกปลาทู 3 ถ้วย 275 บาท ส่งฟรีค่ะ สะดวกจ่ายแบบไหนดีคะ", stage: "2", orderData: NPT(3) }),
      turn({ reply: "เก็บเงินปลายทางนะคะ ขอชื่อ ที่อยู่ เบอร์ด้วยค่ะ", stage: "3", paymentMethod: "COD" }),
      turn({ reply: "สรุปที่อยู่จัดส่งนะคะ\nสมหญิง ใจดี\n123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540\n081-112 2334[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ", stage: "4b", paymentMethod: "COD", orderData: { ...REAL_BROKEN_CASE } }),
    ]);

    await sendText(U, "สนใจน้ำพริกค่ะ เอา 3 ถ้วย");
    await sendText(U, "เก็บเงินปลายทางค่ะ");
    await sendText(U, "สมหญิง ใจดี 123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540 เบอร์ 081-112 2334");

    expect(orderCount(), "🔴 เคสนี้เคยหายเงียบ — ต้องเขียนชีตได้").toBe(1);
    const row = orderRowAt(0);
    expect(row["ชื่อ-นามสกุล"]).toBe("สมหญิง ใจดี");
    expect(row["เบอร์โทร"], "081-112 2334 → 0811122334").toBe("0811122334");
    expect(row["ที่อยู่"]).toBe("123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");
    expect(row["การชำระเงิน"]).toBe("COD");
    expect(row["ยอดเงิน"], "qty3 COD = 275").toBe("275");
    expect(row["สินค้า+จำนวน"]).toBe("น้ำพริกปลาทูฟรีซดราย x3");
    expect(row["รูปSlip"], "COD ไม่มีสลิป").toBeFalsy();
    expect(JSON.stringify(adminPushes())).toContain("ออเดอร์ใหม่");
    assertCentral(U);
  });
});

describe("บท 14b — 🔴 'บูม': COD qty1 · 3 field ผู้รับ ไม่มีจังหวัด/รหัสแยก", () => {
  it("3 field + items → complete · ยอด/สินค้า+จำนวน ไม่หาย (qty1 = 125)", async () => {
    scriptGemini([
      turn({ reply: "น้ำพริกปลาทู 1 ถ้วย 95 บาท ค่าส่ง 30 รวม 125 บาท เก็บปลายทางนะคะ ขอชื่อ ที่อยู่ เบอร์ค่ะ", stage: "3", paymentMethod: "COD", orderData: NPT(1) }),
      turn({ reply: "สรุปที่อยู่จัดส่งนะคะ[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ", stage: "4b", paymentMethod: "COD", orderData: { ชื่อ: "บูม", ที่อยู่: "1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120", เบอร์: "0912345678" } }),
    ]);

    await sendText(U, "เอา 1 ชิ้น เก็บปลายทางค่ะ");
    await sendText(U, "บูม / 1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120 / 0912345678");

    expect(orderCount(), "🔴 3 field ต้องพอ complete").toBe(1);
    const row = orderRowAt(0);
    expect(row["ชื่อ-นามสกุล"]).toBe("บูม");
    expect(row["ที่อยู่"]).toBe("1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120");
    expect(row["เบอร์โทร"]).toBe("0912345678");
    expect(row["จังหวัด"], "G ว่าง").toBe("");
    expect(row["สินค้า+จำนวน"]).toBe("น้ำพริกปลาทูฟรีซดราย x1");
    expect(row["ยอดเงิน"], "qty1 COD = 125").toBe("125");
    expect(row["ค่าส่ง"], "qty1 ต่ำกว่าส่งฟรี = 30").toBe("30");
    expect(JSON.stringify(adminPushes())).toContain("ออเดอร์ใหม่");
    assertCentral(U);
  });
});

describe("บท 16 — เบอร์รูปแบบไหนก็ได้ที่มีตัวเลข → ผ่าน", () => {
  it("COD + เบอร์บ้าน 02-1234567 (สั่ง+ที่อยู่ในข้อความเดียว) → ผ่าน", async () => {
    scriptGemini([
      turn({ reply: "รับ 3 ถ้วย 275 บาท ส่งของให้เลยนะคะ", stage: "4b", paymentMethod: "COD", orderData: { ...NPT(3), ชื่อ: "สมชาย ใจดี", ที่อยู่: "123/45 ม.6 บางพลี สมุทรปราการ 10540", เบอร์: "02-1234567" } }),
    ]);

    await sendText(U, "เอา 3 ถ้วย สมชาย ใจดี 123/45 ม.6 บางพลี สมุทรปราการ 10540 02-1234567 เก็บปลายทาง");

    expect(orderCount(), "มีเบอร์ = ผ่าน").toBe(1);
    expect(orderRowAt(0)["เบอร์โทร"]).toBe("021234567");
    expect(orderRowAt(0)["ยอดเงิน"]).toBe("275");
    expect(JSON.stringify(adminPushes())).toContain("ออเดอร์ใหม่");
    assertCentral(U);
  });

  it("โอน + เบอร์บ้าน + สลิป → ผ่าน", async () => {
    scriptGemini([
      turn({ reply: "รับ 3 ถ้วย 275 บาท รอสลิปนะคะ", stage: "3", paymentMethod: "โอน", orderData: { ...NPT(3), ชื่อ: "สมชาย ใจดี", ที่อยู่: "123/45 ม.6 บางพลี สมุทรปราการ 10540", เบอร์: "021234567" } }),
      turn({ reply: "ได้รับสลิปแล้วค่ะ ขอบคุณมากค่ะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip" }),
    ]);

    await sendText(U, "เอา 3 ถ้วย โอนนะคะ สมชาย ใจดี 123/45 ม.6 บางพลี สมุทรปราการ 10540 021234567");
    expect(orderCount(), "ยังไม่มีสลิป").toBe(0);

    await sendImage(U);
    expect(orderCount(), "โอน + เบอร์ + สลิป → ผ่าน").toBe(1);
    expect(orderRowAt(0)["เบอร์โทร"]).toBe("021234567");
    assertCentral(U);
  });
});

describe("บท 17 — COD ได้แค่ที่อยู่ → บอทขอชื่อ+เบอร์ (ไม่เงียบ ไม่แจ้งกลุ่ม)", () => {
  it("COD ยังไม่ครบ → ไม่เขียนแถว + ไม่ push กลุ่ม", async () => {
    scriptGemini([
      turn({ reply: "น้ำพริกปลาทู 3 ถ้วย 275 บาท เก็บปลายทางนะคะ ขอชื่อ ที่อยู่ เบอร์ด้วยค่ะ", stage: "3", paymentMethod: "COD", orderData: NPT(3) }),
      turn({ reply: "ขอชื่อผู้รับกับเบอร์โทรด้วยนะคะ", stage: "4b", paymentMethod: "COD", orderData: { ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540" } }),
    ]);

    await sendText(U, "เอา 3 ถ้วย เก็บปลายทางค่ะ");
    await sendText(U, "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");

    expect(orderCount(), "ยังไม่ครบ = ไม่เขียนแถว").toBe(0);
    expect(adminPushes().length, "🔴 COD ยังไม่ครบ = ห้ามแจ้งกลุ่ม").toBe(0);
    expect(lineCalls.replies.length, "2 เทิร์น = 2 reply").toBe(2);
    assertCentral(U);
  });
});

describe("บท 17b — โอน + สลิป + ยังไม่มีที่อยู่ → แจ้งกลุ่มจากสลิป ไม่ใช่ ⚠️", () => {
  it("สลิปมาก่อนที่อยู่ → admin รู้จากสลิป · ไม่มี ⚠️ ข้อมูลไม่ครบ", async () => {
    scriptGemini([
      turn({ reply: "น้ำพริกปลาทู 3 ถ้วย 275 บาท โอนได้เลยค่ะ", stage: "3", paymentMethod: "โอน", orderData: NPT(3) }),
      turn({ reply: "ได้รับสลิปแล้วค่ะ ขอชื่อ ที่อยู่ เบอร์ด้วยนะคะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip", imageNote: "ยอด 275" }),
    ]);

    await sendText(U, "เอา 3 ถ้วย โอนนะคะ");
    await sendImage(U);

    expect(orderCount(), "ยังไม่มีที่อยู่ = ไม่เขียนแถว").toBe(0);
    const admin = JSON.stringify(adminPushes());
    expect(admin, "แอดมินรู้จาก push สลิป").toContain("มีลูกค้าส่งสลิปมา");
    expect(admin, "ต้องไม่มี ⚠️ ข้อมูลไม่ครบ").not.toContain("ข้อมูลไม่ครบ");
    assertCentral(U);
  });
});

describe("บท 18 — COD: สั่ง(ได้ชื่อ+เบอร์)→ยังไม่แจ้งกลุ่ม→ครบที่อยู่→เขียน+แจ้งกลุ่ม", () => {
  it("ระหว่างเก็บข้อมูลไม่แจ้งกลุ่ม · ครบเทิร์นไหนแจ้งเทิร์นนั้น", async () => {
    scriptGemini([
      turn({ reply: "น้ำพริกปลาทู 3 ถ้วย 275 บาท เก็บปลายทางนะคะ ขอที่อยู่จัดส่งด้วยค่ะ", stage: "3", paymentMethod: "COD", orderData: { ...NPT(3), ชื่อ: "สมหญิง ใจดี", เบอร์: "0811122334" } }),
      turn({ reply: "สรุปที่อยู่จัดส่งนะคะ[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ ขอบคุณมากค่ะ", stage: "4b", paymentMethod: "COD", orderData: { ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540" } }),
    ]);

    await sendText(U, "เอา 3 ถ้วย เก็บปลายทาง สมหญิง ใจดี 0811122334");
    expect(orderCount(), "ยังไม่มีที่อยู่ = ไม่เขียน").toBe(0);
    expect(adminPushes().length, "🔴 สรุปยอดแล้วแต่ยังไม่ครบ = ไม่แจ้งกลุ่ม").toBe(0);

    await sendText(U, "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");
    expect(orderCount(), "ครบ → เขียนแถว").toBe(1);
    expect(orderRowAt(0)["ที่อยู่"]).toBe("123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");
    expect(orderRowAt(0)["ยอดเงิน"]).toBe("275");
    expect(JSON.stringify(adminPushes())).toContain("ออเดอร์ใหม่");
    assertCentral(U);
  });
});
