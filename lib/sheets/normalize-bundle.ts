import { cleanHeader, cleanCell } from "./clean";
import type { BotLibrary } from "./loader";

/**
 * lib/sheets/normalize-bundle.ts — D-72a (เดิม adapter-v3.ts)
 *
 * 🔴 **ไม่ใช่ shim แปลชื่อแท็บ — ชื่อแท็บในชีต = ชื่อคีย์ใน BotLibrary แล้ว (D-72a)**
 *    ไฟล์นี้เหลือหน้าที่ "แปลงความหมาย" 4 อย่างที่เป็นของจริง ลบทิ้งเฉย ๆ ไม่ได้:
 *      1. normalize สถานะ "ว่าง = draft" (B1 · กลับด้านจาก v2 = ปิด KI-08 ถาวร)
 *         🔴 consumer ใช้ `isActiveStatus` ซึ่ง **ว่าง = active** → ถ้าไม่ normalize ที่นี่
 *            แถวที่เจ้าของยังไม่กรอกสถานะจะเด้งขึ้นหน้าร้านทันที
 *      2. คำนวณ `funnel_stage` (FIXED_FUNNEL + flag handoff + คอลัมน์ optional D-68)
 *      3. ประกอบ `คำตอบ` ของ Knowledge จาก 3 คอลัมน์ (ความกังวลจริง/ข้อเท็จจริง/แนวตอบ) → เข้า prompt
 *      4. lowercase สถานะให้ Products/Promo (pricing เทียบ `!== "live"` แบบ case-sensitive)
 *
 * 🔴 D-72b จะ **แยกเส้นทาง** ไม่ใช่ลบไฟล์นี้: บอทอ่านของที่ normalize แล้ว · Studio/ปุ่มเขียนต้องเห็น
 *    "แถวดิบตามชีตเป๊ะ" — โดยเฉพาะข้อ 3 ที่ยุบ 3 คอลัมน์เป็นก้อนเดียว **เขียนกลับไม่ได้โดยหลักการ**
 *    (นี่คือเหตุผลที่แท้จริงที่ปุ่มเขียนใน /train พัง ไม่ใช่เรื่องชื่อแท็บ)
 *
 * 🔴 ห้าม fallback ยัดดิบ (B1): header หลักขาด → แท็บนั้นคืนว่าง (ฟีเจอร์ degrade) + log structured ฟ้อง
 */

/** ชื่อแท็บจริงในชีต (ตามลำดับ batchGet) — 🔴 D-72a: ตรงกับคีย์ใน `BotLibrary` เป๊ะ ไม่มีชั้นแปลชื่อแล้ว */
export const SHEET_TABS = ["Steps", "Knowledge", "Products", "Promo", "Vars", "Config"] as const;
export type SheetTab = (typeof SHEET_TABS)[number];

/** เคาะ #2: funnel map ตายตัวใน adapter (ชีต v3 ไม่มีคอลัมน์ funnel — ความหมายอยู่ที่นี่) · ประตูใหม่นอกลิสต์ → qualified + log */
const FIXED_FUNNEL: Record<string, string> = {
  S1: "lead",
  S2: "qualified",
  S2Q: "qualified",
  S3: "quoted",
  S4: "won",
};
const DEFAULT_FUNNEL = "qualified";

/** ค่า flag handoff ที่ยอมรับ (คอลัมน์ handoff ใน เส้นทางขาย) */
const HANDOFF_FLAG = new Set(["ใช่", "true", "on", "1", "yes", "✓", "เปิด", "handoff"]);

/** normalize สถานะ v3 → canonical: "live" เท่านั้นที่ live · อื่นทั้งหมดรวม "ว่าง" = draft (B1) */
function normalizeStatus(raw: string | undefined): "live" | "draft" {
  return cleanCell(raw).toLowerCase() === "live" ? "live" : "draft";
}

function headerIndex(rows: string[][]): { header: string[]; idx: (name: string) => number } {
  const header = (rows[0] ?? []).map(cleanHeader);
  return { header, idx: (name: string) => header.indexOf(cleanHeader(name)) };
}

function logMissing(tab: string, missing: string[]): void {
  console.error(JSON.stringify({ scope: "sheets", event: "header-missing", tab, missing, action: "degrade-tab" }));
}

