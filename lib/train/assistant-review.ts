import { cleanHeader, cleanCell } from "@/lib/sheets/clean";
import { lintHealthH1 } from "./lint";
import { patternFromColumns, triggerTextForTab, h1FlagsForRow } from "./preview";
import { tabKeyColumn } from "./sandbox";
import type { AssistantProposal } from "./assistant";
import type { RawSheets } from "@/lib/sheets/loader";
import type { AppConfig } from "@/lib/config";

/**
 * lib/train/assistant-review.ts — D-75: ด่านตรวจ deterministic ของใบ proposal ก่อนถึงมือเจ้าของ
 * 🔴 รันกับใบ **ทุกชนิด** (add-row และ edit-row) — เคสอันตรายจริงคือแก้แถวสุขภาพเดิมแล้วเผลอใส่คำรับรอง
 * ผลลัพธ์ = warnings[] แนบการ์ด (ไม่ block — ประตู block จริงคือ lint gate ตอนบันทึกในฟอร์ม เส้นเดิม D-72b)
 * 🔴 ตัวจับ H1 = lintHealthH1 ตัวเดียวกับ lint ตอนบันทึก (import — ห้ามลอกกติกา) → เตือนตั้งแต่ตอนคุย
 *    ด้วยเกณฑ์เดียวกับที่จะเจอตอนบันทึกเป๊ะ ไม่มีทางพูดคนละเสียง
 */

/** แตกลิสต์ keyword ("ก,ข , ค") → คำสะอาด */
function splitKeywords(raw: string): string[] {
  return raw.split(",").map((k) => cleanCell(k)).filter(Boolean);
}

/** คอลัมน์/แถวดิบของแท็บ + ดัชนีคอลัมน์ (header-driven · null = แท็บไม่มีในชีต) */
function tabView(raw: RawSheets, tab: string): { header: string[]; rows: string[][]; idx: (name: string) => number } | null {
  const rows = (raw as Record<string, string[][]>)[tab];
  if (!rows || rows.length < 1) return null;
  const header = rows[0].map(cleanHeader);
  return { header, rows, idx: (name: string) => header.indexOf(cleanHeader(name)) };
}

/** ป้ายแถวสำหรับข้อความเตือน — "K005 · ส่งกี่วัน" (มี id) หรือ key เฉย ๆ */
function rowLabel(view: NonNullable<ReturnType<typeof tabView>>, rowIdx: number, keyIdx: number): string {
  const idIdx = view.idx("id");
  const id = idIdx >= 0 ? cleanCell(view.rows[rowIdx][idIdx] ?? "") : "";
  const key = keyIdx >= 0 ? cleanCell(view.rows[rowIdx][keyIdx] ?? "") : "";
  return id ? `${id} · ${key}` : key;
}

