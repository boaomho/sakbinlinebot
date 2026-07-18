import { describe, it, expect } from "vitest";
import { sendText, sendImage } from "../harness/replay";
import { scriptGemini, turn, sheetsCalls, geminiState, adminPushes, lineCalls } from "../harness/state";
import { orderCount, orderRowAt } from "../harness/sheet";
import { FULL_ADDRESS, REAL_BROKEN_CASE } from "../harness/fixtures";
import { assertCentral, assertStageInEnum } from "../harness/assert";
import { readCustomer } from "../harness/db";

/**
 * Golden scenarios must-pass (บรีฟ v1.5 Step 9) — ต้องเขียวกับโค้ด v1.2 ปัจจุบัน
 * = ยืนยันว่า flowing order-model ที่เพิ่งทำถูกต้อง และได้ baseline นิ่งก่อนรื้อ core (Step 0)
 *
 * Gemini เป็น scripted output → บทเหล่านี้เทส "โค้ดเรา" (order gate / สลิป / debounce / บอลลูน)
 * ไม่ได้เทส LLM
 */

const U = "Uharnesstestcustomer0000000000001";

describe("บท 1 — ซื้อลื่น: ทัก→สั่ง→โอน→สลิป→ที่อยู่ → 1 แถวในชีต ถูกต้อง", () => {
  it("เขียนออเดอร์ลงชีต 1 แถว ข้อมูลครบถูกต้อง", async () => {
    scriptGemini([
      // 1) ทักทาย
      turn({ reply: "สวัสดีค่ะ สนใจตัวไหนดีคะ", stage: "1" }),
      // 2) สั่งของ
      turn({
        reply: "น้ำพริกปลาทู 3 กระปุก 285 บาทค่ะ[[เว้น]]สะดวกโอนหรือเก็บปลายทางดีคะ",
        stage: "2",
        orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "3", ยอด: "285" },
      }),
      // 3) เลือกโอน
      turn({ reply: "โอนมาที่บัญชีนี้ได้เลยค่ะ", stage: "3", paymentMethod: "โอน" }),
      // 4) ส่งสลิป (ยังไม่มีที่อยู่)
      turn({
        reply: "ได้รับสลิปแล้วค่ะ ขอที่อยู่จัดส่งหน่อยนะคะ",
        stage: "4a",
        paymentMethod: "โอน",
        imageIntent: "slip",
        imageNote: "ยอด 285 บาท",
      }),
      // 5) ให้ที่อยู่ครบ → gate ต้องเขียนชีต
      turn({
        reply: "สรุปที่อยู่จัดส่งนะคะ\nสมชาย ใจดี\n123/45 หมู่ 6 บางรัก เมือง ชลบุรี 20000\n0811122334[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ ขอบคุณมากค่ะ",
        stage: "4b",
        paymentMethod: "โอน",
        orderData: { ...FULL_ADDRESS },
      }),
    ]);

    await sendText(U, "สวัสดีค่ะ สนใจน้ำพริก");
    await sendText(U, "เอา 3 กระปุกค่ะ");
    await sendText(U, "โอนนะคะ");
    await sendImage(U);
    await sendText(U, "สมชาย ใจดี 123/45 หมู่ 6 บางรัก เมือง ชลบุรี 20000 เบอร์ 0811122334");

    // ---- ต้องได้ออเดอร์ 1 แถว ----
    expect(orderCount(), "ต้องเขียนชีตครั้งเดียว").toBe(1);
    // อ่านแถวจริงที่ยิงเข้า Sheets API แล้ว map ตาม ORDERS_HEADER
    // = พิสูจน์ว่า "ค่าลงตรงคอลัมน์" ไม่ใช่แค่ "ค่าถูก"
    expect(sheetsCalls.appends[0].range, "layout จริง 24 คอลัมน์ A–X").toBe("Orders!A:X");
    const row = orderRowAt(0);
    expect(row["ชื่อ-นามสกุล"]).toBe("สมชาย ใจดี");
    expect(row["เบอร์โทร"]).toBe("0811122334");
    expect(row["ที่อยู่"]).toBe("123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.ชลบุรี 20000");
    expect(row["จังหวัด"]).toBe("ชลบุรี");
    expect(row["รหัสไปรษณีย์"]).toBe("20000");
    expect(row["ยอดเงิน"]).toBe("285");
    expect(row["การชำระเงิน"]).toBe("โอน");
    expect(row["สินค้า+จำนวน"]).toBe("น้ำพริกปลาทู x3");
    expect(row["รูปSlip"], "โอน = ต้องผูกสลิปไว้กับแถว").toBeTruthy();

    // ---- state หลังเขียน: ล้าง pending + สลิป, ไม่มีแท็กรอ, mark เขียนแล้ว ----
    const c = await readCustomer(U);
    expect(c?.has_written_order).toBe(true);
    expect(c?.pending_order).toBeNull();
    expect(c?.last_slip_pathname).toBeNull();
    expect(c?.tags).not.toContain("รอโอน");
    expect(c?.tags).not.toContain("รอที่อยู่");

    // ---- push แอดมิน: สลิป (จุด 1) + ออเดอร์ใหม่ (จุด 2) ----
    const admin = adminPushes();
    const adminText = JSON.stringify(admin);
    expect(adminText).toContain("มีลูกค้าส่งสลิปมา");
    expect(adminText).toContain("ออเดอร์ใหม่");

    assertCentral(U);
    assertStageInEnum(c?.stage);
    expect(geminiState.overflowCalls, "script ต้องพอดีกับจำนวนเทิร์น").toBe(0);
  });
});

