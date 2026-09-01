import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { sheetsCalls } from "../harness/state";
import { seedBotLib, v3StepRows, v3KnowRows } from "../harness/botlib-fixture";
import { parseAssistantResponse, buildAssistantSystem } from "@/lib/train/assistant";
import { rewriteSafety } from "@/lib/train/rewrite-safety";
import { lintPattern } from "@/lib/train/lint";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { getConfig } from "@/lib/config";
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
    const raw = JSON.stringify({ reply: "โอเคค่ะ", proposals: [{ action: "add-row", tab: "Knowledge", key: "ส่งไปตปท.ไหม", note: "n", cols: [{ name: "คำตอบ", value: "ส่งเฉพาะในไทยค่ะ" }, { name: "keywords", value: "ตปท,ต่างประเทศ" }] }] });
    const out = parseAssistantResponse(raw);
    expect(out.reply).toBe("โอเคค่ะ");
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].cols).toEqual({ คำตอบ: "ส่งเฉพาะในไทยค่ะ", keywords: "ตปท,ต่างประเทศ" });
  });
  it("🔴 cap ≤3 proposals (กติกา 10)", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ action: "add-row", tab: "Knowledge", key: `k${i}`, note: "n", cols: [] }));
    const out = parseAssistantResponse(JSON.stringify({ reply: "x", proposals: many }));
    expect(out.proposals).toHaveLength(3);
  });
  it("🔴 scope guard: tab นอก 4 แท็บ / action ผิด → ตัดทิ้ง", () => {
    const out = parseAssistantResponse(JSON.stringify({ reply: "x", proposals: [
      { action: "add-row", tab: "Config", key: "k", note: "n", cols: [] },
      { action: "delete", tab: "Knowledge", key: "k", note: "n", cols: [] },
      { action: "add-row", tab: "Products", key: "k", note: "n", cols: [] },
    ] }));
    expect(out.proposals, "Config/Products/delete ถูกตัด").toHaveLength(0);
  });
  it("🔴 no-guess (กติกา 8): reply อย่างเดียว ไม่มี proposal → คืน reply + proposals ว่าง", () => {
    const out = parseAssistantResponse(JSON.stringify({ reply: "ขอถามก่อนนะคะ ส่งด่วนหรือธรรมดา?", proposals: [] }));
    expect(out.proposals).toHaveLength(0);
    expect(out.reply).toContain("ขอถาม");
  });
  it("key ว่าง → ตัด · non-JSON → reply fallback", () => {
    expect(parseAssistantResponse(JSON.stringify({ reply: "x", proposals: [{ action: "add-row", tab: "Knowledge", key: "", note: "", cols: [] }] })).proposals).toHaveLength(0);
    expect(parseAssistantResponse("ไม่ใช่ json").proposals).toHaveLength(0);
    expect(parseAssistantResponse(undefined).proposals).toHaveLength(0);
  });
});

// ---------- D-60.2 · phase gate (invariant flow สัมภาษณ์อยู่ในโค้ด — บั๊กที่เทสเดิมจับไม่ได้เพราะ invariant อยู่แค่ใน prompt) ----------
describe("D-60.2 · phase gate — จังหวะสัมภาษณ์ห้ามมี proposals", () => {
  const prop = { action: "add-row", tab: "Steps", key: "H5", note: "n", cols: [{ name: "funnel_stage", value: "handoff_notify" }] };
  it('🔴 phase="interview" + โมเดลแอบส่ง proposals → server ทิ้งทั้งหมด (เคสบั๊กจริง H5)', () => {
    const out = parseAssistantResponse(JSON.stringify({ reply: "ขอถามก่อนค่ะ", phase: "interview", proposals: [prop] }));
    expect(out.phase).toBe("interview");
    expect(out.proposals, "gate ทิ้ง proposals").toHaveLength(0);
    expect(out.reply).toContain("ขอถาม");
  });
  it('phase="draft" → ทิ้งเหมือนกัน (จังหวะเสนอ 3 แบบใน reply)', () => {
    expect(parseAssistantResponse(JSON.stringify({ reply: "3 แบบค่ะ...", phase: "draft", proposals: [prop] })).proposals).toHaveLength(0);
  });
  it('phase="proposal" → ผ่านปกติ · phase หาย = proposal (compat)', () => {
    expect(parseAssistantResponse(JSON.stringify({ reply: "x", phase: "proposal", proposals: [prop] })).proposals).toHaveLength(1);
    expect(parseAssistantResponse(JSON.stringify({ reply: "x", proposals: [prop] })).proposals).toHaveLength(1);
  });
});

describe("D-60.2 · prompt: FLOW ขึ้นต้น + few-shot + ข้อยกเว้นแคบ", () => {
  it("🔴 FLOW สัมภาษณ์อยู่ก่อนกติกาเหล็ก (ไม่จมกลางลิสต์)", () => {
    const s = buildAssistantSystem("KB");
    expect(s.indexOf("FLOW สัมภาษณ์"), "FLOW มาก่อน").toBeLessThan(s.indexOf("กติกาเหล็ก"));
    expect(s).toContain('"phase":"interview"'); // few-shot ตัวอย่างเทิร์นแรกงานใหม่
    expect(s, "ข้อยกเว้นแคบ: แค่บอกหัวข้อ/ชื่อประตู = ไม่ครบ").toContain("แค่บอกหัวข้อ/ชื่อประตู");
    expect(s, "บอกโมเดลว่า server จะทิ้ง").toContain("ระบบจะทิ้ง proposals อัตโนมัติ");
  });
});

