import { getSheets } from "./client";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";
import { validateStepFunnelStages, VALID_FUNNEL_STAGES } from "@/lib/agent/inject";
import { getTrainSandbox } from "@/lib/train/sandbox";

/**
 * lib/sheets/loader.ts — โหลด BotLibrary ทุกแท็บด้วย batchGet 1 call จาก SHEET_BOTLIB_ID
 * (Google Sheets API + service account เดิม · ชีตไม่ต้อง publish สาธารณะอีกต่อไป)
 *
 * cache bundle 60 วิ (TTL เดียว · D-12) — 1 เทิร์นเรียก Google ไม่เกิน 1 ชุด (ส่วนใหญ่ hit cache)
 * โหลดไม่ได้ → ใช้ cache เก่า · ไม่มี cache เลย → คืน null (ผู้เรียกปิดฟีเจอร์ all-or-nothing)
 */

/** ชื่อแท็บใน BotLibrary (v2.0 · D-41) — key ที่ผู้เรียกใช้อ้าง
 *  🔴 ตัด CSV_Examples (เลิกใช้ "เลียนโทน" · verbatim ไม่ต้องมีตัวอย่างน้ำเสียง) · เพิ่ม CSV_Vars (ตัวแปรข้อความเจ้าของ · D-43) */
export const BOTLIB_TABS = [
  "CSV_Step",
  "CSV_Objections",
  "CSV_FAQ",
  "CSV_Follow",
  "CSV_Config",
  "CSV_Products",
  "CSV_Promo",
  "CSV_Vars",
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
  // 🔴 T-STUDIO (guarded no-op สำหรับ prod): อยู่ใน sandbox → bypass cache 60วิ ทั้งอ่าน/เขียน
  //    เพื่อ (1) ให้ draft overlay (apply ที่ batchGet proxy) มีผลทันทีทุกเทิร์น
  //    (2) 🔴 กัน bundle ที่มี overlay รั่วเข้า cache ที่ prod ใช้ร่วม · ไม่มี context = พฤติกรรมเดิมทุกบรรทัด
  const inSandbox = Boolean(getTrainSandbox());
  const now = Date.now();
  if (!inSandbox && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.bundle;
  }

  let spreadsheetId: string;
  try {
    spreadsheetId = resolveSpreadsheetId(process.env.SHEET_BOTLIB_ID, "SHEET_BOTLIB_ID");
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets", warning: "SHEET_BOTLIB_ID invalid", error: String(error) }));
    return (inSandbox ? null : cache?.bundle) ?? null; // ยังมี cache เก่าก็ใช้ต่อ (prod) · sandbox = null
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
    if (!inSandbox) cache = { bundle, fetchedAt: now }; // 🔴 sandbox ไม่เขียน cache (กัน draft รั่ว prod)
    logStepFunnelStageIssues(bundle.CSV_Step); // Step 6: validate funnel_stage ครั้งเดียวต่อ load (ไม่ spam per-turn)
    return bundle;
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets", warning: "batchGet BotLibrary failed", error: String(error) }));
    return (inSandbox ? null : cache?.bundle) ?? null; // fallback cache เก่า (prod) · sandbox = null
  }
}

/**
 * Step 6: log แถวที่ funnel_stage ผิด (ครั้งเดียวตอนโหลด · ไม่ใช่ warn ต่อ turn)
 * 🔴 error (ไม่ใช่ warn) พร้อม value+stepId+allowed · severity=high (typo handoff) เด่นเป็นพิเศษ · fail-safe คงแถว
 */
function logStepFunnelStageIssues(stepRows: string[][]): void {
  for (const b of validateStepFunnelStages(stepRows)) {
    console.error(JSON.stringify({
      scope: "sheets", tab: "CSV_Step",
      error: b.severity === "high" ? "🔴 funnel_stage ผิด (ตาข่าย handoff หาย — เสี่ยง พ.ร.บ.อาหาร)" : "funnel_stage ไม่รู้จัก (ประตูไม่เข้า region)",
      severity: b.severity, stepId: b.stepId, value: b.value, allowed: VALID_FUNNEL_STAGES,
    }));
  }
}

/** เฉพาะเทส — ล้าง cache (กันข้อมูลค้างข้ามเทส) */
export function __resetBotLibraryCache(): void {
  cache = null;
}