describe("บท 7 — ส่งสลิปซ้ำ 2 รอบ → 1 ออเดอร์", () => {
  it("สลิปใบที่ 2 ไม่ทำให้เกิดออเดอร์ซ้ำ", async () => {
    scriptGemini([
      // 1) สั่ง + โอน + ที่อยู่ครบ (ยังไม่มีสลิป → ยังไม่เขียน)
      turn({
        reply: "รับทราบค่ะ รอสลิปนะคะ",
        stage: "3",
        paymentMethod: "โอน",
        orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "3", ยอด: "285", ...FULL_ADDRESS },
      }),
      // 2) สลิปใบแรก → ครบ → เขียน 1 แถว
      turn({ reply: "ได้รับสลิปแล้วค่ะ ขอบคุณมากค่ะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip" }),
      // 3) สลิปใบที่สอง (ลูกค้าส่งซ้ำ) → ต้องไม่เขียนซ้ำ
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

    // ยังต้องตอบลูกค้าตามปกติ
    expect(lineCalls.replies.length).toBe(1);
    assertCentral(U);

    const c = await readCustomer(U);
    expect(c?.last_slip_pathname, "ห้ามจำเป็นสลิป").toBeNull();
  });
});

describe("บท 14 — 🔴 เคสจริงที่พัง: COD + ที่อยู่ก้อนเดียว (ไม่มี ต./อ./จ. นำ)", () => {
  it("ที่อยู่ก้อนดิบ + เบอร์มือถือมีขีด → ครบ → เขียนชีต + push", async () => {
    scriptGemini([
      turn({ reply: "น้ำพริกปลาทู 3 ถ้วย 285 บาทค่ะ", stage: "2", orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "3", ยอด: "285" } }),
      turn({ reply: "เก็บเงินปลายทางนะคะ ขอชื่อ ที่อยู่ เบอร์ด้วยค่ะ", stage: "3", paymentMethod: "COD" }),
      // AI ส่งมาแบบที่เกิดขึ้นจริง: ที่อยู่ก้อนเดียว + รหัส ไม่มี ตำบล/อำเภอ/จังหวัด แยก
      turn({
        reply: "สรุปที่อยู่จัดส่งนะคะ\nสมหญิง ใจดี\n123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540\n081-112 2334[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ ขอบคุณมากค่ะ",
        stage: "4b",
        paymentMethod: "COD",
        orderData: { ...REAL_BROKEN_CASE },
      }),
    ]);

    await sendText(U, "สนใจน้ำพริกค่ะ เอา 3 ถ้วย");
    await sendText(U, "เก็บเงินปลายทางค่ะ");
    await sendText(U, "สมหญิง ใจดี 123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540 เบอร์ 081-112 2334");

    expect(orderCount(), "🔴 เคสนี้เคยหายเงียบ — ต้องเขียนชีตได้แล้ว").toBe(1);
    const row = orderRowAt(0);
    expect(row["ชื่อ-นามสกุล"]).toBe("สมหญิง ใจดี");
    expect(row["เบอร์โทร"], "081-112 2334 → 0811122334 (sanitizePhone ตัวจริง)").toBe("0811122334");
    expect(row["ที่อยู่"], "ที่อยู่เก็บเป็นก้อนดิบตามที่ลูกค้าพิมพ์").toBe("123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");
    expect(row["การชำระเงิน"]).toBe("COD");
    expect(row["รูปSlip"], "COD ไม่มีสลิป").toBeFalsy();

    expect(JSON.stringify(adminPushes()), "ต้อง push ออเดอร์ใหม่").toContain("ออเดอร์ใหม่");
    assertCentral(U);
  });
});

