import { getSheets } from "./client";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";
import { validateStepFunnelStages, VALID_FUNNEL_STAGES } from "@/lib/agent/inject";
import { getTrainSandbox } from "@/lib/train/sandbox";
import { SHEET_TABS, normalizeBundle } from "./normalize-bundle";

/**
 * lib/sheets/loader.ts — โหลด BotLibrary ทุกแท็บด้วย batchGet 1 call จาก SHEET_BOTLIB_ID
 * (Google Sheets API + service account เดิม · ชีตไม่ต้อง publish สาธารณะอีกต่อไป)
 *
 * cache bundle 60 วิ (TTL เดียว · D-12) — 1 เทิร์นเรียก Google ไม่เกิน 1 ชุด (ส่วนใหญ่ hit cache)
 * โหลดไม่ได้ → ใช้ cache เก่า · ไม่มี cache เลย → คืน null (ผู้เรียกปิดฟีเจอร์ all-or-nothing)
 */

/**
 * คีย์ของ BotLibrary — 🔴 **D-72a: ตรงกับชื่อแท็บในชีตเป๊ะ** (ชีต = โค้ด = X-ray ชื่อเดียวกัน)
 * `Follow` ไม่มีแท็บในชีต (dormant ตั้งแต่ B7) แต่คงคีย์ไว้ให้ cron/follow อ่านแล้ว skip เหมือนเดิม
 * (D-72a ลบคีย์ `Objections` ทิ้ง — v3 ยุบเข้า Knowledge แล้ว คืน [] มาตลอด)
 */
export const BOTLIB_TABS = [
  "Steps",
  "Knowledge",
  "Follow",
  "Config",
  "Products",
  "Promo",
  "Vars",
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

  // 🔴 D-72a: ชื่อ ENV กลับมาเป็น SHEET_BOTLIB_ID (ไม่มี v2 ให้แยกแล้ว)
  //    เจ้าของแก้ "ค่า" ของ ENV เดิมให้ชี้ชีต v3 ก่อน deploy → deploy เก่าไม่อ่าน = ไม่มีช่วงบอทดับ
  const envKey = "SHEET_BOTLIB_ID";
  let spreadsheetId: string;
  try {
    spreadsheetId = resolveSpreadsheetId(process.env[envKey], envKey);
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets", warning: `${envKey} invalid`, error: String(error) }));
    return (inSandbox ? null : cache?.bundle) ?? null; // ยังมี cache เก่าก็ใช้ต่อ (prod) · sandbox = null
  }

  try {
    const res = await getSheets().spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: SHEET_TABS.map((t) => `${t}!A:Z`),
    });
    const valueRanges = res.data.valueRanges ?? [];
    // "order of ValueRanges is the same as requested ranges" (ยืนยันจาก types) → map ตาม index
    const rawByTab: Record<string, string[][]> = {};
    SHEET_TABS.forEach((tab, i) => {
      rawByTab[tab] = (valueRanges[i]?.values as string[][] | undefined) ?? [];
    });
    const bundle: BotLibrary = normalizeBundle(rawByTab); // normalize สถานะ (ว่าง=draft) + funnel + ประกอบคำตอบ — จุดเดียว
    if (!inSandbox) cache = { bundle, fetchedAt: now }; // 🔴 sandbox ไม่เขียน cache (กัน draft รั่ว prod)
    logStepFunnelStageIssues(bundle.Steps); // Step 6: validate funnel_stage ครั้งเดียวต่อ load (ไม่ spam per-turn)
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
      scope: "sheets", tab: "Steps",
      error: b.severity === "high" ? "🔴 funnel_stage ผิด (ตาข่าย handoff หาย — เสี่ยง พ.ร.บ.อาหาร)" : "funnel_stage ไม่รู้จัก (ประตูไม่เข้า region)",
      severity: b.severity, stepId: b.stepId, value: b.value, allowed: VALID_FUNNEL_STAGES,
    }));
  }
}

/** เฉพาะเทส — ล้าง cache (กันข้อมูลค้างข้ามเทส) */
export function __resetBotLibraryCache(): void {
  cache = null;
}
