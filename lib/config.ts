import { loadBotLibrary } from "./sheets/loader";
import { DEFAULT_ASSURANCE_PHRASES } from "./guards/assurance";
import { getTrainSandbox } from "./train/sandbox";
// หมายเหตุ: cleanCell/stripKeyAnnotation ยังเป็น copy ในไฟล์นี้ (regex อักขระล่องหนแก้ยาก)
// ตัวกลางอยู่ lib/sheets/clean.ts แล้ว — ตรงกัน 100% · ถ้าแก้ regex ต้องแก้ทั้ง 2 ที่

/** D-61.C4: ข้อความพักสายมาตรฐาน — บอทเรียกตัวเองด้วยชื่อจาก Config `ชื่อบอท` (ห้าม hardcode "ปลาทู") */
export function defaultReply(botName: string): string {
  return `ขออภัยค่ะ ตอนนี้${botName}ขัดข้องนิดหน่อย รอสักครู่แล้วลองทักมาใหม่นะคะ 🙏`;
}

export interface FeatureSwitches {
  /** แกนขาย: Step + FAQ + Config โหลดสำเร็จหรือไม่ (ไม่ใช่สวิตช์ในชีต แต่เป็นผลของการเช็คของจริง) */
  salesCore: boolean;
  /** ความจำลูกค้า (Neon) */
  memory: boolean;
  /** ติดแท็กลูกค้า */
  tagging: boolean;
  /** ส่งต่อแอดมิน (handoff) */
  handoff: boolean;
  /** จังหวะตอบเหมือนคน (debounce + typing indicator) */
  humanLikeTiming: boolean;
  /** ระบบออเดอร์ + อ่านสลิป */
  orders: boolean;
  /** ตามลูกค้าอัตโนมัติ (follow) */
  follow: boolean;
  /** Flex Cards เสริม */
  flexCards: boolean;
}

