import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, sheetsCalls } from "../harness/state";
import { appendedRows, rowByColumn, columnOf } from "../harness/sheet";
import { seedBotLib } from "../harness/botlib-fixture";
import { ORDERS_HEADER } from "@/lib/orders";

beforeEach(() => seedBotLib());

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

describe("ORDERS_HEADER — ต้องตรงกับชีตจริง 26 ช่อง A–Z (D-31 เพิ่ม Y/Z แก้ไข)", () => {
  it("มี 26 คอลัมน์", () => {
    expect(ORDERS_HEADER).toHaveLength(26);
  });

  it("Z/AA = แก้ไขล่าสุด/แก้ไขกี่ครั้ง (D-31 · เลื่อนจาก Y/Z เพราะ D-64 แทรก Q)", () => {
    expect(columnOf("แก้ไขล่าสุด")).toBe("Z");
    expect(columnOf("แก้ไขกี่ครั้ง")).toBe("AA");
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
      // 🔴 D-64: Q = "กล่องส่งออเดอร์" (สูตรในชีต · โค้ดไม่ได้ขอ) → order_id เลื่อนไป R
      R: "order_id",
      S: "line_user_id",
      T: "items_json",
      U: "ค่าส่ง",
      V: "source_channel",
      W: "ref_code",
      X: "ยอดในสลิป",
      Y: "bot_version",
    };
    for (const [col, header] of Object.entries(expected)) {
      expect(columnOf(header), `${header} ต้องอยู่คอลัมน์ ${col}`).toBe(col);
    }
  });

  it("🔴 D-64: แทรก Q \"กล่องส่งออเดอร์\" → order_id เป็นต้นไปเลื่อนขวา 1 ช่อง", () => {
    expect(columnOf("order_id"), "เดิม Q → ตอนนี้ R").toBe("R");
    expect(columnOf("line_user_id"), "เดิม R → S").toBe("S");
    expect(columnOf("items_json"), "เดิม S → T").toBe("T");
    expect(columnOf("ค่าส่ง"), "เดิม T → U").toBe("U");
    expect(columnOf("source_channel"), "เดิม U → V").toBe("V");
    expect(columnOf("ref_code"), "เดิม V → W").toBe("W");
    expect(columnOf("ยอดในสลิป"), "เดิม W → X").toBe("X");
    expect(columnOf("bot_version"), "เดิม X → Y").toBe("Y");
    expect(columnOf("แก้ไขล่าสุด"), "เดิม Y → Z").toBe("Z");
    expect(columnOf("แก้ไขกี่ครั้ง"), "เดิม Z → AA").toBe("AA");
  });
});