describe("D-60.2 · UI persona — ไม่มี 'ผม' hardcode ใน TrainStudio (guard แบบ prompt-lint)", () => {
  it("🔴 greeting/ข้อความผู้ช่วยใน UI ต้องไม่ใช้ ผม", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/train/TrainStudio.tsx", "utf8");
    expect(src).not.toMatch(/บอกผม|ผมจะ|ผมช่วย|ผมให้/);
  });
});

// real-Gemini (skip-gated เหมือน golden): เคสบั๊กจริง — เทิร์นแรกงานใหม่ H5 ต้องไม่ออกใบ
const RUN_REAL = process.env.HARNESS_REAL_GEMINI === "1" && Boolean(process.env.GEMINI_API_KEY);
describe.skipIf(!RUN_REAL)("D-60.2 · real Gemini — เทิร์นแรกงานใหม่ = interview (ไม่มี proposal)", () => {
  it("สั่ง 'เพิ่ม Step H5 handoff_notify เรื่องสุขภาพ' (ไม่มีตัวอย่าง/คำตอบ) → proposals ว่าง + ถามกลับ", async () => {
    const { runTrainAssistant } = await import("@/lib/train/assistant");
    const kb = await buildAssistantKB();
    const out = await runTrainAssistant([{ role: "user", text: "เพิ่ม Step H5 เป็น handoff_notify เวลาลูกค้ามีคำถามหรือแจ้งเกี่ยวกับสุขภาพ" }], kb);
    expect(out.proposals, "เทิร์นแรกงานใหม่ห้ามออกใบ").toHaveLength(0);
    expect(out.reply.length, "ต้องถามกลับ ไม่ใช่ตอบเปล่า").toBeGreaterThan(20);
  }, 45_000);
});

// ---------- KB ----------
describe("D-59 · buildAssistantKB", () => {
  it("มี header/keys 4 แท็บ + วิธีใช้ + claims", async () => {
    const kb = await buildAssistantKB();
    expect(kb).toContain("วิธีใช้ระบบ");
    expect(kb).toContain("Knowledge");
    expect(kb).toContain("ส่งกี่วัน"); // key จาก seedBotLib FAQ
    expect(kb).toContain("คำโฆษณาต้องห้าม");
  });
});

// ---------- เส้นทางเขียน origin=ai ----------
function seedStep(): void {
  seedBotLib({ stepRows: v3StepRows([{ step_id: "S1", funnel: "lead", name: "ทัก", guide: "สวัสดีค่ะ" }]) });
}
function lastTrainLog(): string[] | undefined {
  const log = sheetsCalls.appends.filter((a) => a.range.startsWith("TRAIN_LOG")).pop();
  return log?.values[log.values.length - 1];
}

describe("D-59 · เขียน origin=ai → TRAIN_LOG ai-draft/ai-edit", () => {
  it("appendRow origin=ai → บังคับ draft + action=ai-draft", async () => {
    // 🔴 D-68: เขียนชีต v3 ยังปิดอยู่ → ผ่าน guard ครบแล้ว throw ก่อนแตะ Google (ไม่มี TRAIN_LOG)
    //    การันตี origin=ai → ai-draft จะกลับมาพิสูจน์ได้เมื่อเปิดเขียนใน D-69
    seedBotLib({ knowRows: v3KnowRows([{ say: "x", keyword: "x", fact: "y" }]) });
    sheetsCalls.appends.length = 0;
    await expect(appendRow("Knowledge", { คำถาม: "ส่งเสาร์ไหม", keywords: "เสาร์", action: "answer", คำตอบ: "ส่งค่ะ" }, "ai"))
      .rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
    expect(lastTrainLog(), "ไม่แตะ TRAIN_LOG").toBeUndefined();
  });
  it("writeCell origin=ai → ผ่าน guard แล้วติด write-disabled (ไม่แตะชีต)", async () => {
    seedStep();
    sheetsCalls.batchUpdates.length = 0;
    sheetsCalls.appends.length = 0;
    await expect(writeCell("Steps", "S1", "ตัวอย่างคำตอบ", "สวัสดีจ้า", "สวัสดีค่ะ", "ai"))
      .rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
    expect([...sheetsCalls.batchUpdates, ...sheetsCalls.appends], "ห้ามแตะชีต/TRAIN_LOG").toHaveLength(0);
  });
  it("🔴 Config เขียนไม่ได้จริง (assertEditable) — AI สั่งก็ไม่ผ่าน", async () => {
    await expect(appendRow("Config", { key: "x" }, "ai")).rejects.toThrow(/เขียนไม่ได้|Config/);
    await expect(writeCell("Config", "k", "value", "9", "", "ai")).rejects.toThrow();
  });
  it("🔴 lint block ไหลกลับ (status lint · ไม่เขียน) — H1 คำสุขภาพไม่ handoff", async () => {
    // 🔴 D-72a: เดิมมีบรรทัด seed `botLibReturn.CSV_FAQ` ทับ — ตายมาตั้งแต่ D-61.B (ชื่อไม่ตรงแท็บจริง)
    //    ลบทิ้ง → ใช้ Knowledge จาก seedBotLib() เหมือนที่เคยทำงานจริง (เคสนี้วัด lint ไม่ได้วัดแถวเดิม)
    seedBotLib();
    const res = await appendRow("Knowledge", { คำถาม: "แพ้กุ้งทานได้ไหม", keywords: "แพ้กุ้ง", action: "answer", คำตอบ: "ทานได้ค่ะ ไม่เป็นไร" }, "ai");
    expect(res.status).toBe("lint");
  });
});

