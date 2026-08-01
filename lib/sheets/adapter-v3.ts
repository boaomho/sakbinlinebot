import { cleanHeader, cleanCell } from "./clean";
import type { BotLibrary } from "./loader";

/**
 * lib/sheets/adapter-v3.ts — D-61.B · adapter ชีต v3 → BotLibrary shape เดิม (จุดแปลงเดียวทั้งระบบ)
 * consumers (inject/pricing/config/quote/train) ไม่รู้จัก v3 เลย — เห็น bundle shape เดิม + ค่าสถานะ canonical
 *
 * 🔴 กติกาสถานะ v3 (B1): "ว่าง = draft" (กลับด้านจาก v2 · ปิด KI-08 ถาวร) — isolate ที่นี่บรรทัดเดียว:
 *    normalize ทุกแถว → "live" หรือ "draft" เท่านั้น · โค้ดข้างใน (isActiveStatus ว่าง=live / STATUS_LIVE==="live")
 *    ไม่มีวันเจอค่าว่างจาก v3 → ความหมายเดียวทั้งระบบ · แถว draft ไม่ถูกกรองทิ้ง (studio ต้องเห็น)
 * 🔴 ห้าม fallback ยัดดิบ (B1): header หลักขาด → แท็บนั้นคืนว่าง (ฟีเจอร์ degrade) + log structured ฟ้อง
 */

/** ชื่อแท็บจริงในไฟล์ v3 (ตามลำดับ batchGet) — ใหม่ 2 แท็บชื่อไทยตาม spec B2/B3 · ที่เหลือคงชื่อ CSV_* */
export const V3_SHEET_TABS = ["เส้นทางขาย", "ความรู้", "CSV_Products", "CSV_Promo", "CSV_Vars", "CSV_Config"] as const;
export type V3Tab = (typeof V3_SHEET_TABS)[number];

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
  console.error(JSON.stringify({ scope: "sheets-v3", event: "header-missing", tab, missing, action: "degrade-tab" }));
}

/** เส้นทางขาย → CSV_Step (header v2-compatible + optional "สาระที่ต้องสื่อ" · เคาะ #3) */
function adaptSteps(rows: string[][]): string[][] {
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
  const iStatus = idx("สถานะ");
  if (iId === -1 || iEntry === -1) {
    logMissing("เส้นทางขาย", [iId === -1 ? "step_id" : "", iEntry === -1 ? "เข้าเมื่อ" : ""].filter(Boolean));
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
    let funnel = isHandoff ? "handoff" : FIXED_FUNNEL[stepId];
    if (!funnel) {
      console.warn(JSON.stringify({ scope: "sheets-v3", event: "unknown-step-funnel", stepId, fallback: DEFAULT_FUNNEL }));
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

/** ความรู้ (FAQ+OBJ รวม) → CSV_FAQ · คำตอบ = ก้อนประกอบ ลำดับเคาะ #1: ความกังวลจริง → ข้อเท็จจริง → แนวตอบ */
function adaptKnowledge(rows: string[][]): string[][] {
  if (rows.length === 0) return [];
  const { idx } = headerIndex(rows);
  const iSay = idx("ลูกค้าพูดยังไง");
  const iFact = idx("ข้อเท็จจริง/สิ่งที่อยากให้รู้") >= 0 ? idx("ข้อเท็จจริง/สิ่งที่อยากให้รู้") : idx("ข้อเท็จจริง");
  const iConcern = idx("ความกังวลจริง");
  const iGuide = idx("แนวตอบ");
  const iKw = idx("keyword");
  const iStatus = idx("สถานะ");
  if (iSay === -1) {
    logMissing("ความรู้", ["ลูกค้าพูดยังไง"]);
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

/** แท็บ pass-through (Products/Promo/Vars) — โครงคอลัมน์เดิม แค่ normalize คอลัมน์ "สถานะ" เป็น canonical */
function adaptPassthrough(tab: string, rows: string[][]): string[][] {
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

/** ประกอบ bundle v3 → BotLibrary shape เดิม (CSV_Objections=[] แท็บรวมแล้ว · CSV_Follow=[] ไม่ยกมา B7) */
export function adaptV3Bundle(rawByTab: Record<string, string[][]>): BotLibrary {
  const get = (tab: V3Tab) => rawByTab[tab] ?? [];
  return {
    CSV_Step: adaptSteps(get("เส้นทางขาย")),
    CSV_FAQ: adaptKnowledge(get("ความรู้")),
    CSV_Objections: [], // B2: ยุบรวมเข้า "ความรู้" · v3 ไม่ใช้ OBJ verbatim อยู่แล้ว (เรียบเรียงสด)
    CSV_Follow: [], // B7: dormant ไม่ยกมา
    CSV_Config: get("CSV_Config"), // key-value · ไม่มีคอลัมน์สถานะ (B5)
    CSV_Products: adaptPassthrough("CSV_Products", get("CSV_Products")),
    CSV_Promo: adaptPassthrough("CSV_Promo", get("CSV_Promo")),
    CSV_Vars: adaptPassthrough("CSV_Vars", get("CSV_Vars")),
  };
}
