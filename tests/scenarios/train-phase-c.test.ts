import { describe, it, expect, beforeAll } from "vitest";
import { sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { diffCell, writeCell } from "@/lib/train/write";
import { columnLetter } from "@/lib/sheets/columns";

/**
 * T-STUDIO เฟส ค — เขียนกลับชีต: target ด้วย key+header · conflict กัน · TRAIN_LOG จด · Orders บล็อก · lint gate
 * 🔴 write.ts รันนอก sandbox → getSheets() = mock (real client path) · ไม่แตะ Orders
 */

const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ความรู้สึกลูกค้าตอนนี้", "ทำไมประตูนี้สำคัญ", "หลักการนำพา", "ห้ามทำ", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "คิดเอง"];
function r(step_id: string, o: Partial<Record<string, string>> = {}): string[] {
  return STEP_H.map((h) => (h === "step_id" ? step_id : o[h] ?? ""));
}
function steps(): string[][] {
  return [STEP_H, r("S1", { ตัวอย่างคำตอบ: "สวัสดีค่ะ", คิดเอง: "ปิด" }), r("S2", { ตัวอย่างคำตอบ: "รับออเดอร์แล้วค่ะ", คิดเอง: "ปิด" })];
}

beforeAll(() => {
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
  process.env.TRAIN_PASSWORD = "test-train-pass";
});

describe("เฟส ค · เขียนถูกเซลล์ผ่าน key + header (A1 สด ไม่จำ index)", () => {
  it("🔴 writeCell S2/ตัวอย่างคำตอบ → batchUpdate range = คอลัมน์+แถวที่หาสดจาก header", async () => {
    seedBotLib({ stepRows: steps() });
    const res = await writeCell("CSV_Step", "S2", "ตัวอย่างคำตอบ", "รับออเดอร์แล้วนะคะ 😊", "รับออเดอร์แล้วค่ะ");
    expect(res.status).toBe("ok");
    // ตัวอย่างคำตอบ = index 10 → คอลัมน์ K · S2 = แถวอาเรย์ 2 → sheet row 3
    const expectedRange = `CSV_Step!${columnLetter(10)}3`;
    const upd = sheetsCalls.batchUpdates.find((b) => b.range === expectedRange);
    expect(upd, "เขียนตรงเซลล์ K3").toBeTruthy();
    expect(upd!.values[0][0]).toBe("รับออเดอร์แล้วนะคะ 😊");
  });

  it("TRAIN_LOG ถูก append (เวลา/แท็บ/key/คอลัมน์/เก่า/ใหม่)", async () => {
    seedBotLib({ stepRows: steps() });
    await writeCell("CSV_Step", "S1", "ตัวอย่างคำตอบ", "สวัสดีจ้า", "สวัสดีค่ะ");
    const log = sheetsCalls.appends.find((a) => a.range.startsWith("TRAIN_LOG"));
    expect(log, "จด TRAIN_LOG").toBeTruthy();
    const row = log!.values[log!.values.length - 1];
    expect(row.slice(1, 6)).toEqual(["CSV_Step", "S1", "ตัวอย่างคำตอบ", "สวัสดีค่ะ", "สวัสดีจ้า"]);
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
});
