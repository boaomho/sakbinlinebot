import { describe, it, expect } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, sheetsCalls } from "../harness/state";
import { appendedRows, rowByColumn, columnOf } from "../harness/sheet";
import { ORDERS_HEADER } from "@/lib/orders";

/**
 * 🔴 Layout ชีต Orders — บั๊กที่แพงที่สุดคือ "ค่าลงผิดช่อง" เพราะมันเงียบ
 * ไม่มี error ไม่มี log ออเดอร์ดูปกติ แต่จังหวัดไปอยู่ช่องตำบล ยอดเงินไปอยู่ช่องสินค้า
 *
 * เทสนี้ยิงผ่าน handler จริง → appendOrderRow ตัวจริง → จับแถวดิบที่ยิงเข้า Sheets API
 * แล้วเทียบ "ตัวอักษรคอลัมน์" ตรง ๆ กับชีตจริง (อ่านด้วยตาเทียบได้เลย)
 *
 * ⚠️ index ตายตัวชั่วคราว — Step 1 (header-driven) จะรื้อถาวร เทสนี้คือตาข่ายจนถึงตอนนั้น
 */

const U = "Uharnesstestcustomer0000000000009";

describe("ORDERS_HEADER — ต้องตรงกับชีตจริง 24 ช่อง A–X", () => {
  it("มี 24 คอลัมน์", () => {
    expect(ORDERS_HEADER).toHaveLength(24);
  });

  it("ตำแหน่งคอลัมน์ตรงกับชีตจริง (อ่านจากชีตแล้ว)", () => {
    const expected: Record<string, string> = {
      A: "ลำดับ",
      B: "วันที่",
      C: "ชื่อไลน์ลูกค้า",
      D: "ชื่อ-นามสกุล",
      E: "เบอร์โทร",
      F: "ที่อยู่",
      G: "จังหวัด",
      H: "รหัสไปรษณีย์",
      I: "สินค้า+จำนวน",
      J: "ยอดเงิน",
      K: "การชำระเงิน",
      L: "รูปSlip",
      M: "คอนเฟิร์ม",
      N: "ยกเลิก",
      O: "ส่งออเดอร์แล้ว",
      P: "เลขTracking",
      Q: "order_id",
      R: "line_user_id",
      S: "items_json",
      T: "ค่าส่ง",
      U: "source_channel",
      V: "ref_code",
      W: "ยอดในสลิป",
      X: "bot_version",
    };
    for (const [col, header] of Object.entries(expected)) {
      expect(columnOf(header), `${header} ต้องอยู่คอลัมน์ ${col}`).toBe(col);
    }
  });

  it("🔴 Q–X เลื่อนซ้าย 2 ช่องจาก contract เดิม (เพราะลบ ตำบล/อำเภอ)", () => {
    expect(columnOf("order_id"), "เดิม S → ตอนนี้ Q").toBe("Q");
    expect(columnOf("line_user_id"), "เดิม T → R").toBe("R");
    expect(columnOf("items_json"), "เดิม U → S").toBe("S");
    expect(columnOf("ค่าส่ง"), "เดิม V → T").toBe("T");
    expect(columnOf("source_channel"), "เดิม W → U").toBe("U");
    expect(columnOf("ref_code"), "เดิม X → V").toBe("V");
    expect(columnOf("ยอดในสลิป"), "เดิม Y → W").toBe("W");
    expect(columnOf("bot_version"), "เดิม Z → X").toBe("X");
  });
});

describe("appendOrderRow — ทุก field ลงตรงคอลัมน์จริง", () => {
  it("COD ครบ → แถวดิบตรงทุกช่อง A–X", async () => {
    scriptGemini([
      turn({
        reply: "สรุปที่อยู่จัดส่งนะคะ[[เว้น]]ของถึงภายใน 1-2 วันทำการค่ะ",
        stage: "4b",
        paymentMethod: "COD",
        orderData: {
          สินค้า: "น้ำพริกปลาทู",
          จำนวน: "3",
          ยอด: "285",
          ชื่อ: "สมหญิง ใจดี",
          เบอร์: "081-112 2334",
          ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540",
          จังหวัด: "สมุทรปราการ",
          รหัสไปรษณีย์: "10540",
        },
      }),
    ]);

    await sendText(U, "สมหญิง ใจดี 123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540 081-112 2334 เก็บปลายทาง");

    expect(appendedRows(), "ต้องเขียน 1 แถว").toHaveLength(1);
    expect(sheetsCalls.appends[0].range, "range ต้องครอบ 24 คอลัมน์").toBe("Orders!A:X");

    const r = rowByColumn(0);
    expect(r.A, "ลำดับ เว้นว่าง ให้ cron แจก").toBe("");
    expect(r.B, "วันที่ ISO").toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.C, "ชื่อไลน์ลูกค้า").toBe("คุณทดสอบ");
    expect(r.D, "ชื่อ-นามสกุล").toBe("สมหญิง ใจดี");
    expect(r.E, "เบอร์โทร (sanitize ตัวจริง)").toBe("0811122334");
    expect(r.F, "ที่อยู่ ก้อนดิบ").toBe("123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");
    expect(r.G, "จังหวัด").toBe("สมุทรปราการ");
    expect(r.H, "รหัสไปรษณีย์").toBe("10540");
    expect(r.I, "สินค้า+จำนวน").toBe("น้ำพริกปลาทู x3");
    expect(r.J, "ยอดเงิน").toBe("285");
    expect(r.K, "การชำระเงิน").toBe("COD");
    expect(r.L, "รูปSlip — COD ไม่มี").toBe("");
    expect(r.M, "คอนเฟิร์ม").toBe("FALSE");
    expect(r.N, "ยกเลิก").toBe("FALSE");
    expect(r.O, "ส่งออเดอร์แล้ว").toBe("FALSE");
    expect(r.P, "เลขTracking").toBe("");
    // Q–X จองไว้ให้ตรงชีต ยังไม่มีค่าจน Step 2/3 — สำคัญคือ "ต้องมีช่อง" ไม่งั้นค่าอื่นเลื่อน
    for (const col of ["Q", "R", "S", "T", "U", "V", "W", "X"]) {
      expect(r[col], `${col} ยังว่างจน Step 2/3`).toBe("");
    }
    expect(appendedRows()[0], "ต้องยิง 24 ช่องเสมอ").toHaveLength(24);
  });

  it("โอน + สลิป → รูปSlip ลงคอลัมน์ L", async () => {
    scriptGemini([
      turn({
        reply: "รับทราบค่ะ",
        stage: "3",
        paymentMethod: "โอน",
        orderData: {
          สินค้า: "น้ำพริกปลาทู",
          จำนวน: "2",
          ยอด: "190",
          ชื่อ: "สมชาย ใจดี",
          เบอร์: "0811122334",
          ที่อยู่: "9/9 ถ.สุขุมวิท กรุงเทพ 10110",
        },
      }),
      turn({ reply: "ได้รับสลิปแล้วค่ะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip" }),
    ]);

    const { sendImage } = await import("../harness/replay");
    await sendText(U, "โอนนะคะ สมชาย ใจดี 9/9 ถ.สุขุมวิท กรุงเทพ 10110 0811122334");
    await sendImage(U);

    const r = rowByColumn(0);
    expect(r.K).toBe("โอน");
    expect(r.L, "pathname สลิปต้องลงคอลัมน์ L").toMatch(/^slips\//);
  });
});
