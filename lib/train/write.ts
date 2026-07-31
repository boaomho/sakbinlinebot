import { getSheets } from "@/lib/sheets/client";
import { loadBotLibrary, __resetBotLibraryCache, BotLibrary } from "@/lib/sheets/loader";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";
import { columnLetter } from "@/lib/sheets/columns";
import { cleanHeader, cleanCell } from "@/lib/sheets/clean";
import { bangkokDateTime } from "@/lib/core/time";
import { getConfig } from "@/lib/config";
import { lintPattern } from "./lint";
import { patternFromColumns, triggerTextForTab, h1FlagsForRow, EDITABLE_COLS } from "./preview";
import { tabKeyColumn } from "./sandbox";
import { VALID_FUNNEL_STAGES, isActiveStatus, statusColumnIndex } from "@/lib/agent/inject";

/**
 * lib/train/write.ts — เฟส ค: เขียน draft กลับชีต BotLibrary จริง
 * 🔴 รันนอก sandbox (getSheets = client จริง) · เขียนเฉพาะ SHEET_BOTLIB_ID · ห้ามแตะ Orders (hard guard)
 * 🔴 target สดทุกครั้ง: หา row/col จาก key column + ชื่อ header ตอนเขียน (ไม่จำ A1/index)
 */

const EDITABLE_TABS = ["CSV_Step", "CSV_Objections", "CSV_FAQ", "CSV_Vars"];
const TRAIN_LOG_TAB = "TRAIN_LOG";
const TRAIN_LOG_HEADER = ["เวลา", "แท็บ", "key", "คอลัมน์", "ค่าเก่า(ย่อ)", "ค่าใหม่(ย่อ)", "ประเภท"];
const DRAFT = "draft";

export type WriteResult =
  | { status: "ok"; range: string }
  | { status: "conflict"; current: string }
  | { status: "lint"; lint: ReturnType<typeof lintPattern> }
  | { status: "not_found" };

function botlibId(): string {
  const id = resolveSpreadsheetId(process.env.SHEET_BOTLIB_ID, "SHEET_BOTLIB_ID");
  // hard guard ระดับ spreadsheetId: ต้องไม่ใช่ชีต Orders เด็ดขาด
  try {
    if (process.env.SHEET_ORDERS_ID && id === resolveSpreadsheetId(process.env.SHEET_ORDERS_ID, "SHEET_ORDERS_ID")) {
      throw new Error("SHEET_BOTLIB_ID ชนกับ SHEET_ORDERS_ID — ปฏิเสธการเขียน (กันเขียนโดนชีตออเดอร์)");
    }
  } catch (e) {
    if (String(e).includes("ชนกับ")) throw e; // เฉพาะเคสชนจริง · resolve Orders ไม่ได้ = ข้าม (ยังเขียน BotLibrary ได้)
  }
  return id;
}

function assertEditable(tab: string, column: string): void {
  if (!EDITABLE_TABS.includes(tab)) {
    throw new Error(`แท็บ "${tab}" เขียนไม่ได้ — เขียนได้เฉพาะ BotLibrary: ${EDITABLE_TABS.join(" / ")} (ห้ามแตะ Orders)`);
  }
  if (!(EDITABLE_COLS[tab] ?? []).includes(column)) {
    throw new Error(`คอลัมน์ "${column}" ของ ${tab} แก้ไม่ได้`);
  }
}

interface Located {
  rowIndex: number; // index ในอาเรย์ (แถว 0 = header) → sheet row = rowIndex+1
  colIndex: number;
  current: string;
  rowCols: Record<string, string>;
}

/** หาแถว/คอลัมน์จาก key column + ชื่อ header (pure · header-driven) */
function locateInLib(lib: BotLibrary, tab: string, key: string, column: string): Located | null {
  const rows = (lib as Record<string, string[][]>)[tab];
  const keyCol = tabKeyColumn(tab);
  if (!rows || rows.length < 2 || !keyCol) return null;
  const header = rows[0].map(cleanHeader);
  const keyIdx = header.indexOf(keyCol);
  const colIdx = header.indexOf(cleanHeader(column));
  if (keyIdx === -1 || colIdx === -1) return null;
  const rowIndex = rows.findIndex((r, i) => i > 0 && cleanCell(r[keyIdx] ?? "") === key);
  if (rowIndex === -1) return null;
  const rowCols: Record<string, string> = {};
  header.forEach((h, i) => { if (h) rowCols[h] = rows[rowIndex][i] ?? ""; });
  return { rowIndex, colIndex: colIdx, current: rows[rowIndex][colIdx] ?? "", rowCols };
}