/** Steps: แถวดิบ → header ที่ inject.ts อ่าน (+ funnel_stage ที่คำนวณ) */
function normalizeSteps(rows: string[][]): string[][] {
  if (rows.length === 0) return [];
  const { idx } = headerIndex(rows);
  const iId = idx("step_id");
  const iName = idx("ชื่อประตู");
  const iEntry = idx("เข้าเมื่อ");
  const iEssence = idx("สาระที่ต้องสื่อ");
  const iCollect = idx("ต้องได้อะไรถึงไปต่อ");
  const iNext = idx("ไปประตูไหน");
  const iExample = idx("แนวตอบ");
  const iHandoff = idx("handoff");
  const iFunnel = idx("funnel_stage"); // D-68: optional · ไม่มี = -1 → ใช้ FIXED_FUNNEL เดิม
  const iStatus = idx("สถานะ");
  if (iId === -1 || iEntry === -1) {
    logMissing("Steps", [iId === -1 ? "step_id" : "", iEntry === -1 ? "เข้าเมื่อ" : ""].filter(Boolean));
    return [];
  }
  const out: string[][] = [
    ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ต้องเก็บข้อมูล", "สาระที่ต้องสื่อ", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "สถานะ"],
  ];
  const g = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const stepId = cleanCell(g(r, iId));
    if (!stepId) continue; // แถวว่าง/หมายเหตุ
    const isHandoff = HANDOFF_FLAG.has(cleanCell(g(r, iHandoff)).toLowerCase());
    // 🔴 D-68: คอลัมน์ `funnel_stage` เป็น optional — "มีก็ใช้ ไม่มีก็ FIXED_FUNNEL เดิม"
    //    เหตุ: FIXED_FUNNEL รู้จักแค่ S1/S2/S2Q/S3/S4 → funnel อีก 4 ค่าที่โค้ดยังอ่านอยู่
    //    (handoff_after_intake · awaiting_payment · awaiting_address · post_sale) ผลิตไม่ได้เลย = ฟีเจอร์ตายเงียบ
    //    ชีตจริง "ยังไม่มี" คอลัมน์นี้ → idx = -1 → พฤติกรรม prod วันนี้เหมือนเดิมเป๊ะ (ดู DECISIONS D-68)
    const explicitFunnel = cleanCell(g(r, iFunnel)).toLowerCase();
    let funnel = isHandoff ? "handoff" : explicitFunnel || FIXED_FUNNEL[stepId];
    if (!funnel) {
      console.warn(JSON.stringify({ scope: "sheets", event: "unknown-step-funnel", stepId, fallback: DEFAULT_FUNNEL }));
      funnel = DEFAULT_FUNNEL; // เคาะ #2: ประตูใหม่นอกลิสต์ → default qualified + ฟ้อง
    }
    out.push([
      stepId,
      funnel,
      g(r, iName),
      g(r, iEntry),
      g(r, iNext),
      g(r, iCollect),
      g(r, iEssence),
      g(r, iExample), // แนวตอบ → ตัวอย่างคำตอบ (v3 ไม่ใช้เป็น verbatim — เก็บให้ studio/ผู้ช่วยดู)
      "", // ตัวอย่างประโยคปิดท้าย — v3 ไม่มีคอนเซปต์ปิดท้ายแยก
      normalizeStatus(g(r, iStatus)),
    ]);
  }
  return out;
}

/** Knowledge: ประกอบ `คำตอบ` จาก 3 คอลัมน์ (ลำดับเคาะ #1: ความกังวลจริง → ข้อเท็จจริง → แนวตอบ) */
function normalizeKnowledge(rows: string[][]): string[][] {
  if (rows.length === 0) return [];
  const { idx } = headerIndex(rows);
  const iSay = idx("ลูกค้าพูดยังไง");
  const iFact = idx("ข้อเท็จจริง/สิ่งที่อยากให้รู้") >= 0 ? idx("ข้อเท็จจริง/สิ่งที่อยากให้รู้") : idx("ข้อเท็จจริง");
  const iConcern = idx("ความกังวลจริง");
  const iGuide = idx("แนวตอบ");
  const iKw = idx("keyword");
  const iStatus = idx("สถานะ");
  if (iSay === -1) {
    logMissing("Knowledge", ["ลูกค้าพูดยังไง"]);
    return [];
  }
  const out: string[][] = [["คำถาม", "keywords", "action", "คำตอบ", "สถานะ"]];
  const g = (r: string[], i: number) => (i >= 0 ? cleanCell(r[i] ?? "") : "");
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const say = g(r, iSay);
    if (!say) continue;
    const answer = [
      g(r, iConcern) && `ความกังวลจริง: ${g(r, iConcern)}`,
      g(r, iFact) && `ข้อเท็จจริง: ${g(r, iFact)}`,
      g(r, iGuide) && `แนวตอบ (ปรับตามบริบท): ${g(r, iGuide)}`,
    ]
      .filter(Boolean)
      .join("\n");
    out.push([say, g(r, iKw), "answer", answer, normalizeStatus(r[iStatus])]);
  }
  return out;
}