describe("บท 14b — 🔴 เคส production 'บูม': COD 3 field (ชื่อ+ที่อยู่ก้อน+เบอร์) ไม่มีจังหวัด/รหัสแยก", () => {
  it("AI ส่งแค่ 3 field → complete → เขียน+push (ไม่ต้องมีจังหวัด/รหัส)", async () => {
    scriptGemini([
      turn({ reply: "รับ 1 ชิ้น เก็บปลายทางนะคะ ขอชื่อ ที่อยู่ เบอร์ค่ะ", stage: "3", paymentMethod: "COD", orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "1", ยอด: "95" } }),
      // AI ส่งแค่ 3 field ผู้รับ — ไม่มี จังหวัด/รหัสไปรษณีย์ แยก (ตาม schema ใหม่)
      turn({
        reply: "สรุปที่อยู่จัดส่งนะคะ[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ",
        stage: "4b",
        paymentMethod: "COD",
        orderData: { ชื่อ: "บูม", ที่อยู่: "1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120", เบอร์: "0912345678" },
      }),
    ]);

    await sendText(U, "เอา 1 ชิ้น เก็บปลายทางค่ะ");
    await sendText(U, "บูม / 1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120 / 0912345678");

    expect(orderCount(), "🔴 เคสที่พังจริง — 3 field ต้องพอ complete").toBe(1);
    const row = orderRowAt(0);
    expect(row["ชื่อ-นามสกุล"]).toBe("บูม");
    expect(row["ที่อยู่"]).toBe("1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120");
    expect(row["เบอร์โทร"]).toBe("0912345678");
    expect(row["จังหวัด"], "จังหวัดปล่อยว่าง (ดึงจากก้อนด้วยสูตรชีตทีหลัง)").toBe("");
    // 🔴 จุด 1: สินค้า+จำนวน+ยอด ต้องไม่หาย (ทีมแพ็คต้องรู้ยอดเก็บเงิน COD)
    expect(row["สินค้า+จำนวน"], "ต้องมี x จำนวน ไม่ใช่ชื่อเปล่า").toBe("น้ำพริกปลาทู x1");
    expect(row["ยอดเงิน"], "ยอดต้องไม่หาย").toBe("95");
    expect(JSON.stringify(adminPushes())).toContain("ออเดอร์ใหม่");
    assertCentral(U);
  });
});

