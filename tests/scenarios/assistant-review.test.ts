import { describe, it, expect, vi } from "vitest";

// 🔴 mock @google/genai เฉพาะไฟล์นี้ — จับ args ของ generateContent (ห้ามยิงจริง)
const genaiCalls: { model?: string }[] = [];
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class FakeGenAI {
    models = {
      generateContent: async (args: { model: string }) => {
        genaiCalls.push({ model: args.model });
        return { text: JSON.stringify({ reply: "ค่ะ", phase: "interview", proposals: [] }), usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
      },
    };
  }
  return { ...actual, GoogleGenAI: FakeGenAI };
});
import { reviewProposal } from "@/lib/train/assistant-review";
import { buildAssistantSystem, buildTaskBlock, runTrainAssistant, type AssistantProposal } from "@/lib/train/assistant";
import { testConfig } from "../harness/fixtures";
import type { RawSheets } from "@/lib/sheets/loader";

/**
 * D-75 · ด่านตรวจ deterministic ของใบ proposal + สคริปต์สัมภาษณ์ + โมเดล/ต้นทุนผู้ช่วย
 * 🔴 ทุกเทสไม่พึ่ง Gemini จริง — ด่านตรวจเป็น pure function บนแถวดิบ (D-72b)
 */

function raw(over: Partial<Record<string, string[][]>> = {}): RawSheets {
  return {
    Steps: [
      ["step_id", "ชื่อประตู", "เข้าเมื่อ", "สาระที่ต้องสื่อ", "ต้องได้อะไรถึงไปต่อ", "ไปประตูไหน", "แนวตอบ", "handoff", "สถานะ"],
      ["S1", "ทักทาย", "ลูกค้าทักมา", "ทักทาย", "", "S2", "", "", "live"],
    ],
    Knowledge: [
      ["id", "ลูกค้าพูดยังไง", "keyword", "ความกังวลจริง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "แนวตอบ", "สถานะ"],
      ["K005", "ส่งกี่วันถึง", "ส่งกี่วัน", "กลัวรอนาน", "1-2 วันค่ะ", "", "live"],
      ["K013", "เก็บเงินปลายทางได้ไหม", "ปลายทาง,COD", "", "ได้ค่ะ", "", "live"],
      ["K014", "แพ้กุ้งทานได้ไหม", "แพ้กุ้ง", "กลัวแพ้", "มีกะปิจากกุ้ง", "", "live"],
    ],
    Products: [["sku", "สถานะ"]],
    Promo: [["promo_id", "สถานะ"]],
    Vars: [["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"]],
    Config: [["key", "value"]],
    ...over,
  } as RawSheets;
}

function prop(over: Partial<AssistantProposal>): AssistantProposal {
  return { action: "add-row", tab: "Knowledge", key: "คำถามใหม่", cols: {}, note: "", ...over };
}

describe("D-75 · reviewProposal — ด่าน 1: ชื่อคอลัมน์ต้องตรงชีตเป๊ะ", () => {
  it('🔴 "keywords" (พหูพจน์ typo) → เตือนว่าจะถูกทิ้งเงียบ + บอกคอลัมน์จริง', () => {
    const w = reviewProposal(raw(), prop({ cols: { keywords: "ส่งด่วน", "ลูกค้าพูดยังไง": "ส่งด่วนได้ไหม" } }), testConfig());
    expect(w.join(" ")).toContain("keywords");
    expect(w.join(" ")).toContain("จะถูกทิ้งเงียบ");
    expect(w.join(" "), "บอกคอลัมน์จริงให้เทียบ").toContain("ลูกค้าพูดยังไง");
  });
  it("คอลัมน์ตรงหมด → ไม่มีเตือนด่านนี้", () => {
    const w = reviewProposal(raw(), prop({ cols: { "ลูกค้าพูดยังไง": "ส่งด่วนได้ไหม", keyword: "ส่งด่วน" } }), testConfig());
    expect(w.join(" ")).not.toContain("จะถูกทิ้งเงียบ");
  });
});

describe("D-75 · reviewProposal — ด่าน 2+3: keyword ชน/substring", () => {
  it("keyword ชนตรงกับแถวอื่น → บอก id แถวนั้น + เสนอแก้แถวเดิม", () => {
    const w = reviewProposal(raw(), prop({ cols: { keyword: "ส่งกี่วัน" } }), testConfig());
    expect(w.join(" ")).toContain("K005");
    expect(w.join(" ")).toContain("แก้แถวเดิม");
  });
  it('🔴 keyword สั้น ≤2 ตัวอักษร ("อย") → เตือน substring อันตราย', () => {
    const w = reviewProposal(raw(), prop({ cols: { keyword: "อย" } }), testConfig());
    expect(w.join(" ")).toContain("สั้นเกิน");
  });
  it('🔴 บทเรียนที่จ่ายแพงสุด: keyword ฝังในคำของแถวอื่น — "ท้อง" ฝังใน "ท้องเสีย" · "ทาง" ฝังใน "ปลายทาง"', () => {
    // หมายเหตุ: ตัวอย่างในโจทย์ ("ท้อง" ใน "ปลายทาง") ไม่จริงระดับสตริง (ไม้โทไม่ตรง) —
    // กลไกจับเฉพาะ substring จริง เทสด้วยเคสจริงทั้งสองทิศ
    const rawWithSick = raw({
      Knowledge: [
        ["id", "ลูกค้าพูดยังไง", "keyword", "ความกังวลจริง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "แนวตอบ", "สถานะ"],
        ["K013", "เก็บเงินปลายทางได้ไหม", "ปลายทาง,COD", "", "ได้ค่ะ", "", "live"],
        ["K016", "กินแล้วท้องเสียทำยังไง", "ท้องเสีย", "", "ส่งต่อแอดมิน", "", "live"],
      ],
    });
    const w1 = reviewProposal(rawWithSick, prop({ cols: { keyword: "ท้อง" } }), testConfig());
    const hit1 = w1.find((x) => x.includes('"ท้อง"') && x.includes("ท้องเสีย"));
    expect(hit1, "ท้อง ฝังใน ท้องเสีย — ต้องยกคำที่ฝัง+แถว").toBeTruthy();
    expect(hit1).toContain("K016");
    const w2 = reviewProposal(rawWithSick, prop({ cols: { keyword: "ทาง" } }), testConfig());
    const hit2 = w2.find((x) => x.includes('"ทาง"') && x.includes("K013"));
    expect(hit2, "ทาง ฝังในข้อความของ K013").toBeTruthy();
  });
  it("keyword วลีปกติไม่ชนใคร → เงียบ", () => {
    const w = reviewProposal(raw(), prop({ cols: { keyword: "ส่งต่างจังหวัดกี่วัน", "ลูกค้าพูดยังไง": "ต่างจังหวัดกี่วันถึง" } }), testConfig());
    expect(w).toHaveLength(0);
  });
});

describe("D-75 · reviewProposal — ด่าน 4: H1 (ตัวจับเดียวกับ lint ตอนบันทึก)", () => {
  it("🔴 add-row แถวสุขภาพ + คำรับรอง → เตือนก่อนถึง lint (บอกว่าจะไม่ผ่าน)", () => {
    const w = reviewProposal(raw(), prop({ key: "แพ้ปลาทานได้ไหม", cols: { "ลูกค้าพูดยังไง": "แพ้ปลาทานได้ไหม", แนวตอบ: "ทานได้ค่ะ ไม่เป็นไร" } }), testConfig());
    expect(w.join(" ")).toContain("คำรับรอง");
    expect(w.join(" "), "บอกชะตากรรมตอนบันทึกล่วงหน้า").toContain("lint จะไม่ให้ผ่าน");
  });
  it("🔴 เคาะ (3): edit-row แถวสุขภาพเดิม แล้วเผลอใส่คำรับรองในช่องเดียว → ด่าน H1 ต้องเห็น (merge ทั้งแถว)", () => {
    // ใบแก้เฉพาะ `ข้อเท็จจริง` — trigger สุขภาพอยู่ในคอลัมน์ `ลูกค้าพูดยังไง` ของแถวเดิม (K014 "แพ้กุ้งทานได้ไหม")
    const w = reviewProposal(raw(), prop({ action: "edit-row", key: "แพ้กุ้งทานได้ไหม", cols: { "ข้อเท็จจริง/สิ่งที่อยากให้รู้": "ทานได้แน่นอนค่ะ ปลอดภัย" } }), testConfig());
    expect(w.join(" "), "ต้อง merge ค่าแถวเดิม → เห็น trigger สุขภาพ").toContain("คำรับรอง");
  });
  it("edit-row แถวสุขภาพ ด้วยข้อเท็จจริงตามฉลาก → warn H1 ธรรมดา (เขียนได้) ไม่ใช่คำรับรอง", () => {
    const w = reviewProposal(raw(), prop({ action: "edit-row", key: "แพ้กุ้งทานได้ไหม", cols: { "ข้อเท็จจริง/สิ่งที่อยากให้รู้": "มีกะปิจากกุ้ง และมีปลาเป็นส่วนประกอบหลัก" } }), testConfig());
    expect(w.join(" ")).toContain("ข้อเท็จจริงตามฉลาก");
    expect(w.join(" ")).not.toContain("lint จะไม่ให้ผ่าน");
  });
});

describe("D-75 · reviewProposal — ด่าน 5: เรื่องซ้ำ → เสนอแก้แถวเดิม", () => {
  it("add-row ที่ key มีอยู่แล้ว → ชี้แถวเดิม (id) + แนะแก้แทน", () => {
    const w = reviewProposal(raw(), prop({ key: "ส่งกี่วันถึง", cols: { "ลูกค้าพูดยังไง": "ส่งกี่วันถึง" } }), testConfig());
    const hit = w.find((x) => x.includes("มีอยู่แล้ว"));
    expect(hit).toBeTruthy();
    expect(hit).toContain("K005");
    expect(hit).toContain("แก้แถวเดิมแทน");
  });
});

describe("D-75 · สคริปต์สัมภาษณ์ — ผูก schema จริงของแท็บ (ชื่อคอลัมน์ตรงชีตเป๊ะ)", () => {
  it("task เพิ่ม Knowledge → คำถาม 4 ข้อ + ชื่อคอลัมน์จริงครบ + ห้ามคิด id เอง", () => {
    const sys = buildAssistantSystem("(kb)", [], { kind: "add", tab: "Knowledge" });
    for (const col of ["ลูกค้าพูดยังไง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "ความกังวลจริง", "แนวตอบ", "keyword"]) {
      expect(sys, `สคริปต์ต้องอ้างคอลัมน์ ${col}`).toContain(`\`${col}\``);
    }
    expect(sys).toContain("ไม่ต้องคิดคอลัมน์ `id`");
    expect(sys, "เช็คเรื่องซ้ำกับ KB ก่อนออกใบ").toContain("เสนอ edit-row แถวเดิม");
  });
  it("task เพิ่ม Steps → ถามป้ายส่งคน 3 ค่า (D-73b) + ชื่อคอลัมน์จริง", () => {
    const sys = buildAssistantSystem("(kb)", [], { kind: "add", tab: "Steps" });
    for (const col of ["เข้าเมื่อ", "สาระที่ต้องสื่อ", "ต้องได้อะไรถึงไปต่อ", "ไปประตูไหน", "handoff"]) {
      expect(sys).toContain(`\`${col}\``);
    }
    expect(sys).toContain("เก็บข้อมูลก่อน");
  });
  it("task แก้แถวเดิม → มีค่าปัจจุบันของแถว (rowContext) + สั่งเสนอเฉพาะช่องที่เปลี่ยน", () => {
    const block = buildTaskBlock({ kind: "edit", tab: "Knowledge", key: "ส่งกี่วันถึง", rowContext: "id: K005\nลูกค้าพูดยังไง: ส่งกี่วันถึง" });
    expect(block).toContain("K005");
    expect(block).toContain("เฉพาะช่องที่เปลี่ยนจริง");
  });
  it("🔴 กติกาสุขภาพในตัว prompt = เกณฑ์ D-72b (ห้ามคำรับรอง) — ไม่ใช่ funnel_stage=handoff_notify ที่ผลิตไม่ได้แล้ว (D-73b)", () => {
    const sys = buildAssistantSystem("(kb)");
    expect(sys).toContain("ข้อเท็จจริงตามฉลาก");
    expect(sys).not.toContain("funnel_stage=handoff_notify");
  });
});

describe("D-75 · runTrainAssistant — โมเดลจาก Config + ลง ai_usage call_kind assistant", () => {
  it("ใช้ config.geminiModel + log ai-usage callKind=assistant", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(String(a[0])); });
    try {
      const cfg = testConfig({ geminiModel: "gemini-test-model" });
      const out = await runTrainAssistant([{ role: "user", text: "สวัสดี" }], "(kb)", cfg, { task: { kind: "add", tab: "Vars" } });
      expect(out.phase).toBe("interview");
      expect(genaiCalls[0]?.model, "🔴 โมเดล = ตัวเดียวกับบอท (จากชีต) ไม่ใช่ MODEL ตายตัว").toBe("gemini-test-model");
      const usage = logs.find((l) => l.includes('"ai-usage"') && l.includes('"assistant"'));
      expect(usage, "ทุก call ลง ai_usage แยก call_kind assistant").toBeTruthy();
    } finally {
      logSpy.mockRestore();
    }
  });
});
