import { getConfigCsv, parseCsvRows } from "./sheets";

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
  useEmoji: boolean;
  temperature: number;
  maxOutputTokens: number;
  showTyping: boolean;
  debounceWaitMs: number;
  delayBetweenBubblesMs: number;
  slipUrlExpiryDays: number;
  orderCutoffTime: string;
  orderNumberResetDaily: boolean;
  handoffKeywords: string[];
  adminSilenceReturnDays: number;
  releaseKeyword: string;
  /** เปิด_คำสั่งเทสต์ — คุม /reset ฯลฯ · default เปิด ปิดตอนขายจริง */
  testCommandsEnabled: boolean;
  /** สวิตช์ดิบจากชีต (ก่อนเช็ค all-or-nothing กับ env) */
  rawSwitches: {
    tagging: boolean;
    handoff: boolean;
    orders: boolean;
    follow: boolean;
    flexCards: boolean;
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

function toNumber(value: string | undefined, fallback: number): number {
  const cleaned = cleanCell(value);
  if (cleaned === "") return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

let cachedConfig: AppConfig | null = null;
let cachedAt = 0;
const CONFIG_MEMO_MS = 5_000;

export async function getConfig(): Promise<AppConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CONFIG_MEMO_MS) {
    return cachedConfig;
  }

  const csv = await getConfigCsv();
  const raw = new Map<string, string>();
  let loadFailed = false;

  if (csv) {
    const rows = parseCsvRows(csv);
    for (const row of rows) {
      // cleanCell ทั้ง key และ value กันอักขระล่องหนทำให้ lookup พลาด
      const key = cleanCell(row[0]);
      const value = cleanCell(row[1]);
      if (!key || key.toLowerCase() === "key") continue;
      raw.set(key, value);
    }
  } else {
    loadFailed = true;
    console.warn(JSON.stringify({ scope: "config", warning: "SHEET_CONFIG_URL missing or fetch failed, using defaults" }));
  }

  const rawSwitches = {
    tagging: parseSwitch(raw.get("เปิด_ติดแท็ก"), true),
    handoff: parseSwitch(raw.get("เปิด_ส่งต่อแอดมิน"), false),
    orders: parseSwitch(raw.get("เปิด_ระบบออเดอร์"), false),
    follow: parseSwitch(raw.get("เปิด_ระบบติดตาม"), false),
    flexCards: parseSwitch(raw.get("เปิด_การ์ด_flex"), false),
  };

  const config: AppConfig = {
    botName: raw.get("ชื่อบอท") || "ปลาทู",
    shopName: raw.get("ชื่อร้าน") || "สากบิน",
    useEmoji: parseSwitch(raw.get("ใช้_emoji"), false),
    temperature: toNumber(raw.get("temperature"), 1.0),
    maxOutputTokens: Math.max(1024, toNumber(raw.get("maxOutputTokens"), 1024)),
    showTyping: parseSwitch(raw.get("แสดง_typing"), true),
    debounceWaitMs: toNumber(raw.get("debounce_รอรวมคำถาม_วิ"), 8) * 1000,
    delayBetweenBubblesMs: toNumber(raw.get("หน่วง_ระหว่างข้อความ_วิ"), 1) * 1000,
    slipUrlExpiryDays: toNumber(raw.get("อายุลิงก์สลิป_วัน"), 7),
    orderCutoffTime: raw.get("เวลารอบตัดออเดอร์") || "12:00",
    orderNumberResetDaily: parseSwitch(raw.get("เลขออเดอร์_รีเซ็ตทุกวัน"), true),
    handoffKeywords: (raw.get("คำ_handoff") || "")
      .split(",")
      .map((s) => cleanCell(s))
      .filter(Boolean),
    adminSilenceReturnDays: toNumber(raw.get("คืนสิทธิ์แอดมิน_หลังเขียน_วัน"), 1),
    releaseKeyword: raw.get("คำคืนสิทธิ์บอท_จากแอดมิน") || "คืนบอท",
    testCommandsEnabled: parseSwitch(raw.get("เปิด_คำสั่งเทสต์"), true),
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
  const salesCore = Boolean(process.env.SHEET_STEP_URL && process.env.SHEET_FAQ_URL && process.env.SHEET_CONFIG_URL);
  if (!salesCore) {
    warnDisabled("salesCore", "ต้องมี SHEET_STEP_URL + SHEET_FAQ_URL + SHEET_CONFIG_URL ครบ");
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

  const humanLikeTiming = memory;
  if (!humanLikeTiming) {
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

  const followReady = Boolean(process.env.SHEET_FOLLOW_URL && memory);
  const follow = config.rawSwitches.follow && followReady;
  if (config.rawSwitches.follow && !followReady) {
    warnDisabled("follow", "ต้องมี SHEET_FOLLOW_URL + memory (DATABASE_URL)");
  }

  const flexCards = config.rawSwitches.flexCards;

  return { salesCore, memory, tagging, handoff, humanLikeTiming, orders, follow, flexCards };
}

function warnDisabled(feature: string, reason: string): void {
  console.warn(JSON.stringify({ scope: "feature-switch", feature, status: "disabled", reason }));
}