/** Products/Promo/Vars — โครงคอลัมน์เดิม แค่ normalize คอลัมน์ "สถานะ" เป็น canonical (lowercase + ว่าง=draft) */
function normalizeStatusTab(tab: string, rows: string[][]): string[][] {
  if (rows.length === 0) return [];
  const { idx } = headerIndex(rows);
  const iStatus = idx("สถานะ");
  if (iStatus === -1) {
    logMissing(tab, ["สถานะ"]);
    return []; // B1: ไม่มีคอลัมน์สถานะ = degrade ทั้งแท็บ (กันแถวหลุด live โดยไม่ตั้งใจ)
  }
  return rows.map((r, i) => {
    if (i === 0) return [...r];
    if (r.every((c) => cleanCell(c) === "")) return [...r]; // แถวว่าง/หมายเหตุ — คงไว้ (consumer กรอง key ว่างเองเหมือนเดิม)
    const copy = [...r];
    while (copy.length <= iStatus) copy.push("");
    copy[iStatus] = normalizeStatus(copy[iStatus]);
    return copy;
  });
}

// ---- D-61.C: ตรวจสุขภาพชีต v3 (การ์ดใน /train/dashboard · ไม่ silent ตาม B1) ----

export interface TabStat {
  tab: string;
  ok: boolean;
  /** header หลักที่ขาด (ทำให้แท็บ degrade) */
  missing: string[];
  /** จำนวนแถวข้อมูล (ไม่นับ header/แถวว่าง) */
  rows: number;
  live: number;
  draft: number;
}

/** header หลักต่อแท็บ — ขาด = แท็บ degrade (ฟีเจอร์ที่พึ่งตัวนั้นปิด · ห้าม fallback ยัดดิบ) */
const REQUIRED_HEADERS: Record<string, string[]> = {
  Steps: ["step_id", "เข้าเมื่อ", "สถานะ"],
  Knowledge: ["ลูกค้าพูดยังไง", "สถานะ"],
  Products: ["sku", "ชื่อสินค้า", "ราคาปกติ_ต่อหน่วย", "สถานะ"],
  Promo: ["promo_id", "sku", "จำนวน", "ราคาโปร", "สถานะ"],
  Vars: ["ตัวแปร", "ค่า", "สถานะ"],
  Config: ["key"],
};

/** สถิติ+ปัญหาต่อแท็บ (pure) — dashboard ใช้โชว์ ✅/⚠️ ก่อน cutover */
export function validateBundle(rawByTab: Record<string, string[][]>): TabStat[] {
  return SHEET_TABS.map((tab) => {
    const rows = rawByTab[tab] ?? [];
    if (rows.length === 0) return { tab, ok: false, missing: ["(แท็บว่าง/ไม่พบ)"], rows: 0, live: 0, draft: 0 };
    const { idx } = headerIndex(rows);
    const missing = (REQUIRED_HEADERS[tab] ?? []).filter((h) => idx(h) === -1);
    const statusIdx = idx("สถานะ");
    const keyIdx = idx(tab === "Steps" ? "step_id" : tab === "Knowledge" ? "ลูกค้าพูดยังไง" : tab === "Config" ? "key" : tab === "Vars" ? "ตัวแปร" : tab === "Promo" ? "promo_id" : "sku");
    let live = 0;
    let draft = 0;
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const key = keyIdx >= 0 ? cleanCell(rows[i][keyIdx] ?? "") : "";
      if (!key) continue;
      count += 1;
      if (statusIdx >= 0) (normalizeStatus(rows[i][statusIdx]) === "live" ? live++ : draft++);
    }
    return { tab, ok: missing.length === 0 && count > 0, missing, rows: count, live, draft };
  });
}

/**
 * แถวดิบจากชีต → BotLibrary (normalize ความหมาย · **ไม่แปลงชื่อแท็บแล้ว** — ชื่อตรงกันทั้งสองฝั่ง)
 * `Follow: []` — dormant ตั้งแต่ B7 (ชีตไม่มีแท็บนี้) · คงคีย์ไว้ให้ cron/follow อ่านแล้ว skip ได้เหมือนเดิม
 */
export function normalizeBundle(rawByTab: Record<string, string[][]>): BotLibrary {
  const get = (tab: SheetTab) => rawByTab[tab] ?? [];
  return {
    Steps: normalizeSteps(get("Steps")),
    Knowledge: normalizeKnowledge(get("Knowledge")),
    Follow: [], // B7: dormant — ไม่มีแท็บนี้ในชีต
    Config: get("Config"), // key-value · ไม่มีคอลัมน์สถานะ (B5)
    Products: normalizeStatusTab("Products", get("Products")),
    Promo: normalizeStatusTab("Promo", get("Promo")),
    Vars: normalizeStatusTab("Vars", get("Vars")),
  };
}
