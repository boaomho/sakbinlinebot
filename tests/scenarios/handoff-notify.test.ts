import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { adminPushes, lineCalls, harnessOverrides, sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { messagingApi } from "@line/bot-sdk";

/**
 * D-58 · handoff_notify + pre-check ชั้นสอง `คำ_notify`
 * ลูกค้าถามสุขภาพ (ไม่รุนแรง) → บังคับประตู H1 (funnel=handoff_notify): ตอบ pattern ชีต + push 🔔 + ไม่ปิดบอท
 * 🔴 DEFAULT_HANDOFF_KEYWORDS ในโค้ดไม่แตะ · เปิดใช้ผ่านชีต (ย้ายคำสุขภาพ handoff→notify)
 */
const U = "Uhandoffnotifycustomer00000000001";
const FOOTER = "บอทปิดการทำงานกับลูกค้ารายนี้แล้ว";
const NOTIFY_ANSWER = "สินค้ามีส่วนผสมปลาและกะปิค่ะ หากมีข้อสงสัยเรื่องแพ้อาหาร แนะนำปรึกษาแพทย์ เดี๋ยวแอดมินมาช่วยดูแลเพิ่มเติมนะคะ";

const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย"];
function row(step_id: string, funnel: string, o: Partial<Record<string, string>> = {}): string[] {
  return STEP_H.map((h) => (h === "step_id" ? step_id : h === "funnel_stage" ? funnel : o[h] ?? ""));
}
/** ชีตที่ H1=handoff_notify (มี pattern) + HX=handoff จริง */
function notifySheet(h1Funnel = "handoff_notify", h1Pattern = NOTIFY_ANSWER): string[][] {
  return [
    STEP_H,
    row("S1", "lead", { ตัวอย่างคำตอบ: "สวัสดีค่ะ" }),
    row("H1", h1Funnel, { ตัวอย่างคำตอบ: h1Pattern }),
    row("HX", "handoff", { ตัวอย่างคำตอบ: "ขอตามแอดมินนะคะ" }),
  ];
}
function bubbles(): string[] {
  return lineCalls.replies.flatMap((r) => r.messages).map((m) => (m.type === "text" ? (m.text ?? "") : "[IMG]"));
}
function notifyPushCount(): number {
  return adminPushes().filter((p) => p.messages.some((m: messagingApi.Message) => m.type === "text" && m.text.includes("ถามเรื่องสุขภาพ"))).length;
}
/** เปิดฟีเจอร์แบบชีตจริง: ย้ายคำสุขภาพจาก handoff → notify */
function cfgNotify(): void {
  harnessOverrides.config = { handoffKeywords: ["ขอแอดมิน", "คุยกับคน"], notifyKeywords: ["แพ้", "แพ้กุ้ง", "ท้อง"] };
}

beforeEach(() => seedBotLib({ stepRows: notifySheet() }));

describe("D-58 · handoff_notify — ตอบ + แจ้ง + ไม่ปิดบอท", () => {
  it("🔴 คำ_notify → บอทตอบ pattern H1 + push 🔔 + human_mode=false (ไม่มี footer)", async () => {
    cfgNotify();
    await sendText(U, "แพ้กุ้งกินได้ไหมคะ");
    expect(bubbles().join(" "), "ตอบ pattern ประตู H1").toContain("ปรึกษาแพทย์");
    const pushes = JSON.stringify(adminPushes());
    expect(pushes, "แจ้งแอดมิน 🔔").toContain("🔔");
    expect(pushes).toContain("ถามเรื่องสุขภาพ");
    expect(pushes, "ไม่ปิดบอท = ไม่มี footer").not.toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode, "ไม่ตั้ง human_mode").toBe(false);
  });

  it("🔴 fail-safe: คำ_notify แต่ H1 funnel=handoff (ตั้งผิด) → ปิดบอทเงียบ + footer", async () => {
    seedBotLib({ stepRows: notifySheet("handoff") }); // H1 ตั้งผิด
    cfgNotify();
    await sendText(U, "แพ้กุ้งไหมคะ");
    expect(JSON.stringify(adminPushes()), "ตกกลับ handoff").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode, "ห้ามบอทตอบสุขภาพเงียบ → ปิดบอท").toBe(true);
    expect(notifyPushCount(), "ไม่ push 🔔").toBe(0);
  });

  it("🔴 fail-safe: H1 funnel=handoff_notify แต่ pattern ว่าง → ปิดบอทเงียบ (ไม่หายเงียบ)", async () => {
    seedBotLib({ stepRows: notifySheet("handoff_notify", "") });
    cfgNotify();
    await sendText(U, "ท้องกินได้ไหม");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 precedence: คำ_handoff ชนะ คำ_notify (คำเดียวกันอยู่ทั้งคู่ → ปิดเงียบ)", async () => {
    harnessOverrides.config = { handoffKeywords: ["แพ้"], notifyKeywords: ["แพ้"] };
    await sendText(U, "แพ้กุ้งไหม");
    expect(JSON.stringify(adminPushes()), "handoff ก่อน").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
    expect(notifyPushCount()).toBe(0);
  });

  it("'แพ้กุ้งมั้ย' → เข้า notify ไม่โดน FAQ แย่ง (isHandoffTurn ข้าม FAQ/OBJ)", async () => {
    seedBotLib({ stepRows: notifySheet() });
    sheetsCalls.botLibReturn.CSV_FAQ = [
      ["คำถาม", "keywords", "action", "คำตอบ", "สถานะ"],
      ["อร่อยไหม", "อร่อย,กุ้ง", "answer", "อร่อยมากค่ะ", "live"],
    ];
    cfgNotify();
    await sendText(U, "แพ้กุ้งมั้ยคะ");
    const t = bubbles().join(" ");
    expect(t, "ตอบ pattern H1").toContain("ปรึกษาแพทย์");
    expect(t, "ไม่ใช่คำตอบ FAQ").not.toContain("อร่อยมากค่ะ");
  });

  it("🔴 dedup: ถามซ้ำประตูเดิม → push 🔔 ครั้งเดียว (ธง delivered_steps)", async () => {
    cfgNotify();
    await sendText(U, "แพ้กุ้งไหม");
    await sendText(U, "แล้วแพ้ปลาล่ะ");
    expect(notifyPushCount(), "push 🔔 ครั้งเดียว").toBe(1);
  });

  it("deploy default (notifyKeywords ว่าง) = พฤติกรรมเดิม 100% — คำสุขภาพใน handoff เดิม → ปิดเงียบ", async () => {
    // ไม่ override config → ใช้ DEFAULT_HANDOFF_KEYWORDS (มี 'แพ้') · notifyKeywords = []
    await sendText(U, "แพ้กุ้งกินได้ไหม");
    expect(JSON.stringify(adminPushes()), "handoff เดิม").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
    expect(notifyPushCount(), "notify ปิดอยู่").toBe(0);
  });
});
