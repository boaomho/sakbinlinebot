import { describe, it, expect, beforeAll } from "vitest";
import { scriptGemini, turn, lineCalls, sheetsCalls, geminiState } from "../harness/state";
import { seedBotLib, v3StepRows, V3_STEP_HEADER, TAB } from "../harness/botlib-fixture";
import { runTrainTurn, runTrainPreview } from "@/lib/train/turn";
import { applyOverlayToTab } from "@/lib/train/sandbox";

/**
 * T-STUDIO เฟส ข — แตะบอลลูนเพื่อแก้: overlay / provenance / dropped bubble / lint สด / preview
 * 🔴 reuse resolver+matcher production ทั้งหมด (ผ่าน sandbox) — ไม่ duplicate logic
 */

/**
 * 🔴 D-68: seed "ชีตดิบ v3" ผ่านเส้นทางเดียวกับ prod
 * overlay ที่ "มีความหมายใน v3" = ทับคอลัมน์ที่เข้า prompt เท่านั้น → `สาระที่ต้องสื่อ`
 * (คอลัมน์ `แนวตอบ` ของแท็บเส้นทางขาย ไม่เข้า prompt · v3 ไม่ส่ง verbatim — ดู DECISIONS D-66 §4)
 */
const ESSENCE_IDX = V3_STEP_HEADER.indexOf("สาระที่ต้องสื่อ");
function steps(): string[][] {
  return v3StepRows([
    { step_id: "S1", entry: 'ทักทาย เช่น "สวัสดี"', essence: "สาระจากชีตเดิม: ทักทายลูกค้า" },
    { step_id: "S3", entry: 'ยืนยัน เช่น "ขอยืนยัน"', essence: "ทวนที่อยู่: {ออเดอร์_ที่อยู่}", guide: "ยืนยันนะคะ[[เว้น]]ที่อยู่เดิม {ออเดอร์_ที่อยู่}" },
  ]);
}

beforeAll(() => {
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
  process.env.TRAIN_PASSWORD = "test-train-pass";
});

describe("เฟส ข · applyOverlayToTab (pure) — ทับบนชีตดิบ v3", () => {
  it("ทับเฉพาะเซลล์ (key+column) ตรง · header-driven · ไม่แตะแถวอื่น", () => {
    const rows = steps();
    const out = applyOverlayToTab(TAB.steps, rows, [{ tab: TAB.steps, key: "S1", column: "สาระที่ต้องสื่อ", value: "สาระใหม่ค่ะ" }]);
    expect(out[1][ESSENCE_IDX]).toBe("สาระใหม่ค่ะ");
    expect(out[2][ESSENCE_IDX], "แถวอื่นไม่แตะ").toBe("ทวนที่อยู่: {ออเดอร์_ที่อยู่}");
    expect(rows[1][ESSENCE_IDX], "ต้นฉบับไม่ถูก mutate").toBe("สาระจากชีตเดิม: ทักทายลูกค้า");
  });
  it("key/column ไม่เจอ → ไม่ทับ (เงียบ)", () => {
    const out = applyOverlayToTab(TAB.steps, steps(), [{ tab: TAB.steps, key: "ไม่มี", column: "สาระที่ต้องสื่อ", value: "x" }]);
    expect(out[1][ESSENCE_IDX]).toBe("สาระจากชีตเดิม: ทักทายลูกค้า");
  });
});

