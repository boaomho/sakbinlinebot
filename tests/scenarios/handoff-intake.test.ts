import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, adminPushes, lineCalls, harnessOverrides } from "../harness/state";
import { FULL_ADDRESS } from "../harness/fixtures";
import { seedBotLib, PRICING_CONFIG, v3StepRows } from "../harness/botlib-fixture";
import { readCustomer, setLastSeenAgo } from "../harness/db";

/**
 * D-34 · funnel_stage=handoff_after_intake — บอทคุยเก็บข้อมูลก่อน แล้วค่อย handoff
 * เพดานกันค้าง + "ขอคุยแอดมิน"(keyword) + AI ตัดสิน → handoff (footer) · pivot ออก → push-on-exit (ไม่ footer)
 */
const U = "Uharnesstestcustomer0000000000014";
const FOOTER = "บอทปิดการทำงานกับลูกค้ารายนี้แล้ว";

/**
 * 🔴 D-68: seed "ชีตดิบ v3" ผ่านเส้นทางเดียวกับ prod (loader → adapter)
 * funnel_stage = คอลัมน์ optional ที่ D-68 เปิดให้ adapter อ่าน — จำเป็นสำหรับ handoff_after_intake
 * ซึ่ง FIXED_FUNNEL (S1/S2/S2Q/S3/S4) ผลิตไม่ได้ (ดู DECISIONS D-68 ข้อ 1)
 */
function stepSheet(): string[][] {
  return v3StepRows([
    { step_id: "S1", funnel: "lead", essence: "ทักทาย" },
    { step_id: "S2_DIRECT", funnel: "qualified", entry: 'บอกจำนวน เช่น "สั่ง"', essence: "สรุปยอด" },
    { step_id: "S4B", funnel: "won", essence: "ปิดจบ" },
    { step_id: "H_CLAIM", funnel: "handoff_after_intake", name: "เคลม-คุยก่อน", entry: 'ของเสีย เช่น "ของเสีย"', essence: "ทวนปัญหา" },
    { step_id: "H1", funnel: "handoff", name: "เคลมด่วน", entry: "แพ้อาหาร" },
  ]);
}
function cfg(extra: [string, string][] = []): Map<string, string> {
  return new Map<string, string>([...Object.entries(PRICING_CONFIG), ...extra]);
}
function customerText(): string {
  return lineCalls.replies.flatMap((rr) => rr.messages).map((m) => (m.type === "text" ? m.text : "")).join(" ");
}

beforeEach(() => seedBotLib({ stepRows: stepSheet() }));

