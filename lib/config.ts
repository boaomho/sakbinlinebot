import { loadBotLibrary } from "./sheets/loader";
// หมายเหตุ: cleanCell/stripKeyAnnotation ยังเป็น copy ในไฟล์นี้ (regex อักขระล่องหนแก้ยาก)
// ตัวกลางอยู่ lib/sheets/clean.ts แล้ว — ตรงกัน 100% · ถ้าแก้ regex ต้องแก้ทั้ง 2 ที่

export const DEFAULT_REPLY =
  "ขออภัยค่ะ ตอนนี้ปลาทูขัดข้องนิดหน่อย รอสักครู่แล้วลองทักมาใหม่นะคะ 🙏";

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
  showTyping: boolean;
  debounceWaitMs: number;
  /** หน่วง_ระหว่างบอลลูน — อ่านไว้แต่ปัจจุบันยังส่งบอลลูนใน reply เดียว (ยังไม่ได้ใช้หน่วงจริง) */
  delayBetweenBubblesMs: number;
  slipUrlExpiryDays: number;
  orderCutoffTime: string;
  orderNumberResetDaily: boolean;
  handoffKeywords: string[];
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

let cachedConfig: AppConfig | null = null;
let cachedAt = 0;
const CONFIG_MEMO_MS = 5_000;

/** เฉพาะเทส — ล้าง memo ของ getConfig (config-parse unit test อ่านใหม่ทุกครั้ง) */
export function __resetConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

export async function getConfig(): Promise<AppConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CONFIG_MEMO_MS) {
    return cachedConfig;
  }

  const lib = await loadBotLibrary();
  const rows = lib?.CSV_Config ?? null;
  const raw = new Map<string, string>();
  let loadFailed = false;

  if (rows && rows.length > 0) {
    const { keyCol, valCol, headerRowIndex } = findKeyValueCols(rows);
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
    }
  } else {
    loadFailed = true;
    console.warn(JSON.stringify({ scope: "config", warning: "CSV_Config โหลดไม่ได้ (SHEET_BOTLIB_ID?) ใช้ค่า default" }));
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
    temperature: numOf(0.2, "temperature"), // 🔴 D-44: บทบาท "จำแนกและสกัด" ต้องนิ่ง (เดิม 1.0 = นักขายสร้างสรรค์) · ชีต CSV_Config ตั้งทับได้
    // 🔴 พื้น 4096 — gemini-3.x นับ thinking+output รวมกันในเพดานนี้
    // ของจริงเคยชน 2032/2048 ตอนเทิร์นสรุปออเดอร์ (เทิร์นปิดการขาย = เทิร์นที่แพงที่สุด)
    // → finishReason=MAX_TOKENS → fallback → ลูกค้าเห็น "ปลาทูขัดข้อง" ตอนกำลังจะจ่ายเงิน
    // ชีตตั้ง 2048 ไว้ ซึ่งไม่พอจริง → โค้ดบังคับพื้นให้ (pattern เดียวกับที่เคยยกจาก 1024→2048)
    maxOutputTokens: Math.max(4096, numOf(4096, "maxOutputTokens", "max_output_tokens")),
    showTyping: boolOf(true, "แสดง_typing", "typing"),
    debounceWaitMs: debounceSec * 1000,
    delayBetweenBubblesMs: numOf(1, "หน่วง_ระหว่างบอลลูน", "หน่วง_ระหว่างข้อความ") * 1000,
    slipUrlExpiryDays: numOf(7, "อายุลิงก์สลิป_วัน", "อายุลิงก์สลิป"),
    orderCutoffTime: strOf("12:00", "เวลาตัดรอบออเดอร์", "เวลารอบตัดออเดอร์"),
    orderNumberResetDaily: boolOf(true, "เลขออเดอร์_รีเซ็ตทุกวัน", "เลขออเดอร์รีเซ็ตทุกวัน"),
    handoffKeywords: (pick("คำ_handoff", "คำ_ส่งต่อแอดมิน", "keyword_handoff") ?? "")
      .split(",")
      .map((s) => cleanCell(s))
      .filter(Boolean),
    adminSilenceReturnMinutes: numOf(45, "คืนสิทธิ์บอท_หลังแชทเงียบ", "คืนสิทธิ์บอท_หลังแชทเงียบ_นาที"),
    botResumeMessage: strOf("ปลาทูมาดูแลต่อเองนะคะ", "ประโยคเปลี่ยนมือ_บอทรับต่อ"),
    testCommandsEnabled: boolOf(true, "เปิด_คำสั่งเทสต์", "เปิด_คำสั่งเทส"),
    quotaSaver: boolOf(true, "โหมดประหยัดโควตา"),
    rawSwitches,
    raw,
    loadFailed,
  };

  cachedConfig = config;
  cachedAt = now;
  return config;
}

export function formatConfigForPrompt(config: AppConfig): string {
  const lines: string[] = [];
  for (const [key, value] of config.raw.entries()) {
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

  const followReady = Boolean(process.env.SHEET_BOTLIB_ID && memory); // CSV_Follow อยู่ใน BotLibrary แล้ว
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