/** คำไทย/อังกฤษในข้อความ (ตัดตามช่องว่าง/เครื่องหมาย — พอสำหรับหา "คำที่ keyword ไปฝังใน") */
function wordsOf(text: string): string[] {
  return text.split(/[\s,.!?()"'«»“”‘’/·|]+/).map((w) => w.trim()).filter((w) => w.length > 0);
}

/**
 * 🔴 D-75: ตรวจใบ proposal กับข้อมูลจริง (แถวดิบ D-72b) — คืนคำเตือนภาษาคน (ไม่ block)
 * ด่าน: (1) ชื่อคอลัมน์ไม่ตรงชีต=จะถูกทิ้งเงียบ (2) keyword ชนแถวอื่น (3) keyword substring อันตราย
 *       — สองชั้น: สั้น ≤2 ตัวอักษร + "ฝังในคำของแถวอื่น" (บทเรียน "ท้อง" ฝังใน "ปลายทาง")
 *       (4) H1 ผ่าน lintHealthH1 ตัวจริง (5) add-row ที่ key/เรื่องซ้ำ → เสนอแก้แถวเดิมแทน
 */
export function reviewProposal(raw: RawSheets, p: AssistantProposal, config: AppConfig): string[] {
  const warnings: string[] = [];
  const view = tabView(raw, p.tab);
  if (!view) return warnings; // แท็บไม่มีในชีต — parser กรอง tab แปลกไปแล้ว (กันตกเฉย ๆ)
  const keyCol = tabKeyColumn(p.tab);
  const keyIdx = keyCol ? view.idx(keyCol) : -1;

  // ── ด่าน 1: ชื่อคอลัมน์ต้องตรง header ดิบเป๊ะ — appendRow/writeCell ทิ้งชื่อแปลกแบบเงียบ (กับดัก D-72b)
  const unknownCols = Object.keys(p.cols).filter((name) => view.idx(name) === -1);
  if (unknownCols.length > 0) {
    warnings.push(`คอลัมน์ไม่ตรงชีต (จะถูกทิ้งเงียบตอนบันทึก): ${unknownCols.join(" · ")} — คอลัมน์จริงของ ${p.tab}: ${view.header.filter(Boolean).join(" | ")}`);
  }

  // ── ด่าน 2+3: keyword (Knowledge เท่านั้น)
  const proposedKw = p.tab === "Knowledge" ? splitKeywords(p.cols["keyword"] ?? "") : [];
  if (proposedKw.length > 0) {
    const kwIdx = view.idx("keyword");
    const selfKey = cleanCell(p.key);
    for (const kw of proposedKw) {
      // ด่าน 3 ชั้นแรก: คำสั้นมาก = substring อันตรายแทบแน่นอน (บทเรียน "อย" ฝังใน "อย่า/อยาก")
      if (kw.length <= 2) {
        warnings.push(`keyword "${kw}" สั้นเกิน (≤2 ตัวอักษร) — จะจับเป็น substring ในคำอื่นแทบทุกคำ ให้เปลี่ยนเป็นวลี เช่น "เลข ${kw}." หรือคำเต็มที่ลูกค้าพิมพ์จริง`);
      }
      for (let i = 1; i < view.rows.length; i++) {
        const rKey = keyIdx >= 0 ? cleanCell(view.rows[i][keyIdx] ?? "") : "";
        if (!rKey || rKey === selfKey) continue; // แถวว่าง/แถวตัวเอง (edit-row)
        // ด่าน 2: ชนตรง ๆ กับ keyword ของแถวอื่น → สองแถวแย่งกันจับ
        const rKws = kwIdx >= 0 ? splitKeywords(view.rows[i][kwIdx] ?? "") : [];
        if (rKws.includes(kw)) {
          warnings.push(`keyword "${kw}" ชนกับแถว ${rowLabel(view, i, keyIdx)} — ถ้าเป็นเรื่องเดียวกัน ให้แก้แถวเดิมแทนการเพิ่มใหม่`);
          continue;
        }
        // ด่าน 3 ชั้นสอง (เจ้าของสั่งเสริม): keyword ฝังเป็น substring ในคำของ "ลูกค้าพูดยังไง" แถวอื่น
        // (บทเรียนที่จ่ายแพงสุด: "ท้อง" 4 ตัวอักษร ฝังใน "ปลายทาง" — เกณฑ์ความยาวอย่างเดียวจับไม่ได้)
        const host = wordsOf(rKey).find((w) => w.length > kw.length && w.includes(kw));
        if (host) {
          warnings.push(`keyword "${kw}" ฝังอยู่ในคำ "${host}" ของแถว ${rowLabel(view, i, keyIdx)} — จะจับผิดแถวเมื่อลูกค้าพิมพ์คำนั้น ให้เปลี่ยนเป็นวลีที่ยาวขึ้น`);
        }
      }
    }
  }

  // ── ด่าน 4: H1 — เกณฑ์เดียวกับ lint ตอนบันทึก (แถวสุขภาพ + คำรับรอง = จะโดน block · เตือนตั้งแต่ตอนนี้)
  //    🔴 รันทั้ง add-row และ edit-row — edit แถวสุขภาพเดิมแล้วเผลอใส่ "ทานได้" คือเคสอันตรายจริง
  const h1Cols = p.action === "edit-row" ? mergedRowCols(view, p.key, keyIdx, p.cols) : p.cols;
  const h1 = lintHealthH1(triggerTextForTab(p.tab, h1Cols), patternFromColumns(p.tab, h1Cols), {
    ...h1FlagsForRow(p.tab, h1Cols),
    assurancePhrases: config.assuranceBannedPhrases,
  });
  for (const f of h1) warnings.push(f.level === "block" ? `${f.message} — ถ้าบันทึกทั้งแบบนี้ lint จะไม่ให้ผ่าน` : f.message);

  // ── ด่าน 5: add-row ที่ key มีอยู่แล้ว → ชี้แถวเดิม (dup-check ตอนบันทึกจะปฏิเสธอยู่ดี — บอกก่อนให้เปลี่ยนทาง)
  if (p.action === "add-row" && keyIdx >= 0) {
    const dupAt = view.rows.findIndex((r, i) => i > 0 && cleanCell(r[keyIdx] ?? "") === cleanCell(p.key));
    if (dupAt > 0) warnings.push(`"${p.key}" มีอยู่แล้ว: แถว ${rowLabel(view, dupAt, keyIdx)} — ให้แก้แถวเดิมแทนการเพิ่มใหม่`);
  }

  return warnings;
}

/** edit-row: ค่าแถวจริงปัจจุบัน + ทับด้วยช่องที่ใบเสนอ → H1 เห็นภาพ "หลังแก้" ทั้งแถว (ไม่ใช่แค่ช่องที่เปลี่ยน) */
function mergedRowCols(view: NonNullable<ReturnType<typeof tabView>>, key: string, keyIdx: number, proposed: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (keyIdx >= 0) {
    const rowIdx = view.rows.findIndex((r, i) => i > 0 && cleanCell(r[keyIdx] ?? "") === cleanCell(key));
    if (rowIdx > 0) view.header.forEach((h, i) => { if (h) out[h] = view.rows[rowIdx][i] ?? ""; });
  }
  return { ...out, ...proposed };
}
