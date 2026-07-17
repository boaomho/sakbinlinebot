import { describe, it, expect } from "vitest";
import { resolveColumns, cell } from "@/lib/sheets/columns";
import { cleanHeader } from "@/lib/sheets/clean";
import { loadBotLibrary, BOTLIB_TABS } from "@/lib/sheets/loader";
import { sheetsCalls } from "../harness/state";

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
    const cols = resolveColumns(STEP_HEADERS, ["step_id", "หลักการนำพา", "ห้ามทำ"], "CSV_Step");
    expect(cols).not.toBeNull();
    expect(cols!["step_id"]).toBe(0);
    expect(cols!["หลักการนำพา"]).toBe(3);
    expect(cols!["ห้ามทำ"]).toBe(4);
  });

  it("🔴 สลับตำแหน่ง (funnel_stage ไปหลังสุด) → ยังหาถูกโดยชื่อ", () => {
    const swapped = ["step_id", "ชื่อประตู", "หลักการนำพา", "ห้ามทำ", "ไปประตูถัดไปเมื่อ", "funnel_stage"];
    const cols = resolveColumns(swapped, ["step_id", "funnel_stage", "หลักการนำพา"], "CSV_Step");
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
    const cols = resolveColumns(STEP_HEADERS, ["step_id", "คอลัมน์ที่ไม่มีในชีต"], "CSV_Step");
    expect(cols).toBeNull();
  });

  it("อักขระล่องหน + วงเล็บกำกับใน header → cleanHeader จับได้", () => {
    // header มี zero-width (U+200B) นำหน้า + วงเล็บกำกับ
    const dirty = ["​step_id", "funnel_stage (enum)", "หลักการนำพา"];
    const cols = resolveColumns(dirty, ["step_id", "funnel_stage", "หลักการนำพา"], "CSV_Step");
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
  it("ยิง batchGet ครบ 8 แท็บใน 1 call แล้ว map กลับตามชื่อแท็บ", async () => {
    sheetsCalls.botLibReturn = {
      CSV_Step: [["step_id", "funnel_stage"], ["S1", "lead"]],
      CSV_FAQ: [["คำถาม", "keywords"], ["ส่งกี่วัน", "ส่ง,กี่วัน"]],
    };

    const lib = await loadBotLibrary();
    expect(lib).not.toBeNull();
    expect(sheetsCalls.lastBatchGetRanges, "1 call ขอครบ 8 แท็บ").toHaveLength(8);
    expect(sheetsCalls.lastBatchGetRanges).toContain("CSV_Step!A:Z");
    expect(lib!["CSV_Step"][1]).toEqual(["S1", "lead"]);
    expect(lib!["CSV_FAQ"][0]).toEqual(["คำถาม", "keywords"]);
    // แท็บที่ไม่ได้ set → แถวว่าง (ไม่ throw)
    expect(lib!["CSV_Promo"]).toEqual([]);
  });

  it("cache: call ที่ 2 ภายใน 60 วิ ไม่ยิง Google ซ้ำ", async () => {
    sheetsCalls.botLibReturn = { CSV_Step: [["step_id"]] };
    await loadBotLibrary();
    sheetsCalls.lastBatchGetRanges = []; // ล้างเพื่อดูว่ามีการยิงซ้ำมั้ย
    await loadBotLibrary();
    expect(sheetsCalls.lastBatchGetRanges, "hit cache = ไม่ยิงซ้ำ").toHaveLength(0);
  });

  it("BOTLIB_TABS = 8 แท็บตาม CONTRACTS", () => {
    expect(BOTLIB_TABS).toHaveLength(8);
    expect(BOTLIB_TABS).toContain("CSV_Config");
    expect(BOTLIB_TABS).toContain("CSV_Objections");
  });
});