describe("handoff_after_intake — คุยก่อนค่อยส่งคน (D-34)", () => {
  it("เข้า intake เทิร์นแรก → ไม่ handoff · intake_turns=1 (บอทคุยก่อน)", async () => {
    scriptGemini([turn({ reply: "เสียใจด้วยนะคะ ขอถามรายละเอียดหน่อยค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "สินค้ามีปัญหาค่ะ");
    expect(JSON.stringify(adminPushes()), "ยังไม่ส่งคน").not.toContain(FOOTER);
    const c = await readCustomer(U);
    expect(c?.human_mode).toBe(false);
    expect(c?.intake_turns).toBe(1);
  });

  it("🔴 เกินเพดาน (เพดาน=2) → handoff + footer (กันค้าง)", async () => {
    harnessOverrides.config = { raw: cfg([["เพดานเทิร์นก่อนส่งแอดมิน", "2"]]) };
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "ขอรูปด้วยค่ะ", stage: "H_CLAIM", handoff: false }),
    ]);
    await sendText(U, "สินค้ามีปัญหา");
    expect((await readCustomer(U))?.human_mode, "เทิร์น 1 ยังคุย").toBe(false);
    await sendText(U, "อธิบายเพิ่ม");
    expect(JSON.stringify(adminPushes()), "เทิร์น 2 เกินเพดาน → handoff").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("'ขอคุยกับแอดมิน' กลาง intake → handoff ทันที (keyword pre-check)", async () => {
    scriptGemini([turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "สินค้ามีปัญหา");
    await sendText(U, "ขอคุยกับแอดมินเลยค่ะ");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 AI ตั้ง handoff=true เทิร์นแรก → ยังไม่ handoff (ถามก่อนอย่างน้อย min=1) · เทิร์น 2 + flag → handoff", async () => {
    scriptGemini([
      turn({ reply: "ขอส่งต่อแอดมินนะคะ", stage: "H_CLAIM", handoff: true, handoffReason: "เคลม" }),
      turn({ reply: "ขอส่งต่อแอดมินค่ะ", stage: "H_CLAIM", handoff: true, handoffReason: "เคลม" }),
    ]);
    await sendText(U, "สินค้ามีปัญหา");
    expect(JSON.stringify(adminPushes()), "เทิร์น 1 แม้ AI flag → ยังถามก่อน").not.toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode, "เทิร์น 1 ไม่ปิดบอท").toBe(false);
    await sendText(U, "รายละเอียดเพิ่มค่ะ");
    expect(JSON.stringify(adminPushes()), "เทิร์น 2 + flag → handoff").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 pivot: เคลมแล้ว 'ขอสั่งเพิ่ม' → ย้ายประตูขาย · push-on-exit (ไม่ footer) · บอทขายต่อ · intake_turns=0", async () => {
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "ได้เลยค่ะ รับ 3 ถ้วยนะคะ", stage: "S2_DIRECT", handoff: false, orderData: { items: [{ qty: 3 }] } }),
    ]);
    await sendText(U, "สินค้ามีปัญหา");
    await sendText(U, "เอาเป็นว่าขอสั่งเพิ่ม 3 ถ้วย");

    const admin = JSON.stringify(adminPushes());
    expect(admin, "(ก) push-on-exit เข้ากลุ่ม").toContain("ลูกค้าเพิ่งคุยเรื่อง");
    expect(admin, "(ก) ไม่มี footer").not.toContain(FOOTER);
    expect(customerText(), "(ข) บอทขายต่อ").toContain("รับ 3 ถ้วย");
    const c = await readCustomer(U);
    expect(c?.human_mode, "(ค) บอทไม่ปิด").toBe(false);
    expect(c?.intake_turns, "(ง) reset").toBe(0);
  });

  it("🔴 pivot + ปิดออเดอร์เทิร์นเดียว → 📦 กับ push-on-exit ไม่ตีกัน (คนละข้อความ)", async () => {
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "รับ 1 ถ้วย เก็บปลายทางค่ะ", stage: "S4B", handoff: false, paymentMethod: "COD", orderData: { items: [{ qty: 1 }], ...FULL_ADDRESS } }),
    ]);
    await sendText(U, "สินค้ามีปัญหา");
    await sendText(U, "ขอสั่ง 1 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 ชลบุรี 20000 0811122334");

    const admin = JSON.stringify(adminPushes());
    expect(admin, "📦 ออเดอร์ใหม่").toContain("ออเดอร์ใหม่");
    expect(admin, "push-on-exit").toContain("ลูกค้าเพิ่งคุยเรื่อง");
    expect(admin, "(จ) ไม่มี footer (ทั้งคู่ไม่ใช่ handoff)").not.toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(false);
  });

  it("🔴 reset ตอน handoff จาก intake → intake_turns=0 (กัน counter ค้างข้ามเซสชัน · D-35)", async () => {
    harnessOverrides.config = { raw: cfg([["เพดานเทิร์นก่อนส่งแอดมิน", "1"]]) }; // cap 1 → handoff เทิร์นแรกผ่านเพดาน
    scriptGemini([turn({ reply: "ส่งต่อค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "สินค้ามีปัญหา");
    expect(JSON.stringify(adminPushes()), "เกินเพดาน → handoff").toContain(FOOTER);
    expect((await readCustomer(U))?.intake_turns, "🔴 reset ตอน handoff (ไม่ค้าง)").toBe(0);
  });

  it("🔴 timeout: เงียบเกิน 45 นาที → intake นับใหม่ (ไม่สะสมข้ามเซสชัน · D-35)", async () => {
    scriptGemini([turn({ reply: "ถามค่ะ", stage: "H_CLAIM", handoff: false }), turn({ reply: "ถามอีกค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "สินค้ามีปัญหา");
    expect((await readCustomer(U))?.intake_turns).toBe(1);
    await setLastSeenAgo(U, 60); // เงียบ 60 นาที (> adminSilenceReturnMinutes 45)
    await sendText(U, "สินค้ามีปัญหาอีกค่ะ");
    expect((await readCustomer(U))?.intake_turns, "เงียบนาน → เริ่มนับใหม่ (1 ไม่ใช่ 2)").toBe(1);
  });

  it("funnel_stage=handoff (H1) → ยัง handoff เทิร์นแรก (D-33 ไม่ regression)", async () => {
    scriptGemini([turn({ reply: "...", stage: "H1", handoff: false })]);
    await sendText(U, "กินแล้วแพ้กุ้งไหมคะ");
    expect(JSON.stringify(adminPushes()), "handoff ทันที ไม่ต้องรอ intake").toContain(FOOTER);
  });
});
