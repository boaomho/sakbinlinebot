import { describe, it, expect } from "vitest";
import { resolveColumns, cell } from "@/lib/sheets/columns";
import { cleanHeader } from "@/lib/sheets/clean";
import { loadBotLibrary, BOTLIB_TABS } from "@/lib/sheets/loader";
import { V3_SHEET_TABS } from "@/lib/sheets/adapter-v3";
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
  it("ยิง batchGet ครบทุกแท็บ v3 ใน 1 call แล้ว map ผ่าน adapter กลับเป็น shape ภายใน", async () => {
    sheetsCalls.botLibReturn = {
      [TAB.steps]: v3StepRows([{ step_id: "S1", entry: "ทัก" }]),
      [TAB.knowledge]: v3KnowRows([{ say: "ส่งกี่วัน", keyword: "ส่ง,กี่วัน" }]),
    };

    const lib = await loadBotLibrary();
    expect(lib).not.toBeNull();
    expect(sheetsCalls.lastBatchGetRanges, "1 call ขอครบทุกแท็บ v3").toHaveLength(V3_SHEET_TABS.length);
    expect(sheetsCalls.lastBatchGetRanges).toContain(`${TAB.steps}!A:Z`);
    expect(sheetsCalls.lastBatchGetRanges, "🔴 D-68: ไม่ขอแท็บ v2 แล้ว").not.toContain("CSV_Step!A:Z");
    // adapter แปลงเป็น shape ภายใน: S1 → funnel lead (FIXED_FUNNEL · ชีตไม่มีคอลัมน์ funnel_stage)
    expect(lib!["CSV_Step"][1][0]).toBe("S1");
    expect(lib!["CSV_Step"][1][1]).toBe("lead");
    expect(lib!["CSV_FAQ"][1][0]).toBe("ส่งกี่วัน");
    // แท็บที่ไม่ได้ set → แถวว่าง (ไม่ throw)
    expect(lib!["CSV_Promo"]).toEqual([]);
  });

  it("cache: call ที่ 2 ภายใน 60 วิ ไม่ยิง Google ซ้ำ", async () => {
    sheetsCalls.botLibReturn = { [TAB.steps]: v3StepRows([{ step_id: "S1" }]) };
    await loadBotLibrary();
    sheetsCalls.lastBatchGetRanges = []; // ล้างเพื่อดูว่ามีการยิงซ้ำมั้ย
    await loadBotLibrary();
    expect(sheetsCalls.lastBatchGetRanges, "hit cache = ไม่ยิงซ้ำ").toHaveLength(0);
  });

  it("BOTLIB_TABS = คีย์ของ shape ภายใน (8 ช่อง) · V3_SHEET_TABS = แท็บจริงบนชีต (6)", () => {
    expect(BOTLIB_TABS).toHaveLength(8);
    expect(BOTLIB_TABS).toContain("CSV_Config");
    expect(BOTLIB_TABS).toContain("CSV_Objections"); // ยังเป็นคีย์ใน shape (adapter คืน [] เสมอ)
    expect(V3_SHEET_TABS).toHaveLength(6);
    expect(V3_SHEET_TABS).toContain(TAB.steps);
  });
});
