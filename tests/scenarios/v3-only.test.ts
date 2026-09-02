import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, lineCalls, sheetsCalls } from "../harness/state";
import { seedBotLib, TAB } from "../harness/botlib-fixture";
import { getConfig, resolveFeatureSwitches, __resetConfigCache } from "@/lib/config";
import { loadBotLibrary, __resetBotLibraryCache } from "@/lib/sheets/loader";

/**
 * D-68 · v3 = ทางเดียว — พิสูจน์ว่าไม่มี ENV `SHEET_SCHEMA` แล้วยังได้พฤติกรรม v3 ครบ
 * 🔴 ไฟล์นี้ห้ามตั้ง SHEET_SCHEMA เด็ดขาด (นั่นคือประเด็นทั้งหมดของเทส)
 * ครอบ: เทิร์นจริง 1 เทิร์น (เรียบเรียงสด ไม่ verbatim) · การ์ด salesCore ชี้ SHEET_BOTLIB_ID ·
 *       loader อ่านไฟล์ v3 · ปุ่มเขียนใน /train ชี้ไฟล์ v3 (ปิด known issue D-65)
 */

const U = "U" + "d68".padEnd(32, "0");

beforeEach(() => {
  delete process.env.SHEET_SCHEMA; // ย้ำ: ต้องไม่มีสวิตช์แล้ว
  seedBotLib();
});

describe("D-68 · ไม่มี ENV SHEET_SCHEMA → ยังเป็น v3 ทุกชั้น", () => {
  it("เทิร์นจริง: reply ของ AI ส่งตรงถึงลูกค้า (เรียบเรียงสด · ไม่ใช่ verbatim จากชีต)", async () => {
    expect(process.env.SHEET_SCHEMA, "ต้องไม่มีสวิตช์").toBeUndefined();
    scriptGemini([turn({ reply: "สวัสดีค่ะ ปลาทูแนะนำน้ำพริกปลาทูค่ะ[[เว้น]]รับเป็นโปรไหนดีคะ", stage: "S2" })]);
    await sendText(U, "สนใจค่ะ");
    const texts = lineCalls.replies.flatMap((r) => r.messages).map((m) => (m.type === "text" ? (m as { text: string }).text : "[IMG]"));
    expect(texts.join("\n"), "ต้องเป็นคำที่ AI เขียน ไม่ใช่ pattern จากชีต").toContain("ปลาทูแนะนำน้ำพริกปลาทู");
    expect(texts.length, "v3 ปิดโหมดประหยัดโควตา → [[เว้น]] แตกบอลลูนจริง").toBeGreaterThan(1);
  });

  it("quotaSaver = false ตายตัว (D-68 · คีย์ `โหมดประหยัดโควตา` ถูกลบจากโค้ด+ชีต)", async () => {
    __resetConfigCache();
    const config = await getConfig();
    expect(config.quotaSaver).toBe(false);
  });

  it("🔴 การ์ด salesCore ชี้ SHEET_BOTLIB_ID — ไม่มีค่า = ปิดแกนขาย (ไม่ใช่ SHEET_BOTLIB_ID เดิม)", async () => {
    const config = await getConfig();
    const saved = process.env.SHEET_BOTLIB_ID;
    const savedOld = process.env.SHEET_BOTLIB_ID;
    try {
      process.env.SHEET_BOTLIB_ID = "sheet-v2-เก่า-ต้องไม่มีผล";
      delete process.env.SHEET_BOTLIB_ID;
      expect(resolveFeatureSwitches(config).salesCore, "มีแต่ ENV เก่า = ต้องปิด").toBe(false);
      process.env.SHEET_BOTLIB_ID = "sheet-v3";
      expect(resolveFeatureSwitches(config).salesCore).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.SHEET_BOTLIB_ID;
      else process.env.SHEET_BOTLIB_ID = saved;
      if (savedOld === undefined) delete process.env.SHEET_BOTLIB_ID;
      else process.env.SHEET_BOTLIB_ID = savedOld;
    }
  });

  it("loader ขอแท็บตาม SHEET_TABS เสมอ (D-72a: Steps/Knowledge) — ไม่มี dispatch v2 แล้ว", async () => {
    __resetBotLibraryCache();
    sheetsCalls.lastBatchGetRanges = [];
    await loadBotLibrary();
    const ranges = sheetsCalls.lastBatchGetRanges.join(" ");
    expect(ranges, "ต้องขอแท็บจริง").toContain(`${TAB.steps}!A:Z`);
    expect(ranges).toContain(`${TAB.knowledge}!A:Z`);
    // 🔴 D-72a: ชื่อแท็บเก่า (ไทย/CSV_) ต้องหมดแล้ว
    expect(ranges, "ชื่อแท็บเก่าต้องไม่ถูกขอแล้ว").not.toContain("เส้นทางขาย");
    expect(ranges).not.toContain("CSV_");
  });
});

describe("D-72b · ปุ่มเขียนใน /train — เปิดแล้ว (ปิด KI D-65/D-68)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("🔴 appendRow Vars เขียนได้จริง · แถวใหม่บังคับ draft · จด TRAIN_LOG", async () => {
    vi.stubEnv("SHEET_BOTLIB_ID", "1BBBsheetV3newYYYYYYYYYYYYYYYYYYYYYYYYYYY");
    const { appendRow } = await import("@/lib/train/write");
    sheetsCalls.appends.length = 0;
    sheetsCalls.batchUpdates.length = 0;
    const res = await appendRow("Vars", { ตัวแปร: "{รูปทดสอบ}", ค่า: "https://blob.test/x.jpg" });
    expect(res.status).toBe("ok");
    const added = sheetsCalls.appends.find((a) => a.range.startsWith("Vars"));
    // Vars header: ตัวแปร | ค่า | หมายเหตุ | สถานะ — สถานะบังคับ draft เสมอ
    expect(added?.values[0]).toEqual(["{รูปทดสอบ}", "https://blob.test/x.jpg", "", "draft"]);
    expect(sheetsCalls.appends.some((a) => a.range.startsWith("TRAIN_LOG"))).toBe(true);
  });
});