export interface AppConfig {
  botName: string;
  shopName: string;
  /** เพศบอท (persona) — ใส่ในบทบาทของ system prompt */
  personaGender: string;
  useEmoji: boolean;
  temperature: number;
  maxOutputTokens: number;
  /**
   * D-69 · โมเดล Gemini ที่ใช้ (คีย์ชีต `โมเดล`) — เจ้าของสลับเองได้ ไม่ต้องแก้โค้ด
   * 🔴 ไม่มีแถวในชีต = `gemini-3.5-flash` (ค่าเดิม · ห้ามพังห้ามปิดฟีเจอร์)
   */
  geminiModel: string;
  /**
   * D-69 · ระดับการคิด (คีย์ชีต `ระดับการคิด`) — ค่าดิบจากชีต ยังไม่แปลง
   * gemini-3.x รับ enum (minimal/low/medium/high) · 2.x รับตัวเลข (thinkingBudget)
   * โค้ดเลือกพารามิเตอร์ให้ถูกตระกูลเองที่ `resolveThinkingConfig` (lib/gemini.ts)
   */
  thinkingLevelRaw: string;
  /** D-69 · timeout คอลหลักของ Gemini (คีย์ชีต `timeout_วินาที` · default 15 วิ) — clamp ตาม maxDuration ที่ handler */
  geminiTimeoutMs: number;
  /** D-69 · ข้อความตอนระบบช้า/ตอบไม่ทัน (คีย์ชีต `ข้อความ_ระบบช้า`) — `{ชื่อบอท}` ในข้อความจะถูกแทนค่า */
  slowSystemMessage: string;
  showTyping: boolean;
  debounceWaitMs: number;
  /** หน่วง_ระหว่างบอลลูน — อ่านไว้แต่ปัจจุบันยังส่งบอลลูนใน reply เดียว (ยังไม่ได้ใช้หน่วงจริง) */
  delayBetweenBubblesMs: number;
  slipUrlExpiryDays: number;
  /** 🔴 ยังใช้อยู่ — resolveDeliveryVar `{วันจัดส่ง}` ที่ลูกค้าเห็น (quote.ts อ่านจาก raw · D-39) */
  orderCutoffTime: string;
  handoffKeywords: string[];
  /** D-61.A (v3): คำ_ธงสุขภาพ — match แล้ว: hint เข้า prompt + 🔔 dedup ต่อเคส + arm assurance guard · ไม่ force stage · ชื่อเดียวไม่มี alias (กติกา B1) · default ในโค้ด = ตาข่ายรวมคำสุขภาพเดิม (deploy v3 ที่ยังไม่ตั้ง key ไม่เสียตาข่าย) */
  healthFlagKeywords: string[];
  /** D-61.A (v3): คำรับรอง_ต้องห้าม — list ของ assurance guard · default ในโค้ด */
  assuranceBannedPhrases: string[];
  /** D-61.A (v3): ข้อความ_แจ้งแอดมิน_notify — เนื้อ 🔔 แจ้งกลุ่มตอนติดธงสุขภาพ */
  notifyAdminHealthTemplate: string;
  /** 🔴 D-73c: ข้อความแจ้งแอดมินตอนลูกค้าเข้าประตูเก็บข้อมูล (intake) — แจ้งแล้วบอทคุยต่อ ไม่ปิดบอท · คีย์ `ข้อความ_แจ้งแอดมิน_เก็บข้อมูล` */
  notifyAdminIntakeTemplate: string;
  /** D-77: บรรทัดท้ายข้อความ 🔔 แจ้งแก้ออเดอร์ — คีย์ `ข้อความ_แจ้งแอดมิน_แก้ออเดอร์` · default ห้ามมี "รบกวน" */
  notifyAdminOrderEditTemplate: string;
  /** 🔴 D-77: คำตระกูลยกเลิก (พยานชั้น 2 ของเส้นยกเลิก) — คีย์ `คำ_ยกเลิกออเดอร์` */
  orderCancelKeywords: string[];
  /** D-61.B (B5): key ที่ติ๊กคอลัมน์ "เข้า prompt" — header-driven: ชีตไม่มีคอลัมน์นี้ (v2) = null = ดัมพ์ทุกแถวเหมือนเดิม */
  promptVisibleKeys: Set<string> | null;
  /** คืนสิทธิ์บอท_หลังแชทเงียบ (นาที) — ถ้าลูกค้าเงียบเกินเวลานี้ในโหมดแอดมิน บอทคืนมาดูแลเอง */
  adminSilenceReturnMinutes: number;
  /** ประโยคเปลี่ยนมือ_บอทรับต่อ — ข้อความบอกลูกค้าตอนบอทรับช่วงต่อจากแอดมิน */
  botResumeMessage: string;
  /** เปิด_คำสั่งเทสต์ — คุม /reset ฯลฯ · default เปิด ปิดตอนขายจริง */
  testCommandsEnabled: boolean;
  /**
   * โหมดประหยัดโควตา (hard-logic คุมค่า push LINE) — เปิด = บังคับรวบทุกบอลลูนเป็น reply
   * เดียว (ไม่แตกบับเบิลเสี่ยงล้นไป push) · ปิด = แตกบับเบิลปกติได้ · default เปิด (money-safe)
   */
  quotaSaver: boolean;
  /** สวิตช์ดิบจากชีต (ก่อนเช็ค all-or-nothing กับ env) */
  rawSwitches: {
    tagging: boolean;
    handoff: boolean;
    orders: boolean;
    follow: boolean;
    flexCards: boolean;
    timing: boolean;
  };
  /** ทุก key-value ดิบจากชีต Config, ไว้ใส่ใน <ข้อมูล Config> ของ prompt ตรง ๆ */
  raw: Map<string, string>;
  /** true ถ้าโหลดชีต Config ไม่สำเร็จและไม่มี cache เลย (ใช้ค่า default ล้วน) */
  loadFailed: boolean;
}

