import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sheetsCalls } from "../harness/state";
import { adaptV3Bundle } from "@/lib/sheets/adapter-v3";
import { loadBotLibrary, __resetBotLibraryCache } from "@/lib/sheets/loader";
import { buildStepInjection, buildCatalogInjection } from "@/lib/agent/inject";
import { resolveCatalogVars } from "@/lib/core/pricing";
import { formatConfigForPrompt } from "@/lib/config";
import { testConfig } from "../harness/fixtures";

/**
 * D-61.B · ชีต v3 + adapter — จุดแปลงเดียว: map แท็บ/คอลัมน์ + normalize สถานะ ("ว่าง=draft" isolate ที่ adapter)
 * โค้ดข้างในเห็น BotLibrary shape เดิม + ค่าสถานะ canonical เท่านั้น
 */

const STEP_V3 = [
  ["step_id", "ชื่อประตู", "เข้าเมื่อ", "สาระที่ต้องสื่อ", "ต้องได้อะไรถึงไปต่อ", "ไปประตูไหน", "แนวตอบ (ตัวอย่าง)", "handoff", "สถานะ"],
  ["S1", "ค้นหาความต้องการ", "ทักเปล่าๆ", "ทักทาย+เกริ่นสินค้า", "รู้ความสนใจ", "S2", "สวัสดีค่ะ", "", "live"],
  ["S2", "แนะนำ+โปร", "ถามสินค้า/ราคา", "จุดเด่น+โปร+choice close", "จำนวน", "S3", "โปรค่ะ", "", "live"],
  ["S9", "ประตูใหม่นอกลิสต์", "เคสใหม่", "x", "y", "S3", "", "", "live"],
  ["HX", "เรียกคน", "ขอคุยแอดมิน", "", "", "", "", "ใช่", "live"],
  ["SD", "ร่าง", "ยังไม่เปิด", "", "", "", "", "", ""], // สถานะว่าง = draft (v3!)
];
const KNOW_V3 = [
  ["id", "ลูกค้าพูดยังไง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "ความกังวลจริง", "แนวตอบ (ตัวอย่าง)", "keyword", "สถานะ"],
  ["K001", "ส่งกี่วันถึง", "ส่ง 1-2 วันทำการ", "กลัวรอนาน", "ปกติ 1-2 วันค่ะ", "ส่งกี่วัน", "live"],
  ["K002", "แถวร่าง", "ยังไม่พร้อม", "", "", "ร่าง", ""], // ว่าง = draft
];
const PROD_V3 = [
  ["sku", "ชื่อสินค้า", "หน่วย", "ราคาปกติ_ต่อหน่วย", "สารก่อภูมิแพ้", "สถานะ"],
  ["NPT-10G", "น้ำพริกปลาทู", "ถ้วย", "95", "มีปลา · ไลน์ผลิตให้แอดมินเช็ค", "live"],
  ["NPX-DRAFT", "ตัวใหม่", "ถ้วย", "80", "", ""], // ว่าง = draft → ต้องไม่ live
];

function v3Raw(over: Record<string, string[][]> = {}): Record<string, string[][]> {
  return { เส้นทางขาย: STEP_V3, ความรู้: KNOW_V3, CSV_Products: PROD_V3, CSV_Promo: [], CSV_Vars: [], CSV_Config: [], ...over };
}

describe("D-61.B · adaptV3Bundle (pure)", () => {
  it("🔴 สถานะ normalize: ว่าง→draft · live→live — isolate ที่ adapter (โค้ดข้างในไม่เจอค่าว่างจาก v3)", () => {
    const b = adaptV3Bundle(v3Raw());
    const statusCol = b.CSV_Step[0].indexOf("สถานะ");
    const bySid = Object.fromEntries(b.CSV_Step.slice(1).map((r) => [r[0], r[statusCol]]));
    expect(bySid.S1).toBe("live");
    expect(bySid.SD, "ว่าง = draft (กลับด้านจาก v2)").toBe("draft");
    const pStatus = b.CSV_Products[0].indexOf("สถานะ");
    expect(b.CSV_Products[2][pStatus], "Products ว่าง = draft (กติกาเดียวทั้งไฟล์)").toBe("draft");
  });

  it("🔴 funnel map ตายตัว (เคาะ #2): S1→lead S2→qualified · handoff flag→handoff · นอกลิสต์→qualified", () => {
    const b = adaptV3Bundle(v3Raw());
    const f = Object.fromEntries(b.CSV_Step.slice(1).map((r) => [r[0], r[1]]));
    expect(f.S1).toBe("lead");
    expect(f.S2).toBe("qualified");
    expect(f.HX, "flag handoff").toBe("handoff");
    expect(f.S9, "นอกลิสต์ default qualified").toBe("qualified");
  });

  it("🔴 ความรู้→CSV_FAQ: ก้อนคำตอบลำดับ ความกังวลจริง→ข้อเท็จจริง→แนวตอบ (เคาะ #1) · OBJ/Follow ว่าง", () => {
    const b = adaptV3Bundle(v3Raw());
    const h = b.CSV_FAQ[0];
    const row = b.CSV_FAQ[1];
    expect(row[h.indexOf("คำถาม")]).toBe("ส่งกี่วันถึง");
    expect(row[h.indexOf("keywords")]).toBe("ส่งกี่วัน");
    expect(row[h.indexOf("action")]).toBe("answer");
    const ans = row[h.indexOf("คำตอบ")];
    expect(ans.indexOf("ความกังวลจริง:")).toBeLessThan(ans.indexOf("ข้อเท็จจริง:"));
    expect(ans.indexOf("ข้อเท็จจริง:")).toBeLessThan(ans.indexOf("แนวตอบ"));
    expect(b.CSV_Objections).toEqual([]);
    expect(b.CSV_Follow).toEqual([]);
  });

  it("header หลักขาด → แท็บ degrade เป็นว่าง (ห้าม fallback ยัดดิบ · B1)", () => {
    const b = adaptV3Bundle(v3Raw({ เส้นทางขาย: [["ผิด", "หมด"], ["x", "y"]] }));
    expect(b.CSV_Step).toEqual([]);
  });

  it("adapted CSV_Step ผ่าน buildStepInjection ได้ (STEP_COLS ครบ) + มี 'สาระที่ต้องสื่อ' ใน block", () => {
    const b = adaptV3Bundle(v3Raw());
    const text = buildStepInjection(b.CSV_Step, { quoted: false, payment: "", userMessage: "สวัสดี", signals: [] });
    expect(text).not.toContain("fallback-whole");
    expect(text).toContain("สาระที่ต้องสื่อ: ทักทาย+เกริ่นสินค้า");
    expect(text, "แถว draft (SD) ต้องถูกกรอง").not.toContain("SD");
  });
});

describe("D-61.B · loader dispatch v3 (SHEET_BOTLIB_V3_ID + แท็บ v3 → adapter)", () => {
  beforeEach(() => {
    process.env.SHEET_SCHEMA = "v3";
    process.env.SHEET_BOTLIB_V3_ID = "1v3testspreadsheetid0000000000000000000000";
    __resetBotLibraryCache();
  });
  afterEach(() => {
    delete process.env.SHEET_SCHEMA;
    delete process.env.SHEET_BOTLIB_V3_ID;
    __resetBotLibraryCache();
  });

  it("🔴 โหมด v3: batchGet แท็บ v3 → bundle shape เดิม (consumers ไม่รู้จัก v3)", async () => {
    sheetsCalls.botLibReturn = v3Raw();
    const lib = await loadBotLibrary();
    expect(lib).not.toBeNull();
    expect(lib!.CSV_Step[1][0]).toBe("S1");
    expect(lib!.CSV_FAQ[1][0]).toBe("ส่งกี่วันถึง");
    expect(sheetsCalls.lastBatchGetRanges.some((r) => r.startsWith("เส้นทางขาย")), "ยิง range แท็บ v3").toBe(true);
  });

  it("โหมด v3 แต่ SHEET_BOTLIB_V3_ID ไม่ตั้ง → null (all-or-nothing เดิม)", async () => {
    delete process.env.SHEET_BOTLIB_V3_ID;
    expect(await loadBotLibrary()).toBeNull();
  });
});

describe("D-61.B · catalog allergen (เคาะ #4) + config เข้า prompt (B5)", () => {
  const products = PROD_V3;
  it("ก: includeAllergen=true → คอลัมน์สารก่อภูมิแพ้เข้า prompt · default(v2) → ไม่เข้า", () => {
    const base = { config: { ยอดขั้นต่ำส่งฟรี_บาท: "275", ค่าส่ง_มาตรฐาน: "30", ค่าส่ง_COD_เพิ่ม: "0", เพดานจำนวน_คูณโปรใหญ่สุด: "2" }, payment: "" };
    const v3Text = buildCatalogInjection(products, [], { ...base, includeAllergen: true });
    expect(v3Text).toContain("ไลน์ผลิตให้แอดมินเช็ค");
    const v2Text = buildCatalogInjection(products, [], base);
    expect(v2Text, "v2 เดิม: ไม่มีสารก่อภูมิแพ้ใน prompt").not.toContain("ไลน์ผลิตให้แอดมินเช็ค");
  });
  it("ข: {สารก่อภูมิแพ้} resolve จากสินค้า live (pattern-driven ทั้งสองโหมด)", () => {
    const out = resolveCatalogVars("ข้อมูลแพ้: {สารก่อภูมิแพ้}", products, []);
    expect(out).toBe("ข้อมูลแพ้: มีปลา · ไลน์ผลิตให้แอดมินเช็ค");
  });
  it("formatConfigForPrompt: promptVisibleKeys กรองเฉพาะที่ติ๊ก · null = ดัมพ์หมด (v2 เดิม)", () => {
    const cfg = testConfig();
    cfg.raw.set("ชื่อบอท", "ปลาทู");
    cfg.raw.set("debounce_รวบคำถาม", "6");
    expect(formatConfigForPrompt(cfg)).toContain("debounce_รวบคำถาม"); // null = หมด
    const filtered = { ...cfg, promptVisibleKeys: new Set(["ชื่อบอท"]) };
    const outText = formatConfigForPrompt(filtered);
    expect(outText).toContain("ชื่อบอท: ปลาทู");
    expect(outText).not.toContain("debounce_รวบคำถาม");
  });
  it("parse คอลัมน์ 'เข้า prompt' จากชีต (header-driven ไม่ผูกโหมด)", async () => {
    sheetsCalls.botLibReturn = {
      CSV_Config: [
        ["key", "ค่าที่ตั้ง", "คำอธิบาย", "เข้า prompt"],
        ["ชื่อบอท", "ปลาทู", "", "ใช่"],
        ["debounce_รวบคำถาม", "6", "", ""],
      ],
    };
    const cfgMod = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
    cfgMod.__resetConfigCache();
    const cfg = await cfgMod.getConfig();
    expect(cfg.promptVisibleKeys).not.toBeNull();
    expect(cfg.promptVisibleKeys!.has("ชื่อบอท")).toBe(true);
    expect(cfg.promptVisibleKeys!.has("debounce_รวบคำถาม")).toBe(false);
    const text = cfgMod.formatConfigForPrompt(cfg);
    expect(text).toContain("ชื่อบอท");
    expect(text).not.toContain("debounce_รวบคำถาม");
  });
});