describe("เฟส ข · overlay มีผลจริงตอนเล่นเทิร์น (draft ทับชีต ในห้องซ้อม)", () => {
  it("🔴 draft `สาระที่ต้องสื่อ` → เข้า prompt ที่โมเดลเห็นจริง (batchGet proxy ทับก่อน pipeline อ่าน)", async () => {
    seedBotLib({ stepRows: steps() });
    scriptGemini([turn({ reply: "คำตอบจาก AI ค่ะ", stage: "S1" })]);
    const res = await runTrainTurn("train-ovl-0001", "สวัสดีค่ะ", undefined, [
      { tab: TAB.steps, key: "S1", column: "สาระที่ต้องสื่อ", value: "สาระดราฟใหม่: ชวนดูโปร" },
    ]);
    // v3 เรียบเรียงสด → วัดที่ prompt ที่โมเดลได้รับจริง ไม่ใช่ข้อความลูกค้า (ดู DECISIONS D-68)
    void res;
    const promptStep = geminiState.lastInput?.stepText ?? "";
    expect(promptStep, "เห็น draft ไม่ใช่ค่าชีตเดิม").toContain("สาระดราฟใหม่: ชวนดูโปร");
    expect(promptStep).not.toContain("สาระจากชีตเดิม");
    expect(lineCalls.replies.length, "ไม่ยิง LINE จริง").toBe(0);
  });

  it("ไม่มี overlay → ค่าชีตเดิมเข้า prompt (bypass cache ไม่กระทบผลปกติ)", async () => {
    seedBotLib({ stepRows: steps() });
    scriptGemini([turn({ reply: "คำตอบจาก AI ค่ะ", stage: "S1" })]);
    await runTrainTurn("train-ovl-0002", "สวัสดีค่ะ");
    expect(geminiState.lastInput?.stepText ?? "").toContain("สาระจากชีตเดิม");
  });
});

describe("เฟส ข · provenance — เทิร์นนี้มาจากแถวไหน", () => {
  it("step turn → sources ชี้ Steps + step_id ที่ส่ง", async () => {
    seedBotLib({ stepRows: steps() });
    scriptGemini([turn({ reply: "AI", stage: "S1" })]);
    const res = await runTrainTurn("train-prov-0001", "สวัสดีค่ะ");
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.sources[0]).toMatchObject({ tab: "Steps", key: "S1", keyCol: "step_id" });
    expect(res.sources[0].columns.map((c) => c.name)).toContain("ตัวอย่างคำตอบ");
  });
});

describe("เฟส ข · dropped bubble ไม่หายเงียบ", () => {
  it("🔴 บอลลูนที่เหลือ {ออเดอร์_ที่อยู่} (ไม่มี last_order) → รายงานใน droppedBubbles", async () => {
    seedBotLib({ stepRows: steps() });
    // v3: AI เขียน reply เอง → ตัวแปรค้างมาจากคำตอบของ AI (ไม่ใช่ pattern ในชีตแบบ v2)
    scriptGemini([turn({ reply: "ยืนยันนะคะ[[เว้น]]ที่อยู่เดิม {ออเดอร์_ที่อยู่}", stage: "S3" })]);
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
    const pv = await runTrainPreview("train-pv-0001", "Steps", "S3", {});
    expect(pv.segments.some((s) => s.text.includes("ยืนยัน") && !s.dropped)).toBe(true);
    expect(pv.segments.some((s) => s.dropped && s.vars.includes("{ออเดอร์_ที่อยู่}")), "บอลลูน {ออเดอร์_ที่อยู่} มาร์ค dropped").toBe(true);
  });

  it("🔴 lint: ตัวแปรไม่รู้จัก + ราคานอกระบบ → block · (draft ทับสด)", async () => {
    seedBotLib({ stepRows: steps() });
    const pv = await runTrainPreview("train-pv-0002", "Steps", "S1", { "ตัวอย่างคำตอบ": "ราคา 999 บาท {ตัวแปรมั่ว}ค่ะ" });
    const kinds = pv.lint.map((f) => f.kind);
    expect(kinds, "ตัวแปรไม่รู้จัก").toContain("unknown-var");
    expect(kinds, "ราคานอกระบบ 999").toContain("price");
    expect(pv.lint.filter((f) => f.level === "block").length).toBeGreaterThan(0);
  });

  it("preview ที่สะอาด → ไม่มี lint block", async () => {
    seedBotLib({ stepRows: steps() });
    const pv = await runTrainPreview("train-pv-0003", "Steps", "S1", {});
    expect(pv.lint.filter((f) => f.level === "block").length).toBe(0);
    expect(sheetsCalls.appends.length, "preview ไม่แตะชีตจริง").toBe(0);
  });
});