describe("บท 16 — เบอร์รูปแบบไหนก็ได้ที่มีตัวเลข → ผ่าน", () => {
  it("COD + เบอร์บ้าน 02-1234567 → ผ่าน (ไม่เช็คมือถือ ไม่เช็คจำนวนหลัก)", async () => {
    scriptGemini([
      turn({
        reply: "สรุปที่อยู่จัดส่งนะคะ[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ",
        stage: "4b",
        paymentMethod: "COD",
        orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "3", ยอด: "285", ชื่อ: "สมชาย ใจดี", ที่อยู่: "123/45 ม.6 บางพลี สมุทรปราการ 10540", เบอร์: "02-1234567" },
      }),
    ]);

    await sendText(U, "สมชาย ใจดี 123/45 ม.6 บางพลี สมุทรปราการ 10540 02-1234567 เก็บปลายทาง");

    expect(orderCount(), "มีเบอร์ = ผ่าน แอดมินตรวจเบอร์เอง").toBe(1);
    expect(orderRowAt(0)["เบอร์โทร"], "sanitize เหลือแต่ตัวเลข").toBe("021234567");
    expect(JSON.stringify(adminPushes())).toContain("ออเดอร์ใหม่");
    assertCentral(U);
  });

  it("โอน + เบอร์บ้าน + สลิป → ผ่าน (เกณฑ์เบอร์เหมือน COD · โอนเพิ่มแค่สลิป)", async () => {
    scriptGemini([
      turn({
        reply: "รับทราบค่ะ รอสลิปนะคะ",
        stage: "3",
        paymentMethod: "โอน",
        orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "3", ยอด: "285", ชื่อ: "สมชาย ใจดี", ที่อยู่: "123/45 ม.6 บางพลี สมุทรปราการ 10540", เบอร์: "021234567" },
      }),
      turn({ reply: "ได้รับสลิปแล้วค่ะ ขอบคุณมากค่ะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip" }),
    ]);

    await sendText(U, "โอนนะคะ สมชาย ใจดี 123/45 ม.6 บางพลี สมุทรปราการ 10540 021234567");
    expect(orderCount(), "ยังไม่มีสลิป").toBe(0);

    await sendImage(U);
    expect(orderCount(), "โอน + เบอร์ + สลิป → ผ่าน").toBe(1);
    expect(orderRowAt(0)["เบอร์โทร"]).toBe("021234567");
    assertCentral(U);
  });
});

