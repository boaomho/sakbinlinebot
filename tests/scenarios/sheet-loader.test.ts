import { describe, it, expect } from "vitest";
import { resolveColumns, cell } from "@/lib/sheets/columns";
import { cleanHeader } from "@/lib/sheets/clean";
import { loadBotLibrary, BOTLIB_TABS } from "@/lib/sheets/loader";
import { SHEET_TABS } from "@/lib/sheets/normalize-bundle";
import { sheetsCalls } from "../harness/state";
import { TAB, v3StepRows, v3KnowRows } from "../harness/botlib-fixture";

/**
 * Part 1 — Sheet loader ตัวเดียว + header-driven (CONTRACTS C1)
 * 🔴 "หาคอลัมน์จากชื่อ header ไม่ใช่ตำแหน่ง" — สลับ/แทรก/เพิ่มคอลัมน์ต้องไม่พัง
 */

describe("resolveColumns — header-driven ทนสลับ/แทรก/เพิ่มคอลัมน์", () => {
  const STEP_HEADERS = [
    "step_id",
    "funnel_stage",
    "ชื่อประตู",
    "หลักการนำพา",
    "ห้ามทำ",
    "ไปประตูถัดไปเมื่อ",
  ];

  it("header ปกติ → map ครบ", () => {
    const cols = resolveColumns(STEP_HEADERS, ["step_id", "หลักการนำพา", "ห้ามทำ"], "Steps");
    expect(cols).not.toBeNull();
    expect(cols!["step_id"]).toBe(0);
    expect(cols!["หลักการนำพา"]).toBe(3);
    expect(cols!["ห้ามทำ"]).toBe(4);
  });

  it("🔴 สลับตำแหน่ง (funnel_stage ไปหลังสุด) → ยังหาถูกโดยชื่อ", () => {
    const swapped = ["step_id", "ชื่อประตู", "หลักการนำพา", "ห้ามทำ", "ไปประตูถัดไปเมื่อ", "funnel_stage"];
    const cols = resolveColumns(swapped, ["step_id", "funnel_stage", "หลักการนำพา"], "Steps");
    expect(cols!["funnel_stage"], "ย้ายไปช่องสุดท้าย = index 5").toBe(5);
    expect(cols!["หลักการนำพา"]).toBe(2);
  });

  it("🔴 แทรกคอลัมน์กลาง → index ขยับ แต่หาโดยชื่อยังถูก", () => {
    const inserted = ["step_id", "คอลัมน์ใหม่แทรก", "funnel_stage", "หลักการนำพา"];
    const cols = resolveColumns(inserted, ["step_id", "funnel_stage", "หลักการนำพา"]);
    expect(cols!["funnel_stage"]).toBe(2);
    expect(cols!["หลักการนำพา"]).toBe(3);
  });

  it("🔴 เพิ่มคอลัมน์ท้าย → ไม่กระทบ", () => {
    const appended = [...STEP_HEADERS, "คอลัมน์ใหม่ท้าย", "อีกอัน"];
    const cols = resolveColumns(appended, ["step_id", "ไปประตูถัดไปเมื่อ"]);
    expect(cols!["ไปประตูถัดไปเมื่อ"]).toBe(5);
  });

  it("🔴 ขาด header ที่ต้องใช้ → คืน null (all-or-nothing) ห้าม fallback เงียบ", () => {
    const cols = resolveColumns(STEP_HEADERS, ["step_id", "คอลัมน์ที่ไม่มีในชีต"], "Steps");
    expect(cols).toBeNull();
  });

  it("อักขระล่องหน + วงเล็บกำกับใน header → cleanHeader จับได้", () => {
    // header มี zero-width (U+200B) นำหน้า + วงเล็บกำกับ
    const dirty = ["​step_id", "funnel_stage (enum)", "หลักการนำพา"];
    const cols = resolveColumns(dirty, ["step_id", "funnel_stage", "หลักการนำพา"], "Steps");
    expect(cols, "ต้องหาเจอแม้ header สกปรก").not.toBeNull();
    expect(cleanHeader("funnel_stage (enum)")).toBe("funnel_stage");
  });

  it("cell() อ่านค่าตาม ColumnMap · เกินความยาวแถว → ''", () => {
    const cols = resolveColumns(["a", "b", "c"], ["a", "c"])!;
    expect(cell(["1", "2", "3"], cols, "c")).toBe("3");
    expect(cell(["1"], cols, "c"), "แถวสั้นกว่า → ว่าง").toBe("");
  });
});

