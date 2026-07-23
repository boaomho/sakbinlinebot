import { describe, it, expect } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, adminPushes } from "../harness/state";
import { readCustomer } from "../harness/db";

/**
 * โครง scenario ที่ v1.2 "ยังทำไม่ได้" — mark ด้วย it.fails() = คาดว่าต้องแดง
 * ถ้าวันไหนมันเขียวขึ้นมา vitest จะฟ้องว่า "expected to fail but passed"
 * → นั่นคือสัญญาณว่า Step 4/5 ทำสำเร็จ ให้มาปลด .fails ออก
 *
 * ⚠️ ข้อจำกัดที่ต้องรู้: Gemini ถูก script ในโหมด default ดังนั้นบทเหล่านี้
 * "ไม่ได้พิสูจน์ความฉลาดของ AI" — มันพิสูจน์ได้แค่ชั้นที่เป็นโค้ด (keyword pre-check,
 * FAQ action=handoff, claims guard) ซึ่งเป็นของที่ Step 4/5 จะเพิ่มเข้ามาจริง ๆ
 * ส่วนบทที่ต้องวัด AI จริง ๆ (5, 12) ต้องรันด้วย HARNESS_REAL_GEMINI=1 ถึงจะมีความหมาย
 */

const U = "Uharnesstestcustomer0000000000002";

describe("บท 2 — 'แพ้กุ้งกินได้มั้ยคะ' → ต้อง handoff ทันที บอทไม่ตอบเอง", () => {
  // ✅ D-44: DEFAULT_HANDOFF_KEYWORDS มีคำกลุ่มสุขภาพ/แพ้แล้ว (ตรงชีต v2.0) → ปลด .fails เป็นเทสเขียวจริง
  it("keyword pre-check จับคำแพ้อาหาร → handoff (H1 เส้นตาย)", async () => {
    scriptGemini([turn({ reply: "กินได้ค่ะ ไม่มีปัญหา", stage: "2" })]);

    await sendText(U, "แพ้กุ้งกินได้มั้ยคะ");

    const c = await readCustomer(U);
    expect(c?.human_mode, "ต้องเข้าโหมดคน (handoff)").toBe(true);
    expect(JSON.stringify(adminPushes())).toContain("ส่งต่อแอดมิน");
  });
});

describe("บท 3 — 'ลดราคาได้มั้ย' → handoff (H2)", () => {
  // v1.2: `คำ_handoff` ยังไม่มีคำกลุ่มส่วนลด (Step 4 เพิ่ม)
  it.fails("keyword pre-check ต้องจับคำขอส่วนลด → handoff", async () => {
    scriptGemini([turn({ reply: "ลดให้ 20% เลยค่ะ", stage: "2" })]);

    await sendText(U, "ลดราคาได้มั้ย");

    const c = await readCustomer(U);
    expect(c?.human_mode, "ต้องเข้าโหมดคน (handoff)").toBe(true);
  });
});

describe("บท 5 — 'ราคานี้ซื้อข้าวได้ 3 มื้อเลยนะ' → ยังใช้หลักการ OBJ_PRICE ตอบได้", () => {
  // v1.2: ยังไม่มี CSV_Objections / objection matching / objection_detected (Step 5)
  it.fails("ต้อง match OBJ_PRICE และไม่ลดราคา", async () => {
    scriptGemini([turn({ reply: "เข้าใจค่ะ", stage: "2" })]);

    await sendText(U, "ราคานี้ซื้อข้าวได้ 3 มื้อเลยนะ");

    // ยังไม่มี field นี้ใน responseSchema ของ v1.2
    const { geminiState } = await import("../harness/state");
    const out = geminiState.script[0] as unknown as { objection_detected?: string };
    expect(out.objection_detected, "ต้องมี objection_detected ใน schema").toBe("OBJ_PRICE");
  });
});

describe("บท 6 — 'มีขายที่ 7-11 มั้ย' (ไม่มีข้อมูล) → บอกว่าไม่มีข้อมูล + handoff (กฎ 10)", () => {
  // v1.2: ยังไม่มีกฎเหล็กข้อ 10 ใน system prompt (Step 5.4)
  it.fails("ไม่มีข้อมูล = ต้อง handoff ห้ามเดา", async () => {
    scriptGemini([turn({ reply: "มีค่ะ หาซื้อได้ตามร้านสะดวกซื้อทั่วไป", stage: "2" })]);

    await sendText(U, "มีขายที่ 7-11 มั้ย");

    const c = await readCustomer(U);
    expect(c?.human_mode, "ไม่มีข้อมูล → ต้องเรียกคน").toBe(true);
  });
});

// ✅ บท 12 (prompt injection → price guard) ย้ายไป price-guard.test.ts แล้ว (KI-02 แก้ใน Step 5 · D-27)
//    KI-01 (word-boundary) + KI-02 (price guard) เสร็จ → เคสนี้เป็น test เขียวจริง ไม่ใช่ it.fails อีก
