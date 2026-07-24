import { describe, it, expect, beforeAll } from "vitest";
import { scriptGemini, turn, lineCalls, sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { runTrainTurn, runTrainPreview } from "@/lib/train/turn";
import { applyOverlayToTab } from "@/lib/train/sandbox";

/**
 * T-STUDIO เฟส ข — แตะบอลลูนเพื่อแก้: overlay / provenance / dropped bubble / lint สด / preview
 * 🔴 reuse resolver+matcher production ทั้งหมด (ผ่าน sandbox) — ไม่ duplicate logic
 */

const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ความรู้สึกลูกค้าตอนนี้", "ทำไมประตูนี้สำคัญ", "หลักการนำพา", "ห้ามทำ", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "คิดเอง"];
function r(step_id: string, funnel_stage: string, o: Partial<Record<string, string>> = {}): string[] {
  return STEP_H.map((h) => (h === "step_id" ? step_id : h === "funnel_stage" ? funnel_stage : o[h] ?? ""));
}
function steps(): string[][] {
  return [
    STEP_H,
    r("S_HELLO", "lead", { เข้าเมื่อ: "ทักทาย", ตัวอย่างคำตอบ: "สวัสดีจากชีตเดิมค่ะ", คิดเอง: "ปิด" }),
    r("S_DROP", "quoted", { เข้าเมื่อ: "x", ตัวอย่างคำตอบ: "ยืนยันนะคะ", ตัวอย่างประโยคปิดท้าย: "ที่อยู่เดิม {ออเดอร์_ที่อยู่}", คิดเอง: "ปิด" }),
  ];
}

beforeAll(() => {
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
  process.env.TRAIN_PASSWORD = "test-train-pass";
});

describe("เฟส ข · applyOverlayToTab (pure)", () => {
  it("ทับเฉพาะเซลล์ (key+column) ตรง · header-driven · ไม่แตะแถวอื่น", () => {
    const rows = steps();
    const out = applyOverlayToTab("CSV_Step", rows, [{ tab: "CSV_Step", key: "S_HELLO", column: "ตัวอย่างคำตอบ", value: "ทักใหม่ค่ะ" }]);
    expect(out[1][STEP_H.indexOf("ตัวอย่างคำตอบ")]).toBe("ทักใหม่ค่ะ");
    expect(out[2][STEP_H.indexOf("ตัวอย่างคำตอบ")], "แถวอื่นไม่แตะ").toBe("ยืนยันนะคะ");
    expect(rows[1][STEP_H.indexOf("ตัวอย่างคำตอบ")], "ต้นฉบับไม่ถูก mutate").toBe("สวัสดีจากชีตเดิมค่ะ");
  });
  it("key/column ไม่เจอ → ไม่ทับ (เงียบ)", () => {
    const out = applyOverlayToTab("CSV_Step", steps(), [{ tab: "CSV_Step", key: "ไม่มี", column: "ตัวอย่างคำตอบ", value: "x" }]);
    expect(out[1][STEP_H.indexOf("ตัวอย่างคำตอบ")]).toBe("สวัสดีจากชีตเดิมค่ะ");
  });
});

describe("เฟส ข · overlay มีผลจริงตอนเล่นเทิร์น (draft ทับชีต ในห้องซ้อม)", () => {
  it("🔴 draft ตัวอย่างคำตอบ → ลูกค้าจำลองเห็นข้อความใหม่ (batchGet proxy ทับก่อน pipeline อ่าน)", async () => {
    seedBotLib({ stepRows: steps() });
    scriptGemini([turn({ reply: "AI (ไม่ใช้ · verbatim)", stage: "S_HELLO" })]);
    const res = await runTrainTurn("train-ovl-0001", "สวัสดีค่ะ", undefined, [
      { tab: "CSV_Step", key: "S_HELLO", column: "ตัวอย่างคำตอบ", value: "ดราฟใหม่ทักทายค่ะ" },
    ]);
    const texts = res.bubbles.flatMap((b) => b.messages).map((m) => (m as { text?: string }).text).join(" ");
    expect(texts, "เห็น draft ไม่ใช่ค่าชีตเดิม").toContain("ดราฟใหม่ทักทายค่ะ");
    expect(texts).not.toContain("สวัสดีจากชีตเดิมค่ะ");
    expect(lineCalls.replies.length, "ไม่ยิง LINE จริง").toBe(0);
  });

  it("ไม่มี overlay → ค่าชีตเดิม (bypass cache ไม่กระทบผลปกติ)", async () => {
    seedBotLib({ stepRows: steps() });
    scriptGemini([turn({ reply: "AI", stage: "S_HELLO" })]);
    const res = await runTrainTurn("train-ovl-0002", "สวัสดีค่ะ");
    const texts = res.bubbles.flatMap((b) => b.messages).map((m) => (m as { text?: string }).text).join(" ");
    expect(texts).toContain("สวัสดีจากชีตเดิมค่ะ");
  });
});

describe("เฟส ข · provenance — เทิร์นนี้มาจากแถวไหน", () => {
  it("step turn → sources ชี้ CSV_Step + step_id ที่ส่ง", async () => {
    seedBotLib({ stepRows: steps() });
    scriptGemini([turn({ reply: "AI", stage: "S_HELLO" })]);
    const res = await runTrainTurn("train-prov-0001", "สวัสดีค่ะ");
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.sources[0]).toMatchObject({ tab: "CSV_Step", key: "S_HELLO", keyCol: "step_id" });
    expect(res.sources[0].columns.map((c) => c.name)).toContain("ตัวอย่างคำตอบ");
  });
});