describe("บท 17 — COD ได้แค่ที่อยู่ → บอทขอชื่อ+เบอร์ (ไม่เงียบ ไม่แจ้งกลุ่ม)", () => {
  it("COD ยังไม่ครบ → ไม่เขียนแถว + ไม่ push กลุ่ม (บอทเก็บข้อมูลเอง)", async () => {
    scriptGemini([
      turn({ reply: "เก็บเงินปลายทางนะคะ", stage: "3", paymentMethod: "COD", orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "3", ยอด: "285" } }),
      // ลูกค้าให้แค่ที่อยู่ → บอทต้องขอชื่อ+เบอร์ต่อ ไม่แจ้งกลุ่ม
      turn({ reply: "ขอชื่อผู้รับกับเบอร์โทรด้วยนะคะ", stage: "4b", paymentMethod: "COD", orderData: { ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540" } }),
    ]);

    await sendText(U, "เอา 3 ถ้วย เก็บปลายทางค่ะ");
    await sendText(U, "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");

    expect(orderCount(), "ยังไม่ครบ = ไม่เขียนแถว").toBe(0);
    expect(adminPushes().length, "🔴 COD ยังไม่ครบ = ห้ามแจ้งกลุ่ม (แจ้งเร็วไป)").toBe(0);
    // ไม่เงียบ: บอทตอบขอข้อมูลที่ขาด
    expect(lineCalls.replies.length).toBe(2);
    assertCentral(U);
  });
});

describe("บท 17b — โอน + สลิป + ยังไม่มีที่อยู่ → แจ้งกลุ่ม 💰 (จากสลิป) ไม่ใช่ ⚠️", () => {
  it("สลิปมาก่อนที่อยู่ → admin รู้จากสลิป · ไม่มี push ⚠️ ระหว่างทาง", async () => {
    scriptGemini([
      turn({ reply: "โอนมาที่บัญชีนี้ได้เลยค่ะ", stage: "3", paymentMethod: "โอน", orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "3", ยอด: "285" } }),
      turn({ reply: "ได้รับสลิปแล้วค่ะ ขอชื่อ ที่อยู่ เบอร์ด้วยนะคะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip", imageNote: "ยอด 285" }),
    ]);

    await sendText(U, "โอนนะคะ");
    await sendImage(U);

    expect(orderCount(), "ยังไม่มีที่อยู่ = ไม่เขียนแถว").toBe(0);
    const admin = JSON.stringify(adminPushes());
    expect(admin, "แอดมินรู้ว่ามีคนโอนจาก push สลิป 💰").toContain("มีลูกค้าส่งสลิปมา");
    expect(admin, "ต้องไม่มี ⚠️ ข้อมูลไม่ครบ อีกแล้ว").not.toContain("ข้อมูลไม่ครบ");
    assertCentral(U);
  });
});

describe("บท 18 — COD: สั่ง→สรุปยอด(ยังไม่แจ้งกลุ่ม)→ครบ 3→เขียน+แจ้งกลุ่ม 📦", () => {
  it("ระหว่างเก็บข้อมูลไม่แจ้งกลุ่ม · ครบเทิร์นไหนแจ้งเทิร์นนั้น", async () => {
    scriptGemini([
      // เทิร์น 1: สั่ง + เลือก COD → สรุปยอด · ได้ชื่อ+เบอร์ แต่ยังไม่มีที่อยู่
      turn({ reply: "น้ำพริกปลาทู 3 ถ้วย 285 บาท เก็บปลายทางนะคะ ขอที่อยู่จัดส่งด้วยค่ะ", stage: "3", paymentMethod: "COD", orderData: { สินค้า: "น้ำพริกปลาทู", จำนวน: "3", ยอด: "285", ชื่อ: "สมหญิง ใจดี", เบอร์: "0811122334" } }),
      // เทิร์น 2: ได้ที่อยู่ → ครบ 3 → ปิด
      turn({ reply: "สรุปที่อยู่จัดส่งนะคะ[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ ขอบคุณมากค่ะ", stage: "4b", paymentMethod: "COD", orderData: { ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540" } }),
    ]);

    await sendText(U, "เอา 3 ถ้วย เก็บปลายทาง สมหญิง ใจดี 0811122334");
    expect(orderCount(), "ยังไม่มีที่อยู่ = ไม่เขียน").toBe(0);
    expect(adminPushes().length, "🔴 สรุปยอดแล้วแต่ยังไม่ครบ = ไม่แจ้งกลุ่ม").toBe(0);

    await sendText(U, "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");
    expect(orderCount(), "ครบ 3 → เขียนแถว").toBe(1);
    expect(orderRowAt(0)["ที่อยู่"]).toBe("123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");
    expect(JSON.stringify(adminPushes()), "ครบแล้วค่อยแจ้งกลุ่ม 📦").toContain("ออเดอร์ใหม่");
    assertCentral(U);
  });
});

describe("บท 9 — พิมพ์รัว 5 ข้อความ → ไม่ตอบซ้อน", () => {
  it("debounce รวบเป็นเทิร์นเดียว ตอบครั้งเดียว", async () => {
    scriptGemini([turn({ reply: "รับทราบค่ะ เดี๋ยวปลาทูจัดให้นะคะ", stage: "2" })]);

    // ยิงรัวพร้อมกัน (เหมือนลูกค้าพิมพ์ติด ๆ กัน)
    await Promise.all([
      sendText(U, "สวัสดีค่ะ"),
      sendText(U, "สนใจน้ำพริก"),
      sendText(U, "ราคาเท่าไหร่"),
      sendText(U, "ส่งกี่วัน"),
      sendText(U, "เอา 3 กระปุก"),
    ]);

    const totalToCustomer = lineCalls.replies.length + lineCalls.pushes.filter((p) => p.to === U).length;
    expect(totalToCustomer, "ต้องตอบลูกค้าครั้งเดียว ไม่ตอบซ้อน").toBe(1);
    expect(geminiState.cursor, "ต้องเรียก Gemini เทิร์นเดียว").toBe(1);

    assertCentral(U);
  });
});
