import { getSheets } from "@/lib/sheets/client";
import { loadBotLibrary, __resetBotLibraryCache, BotLibrary } from "@/lib/sheets/loader";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";
import { columnLetter } from "@/lib/sheets/columns";
import { cleanHeader, cleanCell } from "@/lib/sheets/clean";
import { bangkokDateTime } from "@/lib/core/time";
import { getConfig } from "@/lib/config";
import { lintPattern } from "./lint";
import { patternFromColumns, EDITABLE_COLS } from "./preview";
import { tabKeyColumn } from "./sandbox";

/**
 * lib/train/write.ts — เฟส ค: เขียน draft กลับชีต BotLibrary จริง
 * 🔴 รันนอก sandbox (getSheets = client จริง) · เขียนเฉพาะ SHEET_BOTLIB_ID · ห้ามแตะ Orders (hard guard)
 * 🔴 target สดทุกครั้ง: หา row/col จาก key column + ชื่อ header ตอนเขียน (ไม่จำ A1/index)
 */

const EDITABLE_TABS = ["CSV_Step", "CSV_Objections", "CSV_FAQ", "CSV_Vars"];
const TRAIN_LOG_TAB = "TRAIN_LOG";
const TRAIN_LOG_HEADER = ["เวลา", "แท็บ", "key", "คอลัมน์", "ค่าเก่า(ย่อ)", "ค่าใหม่(ย่อ)"];

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
  const findings = lintPattern(patternFromColumns(tab, merged), { config, lib, payment: "", now: new Date() });
  if (findings.some((f) => f.level === "block")) return { status: "lint", lint: findings };

  const spreadsheetId = botlibId(); // hard guard: BotLibrary เท่านั้น
  const range = `${tab}!${columnLetter(loc.colIndex)}${loc.rowIndex + 1}`; // A1 สดจาก key+header
  await getSheets().spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data: [{ range, values: [[newValue]] }] },
  });
  await appendTrainLog(spreadsheetId, tab, key, column, expectedOld, newValue);
  __resetBotLibraryCache(); // เทิร์นถัดไปเห็นของจริงใหม่
  return { status: "ok", range };
}

const short = (s: string): string => (s.length > 60 ? s.slice(0, 60) + "…" : s);

async function appendTrainLog(spreadsheetId: string, tab: string, key: string, column: string, oldV: string, newV: string): Promise<void> {
  const row = [bangkokDateTime(), tab, key, column, short(oldV), short(newV)];
  try {
    await getSheets().spreadsheets.values.append({
      spreadsheetId, range: `${TRAIN_LOG_TAB}!A:F`, valueInputOption: "USER_ENTERED", requestBody: { values: [row] },
    });
  } catch {
    // แท็บ TRAIN_LOG ยังไม่มี → สร้าง + header + retry (ครั้งแรกครั้งเดียว)
    try {
      await getSheets().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: TRAIN_LOG_TAB } } }] } });
      await getSheets().spreadsheets.values.append({
        spreadsheetId, range: `${TRAIN_LOG_TAB}!A:F`, valueInputOption: "USER_ENTERED", requestBody: { values: [TRAIN_LOG_HEADER, row] },
      });
    } catch (e) {
      console.error(JSON.stringify({ scope: "train", warning: "TRAIN_LOG เขียนไม่ได้ (เขียนเซลล์สำเร็จแล้ว)", error: String(e).slice(0, 120) }));
    }
  }
}
