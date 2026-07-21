import { describe, it, expect, beforeEach } from "vitest";
import { sendText, sendImage } from "../harness/replay";
import { scriptGemini, turn, adminPushes } from "../harness/state";
import { FULL_ADDRESS } from "../harness/fixtures";
import { seedBotLib } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { messagingApi } from "@line/bot-sdk";

/**
 * D-33 · ทุกทาง handoff ผ่านประตูรวม handoff() → มี footer "บอทปิด..." + ปิดบอท
 * · push ที่ไม่ปิดบอท (📦 ออเดอร์ใหม่) → ไม่มี footer · funnel_stage=handoff → โค้ดการันตี
 */
const U = "Uharnesstestcustomer0000000000013";
const FOOTER = "บอทปิดการทำงานกับลูกค้ารายนี้แล้ว";

const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ความรู้สึกลูกค้าตอนนี้", "ทำไมประตูนี้สำคัญ", "หลักการนำพา", "ห้ามทำ", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย"];
function row(step_id: string, funnel_stage: string, o: Partial<Record<string, string>> = {}): string[] {
  return STEP_H.map((h) => (h === "step_id" ? step_id : h === "funnel_stage" ? funnel_stage : o[h] ?? ""));
}
/** step sheet ที่มี H1 funnel_stage=handoff (ทดสอบโค้ดการันตี) */
function handoffStepSheet(): string[][] {
  return [STEP_H, row("S1", "lead", { หลักการนำพา: "ทักทาย" }), row("H1", "handoff", { ห้ามทำ: "ห้ามตอบเอง", ตัวอย่างคำตอบ: "ขอตามแอดมินนะคะ" })];
}
function hasImagePush(): boolean {
  return adminPushes().some((p) => p.messages.some((m: messagingApi.Message) => m.type === "image"));
}

beforeEach(() => seedBotLib());

describe("handoff รวมศูนย์ — 5 ทาง มี footer + ปิดบอท (D-33)", () => {
  it("1) keyword pre-check → footer + human_mode", async () => {
    await sendText(U, "ขอคุยกับคนหน่อยค่ะ");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("2) AI-semantic (handoff=true) → footer + reason", async () => {
    scriptGemini([turn({ reply: "ขอตามแอดมินนะคะ", stage: "2", handoff: true, handoffReason: "ขอส่วนลด" })]);
    await sendText(U, "ขอลดหน่อยได้ไหม");
    const a = JSON.stringify(adminPushes());
    expect(a).toContain(FOOTER);
    expect(a).toContain("ขอส่วนลด");
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("3) เคลม/damage → footer + รูปหลักฐานแนบ (ไม่หาย)", async () => {
    scriptGemini([turn({ reply: "รับเรื่องแล้วค่ะ", stage: "2", imageIntent: "damage", imageNote: "ของแตก" })]);
    await sendImage(U);
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect(hasImagePush(), "รูปหลักฐานต้องแนบไปด้วย").toBe(true);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 4) funnel_stage=handoff (H1) → โค้ดการันตี handoff แม้ AI ไม่ตั้ง flag", async () => {
    seedBotLib({ stepRows: handoffStepSheet() });
    scriptGemini([turn({ reply: "...", stage: "H1", handoff: false })]);
    await sendText(U, "กินแล้วแพ้กุ้งไหมคะ");
    expect(JSON.stringify(adminPushes()), "โค้ดการันตี (ไม่พึ่ง AI flag)").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 non-handoff: ออเดอร์ใหม่ (📦) → ไม่มี footer · บอทไม่ปิด", async () => {
    scriptGemini([turn({ reply: "รับ 1 ถ้วยค่ะ", stage: "4b", paymentMethod: "COD", orderData: { items: [{ qty: 1 }], ...FULL_ADDRESS } })]);
    await sendText(U, "เอา 1 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 ชลบุรี 20000 0811122334");
    const a = JSON.stringify(adminPushes());
    expect(a, "ออเดอร์ใหม่").toContain("ออเดอร์ใหม่");
    expect(a, "ไม่ใช่ handoff → ไม่มี footer").not.toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(false);
  });
});
