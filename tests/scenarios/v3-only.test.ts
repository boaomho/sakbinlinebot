import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, lineCalls, sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { getConfig, resolveFeatureSwitches, __resetConfigCache } from "@/lib/config";
import { loadBotLibrary, __resetBotLibraryCache } from "@/lib/sheets/loader";

/**
 * D-68 · v3 = ทางเดียว — พิสูจน์ว่าไม่มี ENV `SHEET_SCHEMA` แล้วยังได้พฤติกรรม v3 ครบ
 * 🔴 ไฟล์นี้ห้ามตั้ง SHEET_SCHEMA เด็ดขาด (นั่นคือประเด็นทั้งหมดของเทส)
 * ครอบ: เทิร์นจริง 1 เทิร์น (เรียบเรียงสด ไม่ verbatim) · การ์ด salesCore ชี้ SHEET_BOTLIB_V3_ID ·
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

  it("🔴 การ์ด salesCore ชี้ SHEET_BOTLIB_V3_ID — ไม่มีค่า = ปิดแกนขาย (ไม่ใช่ SHEET_BOTLIB_ID เดิม)", async () => {
    const config = await getConfig();
    const saved = process.env.SHEET_BOTLIB_V3_ID;
    const savedOld = process.env.SHEET_BOTLIB_ID;
    try {
      process.env.SHEET_BOTLIB_ID = "sheet-v2-เก่า-ต้องไม่มีผล";
      delete process.env.SHEET_BOTLIB_V3_ID;
      expect(resolveFeatureSwitches(config).salesCore, "มีแต่ ENV เก่า = ต้องปิด").toBe(false);
      process.env.SHEET_BOTLIB_V3_ID = "sheet-v3";
      expect(resolveFeatureSwitches(config).salesCore).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.SHEET_BOTLIB_V3_ID;
      else process.env.SHEET_BOTLIB_V3_ID = saved;
      if (savedOld === undefined) delete process.env.SHEET_BOTLIB_ID;
      else process.env.SHEET_BOTLIB_ID = savedOld;
    }
  });

  it("loader ขอแท็บ v3 เสมอ (เส้นทางขาย/ความรู้) — ไม่มี dispatch v2 แล้ว", async () => {
    __resetBotLibraryCache();
    sheetsCalls.lastBatchGetRanges = [];
    await loadBotLibrary();
    const ranges = sheetsCalls.lastBatchGetRanges.join(" ");
    expect(ranges, "ต้องขอแท็บ v3").toContain("เส้นทางขาย");
    expect(ranges).toContain("ความรู้");
    expect(ranges, "แท็บ v2 ต้องไม่ถูกขอแล้ว").not.toContain("CSV_Step");
  });
});

describe("D-68 · ปุ่มเขียนใน /train — ปิดตายไว้ (KI D-65 ฉบับแก้)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("🔴 เขียนไม่ได้ + ไม่แตะชีตเลย · error บอกทั้งสาเหตุและทางออก", async () => {
    vi.stubEnv("SHEET_BOTLIB_V3_ID", "1BBBsheetV3newYYYYYYYYYYYYYYYYYYYYYYYYYYY");
    const { appendRow } = await import("@/lib/train/write");
    sheetsCalls.appends.length = 0;
    sheetsCalls.batchUpdates.length = 0;
    await expect(appendRow("CSV_Vars", { ตัวแปร: "{รูปทดสอบ}", ค่า: "https://blob.test/x.jpg" }))
      .rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้[\s\S]*D-69/);
    expect([...sheetsCalls.appends, ...sheetsCalls.batchUpdates], "ห้ามแตะชีตแม้แต่ TRAIN_LOG").toHaveLength(0);
  });
});