/** อ่านค่าปัจจุบันสดของเซลล์ (โชว์ diff ก่อนเขียน) */
export async function diffCell(tab: string, key: string, column: string): Promise<{ exists: boolean; old: string }> {
  assertEditable(tab, column);
  __resetBotLibraryCache();
  const lib = await loadBotLibrary();
  const loc = lib ? locateInLib(lib, tab, key, column) : null;
  return { exists: Boolean(loc), old: loc?.current ?? "" };
}

/** เขียน 1 เซลล์กลับชีต (conflict check + lint gate + TRAIN_LOG + invalidate cache) */
export async function writeCell(tab: string, key: string, column: string, newValue: string, expectedOld: string): Promise<WriteResult> {
  assertEditable(tab, column);
  __resetBotLibraryCache();
  const lib = await loadBotLibrary();
  if (!lib) return { status: "not_found" };
  const loc = locateInLib(lib, tab, key, column);
  if (!loc) return { status: "not_found" };

  // 🔴 กันชนกัน: ค่าในชีตจริงตอนนี้ต้องตรงกับที่โชว์ใน diff — ไม่ตรง = มีคนแก้ระหว่างนั้น
  if (loc.current !== expectedOld) return { status: "conflict", current: loc.current };

  // lint gate ฝั่ง server (ไม่เชื่อ client) — lint full-row pattern ที่ทับ draft แล้ว
  const config = await getConfig();
  const merged = { ...loc.rowCols, [column]: newValue };
  const findings = lintPattern(patternFromColumns(tab, merged), { config, lib, payment: "", now: new Date(), trigger: triggerTextForTab(tab, merged), ...h1FlagsForRow(tab, merged) });
  if (findings.some((f) => f.level === "block")) return { status: "lint", lint: findings };

  const spreadsheetId = botlibId(); // hard guard: BotLibrary เท่านั้น
  const range = `${tab}!${columnLetter(loc.colIndex)}${loc.rowIndex + 1}`; // A1 สดจาก key+header
  await getSheets().spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data: [{ range, values: [[newValue]] }] },
  });
  await appendTrainLog(spreadsheetId, tab, key, column, expectedOld, newValue, "edit");
  __resetBotLibraryCache(); // เทิร์นถัดไปเห็นของจริงใหม่
  return { status: "ok", range };
}

// ---- T2-ค: จัดการแถว (list / add-row / status live↔draft) — reuse guard/lint/TRAIN_LOG เดิม ----

export interface TabRow { key: string; status: string; active: boolean; preview: string }
export interface TabRowsResult {
  header: string[];
  keyCol: string | null;
  /** ชื่อคอลัมน์สถานะจริงในชีต ("status" | "สถานะ") · null = แท็บนี้ไม่มี → เพิ่ม/สลับสถานะไม่ได้ */
  statusCol: string | null;
  hasStatusCol: boolean;
  editableCols: string[];
  rows: TabRow[];
  suggestedKey: string | null;
}

/** อ่านทุกแถวของแท็บ (read-only · fresh) — ป้อน list view + ฟอร์มเพิ่มแถว (header-driven) */
export async function listTabRows(tab: string): Promise<TabRowsResult> {
  if (!EDITABLE_TABS.includes(tab)) throw new Error(`แท็บ "${tab}" อ่านไม่ได้ในโหมดจัดการ (เฉพาะ ${EDITABLE_TABS.join(" / ")})`);
  __resetBotLibraryCache();
  const lib = await loadBotLibrary();
  const keyCol = tabKeyColumn(tab);
  const editableCols = EDITABLE_COLS[tab] ?? [];
  const rows = lib ? ((lib as Record<string, string[][]>)[tab] ?? []) : [];
  if (rows.length < 1 || !keyCol) return { header: [], keyCol, statusCol: null, hasStatusCol: false, editableCols, rows: [], suggestedKey: null };
  const header = rows[0].map(cleanHeader);
  const keyIdx = header.indexOf(keyCol);
  const statusIdx = statusColumnIndex(header); // status/สถานะ (single source · ตรงกับ loader prod)
  const prevIdx = editableCols[0] ? header.indexOf(cleanHeader(editableCols[0])) : -1;
  const out: TabRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const key = cleanCell(rows[i][keyIdx] ?? "");
    if (!key) continue; // แถวว่าง/หมายเหตุ (key ว่าง = junk · ตรงกับ prod ที่กรองทิ้ง)
    const statusRaw = statusIdx >= 0 ? cleanCell(rows[i][statusIdx] ?? "") : "";
    const preview = prevIdx >= 0 ? (rows[i][prevIdx] ?? "") : "";
    out.push({ key, status: statusRaw || "(ว่าง=live)", active: isActiveStatus(statusRaw), preview: preview.slice(0, 80) });
  }
  return { header, keyCol, statusCol: statusIdx >= 0 ? header[statusIdx] : null, hasStatusCol: statusIdx >= 0, editableCols, rows: out, suggestedKey: suggestNextKey(tab, out.map((r) => r.key)) };
}

