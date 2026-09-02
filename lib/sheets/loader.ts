import { getSheets } from "./client";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";
import { validateStepFunnelStages, VALID_FUNNEL_STAGES } from "@/lib/agent/inject";
import { getTrainSandbox } from "@/lib/train/sandbox";
import { SHEET_TABS, SheetTab, normalizeBundle } from "./normalize-bundle";

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

/**
 * 🔴 D-72b: "แถวดิบตามชีตเป๊ะ" (ชื่อคอลัมน์จริง ลำดับจริง เลขแถวจริง — ก่อน normalize)
 * เส้นทางของ Studio/ปุ่มเขียนเท่านั้น · เส้นบอทใช้ `BotLibrary` (normalize แล้ว) เหมือนเดิมทุกบรรทัด
 */
export type RawSheets = Record<SheetTab, string[][]>;

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  raw: RawSheets;
  bundle: BotLibrary;
  fetchedAt: number;
}
let cache: CacheEntry | null = null;

function emptyBundle(): BotLibrary {
  return Object.fromEntries(BOTLIB_TABS.map((t) => [t, [] as string[][]])) as BotLibrary;
}

/**
 * แกนโหลดจริง (ใช้ร่วม 2 เส้นทาง) — batchGet 1 call · cache 60 วิ · คืนทั้ง raw+bundle
 * 🔴 D-72b: raw กับ bundle มาจาก batchGet ครั้งเดียวกันเสมอ (cache entry เดียว) — ไม่มีทางเห็นชีตคนละจังหวะ
 */
async function loadBoth(): Promise<CacheEntry | null> {
  // 🔴 T-STUDIO (guarded no-op สำหรับ prod): อยู่ใน sandbox → bypass cache 60วิ ทั้งอ่าน/เขียน
  //    เพื่อ (1) ให้ draft overlay (apply ที่ batchGet proxy) มีผลทันทีทุกเทิร์น
  //    (2) 🔴 กัน bundle ที่มี overlay รั่วเข้า cache ที่ prod ใช้ร่วม · ไม่มี context = พฤติกรรมเดิมทุกบรรทัด
  const inSandbox = Boolean(getTrainSandbox());
  const now = Date.now();
  if (!inSandbox && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  // 🔴 D-72a: ชื่อ ENV กลับมาเป็น SHEET_BOTLIB_ID (ไม่มี v2 ให้แยกแล้ว)
  //    เจ้าของแก้ "ค่า" ของ ENV เดิมให้ชี้ชีต v3 ก่อน deploy → deploy เก่าไม่อ่าน = ไม่มีช่วงบอทดับ
  const envKey = "SHEET_BOTLIB_ID";
  let spreadsheetId: string;
  try {
    spreadsheetId = resolveSpreadsheetId(process.env[envKey], envKey);
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets", warning: `${envKey} invalid`, error: String(error) }));
    return (inSandbox ? null : cache) ?? null; // ยังมี cache เก่าก็ใช้ต่อ (prod) · sandbox = null
  }

  try {
    const res = await getSheets().spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: SHEET_TABS.map((t) => `${t}!A:Z`),
    });
    const valueRanges = res.data.valueRanges ?? [];
    // "order of ValueRanges is the same as requested ranges" (ยืนยันจาก types) → map ตาม index
    const raw = {} as RawSheets;
    SHEET_TABS.forEach((tab, i) => {
      raw[tab] = (valueRanges[i]?.values as string[][] | undefined) ?? [];
    });
    const bundle: BotLibrary = normalizeBundle(raw); // normalize สถานะ (ว่าง=draft) + funnel + ประกอบคำตอบ — จุดเดียว
    const entry: CacheEntry = { raw, bundle, fetchedAt: now };
    if (!inSandbox) cache = entry; // 🔴 sandbox ไม่เขียน cache (กัน draft รั่ว prod)
    logStepFunnelStageIssues(bundle.Steps); // Step 6: validate funnel_stage ครั้งเดียวต่อ load (ไม่ spam per-turn)
    return entry;
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets", warning: "batchGet BotLibrary failed", error: String(error) }));
    return (inSandbox ? null : cache) ?? null; // fallback cache เก่า (prod) · sandbox = null
  }
}

/**
 * เส้นบอท: โหลดทุกแท็บ BotLibrary (normalize แล้ว) — พฤติกรรมเดิมทุกบรรทัด (D-72b แค่ย้ายแกนไป loadBoth)
 * คืน null เมื่อ env ขาด/ผิดรูป หรือโหลดครั้งแรกไม่สำเร็จ (ไม่มี cache) → ปิดฟีเจอร์
 */
export async function loadBotLibrary(): Promise<BotLibrary | null> {
  return (await loadBoth())?.bundle ?? null;
}

/**
 * 🔴 D-72b · เส้น Studio/ปุ่มเขียน: "แถวดิบตามชีตเป๊ะ" จาก batchGet เดียวกับ loadBotLibrary (ไม่เพิ่ม Google call)
 * ใช้หาพิกัดแถว/คอลัมน์ตอนเขียนกลับชีต + โชว์คอลัมน์จริงให้เจ้าของแก้ — ห้ามเอาไปเข้า prompt (ยังไม่ normalize)
 * ใน sandbox: raw ผ่าน overlay ที่ batchGet proxy แล้ว (draft ทับมาให้เหมือนเส้นบอท)
 */
export async function loadRawSheets(): Promise<RawSheets | null> {
  return (await loadBoth())?.raw ?? null;
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
