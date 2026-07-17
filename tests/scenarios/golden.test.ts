import { describe, it, expect } from "vitest";
import { sendText, sendImage } from "../harness/replay";
import { scriptGemini, turn, orderRows, geminiState, adminPushes, lineCalls } from "../harness/state";
import { FULL_ADDRESS } from "../harness/fixtures";
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
    expect(orderRows.length, "ต้องเขียนชีตครั้งเดียว").toBe(1);
    const row = orderRows[0];
    expect(row.customerName).toBe("สมชาย ใจดี");
    expect(row.phone).toBe("0811122334");
    expect(row.address).toBe("123/45 หมู่ 6");
    expect(row.subdistrict).toBe("บางรัก");
    expect(row.district).toBe("เมือง");
    expect(row.province).toBe("ชลบุรี");
    expect(row.postalCode).toBe("20000");
    expect(row.total).toBe("285");
    expect(row.paymentMethod).toBe("โอน");
    expect(row.productAndQty).toBe("น้ำพริกปลาทู x3");
    expect(row.slipPathname, "โอน = ต้องผูกสลิปไว้กับแถว").toBeTruthy();

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
    expect(orderRows.length, "ยังไม่มีสลิป = ยังไม่เขียน").toBe(0);

    await sendImage(U);
    expect(orderRows.length, "สลิปใบแรก → เขียน 1 แถว").toBe(1);

    await sendImage(U);
    expect(orderRows.length, "สลิปใบที่ 2 ต้องไม่เกิดออเดอร์ซ้ำ").toBe(1);

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

    expect(orderRows.length, "รูปไม่ใช่สลิป = ห้ามสร้างออเดอร์").toBe(0);
    expect(adminPushes().length, "รูป other ไม่ต้องรบกวนแอดมิน").toBe(0);

    // ยังต้องตอบลูกค้าตามปกติ
    expect(lineCalls.replies.length).toBe(1);
    assertCentral(U);

    const c = await readCustomer(U);
    expect(c?.last_slip_pathname, "ห้ามจำเป็นสลิป").toBeNull();
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