/**
 * ตัดอักขระล่องหนที่ .trim() ปกติจับไม่หมด (zero-width space/joiner U+200B–U+200D,
 * BOM U+FEFF, non-breaking space U+00A0) แล้ว trim — ใช้กับทั้ง key และ value จากชีต
 * เพราะบ่อยครั้งเซลล์ Google Sheet มีอักขระพวกนี้ติดมาโดยมองไม่เห็น ทำให้ทั้งการ
 * lookup คีย์ และการเทียบค่าสวิตช์พลาดแบบเงียบ ๆ
 */
function cleanCell(value: string | undefined): string {
  if (value === undefined) return "";
  return value.replace(/[​-‍﻿ ]/g, "").trim();
}

/**
 * ตัดคำอธิบายในวงเล็บท้ายคีย์ออก เช่น "เปิด_ส่งต่อแอดมิน (Handoff)" -> "เปิด_ส่งต่อแอดมิน"
 * เพราะในชีตจริงคนใส่วงเล็บกำกับภาษาอังกฤษไว้ให้อ่านง่าย แต่โค้ด lookup ด้วยชื่อคีย์ล้วน
 */
function stripKeyAnnotation(key: string): string {
  return key.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

const SWITCH_TRUE_VALUES = new Set(["เปิด", "true", "on", "1", "ใช่", "yes"]);
const SWITCH_FALSE_VALUES = new Set(["ปิด", "false", "off", "0", "ไม่", "no", ""]);

/**
 * ตีความค่าสวิตช์จากชีตให้เป็น boolean — ใช้ร่วมทุกสวิตช์เพื่อความสม่ำเสมอ
 * รองรับทั้งค่าไทย ("เปิด"/"ปิด"/"ใช่"/"ไม่") และค่าสากล ("true"/"on"/"1" ฯลฯ)
 * ไม่สนตัวพิมพ์เล็กใหญ่ (Thai ไม่มี case อยู่แล้ว) · ค่าที่ไม่รู้จัก = ใช้ fallback
 */
function parseSwitch(value: string | undefined, fallback: boolean): boolean {
  // คีย์ไม่มีในชีตเลย = ใช้ค่า default (ต่างจากเซลล์ว่าง ๆ ที่ตั้งใจ "ปิด")
  if (value === undefined) return fallback;
  const v = cleanCell(value).toLowerCase();
  if (SWITCH_TRUE_VALUES.has(v)) return true;
  if (SWITCH_FALSE_VALUES.has(v)) return false;
  return fallback;
}

/**
 * หา index ของคอลัมน์ key และ value จากแถว header จริง แทนการ hardcode ตำแหน่ง
 * (ทนต่อการสลับ/แทรกคอลัมน์ในชีต) — ชีต Config จริง header คือ
 * A=หมวด B=ค่า(key) C=ค่าที่ตั้ง D=หน่วย E=คำอธิบาย · fallback = B/C ตามโครงจริง
 */
function findKeyValueCols(rows: string[][]): { keyCol: number; valCol: number; headerRowIndex: number } {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cells = rows[i].map((c) => cleanCell(c).toLowerCase());
    let keyCol = -1;
    let valCol = -1;
    for (let j = 0; j < cells.length; j++) {
      const h = cells[j];
      if (keyCol === -1 && (h.includes("key") || h === "ค่า")) keyCol = j;
      if (valCol === -1 && (h.includes("value") || h.includes("ค่าที่ตั้ง") || h === "ค่าตั้ง")) valCol = j;
    }
    if (keyCol !== -1 && valCol !== -1) return { keyCol, valCol, headerRowIndex: i };
  }
  return { keyCol: 1, valCol: 2, headerRowIndex: 0 };
}

/** D-61.A: ตาข่ายธงสุขภาพ default (v3) — ชีตไม่ตั้ง `คำ_ธงสุขภาพ` = ใช้ชุดนี้ (รวมคำจาก คำ_notify เดิม + spec A6) · ตั้ง key ว่าง = ปิดโดยเจตนา */
export const DEFAULT_HEALTH_FLAG_KEYWORDS = [
  "แพ้", "ภูมิแพ้", "แพ้กุ้ง", "แพ้อาหารทะเล", "แพ้ปลา", "กลูเตน",
  "ท้อง", "ตั้งครรภ์", "ให้นม", "เบาหวาน", "ความดัน", "โรคไต", "ผู้ป่วย", "กินยา", "ทานยา",
];