describe("appendOrderRow — ทุก field ลงตรงคอลัมน์จริง", () => {
  it("COD ครบ (items → 2-pass) → แถวดิบตรงทุกช่อง A–X · ยอด/ค่าส่ง จาก pricing", async () => {
    scriptGemini([
      turn({
        reply: "รับ 3 ถ้วย 275 บาท ส่งของให้เลยนะคะ",
        stage: "4b",
        paymentMethod: "COD",
        orderData: {
          items: [{ qty: 3 }],
          ชื่อ: "สมหญิง ใจดี",
          เบอร์: "081-112 2334",
          ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540",
        },
      }),
    ]);

    await sendText(U, "เอา 3 ถ้วย สมหญิง ใจดี 123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540 081-112 2334 เก็บปลายทาง");

    expect(appendedRows(), "ต้องเขียน 1 แถว").toHaveLength(1);
    expect(sheetsCalls.appends[0].range, "🔴 D-64: ชีตมี 27 คอลัมน์ (แทรก Q) → range ครอบถึง AA").toBe("Orders!A:AA");

    const r = rowByColumn(0);
    expect(r.A, "🔴 D-64: ลำดับ เว้นว่าง — Apps Script บนชีตเป็นคนเขียนตอนติ๊ก M").toBe("");
    expect(r.B, "วันที่ = เวลาไทย YYYY-MM-DD HH:MM (D-37 · ไม่ใช่ UTC)").toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(r.B, "🔴 ห้ามเป็น UTC (ไม่มี Z/T)").not.toMatch(/[TZ]/);
    expect(r.C, "ชื่อไลน์ลูกค้า").toBe("คุณทดสอบ");
    expect(r.D, "ชื่อ-นามสกุล").toBe("สมหญิง ใจดี");
    expect(r.E, "เบอร์โทร (sanitize ตัวจริง)").toBe("0811122334");
    expect(r.F, "ที่อยู่ ก้อนดิบ").toBe("123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540");
    expect(r.G, "จังหวัด — ปล่อยว่าง (D-15)").toBe("");
    expect(r.H, "รหัสไปรษณีย์ — ปล่อยว่าง").toBe("");
    expect(r.I, "สินค้า+จำนวน จาก pricing").toBe("น้ำพริกปลาทูฟรีซดราย x3");
    expect(r.J, "ยอดเงิน qty3 COD = 275 (ไม่ใช่ 285 จาก AI)").toBe("275");
    expect(r.K, "การชำระเงิน").toBe("COD");
    expect(r.L, "รูปSlip — COD ไม่มี").toBe("");
    expect(r.M, "คอนเฟิร์ม").toBe("FALSE");
    expect(r.N, "ยกเลิก").toBe("FALSE");
    expect(r.O, "ส่งออเดอร์แล้ว").toBe("FALSE");
    expect(r.P, "เลขTracking").toBe("");
    // 🔴 D-64 เลื่อน 1 ช่อง: R=order_id · S=line_user_id · T=items_json · U=ค่าส่ง
    expect(r.Q, "🔴 Q = กล่องส่งออเดอร์ (สูตรในชีต) — โค้ดต้องไม่เขียนทับ").toBe("");
    expect(r.T, "items_json").toContain("NPT-10G");
    expect(r.U, "ค่าส่ง qty3 = ส่งฟรี 0").toBe("0");
    expect(r.R, "R = order_id (D-29)").toMatch(/^SKB-\d{8}-[a-z0-9]{6}$/);
    expect(r.S, "🔴 S = line_user_id (KI-06 fix — join key)").toBe(U);
    for (const col of ["V", "W", "X", "Y", "Z", "AA"]) {
      expect(r[col], `${col} ยังว่างตอนเขียนครั้งแรก (Z/AA เติมตอนแก้)`).toBe("");
    }
    expect(appendedRows()[0], "🔴 ยิง 27 ช่อง (A–AA) ตาม header จริงของชีต").toHaveLength(27);
  });

  it("โอน + สลิป → รูปSlip ลงคอลัมน์ L · ยอด qty2 = 220 (จาก pricing)", async () => {
    scriptGemini([
      turn({
        reply: "รับ 2 ถ้วย 220 บาท รอสลิปนะคะ",
        stage: "3",
        paymentMethod: "โอน",
        orderData: {
          items: [{ qty: 2 }],
          ชื่อ: "สมชาย ใจดี",
          เบอร์: "0811122334",
          ที่อยู่: "9/9 ถ.สุขุมวิท กรุงเทพ 10110",
        },
      }),
      turn({ reply: "ได้รับสลิปแล้วค่ะ", stage: "4a", paymentMethod: "โอน", imageIntent: "slip" }),
    ]);

    const { sendImage } = await import("../harness/replay");
    await sendText(U, "เอา 2 ถ้วย โอนนะคะ สมชาย ใจดี 9/9 ถ.สุขุมวิท กรุงเทพ 10110 0811122334");
    await sendImage(U);

    const r = rowByColumn(0);
    expect(r.K).toBe("โอน");
    expect(r.J, "qty2 โอน = 190+30 = 220").toBe("220");
    expect(r.L, "pathname สลิปต้องลงคอลัมน์ L").toMatch(/^slips\//);
  });
});