// ---------- D-60 · per-door parse + system prompt + rewriteSafety ----------
describe("D-59/60 · buildAssistantSystem — กติกา 11/12/persona", () => {
  it("มี flow สัมภาษณ์ (11) · เสียงนักขาย (12) · persona ค่ะ · เกลาเสียง · excludeKeys", () => {
    const s = buildAssistantSystem("KB_PLACEHOLDER", ["Knowledge::ส่งกี่วัน"]);
    expect(s).toContain("FLOW สัมภาษณ์");
    expect(s).toContain("3 แบบ");
    expect(s).toContain("เสียงนักขาย CX");
    expect(s).toContain("ค่ะ/นะคะ");
    expect(s).toContain("ห้าม ครับ/ผม");
    expect(s).toContain("เกลาเสียง");
    expect(s, "excludeKeys ต่อท้าย").toContain("Knowledge::ส่งกี่วัน");
    expect(s).toContain("KB_PLACEHOLDER");
  });
  it("🔴 กติกา 12 เกลา — 3 หมวก + 3 เทคนิค (choice close/ดีขึ้น/say no) + 3C", () => {
    const s = buildAssistantSystem("KB");
    expect(s).toContain("หมวก1 นักแก้ปัญหา");
    expect(s).toContain("หมวก2 นักสร้างความต้องการ");
    expect(s).toContain("หมวก3 นักสร้างทางเลือก");
    expect(s).toContain("choice close");
    expect(s, "ห้าม รับมั้ยคะ").toContain("ห้ามเด็ดขาด: 'รับมั้ยคะ");
    expect(s).toContain("ดี→ดีขึ้น→ดีที่สุด");
    expect(s).toContain("say no but never say no");
    expect(s).toContain("3C");
  });
});

describe("D-60เกลา · lint close-style (choice close · warn ไม่ block)", () => {
  async function lint(p: string) {
    const lib = (await loadBotLibrary())!;
    return lintPattern(p, { config: await getConfig(), lib, payment: "", now: new Date() });
  }
  it("🔴 'สนใจรับมั้ยคะ' → warn close-style (ไม่ block)", async () => {
    const f = await lint("สินค้าดีมากค่ะ สนใจรับมั้ยคะ");
    expect(f.find((x) => x.kind === "close-style")?.level).toBe("warn");
    expect(f.some((x) => x.level === "block")).toBe(false);
  });
  it("'รับไปเลยนะคะ' / 'รับเลยนะคะ' → close-style", async () => {
    expect((await lint("รับไปเลยนะคะ")).some((x) => x.kind === "close-style")).toBe(true);
    expect((await lint("รับเลยนะคะ")).some((x) => x.kind === "close-style")).toBe(true);
  });
  it("choice close ('วันไหนดีคะ') + 'รับออเดอร์แล้วค่ะ' → ไม่มี close-style (ไม่ false-positive)", async () => {
    expect((await lint("สะดวกให้จัดส่งวันไหนดีคะ")).some((x) => x.kind === "close-style")).toBe(false);
    expect((await lint("รับออเดอร์แล้วค่ะ ได้รับสลิปแล้วนะคะ")).some((x) => x.kind === "close-style")).toBe(false);
  });
});

describe("D-60 · rewriteSafety (โหมดเกลาเสียงรักษา {} + ตัวเลข)", () => {
  it("รักษาครบ → ไม่เตือน", () => {
    const r = rewriteSafety("โปร 3 ถ้วย {ยอดรวม} บาทค่ะ", "3 ถ้วยราคา {ยอดรวม} บาทนะคะ");
    expect(r.droppedVars).toHaveLength(0);
    expect(r.changedNumbers).toBe(false);
  });
  it("🔴 {ตัวแปร} หาย → droppedVars", () => {
    expect(rewriteSafety("ยอด {ยอดรวม} บาท", "ราคาดีค่ะ").droppedVars).toContain("{ยอดรวม}");
  });
  it("🔴 ตัวเลขเปลี่ยน → changedNumbers", () => {
    expect(rewriteSafety("ส่ง 1-2 วันค่ะ", "ส่ง 3-4 วันค่ะ").changedNumbers).toBe(true);
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