/** แปลงค่า list คั่น , — undefined = ไม่มี key (คืน undefined ให้ default ทำงาน) · "" = key ว่าง (ปิดโดยเจตนา → []) */
function splitList(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return v.split(",").map((s) => cleanCell(s)).filter(Boolean);
}

/**
 * D-69 · ค่าเริ่มต้นของการเรียก Gemini — 🔴 ห้ามเปลี่ยนโมเดลเริ่มต้นในคอมมิตนี้ (เจ้าของจะสลับเองจากชีตแล้ววัด)
 * ชีตไม่มีแถว = ใช้ค่าพวกนี้ → พฤติกรรมเดิม 100%
 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
export const DEFAULT_THINKING_LEVEL = "low";
/**
 * D-69 · ข้อความตอนระบบช้า (แทนของเดิมที่บอกว่า "ยังไม่ได้รับข้อความ ช่วยพิมพ์อีกครั้ง")
 * 🔴 ของเดิมมี 3 ปัญหา: (1) ไม่จริง — ระบบได้รับแล้วแต่ตอบไม่ทัน (2) สั่งให้พิมพ์ซ้ำ = บทยาวขึ้น → ช้าลงอีก
 *    (วงจรที่ทำให้อาการแย่ลงเอง) (3) สัญญาว่าจะกลับมาตอบ ทั้งที่ระบบไม่มี retry
 * ตัวนี้: ไม่โกหก · ไม่สัญญา · ไม่สั่งพิมพ์ซ้ำ · ชวนคุยต่อ (เทิร์นใหม่ = ได้ลองใหม่)
 */
export const DEFAULT_SLOW_SYSTEM_MESSAGE =
  "ขออภัยค่ะ ตอนนี้ระบบตอบช้ากว่าปกตินิดนึงนะคะ {ชื่อบอท}แจ้งทีมแอดมินให้แล้วค่ะ ลูกค้าพิมพ์คุยต่อได้เลยนะคะ";

let cachedConfig: AppConfig | null = null;
let cachedAt = 0;
const CONFIG_MEMO_MS = 5_000;

/** เฉพาะเทส — ล้าง memo ของ getConfig (config-parse unit test อ่านใหม่ทุกครั้ง) */
export function __resetConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

// 🔴 D-68: ลบ parseNotifyDoors + คีย์ `คำ_notify`/`คำ_notify_<door>` — ประตู handoff_notify เป็นของ v2 (ถอดแล้ว)
//    v3 ใช้ ธงสุขภาพ (`คำ_ธงสุขภาพ`) + assurance guard แทน

