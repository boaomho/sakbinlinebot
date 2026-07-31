import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { parseAssistantResponse } from "@/lib/train/assistant";
import { buildAssistantKB } from "@/lib/train/assistant-kb";
import { appendRow, writeCell } from "@/lib/train/write";

/**
 * D-59 จ-1 · ผู้ช่วยเทรน — parser/schema (บริสุทธิ์) + เส้นทางเขียน origin=ai (TRAIN_LOG ai-draft/ai-edit)
 * + scope guard (Config เขียนไม่ได้) · lint block ไหลกลับ (คืน status lint)
 */
beforeAll(() => {
  process.env.TRAIN_PASSWORD = "test-train-pass";
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
});
beforeEach(() => seedBotLib());

// ---------- parser/schema ----------
describe("D-59 · parseAssistantResponse", () => {
  it("cols array → record · action/tab ถูก", () => {
    const raw = JSON.stringify({ reply: "โอเคค่ะ", proposals: [{ action: "add-row", tab: "CSV_FAQ", key: "ส่งไปตปท.ไหม", note: "n", cols: [{ name: "คำตอบ", value: "ส่งเฉพาะในไทยค่ะ" }, { name: "keywords", value: "ตปท,ต่างประเทศ" }] }] });
    const out = parseAssistantResponse(raw);
    expect(out.reply).toBe("โอเคค่ะ");
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].cols).toEqual({ คำตอบ: "ส่งเฉพาะในไทยค่ะ", keywords: "ตปท,ต่างประเทศ" });
  });
  it("🔴 cap ≤3 proposals (กติกา 10)", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ action: "add-row", tab: "CSV_FAQ", key: `k${i}`, note: "n", cols: [] }));
    const out = parseAssistantResponse(JSON.stringify({ reply: "x", proposals: many }));
    expect(out.proposals).toHaveLength(3);
  });
  it("🔴 scope guard: tab นอก 4 แท็บ / action ผิด → ตัดทิ้ง", () => {
    const out = parseAssistantResponse(JSON.stringify({ reply: "x", proposals: [
      { action: "add-row", tab: "CSV_Config", key: "k", note: "n", cols: [] },
      { action: "delete", tab: "CSV_FAQ", key: "k", note: "n", cols: [] },
      { action: "add-row", tab: "CSV_Products", key: "k", note: "n", cols: [] },
    ] }));
    expect(out.proposals, "Config/Products/delete ถูกตัด").toHaveLength(0);
  });
  it("🔴 no-guess (กติกา 8): reply อย่างเดียว ไม่มี proposal → คืน reply + proposals ว่าง", () => {
    const out = parseAssistantResponse(JSON.stringify({ reply: "ขอถามก่อนนะคะ ส่งด่วนหรือธรรมดา?", proposals: [] }));
    expect(out.proposals).toHaveLength(0);
    expect(out.reply).toContain("ขอถาม");
  });
  it("key ว่าง → ตัด · non-JSON → reply fallback", () => {
    expect(parseAssistantResponse(JSON.stringify({ reply: "x", proposals: [{ action: "add-row", tab: "CSV_FAQ", key: "", note: "", cols: [] }] })).proposals).toHaveLength(0);
    expect(parseAssistantResponse("ไม่ใช่ json").proposals).toHaveLength(0);
    expect(parseAssistantResponse(undefined).proposals).toHaveLength(0);
  });
});

// ---------- KB ----------
describe("D-59 · buildAssistantKB", () => {
  it("มี header/keys 4 แท็บ + วิธีใช้ + claims", async () => {
    const kb = await buildAssistantKB();
    expect(kb).toContain("วิธีใช้ระบบ");
    expect(kb).toContain("CSV_FAQ");
    expect(kb).toContain("ส่งกี่วัน"); // key จาก seedBotLib FAQ
    expect(kb).toContain("คำโฆษณาต้องห้าม");
  });
});

// ---------- เส้นทางเขียน origin=ai ----------
const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "สถานะ"];
function seedStep(): void {
  seedBotLib();
  sheetsCalls.botLibReturn.CSV_Step = [STEP_H, ["S1", "lead", "ทัก", "สวัสดีค่ะ", "", "live"]];
}
function lastTrainLog(): string[] | undefined {
  const log = sheetsCalls.appends.filter((a) => a.range.startsWith("TRAIN_LOG")).pop();
  return log?.values[log.values.length - 1];
}

describe("D-59 · เขียน origin=ai → TRAIN_LOG ai-draft/ai-edit", () => {
  it("appendRow origin=ai → บังคับ draft + action=ai-draft", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn.CSV_FAQ = [["คำถาม", "keywords", "action", "คำตอบ", "สถานะ"], ["x", "x", "answer", "y", "live"]];
    const res = await appendRow("CSV_FAQ", { คำถาม: "ส่งเสาร์ไหม", keywords: "เสาร์", action: "answer", คำตอบ: "ส่งค่ะ" }, "ai");
    expect(res.status).toBe("ok");
    expect(lastTrainLog()![6], "action ai-draft").toBe("ai-draft");
  });
  it("writeCell origin=ai → action=ai-edit", async () => {
    seedStep();
    const res = await writeCell("CSV_Step", "S1", "ตัวอย่างคำตอบ", "สวัสดีจ้า", "สวัสดีค่ะ", "ai");
    expect(res.status).toBe("ok");
    expect(lastTrainLog()![6], "action ai-edit").toBe("ai-edit");
  });
  it("🔴 Config เขียนไม่ได้จริง (assertEditable) — AI สั่งก็ไม่ผ่าน", async () => {
    await expect(appendRow("CSV_Config", { key: "x" }, "ai")).rejects.toThrow(/เขียนไม่ได้|Config/);
    await expect(writeCell("CSV_Config", "k", "value", "9", "", "ai")).rejects.toThrow();
  });
  it("🔴 lint block ไหลกลับ (status lint · ไม่เขียน) — H1 คำสุขภาพไม่ handoff", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn.CSV_FAQ = [["คำถาม", "keywords", "action", "คำตอบ", "สถานะ"], ["x", "x", "answer", "y", "live"]];
    const res = await appendRow("CSV_FAQ", { คำถาม: "แพ้กุ้งทานได้ไหม", keywords: "แพ้กุ้ง", action: "answer", คำตอบ: "ทานได้ค่ะ ไม่เป็นไร" }, "ai");
    expect(res.status).toBe("lint");
  });
});

// ---------- route guard ----------
describe("D-59 · assistant route", () => {
  it("ไม่มี cookie → 401", async () => {
    const { POST } = await import("@/app/train/api/assistant/route");
    const req = new NextRequest("https://t.invalid/train/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", text: "hi" }] }) });
    expect((await POST(req)).status).toBe(401);
  });
});