describe("loadBotLibrary — batchGet 1 call ทุกแท็บ + cache 60 วิ", () => {
  it("ยิง batchGet ครบทุกแท็บ v3 ใน 1 call แล้ว map ผ่าน adapter กลับเป็น shape ภายใน", async () => {
    sheetsCalls.botLibReturn = {
      [TAB.steps]: v3StepRows([{ step_id: "S1", entry: "ทัก" }]),
      [TAB.knowledge]: v3KnowRows([{ say: "ส่งกี่วัน", keyword: "ส่ง,กี่วัน" }]),
    };

    const lib = await loadBotLibrary();
    expect(lib).not.toBeNull();
    expect(sheetsCalls.lastBatchGetRanges, "1 call ขอครบทุกแท็บ v3").toHaveLength(SHEET_TABS.length);
    expect(sheetsCalls.lastBatchGetRanges).toContain(`${TAB.steps}!A:Z`);
    // 🔴 D-72a: ชื่อแท็บเป็นอังกฤษแล้ว — ชื่อเก่า (ไทย/CSV_) ต้องไม่ถูกขออีกแล้ว
    for (const old of ["เส้นทางขาย!A:Z", "ความรู้!A:Z", "CSV_Products!A:Z", "CSV_Config!A:Z"]) {
      expect(sheetsCalls.lastBatchGetRanges, "ชื่อแท็บเก่าต้องหมดแล้ว").not.toContain(old);
    }
    // adapter แปลงเป็น shape ภายใน: S1 → funnel lead (FIXED_FUNNEL · ชีตไม่มีคอลัมน์ funnel_stage)
    expect(lib!["Steps"][1][0]).toBe("S1");
    expect(lib!["Steps"][1][1]).toBe("lead");
    expect(lib!["Knowledge"][1][0]).toBe("ส่งกี่วัน");
    // แท็บที่ไม่ได้ set → แถวว่าง (ไม่ throw)
    expect(lib!["Promo"]).toEqual([]);
  });

  it("cache: call ที่ 2 ภายใน 60 วิ ไม่ยิง Google ซ้ำ", async () => {
    sheetsCalls.botLibReturn = { [TAB.steps]: v3StepRows([{ step_id: "S1" }]) };
    await loadBotLibrary();
    sheetsCalls.lastBatchGetRanges = []; // ล้างเพื่อดูว่ามีการยิงซ้ำมั้ย
    await loadBotLibrary();
    expect(sheetsCalls.lastBatchGetRanges, "hit cache = ไม่ยิงซ้ำ").toHaveLength(0);
  });

  it("🔴 D-72a: BOTLIB_TABS (7 คีย์ shape) ⊇ SHEET_TABS (6 แท็บจริง) · ต่างกันแค่ Follow", () => {
    expect(BOTLIB_TABS).toHaveLength(7);
    expect(BOTLIB_TABS).toContain("Config");
    expect(BOTLIB_TABS).not.toContain("CSV_Objections"); // D-72a ลบแท็บ Objections ทิ้ง (v3 ยุบเข้า Knowledge ตั้งแต่ D-61.B)
    expect(SHEET_TABS).toHaveLength(6);
    expect(SHEET_TABS).toContain(TAB.steps);
    // 🔴 หัวใจ D-72a: ชื่อแท็บบนชีต = คีย์ใน shape เป๊ะ (ไม่มีชั้นแปลชื่อ)
    for (const t of SHEET_TABS) expect(BOTLIB_TABS as readonly string[]).toContain(t);
    expect([...BOTLIB_TABS].filter((t) => !(SHEET_TABS as readonly string[]).includes(t))).toEqual(["Follow"]);
  });
});