export async function getConfig(): Promise<AppConfig> {
  const now = Date.now();
  // 🔴 D-61.C: ห้องซ้อมอาจชี้ชีตคนละ schema (sandbox override) → ห้ามใช้/เขียน memo ร่วมกับ prod
  //    (กัน config v3 จากเทิร์นซ้อมรั่วไปให้ลูกค้าจริงเห็น 5 วินาที) — pattern เดียวกับ loader cache
  const inSandbox = Boolean(getTrainSandbox());
  if (!inSandbox && cachedConfig && now - cachedAt < CONFIG_MEMO_MS) {
    return cachedConfig;
  }

  const lib = await loadBotLibrary();
  const rows = lib?.Config ?? null;
  const raw = new Map<string, string>();
  let loadFailed = false;
  let promptVisibleKeys: Set<string> | null = null; // D-61.B: null = ชีตไม่มีคอลัมน์ "เข้า prompt" (v2) → ดัมพ์หมดเหมือนเดิม

  if (rows && rows.length > 0) {
    const { keyCol, valCol, headerRowIndex } = findKeyValueCols(rows);
    // D-61.B (B5 · header-driven ไม่ผูกโหมด): มีคอลัมน์ "เข้า prompt" → เก็บเฉพาะ key ที่ติ๊ก
    const promptColIdx = (rows[headerRowIndex] ?? []).findIndex((c) => cleanCell(c).toLowerCase().includes("เข้า prompt"));
    if (promptColIdx >= 0) promptVisibleKeys = new Set();
    const PROMPT_TICK = new Set(["ใช่", "true", "yes", "1", "✓", "เปิด", "y"]);
    for (let i = 0; i < rows.length; i++) {
      if (i === headerRowIndex) continue; // ข้ามแถวหัวตาราง
      const row = rows[i];
      // stripKeyAnnotation ตัดวงเล็บกำกับท้ายคีย์ · cleanCell กันอักขระล่องหนทั้งคีย์และค่า
      const key = stripKeyAnnotation(cleanCell(row[keyCol]));
      const value = cleanCell(row[valCol]);
      if (!key) continue;
      const keyLower = key.toLowerCase();
      if (keyLower === "key" || keyLower === "ค่า") continue; // กันแถว header ซ้ำ/เผื่อ detect ไม่เจอ
      raw.set(key, value);
      if (promptVisibleKeys && promptColIdx >= 0 && PROMPT_TICK.has(cleanCell(row[promptColIdx]).toLowerCase())) {
        promptVisibleKeys.add(key);
      }
    }
  } else {
    loadFailed = true;
    console.warn(JSON.stringify({ scope: "config", warning: "Config โหลดไม่ได้ (SHEET_BOTLIB_ID?) ใช้ค่า default" }));
  }

  // lookup แบบรับหลายชื่อ (alias) กันชื่อคีย์ในชีตเพี้ยนจากที่โค้ดคาด (เช่น มี/ไม่มี suffix หน่วย)
  const pick = (...candidates: string[]): string | undefined => {
    for (const c of candidates) {
      const v = raw.get(c);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  // เผื่อคีย์เชิงตัวเลขที่หา alias ตรง ๆ ไม่เจอ ให้ค้นด้วย prefix (เช่น "debounce")
  const pickByPrefix = (prefix: string): string | undefined => {
    for (const [k, v] of raw.entries()) {
      if (k.toLowerCase().startsWith(prefix.toLowerCase())) return v;
    }
    return undefined;
  };
  const numOf = (fallback: number, ...candidates: string[]): number => {
    const v = pick(...candidates);
    if (v === undefined) return fallback;
    const n = Number(cleanCell(v));
    return Number.isFinite(n) ? n : fallback;
  };
  const boolOf = (fallback: boolean, ...candidates: string[]): boolean => parseSwitch(pick(...candidates), fallback);
  const strOf = (fallback: string, ...candidates: string[]): string => {
    const v = pick(...candidates);
    return v && v !== "" ? v : fallback;
  };

  const rawSwitches = {
    tagging: boolOf(true, "เปิด_ติดแท็ก"),
    handoff: boolOf(false, "เปิด_ส่งต่อแอดมิน"),
    orders: boolOf(false, "เปิด_ระบบออเดอร์"),
    follow: boolOf(false, "เปิด_ระบบติดตาม"),
    flexCards: boolOf(false, "เปิด_การ์ด_flex", "เปิด_การ์ด flex", "เปิด_flex"),
    timing: boolOf(true, "เปิด_จังหวะหน่วงเหมือนคน", "เปิด_จังหวะหน่วง"),
  };

  // ชื่อจริงในชีตคือ "debounce_รวบคำถาม" · เผื่อสะกดเพี้ยนใช้ prefix "debounce" สำรอง
  const debounceRaw = pick("debounce_รวบคำถาม", "debounce_รวมคำถาม") ?? pickByPrefix("debounce");
  const debounceSec = (() => {
    const n = Number(cleanCell(debounceRaw));
    return Number.isFinite(n) && n > 0 ? n : 6;
  })();

  const config: AppConfig = {
    botName: strOf("ปลาทู", "ชื่อบอท"),
    shopName: strOf("สากบิน", "ชื่อร้าน/แบรนด์", "ชื่อร้าน"),
    personaGender: strOf("หญิง", "เพศบอท"),
    useEmoji: boolOf(false, "ใช้ emoji", "ใช้_emoji", "emoji"),
    temperature: numOf(0.2, "temperature"), // 🔴 D-44: บทบาท "จำแนกและสกัด" ต้องนิ่ง (เดิม 1.0 = นักขายสร้างสรรค์) · ชีต Config ตั้งทับได้
    // 🔴 พื้น 4096 — gemini-3.x นับ thinking+output รวมกันในเพดานนี้
    // ของจริงเคยชน 2032/2048 ตอนเทิร์นสรุปออเดอร์ (เทิร์นปิดการขาย = เทิร์นที่แพงที่สุด)
    // → finishReason=MAX_TOKENS → fallback → ลูกค้าเห็น "ปลาทูขัดข้อง" ตอนกำลังจะจ่ายเงิน
    // ชีตตั้ง 2048 ไว้ ซึ่งไม่พอจริง → โค้ดบังคับพื้นให้ (pattern เดียวกับที่เคยยกจาก 1024→2048)
    maxOutputTokens: Math.max(4096, numOf(4096, "maxOutputTokens", "max_output_tokens")),
    // ---- D-69: การเรียก Gemini ตั้งจากชีตได้ (เจ้าของปรับเองแล้ววัดผล ไม่ต้องสั่ง CC) ----
    // 🔴 ไม่มีแถวไหนเลย = ทำงานต่อด้วยค่าเดิมทุกตัว (default ปลอดภัย · ห้ามพัง/ห้ามปิดฟีเจอร์)
    geminiModel: strOf(DEFAULT_GEMINI_MODEL, "โมเดล", "model", "gemini_model"),
    thinkingLevelRaw: strOf(DEFAULT_THINKING_LEVEL, "ระดับการคิด", "thinking", "thinking_level"),
    // 8 → 15 วิ (D-69: บทยาว 274 tokens เคยใช้ 10.7 วิ → degraded ทั้งที่โมเดลตอบได้)
    geminiTimeoutMs: Math.max(1, numOf(15, "timeout_วินาที", "timeout_วิ", "gemini_timeout")) * 1000,
    slowSystemMessage: strOf(DEFAULT_SLOW_SYSTEM_MESSAGE, "ข้อความ_ระบบช้า", "ข้อความ_ตอบช้า"),
    showTyping: boolOf(true, "แสดง_typing", "typing"),
    debounceWaitMs: debounceSec * 1000,
    delayBetweenBubblesMs: numOf(1, "หน่วง_ระหว่างบอลลูน", "หน่วง_ระหว่างข้อความ") * 1000,
    slipUrlExpiryDays: numOf(7, "อายุลิงก์สลิป_วัน", "อายุลิงก์สลิป"),
    orderCutoffTime: strOf("12:00", "เวลาตัดรอบออเดอร์", "เวลารอบตัดออเดอร์"),
    // 🔴 D-64: ลบ orderNumberResetDaily — เลขออเดอร์ย้ายไป Apps Script (คีย์ `เลขออเดอร์_รีเซ็ตทุกวัน` ในชีตถูกเมิน)
    handoffKeywords: (pick("คำ_handoff", "คำ_ส่งต่อแอดมิน", "keyword_handoff") ?? "")
      .split(",")
      .map((s) => cleanCell(s))
      .filter(Boolean),
    // D-61.A (v3) — ชื่อเดียว ไม่มี alias (กติกา B1) · default = ตาข่ายคำสุขภาพ (DEFAULT_HEALTH_FLAG_KEYWORDS)
    healthFlagKeywords: splitList(raw.get("คำ_ธงสุขภาพ")) ?? [...DEFAULT_HEALTH_FLAG_KEYWORDS],
    assuranceBannedPhrases: splitList(raw.get("คำรับรอง_ต้องห้าม")) ?? [...DEFAULT_ASSURANCE_PHRASES],
    notifyAdminHealthTemplate: strOf("ถามเรื่องสุขภาพ/แพ้อาหาร — บอทให้ข้อมูลตามข้อเท็จจริงแล้ว ยังคุยต่อ (ไม่ได้ปิดบอท) รบกวนช่วยดูให้ด้วยค่ะ", "ข้อความ_แจ้งแอดมิน_notify"),
    // 🔴 D-73c: default ในโค้ด — ห้ามมีคำว่า "รบกวน" (กฎเหล็ก D-61) · ต้องบอกชัดว่า "ยังไม่ต้องเข้ามา"
    notifyAdminIntakeTemplate: strOf(
      "บอทกำลังเก็บข้อมูลให้อยู่ ยังไม่ต้องเข้ามาค่ะ — ถ้าเก็บครบหรือชนเพดานเทิร์น จะแจ้งอีกครั้งพร้อม 📋 สรุปข้อมูลค่ะ",
      "ข้อความ_แจ้งแอดมิน_เก็บข้อมูล",
    ),
    notifyAdminOrderEditTemplate: strOf("แก้ในชีตแล้ว — ช่วยเช็คความถูกต้องของแถวนี้ด้วยค่ะ", "ข้อความ_แจ้งแอดมิน_แก้ออเดอร์"),
    // 🔴 D-77: พยานชั้น 2 ของการยกเลิก — tag จาก AI อย่างเดียวไม่พอ ต้องมีคำจริงในข้อความลูกค้าประกบ
    orderCancelKeywords: splitList(raw.get("คำ_ยกเลิกออเดอร์")) ?? ["ยกเลิก", "ไม่เอาแล้ว", "ไม่สั่งแล้ว", "ขอเลิก"],
    promptVisibleKeys, // D-61.B
    adminSilenceReturnMinutes: numOf(45, "คืนสิทธิ์บอท_หลังแชทเงียบ", "คืนสิทธิ์บอท_หลังแชทเงียบ_นาที"),
    botResumeMessage: strOf("ปลาทูมาดูแลต่อเองนะคะ", "ประโยคเปลี่ยนมือ_บอทรับต่อ"),
    testCommandsEnabled: boolOf(true, "เปิด_คำสั่งเทสต์", "เปิด_คำสั่งเทส"),
    // 🔴 D-61.C6: v3 ปิดโหมดประหยัดโควตา "โดยเจตนา" ที่ระดับโหมด (เจ้าของเคาะ)
    //   เหตุผล: จังหวะบอลลูนคือดีไซน์ CX (ทักทาย/เนื้อ/รูป/คำถามปิดเดี่ยว) + ห้องซ้อมต้องเหมือนของจริง 100%
    //   ยุบบอลลูน = คำถามปิดหายจาก noti มือถือ (เหตุผลระดับ conversion) และ splitter C6 ถูกลบล้าง
    //   🔴 v2 (prod ปัจจุบัน) อ่านค่าจากชีตเหมือนเดิมทุกบรรทัด — ห้ามเปลี่ยนพฤติกรรม
    //   ถ้าอนาคตต้นทุน push สูงจริง → เปิดเป็น scope เฉพาะ push (ว่าที่ D-63) ไม่ใช่ยุบทั้งเทิร์น
    // 🔴 D-68: ปิดถาวร — จังหวะบอลลูนคือดีไซน์ CX (D-61.C6) · คีย์ `โหมดประหยัดโควตา` ถูกลบจากโค้ด+ชีต
    //    ถ้าโควตา LINE เป็นปัญหาจริง → เปิด D-63 (scope เฉพาะ push ไม่ใช่กลับไปยุบทั้งเทิร์น)
    quotaSaver: false,
    rawSwitches,
    raw,
    loadFailed,
  };

  if (!inSandbox) {
    // sandbox ไม่เขียน memo (กัน config ของชีตซ้อมรั่วไป prod · D-61.C)
    cachedConfig = config;
    cachedAt = now;
  }
  return config;
}

export function formatConfigForPrompt(config: AppConfig): string {
  const lines: string[] = [];
  for (const [key, value] of config.raw.entries()) {
    // D-61.B (B5): ชีตมีคอลัมน์ "เข้า prompt" → เฉพาะแถวที่ติ๊กถึงเข้า prompt ขาย · ไม่มีคอลัมน์ (v2) = ดัมพ์หมดเหมือนเดิม
    if (config.promptVisibleKeys && !config.promptVisibleKeys.has(key)) continue;
    lines.push(`${key}: ${value}`);
  }
  if (lines.length === 0) {
    return `ชื่อบอท: ${config.botName}\nชื่อร้าน: ${config.shopName}`;
  }
  return lines.join("\n");
}

/**
 * เช็คสวิตช์แบบ all-or-nothing: ต้อง (1) สวิตช์ในชีตเปิด และ (2) env ที่ต้องใช้ครบ
 * ขาดข้อใดข้อหนึ่ง = ปิดฟีเจอร์ทั้งดุ้น + log เตือน (ไม่ throw ไม่ crash)
 */
export function resolveFeatureSwitches(config: AppConfig): FeatureSwitches {
  // 🔴 Step 1: อ่านทุกแท็บ (Step/FAQ/Config) จาก BotLibrary ตัวเดียว → เช็ค SHEET_BOTLIB_ID
  // (เดิมเช็ค SHEET_STEP_URL + FAQ + CONFIG · ต้องเปลี่ยนพร้อม getConfig ในคอมมิตเดียว
  //  ไม่งั้น deploy กลางคัน salesCore=false บอทตายทั้งตัว)
  const salesCore = Boolean(process.env.SHEET_BOTLIB_ID);
  if (!salesCore) {
    warnDisabled("salesCore", "ต้องมี SHEET_BOTLIB_ID (BotLibrary spreadsheet)");
  }

  const memory = Boolean(process.env.DATABASE_URL);
  if (!memory) {
    warnDisabled("memory", "ต้องมี DATABASE_URL");
  }

  const tagging = config.rawSwitches.tagging && memory;
  if (config.rawSwitches.tagging && !memory) {
    warnDisabled("tagging", "สวิตช์เปิดแต่ไม่มี memory (DATABASE_URL)");
  }

  const handoff = config.rawSwitches.handoff && Boolean(process.env.ADMIN_GROUP_ID) && memory;
  if (config.rawSwitches.handoff && !handoff) {
    warnDisabled("handoff", "ต้องมี ADMIN_GROUP_ID + memory (DATABASE_URL)");
  }

  const humanLikeTiming = config.rawSwitches.timing && memory;
  if (config.rawSwitches.timing && !memory) {
    warnDisabled("humanLikeTiming", "ต้องมี memory (DATABASE_URL) สำหรับ pending_messages — จะ fallback เป็นตอบทันทีไม่หน่วง");
  }

  const ordersReady = Boolean(
    process.env.ORDER_GROUP_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT &&
      process.env.SHEET_ORDERS_ID &&
      process.env.BLOB_SLIPS_TOKEN &&
      memory,
  );
  const orders = config.rawSwitches.orders && ordersReady;
  if (config.rawSwitches.orders && !ordersReady) {
    warnDisabled("orders", "ต้องมี ORDER_GROUP_ID + GOOGLE_SERVICE_ACCOUNT + SHEET_ORDERS_ID + BLOB_SLIPS_TOKEN + memory ครบทุกตัว");
  }

  const followReady = Boolean(process.env.SHEET_BOTLIB_ID && memory); // Follow อยู่ใน BotLibrary แล้ว
  const follow = config.rawSwitches.follow && followReady;
  if (config.rawSwitches.follow && !followReady) {
    warnDisabled("follow", "ต้องมี SHEET_BOTLIB_ID + memory (DATABASE_URL)");
  }

  const flexCards = config.rawSwitches.flexCards;

  return { salesCore, memory, tagging, handoff, humanLikeTiming, orders, follow, flexCards };
}

function warnDisabled(feature: string, reason: string): void {
  console.warn(JSON.stringify({ scope: "feature-switch", feature, status: "disabled", reason }));
}
