import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { getSheets } from "@/lib/sheets/client";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";
import { SHEET_TABS, validateBundle } from "@/lib/sheets/normalize-bundle";
import { getConfig } from "@/lib/config";

export const maxDuration = 20;

/** ค่าที่ยังเป็น placeholder ตอน seed — ต้องกรอกจริงก่อน cutover (D-61.C) */
const PLACEHOLDER_KEYS = ["เลขที่บัญชี", "ชื่อบัญชี", "ธนาคาร"];

/**
 * D-61.C · การ์ดสุขภาพชีต v3 ใน /train/dashboard (เคาะ #5 เฟส B — ไม่ silent)
 * อ่านไฟล์ v3 ตรง (นอก loader/adapter) → validateBundle → แท็บ ✅/⚠️ + live/draft + placeholder ค้าง
 */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const idRaw = process.env.SHEET_BOTLIB_ID;
  if (!idRaw) {
    return NextResponse.json({ v3Configured: false, tabs: [], placeholders: [], error: "ยังไม่ได้ตั้ง SHEET_BOTLIB_ID" });
  }

  try {
    const spreadsheetId = resolveSpreadsheetId(idRaw, "SHEET_BOTLIB_ID");
    const res = await getSheets().spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: SHEET_TABS.map((t) => `${t}!A:Z`),
    });
    const valueRanges = res.data.valueRanges ?? [];
    const rawByTab: Record<string, string[][]> = {};
    SHEET_TABS.forEach((tab, i) => {
      rawByTab[tab] = (valueRanges[i]?.values as string[][] | undefined) ?? [];
    });
    const tabs = validateBundle(rawByTab);

    // placeholder ค้างใน Config ของไฟล์ v3 (ค่าที่ยังมีวงเล็บ "(กรอก...)" หรือว่าง)
    const cfgRows = rawByTab["Config"] ?? [];
    const placeholders: string[] = [];
    for (let i = 1; i < cfgRows.length; i++) {
      const k = (cfgRows[i][0] ?? "").trim();
      const v = (cfgRows[i][1] ?? "").trim();
      if (PLACEHOLDER_KEYS.includes(k) && (v === "" || v.startsWith("("))) placeholders.push(k);
    }

    const config = await getConfig();
    return NextResponse.json({
      v3Configured: true,
      tabs,
      placeholders,
      ready: tabs.every((t) => t.ok) && placeholders.length === 0,
      configLoadFailed: config.loadFailed,
    });
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets-v3", warning: "schema check failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ v3Configured: true, tabs: [], placeholders: [], error: String(error).slice(0, 160) }, { status: 200 });
  }
}
