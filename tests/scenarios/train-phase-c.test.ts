import { describe, it, expect, beforeAll } from "vitest";
import { sheetsCalls } from "../harness/state";
import { seedBotLib, v3StepRows, TAB } from "../harness/botlib-fixture";
import { diffCell, writeCell } from "@/lib/train/write";
import { loadBotLibrary } from "@/lib/sheets/loader";

/**
 * T-STUDIO เฟส ค — เขียนกลับชีต: target ด้วย key+header · conflict กัน · TRAIN_LOG จด · Orders บล็อก · lint gate
 * 🔴 write.ts รันนอก sandbox → getSheets() = mock (real client path) · ไม่แตะ Orders
 */

/** 🔴 D-68: seed "ชีตดิบ v3" ผ่านเส้นทางเดียวกับ prod (loader → adapter) · guide = แนวตอบ → "ตัวอย่างคำตอบ" ใน shape ภายใน */
function steps(): string[][] {
  return v3StepRows([
    { step_id: "S1", guide: "สวัสดีค่ะ" },
    { step_id: "S2", guide: "รับออเดอร์แล้วค่ะ" },
  ]);
}

beforeAll(() => {
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
  process.env.TRAIN_PASSWORD = "test-train-pass";
});

describe("🔴 D-68 · เขียนชีต v3 ยังไม่รองรับ — throw ก่อนแตะ Google (กันเขียนผิดช่อง)", () => {
  it("writeCell → throw ข้อความบอกสาเหตุ+ทางออก · ไม่มี batchUpdate/append ไปถึงชีตเลย", async () => {
    seedBotLib({ stepRows: steps() });
    sheetsCalls.batchUpdates.length = 0;
    sheetsCalls.appends.length = 0;
    await expect(writeCell("CSV_Step", "S2", "ตัวอย่างคำตอบ", "ใหม่", "รับออเดอร์แล้วค่ะ")).rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
    expect(sheetsCalls.batchUpdates, "ห้ามแตะชีต").toHaveLength(0);
    expect(sheetsCalls.appends, "ห้ามแม้แต่ TRAIN_LOG").toHaveLength(0);
  });

  it("appendRow / setRowStatus → throw เหมือนกัน · ไม่แตะชีต", async () => {
    const { appendRow, setRowStatus } = await import("@/lib/train/write");
    seedBotLib({ stepRows: steps() });
    sheetsCalls.batchUpdates.length = 0;
    sheetsCalls.appends.length = 0;
    await expect(appendRow("CSV_Vars", { ตัวแปร: "{ใหม่}", ค่า: "x" })).rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
    await expect(setRowStatus("CSV_Step", "S1", "live")).rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
    expect([...sheetsCalls.batchUpdates, ...sheetsCalls.appends]).toHaveLength(0);
  });
});

describe("เฟส ค · กันชนกัน (conflict)", () => {
  it("🔴 expectedOld ไม่ตรงค่าจริงในชีต → conflict + คืนค่าจริง · ไม่เขียน", async () => {
    seedBotLib({ stepRows: steps() });
    const before = sheetsCalls.batchUpdates.length;
    const res = await writeCell("CSV_Step", "S2", "ตัวอย่างคำตอบ", "ใหม่", "ค่าที่คนอื่นแก้ไปแล้ว");
    expect(res.status).toBe("conflict");
    if (res.status === "conflict") expect(res.current).toBe("รับออเดอร์แล้วค่ะ");
    expect(sheetsCalls.batchUpdates.length, "ไม่เขียนทับ").toBe(before);
  });
});

describe("เฟส ค · hard guard — ห้ามแตะ Orders / แท็บนอก BotLibrary", () => {
  it("🔴 tab นอก editable (Orders) → throw ไม่เขียน", async () => {
    seedBotLib({ stepRows: steps() });
    await expect(writeCell("Orders", "x", "ยอดเงิน", "9", "")).rejects.toThrow(/เขียนไม่ได้|Orders/);
    await expect(diffCell("Orders", "x", "ยอดเงิน")).rejects.toThrow();
  });
  it("คอลัมน์นอก whitelist ของแท็บ → throw", async () => {
    seedBotLib({ stepRows: steps() });
    await expect(writeCell("CSV_Step", "S1", "step_id", "hack", "S1")).rejects.toThrow(/แก้ไม่ได้/);
  });
});

describe("เฟส ค · lint gate ฝั่ง server (ไม่เชื่อ client)", () => {
  it("🔴 ค่าใหม่มีราคานอกระบบ/ตัวแปรผิด → status lint · ไม่เขียน", async () => {
    seedBotLib({ stepRows: steps() });
    const before = sheetsCalls.batchUpdates.length;
    const res = await writeCell("CSV_Step", "S1", "ตัวอย่างคำตอบ", "พิเศษ 999 บาท {ตัวแปรมั่ว}", "สวัสดีค่ะ");
    expect(res.status).toBe("lint");
    if (res.status === "lint") expect(res.lint.some((f) => f.level === "block")).toBe(true);
    expect(sheetsCalls.batchUpdates.length, "lint block = ไม่เขียน").toBe(before);
  });
});

describe("เฟส ค · diffCell อ่านค่าปัจจุบันสด", () => {
  it("คืนค่าเก่าจริงในชีต + exists", async () => {
    seedBotLib({ stepRows: steps() });
    const d = await diffCell("CSV_Step", "S2", "ตัวอย่างประโยคปิดท้าย");
    expect(d.exists).toBe(true);
    expect(d.old).toBe(""); // S2 ไม่มีปิดท้าย
    const d2 = await diffCell("CSV_Step", "S1", "ตัวอย่างคำตอบ");
    expect(d2.old).toBe("สวัสดีค่ะ");
  });

  it("🔴 เฟส ง bug fix: diffCell อ่านสดเสมอ (bypass cache) — เปิด editor หลังชีตเปลี่ยนเห็นค่าล่าสุด", async () => {
    seedBotLib({ stepRows: steps() });
    await loadBotLibrary(); // ทำให้มี cache ค่าเดิม "สวัสดีค่ะ"
    // จำลอง: เจ้าของแก้ชีต (หรือเพิ่งเขียนผ่าน T-STUDIO) → ชีตเป็นค่าใหม่
    sheetsCalls.botLibReturn[TAB.steps] = v3StepRows([
      { step_id: "S1", guide: "สวัสดีค่ะ (แก้ในชีตแล้ว)" },
      { step_id: "S2", guide: "รับออเดอร์แล้วค่ะ" },
    ]);
    const d = await diffCell("CSV_Step", "S1", "ตัวอย่างคำตอบ");
    expect(d.old, "reset cache ก่อนอ่าน → ค่าล่าสุด ไม่ใช่ cache เก่า (client ใช้ตอนเปิด editor)").toBe("สวัสดีค่ะ (แก้ในชีตแล้ว)");
  });
});
