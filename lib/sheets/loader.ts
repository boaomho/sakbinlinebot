import { getSheets } from "./client";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";

/**
 * lib/sheets/loader.ts — โหลด BotLibrary ทุกแท็บด้วย batchGet 1 call จาก SHEET_BOTLIB_ID
 * (Google Sheets API + service account เดิม · ชีตไม่ต้อง publish สาธารณะอีกต่อไป)
 *
 * cache bundle 60 วิ (TTL เดียว · D-12) — 1 เทิร์นเรียก Google ไม่เกิน 1 ชุด (ส่วนใหญ่ hit cache)
 * โหลดไม่ได้ → ใช้ cache เก่า · ไม่มี cache เลย → คืน null (ผู้เรียกปิดฟีเจอร์ all-or-nothing)
 */

/** ชื่อแท็บใน BotLibrary (ตาม CONTRACTS §2) — key ที่ผู้เรียกใช้อ้าง */
export const BOTLIB_TABS = [
  "CSV_Step",
  "CSV_Objections",
  "CSV_Examples",
  "CSV_FAQ",
  "CSV_Follow",
  "CSV_Config",
  "CSV_Products",
  "CSV_Promo",
] as const;

export type BotLibTab = (typeof BOTLIB_TABS)[number];

/** แต่ละแท็บ = แถวดิบ (รวมแถว header) string[][] */
export type BotLibrary = Record<BotLibTab, string[][]>;

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  bundle: BotLibrary;
  fetchedAt: number;
}
let cache: CacheEntry | null = null;

function emptyBundle(): BotLibrary {
  return Object.fromEntries(BOTLIB_TABS.map((t) => [t, [] as string[][]])) as BotLibrary;
}

/**
 * โหลดทุกแท็บ BotLibrary — batchGet 1 call · cache 60 วิ
 * คืน null เมื่อ env ขาด/ผิดรูป หรือโหลดครั้งแรกไม่สำเร็จ (ไม่มี cache) → ปิดฟีเจอร์
 */
export async function loadBotLibrary(): Promise<BotLibrary | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.bundle;
  }

  let spreadsheetId: string;
  try {
    spreadsheetId = resolveSpreadsheetId(process.env.SHEET_BOTLIB_ID, "SHEET_BOTLIB_ID");
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets", warning: "SHEET_BOTLIB_ID invalid", error: String(error) }));
    return cache?.bundle ?? null; // ยังมี cache เก่าก็ใช้ต่อ ไม่งั้นปิดฟีเจอร์
  }

  try {
    const res = await getSheets().spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: BOTLIB_TABS.map((t) => `${t}!A:Z`),
    });
    const valueRanges = res.data.valueRanges ?? [];
    const bundle = emptyBundle();
    // "order of ValueRanges is the same as requested ranges" (ยืนยันจาก types) → map ตาม index
    BOTLIB_TABS.forEach((tab, i) => {
      bundle[tab] = (valueRanges[i]?.values as string[][] | undefined) ?? [];
    });
    cache = { bundle, fetchedAt: now };
    return bundle;
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets", warning: "batchGet BotLibrary failed", error: String(error) }));
    return cache?.bundle ?? null; // fallback cache เก่า · ไม่มีก็ปิดฟีเจอร์
  }
}

/** เฉพาะเทส — ล้าง cache (กันข้อมูลค้างข้ามเทส) */
export function __resetBotLibraryCache(): void {
  cache = null;
}