/** เสนอ key ถัดไป (เฉพาะแท็บที่ key เป็น id มีเลขต่อท้าย: step_id/objection_id) · FAQ/Vars = คนพิมพ์เอง → null */
export function suggestNextKey(tab: string, keys: string[]): string | null {
  if (tab !== "CSV_Step" && tab !== "CSV_Objections") return null;
  let best: { prefix: string; num: number } | null = null;
  for (const k of keys) {
    const m = /^(.*?)(\d+)$/.exec(k.trim());
    if (!m) continue;
    const num = parseInt(m[2], 10);
    if (!best || num >= best.num) best = { prefix: m[1], num };
  }
  return best ? `${best.prefix}${best.num + 1}` : null;
}

function validateNewKey(tab: string, key: string): string | null {
  if (!key) return "ต้องระบุ key (คอลัมน์หลักของแท็บ)";
  if (tab === "CSV_Vars" && !(key.startsWith("{") && key.endsWith("}"))) return "ชื่อตัวแปรต้องครอบด้วยปีกกา { } เช่น {สัดส่วนปลาทู}";
  return null;
}

export type AppendResult =
  | { status: "ok" }
  | { status: "lint"; lint: ReturnType<typeof lintPattern> }
  | { status: "dup" }
  | { status: "no_status_col" }
  | { status: "key_invalid"; message: string }
  | { status: "funnel"; message: string }
  | { status: "not_found" };

/**
 * เพิ่มแถวใหม่ (header-driven · 🔴 บังคับ สถานะ=draft เสมอ · ไม่มีคอลัมน์สถานะ=ปฏิเสธ)
 * กันซ้ำ key · validate funnel_stage (Step) · lint block (รวม H1) กันเขียน · append + TRAIN_LOG action=add-row
 */
export async function appendRow(tab: string, cols: Record<string, string>): Promise<AppendResult> {
  if (!EDITABLE_TABS.includes(tab)) throw new Error(`แท็บ "${tab}" เขียนไม่ได้ — เฉพาะ ${EDITABLE_TABS.join(" / ")} (ห้ามแตะ Orders/Products/Promo/Config)`);
  __resetBotLibraryCache();
  const lib = await loadBotLibrary();
  if (!lib) return { status: "not_found" };
  const rows = (lib as Record<string, string[][]>)[tab] ?? [];
  const keyCol = tabKeyColumn(tab);
  if (rows.length < 1 || !keyCol) return { status: "not_found" };
  const header = rows[0].map(cleanHeader);
  const keyIdx = header.indexOf(keyCol);
  const statusIdx = statusColumnIndex(header); // status/สถานะ (single source)
  if (keyIdx === -1) return { status: "not_found" };
  // 🔴 safety #1: ไม่มีคอลัมน์สถานะ (status/สถานะ) = ปฏิเสธ (ช่องว่าง=live → แถวใหม่จะขึ้นหน้าร้านทันที)
  if (statusIdx === -1) return { status: "no_status_col" };

  const key = cleanCell(cols[keyCol] ?? "");
  const keyErr = validateNewKey(tab, key);
  if (keyErr) return { status: "key_invalid", message: keyErr };
  if (rows.some((r, i) => i > 0 && cleanCell(r[keyIdx] ?? "") === key)) return { status: "dup" };

  // funnel_stage (Step · ตาข่าย handoff H1) — ต้องเป็น enum ที่ถูก
  const funnelIdx = header.indexOf("funnel_stage");
  if (tab === "CSV_Step" && funnelIdx >= 0) {
    const fv = cleanCell(cols["funnel_stage"] ?? "").toLowerCase();
    if (!(VALID_FUNNEL_STAGES as readonly string[]).includes(fv)) {
      return { status: "funnel", message: `funnel_stage "${cols["funnel_stage"] ?? "(ว่าง)"}" ไม่ถูกต้อง — ต้องเป็นหนึ่งใน: ${VALID_FUNNEL_STAGES.join(", ")}` };
    }
  }

  // lint คำตอบ (รวม H1 trigger-aware block) — ไม่เชื่อ client
  const config = await getConfig();
  const findings = lintPattern(patternFromColumns(tab, cols), { config, lib, payment: "", now: new Date(), trigger: triggerTextForTab(tab, cols), ...h1FlagsForRow(tab, cols) });
  if (findings.some((f) => f.level === "block")) return { status: "lint", lint: findings };

  // สร้างแถวตามลำดับ header · บังคับ status=draft · key ช่องหลัก
  const rowArr = header.map((h, i) => {
    if (i === statusIdx) return DRAFT;
    if (i === keyIdx) return key;
    const v = cols[h];
    return typeof v === "string" ? v.slice(0, 4000) : "";
  });

  const spreadsheetId = botlibId(); // hard guard BotLibrary เท่านั้น
  await getSheets().spreadsheets.values.append({
    spreadsheetId, range: `${tab}!A:Z`, valueInputOption: "USER_ENTERED", requestBody: { values: [rowArr] },
  });
  await appendTrainLog(spreadsheetId, tab, key, "(เพิ่มแถว)", "", `draft`, "add-row");
  __resetBotLibraryCache();
  return { status: "ok" };
}