describe("เฟส ข · dropped bubble ไม่หายเงียบ", () => {
  it("🔴 บอลลูนที่เหลือ {ออเดอร์_ที่อยู่} (ไม่มี last_order) → รายงานใน droppedBubbles", async () => {
    seedBotLib({ stepRows: steps() });
    scriptGemini([turn({ reply: "AI", stage: "S_DROP" })]);
    const res = await runTrainTurn("train-drop-0001", "ขอยืนยัน");
    expect(res.droppedBubbles.length, "ต้องมีบอลลูนถูกทิ้ง").toBeGreaterThan(0);
    expect(res.droppedBubbles.some((d) => d.vars.includes("{ออเดอร์_ที่อยู่}"))).toBe(true);
    // บอลลูน "ยืนยันนะคะ" (ไม่มีตัวแปร) ยังส่งถึงลูกค้า
    const texts = res.bubbles.flatMap((b) => b.messages).map((m) => (m as { text?: string }).text).join(" ");
    expect(texts).toContain("ยืนยันนะคะ");
    expect(texts, "บอลลูนที่แปรค้างไม่หลุดดิบถึงลูกค้า").not.toContain("{ออเดอร์_ที่อยู่}");
  });
});

describe("เฟส ข · preview + lint สด (reuse guard production)", () => {
  it("preview render บอลลูน + mark ตัวที่จะถูกทิ้ง", async () => {
    seedBotLib({ stepRows: steps() });
    const pv = await runTrainPreview("train-pv-0001", "CSV_Step", "S_DROP", {});
    expect(pv.segments.some((s) => s.text.includes("ยืนยัน") && !s.dropped)).toBe(true);
    expect(pv.segments.some((s) => s.dropped && s.vars.includes("{ออเดอร์_ที่อยู่}")), "บอลลูน {ออเดอร์_ที่อยู่} มาร์ค dropped").toBe(true);
  });

  it("🔴 lint: ตัวแปรไม่รู้จัก + ราคานอกระบบ → block · (draft ทับสด)", async () => {
    seedBotLib({ stepRows: steps() });
    const pv = await runTrainPreview("train-pv-0002", "CSV_Step", "S_HELLO", { "ตัวอย่างคำตอบ": "ราคา 999 บาท {ตัวแปรมั่ว}ค่ะ" });
    const kinds = pv.lint.map((f) => f.kind);
    expect(kinds, "ตัวแปรไม่รู้จัก").toContain("unknown-var");
    expect(kinds, "ราคานอกระบบ 999").toContain("price");
    expect(pv.lint.filter((f) => f.level === "block").length).toBeGreaterThan(0);
  });

  it("preview ที่สะอาด → ไม่มี lint block", async () => {
    seedBotLib({ stepRows: steps() });
    const pv = await runTrainPreview("train-pv-0003", "CSV_Step", "S_HELLO", {});
    expect(pv.lint.filter((f) => f.level === "block").length).toBe(0);
    expect(sheetsCalls.appends.length, "preview ไม่แตะชีตจริง").toBe(0);
  });
});