/** สลับสถานะ live↔draft (soft delete · ไม่มีลบถาวร) — reuse hard guard + TRAIN_LOG action=status-change */
export async function setRowStatus(tab: string, key: string, toStatus: "live" | "draft"): Promise<WriteResult> {
  if (!EDITABLE_TABS.includes(tab)) throw new Error(`แท็บ "${tab}" เขียนไม่ได้`);
  __resetBotLibraryCache();
  const lib = await loadBotLibrary();
  if (!lib) return { status: "not_found" };
  const rows = (lib as Record<string, string[][]>)[tab] ?? [];
  const keyCol = tabKeyColumn(tab);
  if (rows.length < 2 || !keyCol) return { status: "not_found" };
  const header = rows[0].map(cleanHeader);
  const keyIdx = header.indexOf(keyCol);
  const statusIdx = statusColumnIndex(header); // status/สถานะ (single source)
  if (keyIdx === -1 || statusIdx === -1) return { status: "not_found" };
  const rowIndex = rows.findIndex((r, i) => i > 0 && cleanCell(r[keyIdx] ?? "") === key);
  if (rowIndex === -1) return { status: "not_found" };

  const current = rows[rowIndex][statusIdx] ?? "";
  const spreadsheetId = botlibId();
  const range = `${tab}!${columnLetter(statusIdx)}${rowIndex + 1}`;
  await getSheets().spreadsheets.values.batchUpdate({
    spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: [{ range, values: [[toStatus]] }] },
  });
  await appendTrainLog(spreadsheetId, tab, key, header[statusIdx], current, toStatus, "status-change");
  __resetBotLibraryCache();
  return { status: "ok", range };
}

const short = (s: string): string => (s.length > 60 ? s.slice(0, 60) + "…" : s);

async function appendTrainLog(spreadsheetId: string, tab: string, key: string, column: string, oldV: string, newV: string, action: "edit" | "add-row" | "status-change"): Promise<void> {
  const row = [bangkokDateTime(), tab, key, column, short(oldV), short(newV), action];
  try {
    await getSheets().spreadsheets.values.append({
      spreadsheetId, range: `${TRAIN_LOG_TAB}!A:G`, valueInputOption: "USER_ENTERED", requestBody: { values: [row] },
    });
  } catch {
    // แท็บ TRAIN_LOG ยังไม่มี → สร้าง + header + retry (ครั้งแรกครั้งเดียว)
    try {
      await getSheets().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: TRAIN_LOG_TAB } } }] } });
      await getSheets().spreadsheets.values.append({
        spreadsheetId, range: `${TRAIN_LOG_TAB}!A:G`, valueInputOption: "USER_ENTERED", requestBody: { values: [TRAIN_LOG_HEADER, row] },
      });
    } catch (e) {
      console.error(JSON.stringify({ scope: "train", warning: "TRAIN_LOG เขียนไม่ได้ (เขียนเซลล์สำเร็จแล้ว)", error: String(e).slice(0, 120) }));
    }
  }
}
