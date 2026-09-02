import { GoogleGenAI, ThinkingLevel, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { buildSalesSystemV3, buildUserContent } from "@/prompt/system-v3";
import { AppConfig, defaultReply, DEFAULT_GEMINI_MODEL } from "./config";
import { recordAiUsage, AiCallKind } from "./db";
import { AiOrderItem } from "./core/pricing";

/**
 * order_data ที่ AI ส่งกลับ (D-20) — 3 ช่องผู้รับ + items:[{qty}] (AI ส่งแค่ qty · โค้ดใส่ sku เอง)
 * 🔴 ไม่มี ยอด/สินค้า/sku — โค้ดคิดเงิน+แมป sku ให้ (ลดภาระ AI = thinking ไม่วน)
 * ทุกช่อง optional · ลูกค้ายังไม่ให้ = ไม่ต้องส่ง (ห้ามเดา placeholder)
 */
export interface OrderDataFromAI {
  ชื่อ?: string;
  ที่อยู่?: string;
  เบอร์?: string;
  items?: AiOrderItem[];
}

/** @deprecated D-69: ใช้ `config.geminiModel` (ตั้งจากชีตได้) — D-75: ผู้ช่วยเทรนย้ายไป config แล้ว · เหลือเฉพาะจุดที่ยังไม่มี config จริง */
export const MODEL = DEFAULT_GEMINI_MODEL;

/**
 * D-69 · เลือกพารามิเตอร์ "ระดับการคิด" ให้ถูกตระกูลโมเดล — pure (เทสได้)
 * 🔴 Gemini 3.x ใช้ `thinkingLevel` (enum) · 2.x ใช้ `thinkingBudget` (int) — **ส่งผิดตัว/ส่งทั้งคู่ = HTTP 400**
 * ค่าในชีตใช้กับตระกูลนั้นไม่ได้ → log เตือน + ใช้ default ของตระกูล (ห้ามยิงจนพัง)
 */
export function resolveThinkingConfig(model: string, raw: string): { thinkingLevel?: ThinkingLevel; thinkingBudget?: number } {
  const m = (model ?? "").trim().toLowerCase();
  const v = (raw ?? "").trim().toLowerCase();
  const isV2 = m.startsWith("gemini-2");
  const warn = (reason: string, used: string) =>
    console.warn(JSON.stringify({ scope: "gemini-config", event: "thinking-invalid", model, raw, reason, usedDefault: used }));

  if (isV2) {
    // ตระกูล 2.x — ต้องเป็นตัวเลข (0 = ปิด · -1 = อัตโนมัติ)
    const n = Number(v);
    if (v !== "" && Number.isFinite(n)) return { thinkingBudget: n };
    warn("gemini-2.x รับ thinkingBudget (ตัวเลข) เท่านั้น", "thinkingBudget=-1 (อัตโนมัติ)");
    return { thinkingBudget: -1 };
  }
  // ตระกูล 3.x (และรุ่นใหม่กว่า) — enum
  const levels: Record<string, ThinkingLevel> = {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  };
  const hit = levels[v];
  if (hit) return { thinkingLevel: hit };
  warn("gemini-3.x รับ enum minimal/low/medium/high เท่านั้น (ตัวเลขใช้ไม่ได้)", "thinkingLevel=LOW");
  return { thinkingLevel: ThinkingLevel.LOW };
}

/**
 * D-69 · งบเวลาต่อเทิร์น — timeout ตั้งจากชีตได้ (`timeout_วินาที`) แต่ต้องอยู่ในเพดาน Vercel
 * 🔴 การ์ด: debounce + คอลหลัก + regen ≤ maxDuration − HEADROOM
 *    เผื่อ HEADROOM ไว้ให้ sheet load / Neon / LINE API ที่กินเวลาด้วย (ไม่ใช่แค่ Gemini)
 * regen (assurance guard) ได้ครึ่งหนึ่งของคอลหลัก — เป็นทางรองและมี fallback ตัดบรรทัดอยู่แล้ว
 */
const TIMEOUT_HEADROOM_MS = 6_000;

export interface GeminiTimeouts {
  mainMs: number;
  regenMs: number;
  clamped: boolean;
}

/** pure: คำนวณ timeout จริงที่ใช้ + clamp ถ้าเกินงบ (เทสได้ · ไม่ต้องยิง Gemini) */
export function resolveGeminiTimeouts(requestedMainMs: number, debounceMs: number, maxDurationMs: number): GeminiTimeouts {
  const budget = maxDurationMs - TIMEOUT_HEADROOM_MS - debounceMs;
  const wanted = Math.max(1_000, requestedMainMs);
  // main + regen(ครึ่งหนึ่ง) = wanted * 1.5 ต้องอยู่ในงบ
  if (wanted * 1.5 <= budget) return { mainMs: wanted, regenMs: Math.round(wanted / 2), clamped: false };
  const fitted = Math.max(1_000, Math.floor(budget / 1.5));
  console.warn(JSON.stringify({
    scope: "gemini-config", event: "timeout-clamped",
    requestedSec: Math.round(requestedMainMs / 1000), usedSec: Math.round(fitted / 1000),
    debounceSec: Math.round(debounceMs / 1000), maxDurationSec: Math.round(maxDurationMs / 1000),
    reason: "debounce + main + regen เกินเพดาน maxDuration (เผื่อ headroom 6 วิ)",
  }));
  return { mainMs: fitted, regenMs: Math.round(fitted / 2), clamped: true };
}

/**
 * D-69 · ราคาต่อ 1M tokens (USD · text/image/video) — 🔴 **ตัวเลขประมาณเท่านั้น สำหรับดูแนวโน้ม/เทียบรุ่น**
 * ตัวเลขที่ใช้ตัดสินใจจริง = cost log รายวันของ Google ต่อ API key (เจ้าของมีอยู่แล้ว · D-70 ใช้เป็นตัวหลัก)
 *
 * 📅 **อ้างอิง ai.google.dev/gemini-api/docs/pricing · ดึงเมื่อ 2026-08-28**
 *
 * ⏳ **วันหมดอายุ/วันขึ้นราคาต่อรุ่น** (คอลัมน์ `note` ในตาราง):
 *   · `gemini-3.6-flash` / `gemini-3.7-flash` — ราคาโปร **ถึง 31 ธ.ค. 2026** แล้วขึ้นเป็น 2 เท่า (in 1.50 / out 7.50)
 *   · `gemini-3.1-flash-lite` / `gemini-3.5-flash-lite` — ราคามาตรฐาน ยังไม่มีกำหนดเปลี่ยน
 *   · 🔴 `gemini-2.5-flash` / `gemini-2.5-pro` — **ปิด 16 ต.ค. 2026** (ตาราง deprecation ของ Gemini API)
 *     เส้นทางที่ Google แนะนำ = **3.6 Flash**
 *   · 🔴 `gemini-2.5-flash-lite` — **วันปิดไม่แน่นอน** (ไม่ใช่ "ไม่มีวันปิด"):
 *     หน้า deprecation ของ Gemini API ขึ้นว่า "ยังไม่ประกาศ" แต่ฝั่ง Vertex/Agent Platform ระบุ **20 ต.ค. 2026**
 *     → เอกสารสองที่ยังไม่ตรงกัน · ปฏิบัติเหมือนจะปิดพร้อมพี่น้องมัน
 *   · ⚠️ Google ระบุว่าวันเหล่านี้คือ **"วันที่เร็วที่สุดที่อาจถูกปิด"** และจะแจ้งล่วงหน้า **อย่างน้อย 6 เดือน**
 *     เมื่อกำหนดวันจริง → **อาจเลื่อนออกไป แต่ให้วางแผนที่ 16 ต.ค. 2026 อย่ารอ**
 *
 * 🔴 **ตารางนี้ต้องรีวิวอย่างน้อย 2 ครั้ง:**
 *   1) **ก่อน 16 ต.ค. 2026** — วันปิด `gemini-2.5-*` (เช็คว่าเลื่อนไหม · ลบแถว deprecated ถ้าปิดจริง)
 *   2) **ก่อน 31 ธ.ค. 2026** — ราคาโปร 3.6/3.7 หมด → in $1.50 / out $7.50 (**ต้นทุนเด้งเท่าตัว** ประเมินใหม่ทั้งชุด)
 *
 * `gemini-2.5-*` คงราคาไว้ในตารางเพื่อความครบเท่านั้น (เผื่ออ่าน log เก่าย้อนหลัง) · ตั้งในชีตแล้วจะโดน log เตือน
 * 🔴 โมเดลที่ไม่อยู่ในตาราง = ไม่เดาราคา (log ว่าไม่ทราบ)
 */
const PRICE_PER_1M_USD: Record<string, { in: number; out: number; cached: number; note?: string }> = {
  // ---- ใช้งานได้ (เรียงจากแพงไปถูก) ----
  "gemini-3.5-flash": { in: 1.5, out: 9.0, cached: 0.15, note: "baseline ปัจจุบัน · แพงสุดในกลุ่ม flash" },
  "gemini-3.6-flash": { in: 0.75, out: 3.75, cached: 0.075, note: "ราคาโปรถึง 2026-12-31 แล้วขึ้น 2 เท่า" },
  "gemini-3.7-flash": { in: 0.75, out: 3.75, cached: 0.075, note: "ราคาโปรถึง 2026-12-31 แล้วขึ้น 2 เท่า" },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5, cached: 0.03 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5, cached: 0.025, note: "ถูกสุดที่ใช้ได้" },
  // ---- 🔴 DEPRECATED — ห้ามใช้ (Google ปิด 2026-10-16) · ไว้อ่าน log เก่าเท่านั้น ----
  "gemini-2.5-flash": { in: 0.3, out: 2.5, cached: 0.03, note: "🔴 DEPRECATED ปิด 2026-10-16 (Gemini API) → Google แนะนำย้ายไป 3.6 Flash" },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4, cached: 0.01, note: "🔴 DEPRECATED วันปิดไม่แน่นอน — Gemini API ว่ายังไม่ประกาศ · Vertex ว่า 2026-10-20" },
};

/** 🔴 รุ่นที่ Google จะปิด — ตั้งในชีตแล้วต้องเตือนดัง ๆ (บอทยังทำงานต่อ ไม่พัง) */
const DEPRECATED_MODEL_PREFIXES = ["gemini-2.5", "gemini-2.0", "gemini-1."];

/** เตือนเมื่อชีตตั้งโมเดลที่จะถูกปิด — เรียกครั้งเดียวต่อการเรียก (ไม่ throw) */
function warnIfDeprecatedModel(model: string): void {
  const m = (model ?? "").trim().toLowerCase();
  if (!DEPRECATED_MODEL_PREFIXES.some((p) => m.startsWith(p))) return;
  console.warn(JSON.stringify({
    scope: "gemini-config", event: "model-deprecated", model,
    reason: "Google จะปิดบริการรุ่นนี้ (2.5-flash/pro = 16 ต.ค. 2026 · flash-lite ไม่แน่นอน) — เปลี่ยนคีย์ `โมเดล` ในชีตเป็นรุ่น 3.x (Google แนะนำ 3.6 Flash)",
  }));
}
/** อัตราแลกเปลี่ยนคร่าว ๆ สำหรับอ่านง่าย (ไม่ใช่ตัวเลขบัญชี) */
const USD_TO_THB = 35;

export interface AiCallUsage {
  model: string;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
  latencyMs: number;
  costUsd: number | null;
  costThb: number | null;
}

/**
 * 🔴 D-70: ค่าใช้จ่ายเป็นบาท (ประมาณ) — **แหล่งเดียวกับ log** (หน้าต้นทุนคำนวณซ้ำจาก token ใน ai_usage)
 * null = **ไม่รู้ราคาโมเดลนี้** — ผู้เรียกต้องนับแยก ห้ามตีเป็น 0 ห้ามถัวเฉลี่ย
 */
export function estimateCostThb(model: string, promptTokens: number, outputTokens: number, cachedTokens: number): number | null {
  const usd = estimateCost(model, promptTokens, outputTokens, cachedTokens);
  return usd === null ? null : usd * USD_TO_THB;
}

/** ประเมินค่าใช้จ่ายต่อการเรียก 1 ครั้ง — null = ไม่รู้ราคาโมเดลนี้ (ไม่เดา) */
function estimateCost(model: string, promptTokens: number, outputTokens: number, cachedTokens: number): number | null {
  const price = PRICE_PER_1M_USD[(model ?? "").trim().toLowerCase()];
  if (!price) return null;
  const fresh = Math.max(0, promptTokens - cachedTokens);
  return (fresh * price.in + cachedTokens * price.cached + outputTokens * price.out) / 1_000_000;
}

/**
 * D-69 · สรุป usage ของการเรียก 1 ครั้ง + log + บันทึกลง Neon (fire-and-forget)
 * 🔴 เขียน DB ห้ามบล็อก/ห้ามทำให้บอทเงียบ — พลาดก็แค่ log
 */
/** D-69: prefix user_id → channel (ทะเบียนเดียวกับ REPO-MAP §5) */
function channelOfUserId(userId: string | undefined): string | null {
  if (!userId) return null;
  if (userId.startsWith("fb:")) return "fb";
  if (userId.startsWith("TRAIN:")) return "train";
  return "line";
}

export function reportUsage( // D-75: export ให้ผู้ช่วยเทรนใช้ตัวเดียวกัน (แหล่งเดียว ห้ามลอก)

  kind: AiCallKind,
  model: string,
  usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number } | undefined,
  latencyMs: number,
  extra: Record<string, unknown> = {},
): AiCallUsage {
  const promptTokens = usage?.promptTokenCount ?? 0;
  const candidatesTokens = usage?.candidatesTokenCount ?? 0;
  const thoughtsTokens = usage?.thoughtsTokenCount ?? 0;
  const cachedTokens = usage?.cachedContentTokenCount ?? 0;
  const costUsd = estimateCost(model, promptTokens, candidatesTokens + thoughtsTokens, cachedTokens);
  const out: AiCallUsage = {
    model, promptTokens, candidatesTokens, thoughtsTokens, cachedTokens, latencyMs,
    costUsd,
    costThb: costUsd === null ? null : costUsd * USD_TO_THB,
  };
  console.log(JSON.stringify({
    scope: "ai-usage", callKind: kind, model, latencyMs,
    promptTokens, candidatesTokens, thoughtsTokens, cachedTokens,
    // cachedTokens > 0 = implicit caching ทำงานอยู่ (Gemini 2.5+ เปิดเองอัตโนมัติ · ขั้นต่ำ 4,096 tok)
    costUsd: costUsd === null ? "unknown-model-price" : Number(costUsd.toFixed(6)),
    costThb: out.costThb === null ? "unknown-model-price" : Number(out.costThb.toFixed(4)),
    priceNote: "ประมาณเท่านั้น — ตัวเลขจริงดู cost log ของ Google",
    ...extra,
  }));
  return out;
}

/**
 * safetySettings = OFF ทั้ง 5 หมวดที่ปรับได้ (D-46) — บอทรับออเดอร์: ชื่อ/ที่อยู่/เบอร์/เลขบัญชี/สลิป
 * คือเนื้องานหลัก · availability ต้องมาก่อน · หมวดพวกนี้เคยช่วยกัน (ลูกค้าด่า/เนื้อหาแรง) มีตาข่ายเราเองแล้ว
 * (H4 handoff + verbatim = AI ไม่มีปากแต่งคำเสี่ยง)
 * 🔴 PROHIBITED_CONTENT เป็น core policy ปรับไม่ได้ → ยังบล็อกได้เสมอ = ชั้น degraded (route) คือหลักประกันจริง
 */
export const SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
].map((category) => ({ category, threshold: HarmBlockThreshold.OFF }));

export interface GeminiImageInput {
  mimeType: string;
  base64Data: string;
}

export interface GeminiTurnInput {
  config: AppConfig;
  configText: string;
  stepText: string;
  faqText: string;
  catalogText: string;
  objectionText: string;
  stateText: string;
  historyText: string;
  userMessage: string;
  currentStage: string;
  image?: GeminiImageInput;
  /** D-61.A (v3): regenerate 1 ครั้งจาก assurance guard — ข้อความแก้ไขแนบท้าย user content (v2 ไม่ใช้) */
  correction?: string;
  /** D-69: ผูกแถว ai_usage กับลูกค้า (optional · ไม่ส่ง = บันทึกเป็น null) */
  userId?: string;
}

/** ช่องทางชำระเงินที่ AI ประเมินใหม่ทุกเทิร์นจากบทสนทนาล่าสุด · "" = ยังไม่ตัดสิน */
export type PaymentMethod = "โอน" | "COD" | "";

/** เจตนาของรูปที่ลูกค้าส่งมา (AI ตีความจาก stage+บริบท) — code ลงมือเฉพาะ slip/damage */
export type ImageIntent = "slip" | "damage" | "address" | "other";

export interface GeminiTurnOutput {
  reply: string;
  stage: string;
  tagsAdd: string[];
  handoff: boolean;
  handoffReason: string;
  /** ข้อมูลจัดส่ง+รายการที่ AI จับได้เทิร์นนี้ (โค้ด merge ลง pending_order · ไม่รวมช่องทางชำระ) */
  orderData: OrderDataFromAI;
  /** ช่องทางชำระ "ล่าสุด" — AI ประเมินใหม่ทุกเทิร์น (โค้ดใช้ตัดสิน gate) */
  paymentMethod: PaymentMethod;
  /** true = ลูกค้าขอแก้ออเดอร์ที่ "บันทึกลงชีตแล้ว" (เปลี่ยนที่อยู่/COD↔โอน/เพิ่มลด/ยกเลิก) → โค้ด handoff */
  orderEditRequest: boolean;
  /** ใช้เฉพาะเทิร์นที่มีรูป · เทิร์นข้อความล้วน AI จะตอบ "other" */
  imageIntent: ImageIntent;
  /** สิ่งที่ AI อ่านได้จากรูป (สลิป: ยอด/ธนาคาร/เวลา · อื่นๆ: สรุปสั้นๆ) */
  imageNote: string;
  /** objection_id ที่ AI คิดว่าเจอ (หรือ "none") — log คู่กับ code-match หา keyword ที่ยังไม่อยู่ในชีต (D-27) */
  objectionDetected: string;
  /** true = ผลนี้มาจาก fallback (timeout/MAX_TOKENS/parse fail/error) ไม่ใช่คำตอบจริงจาก AI
   *  ใช้ให้โค้ดรู้ว่า image_intent/order ไม่น่าเชื่อ ต้องปกป้องเรื่องเงินเอง (ถือรูปเป็นสลิปไว้ก่อน) */
  degraded: boolean;
  /** D-48/D-49: true = ผลมาจาก extraction fallback (call หลัก blocked) — stage เป็น current ชั่วคราว
   *  โค้ด route ต้องเลือกประตูปลายทางเอง (D-49 resolveRecoveredStage จากผล gate) แทนตรึง current */
  recovered?: boolean;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    stage: { type: Type.STRING },
    tags_add: { type: Type.ARRAY, items: { type: Type.STRING } },
    handoff: { type: Type.BOOLEAN },
    handoff_reason: { type: Type.STRING },
    order_data: {
      type: Type.OBJECT,
      properties: {
        // ผู้รับ 3 ช่อง (ก้อนดิบ ไม่แยกจังหวัด/รหัส) + items รายการสั่งซื้อ
        ชื่อ: { type: Type.STRING },
        ที่อยู่: { type: Type.STRING },
        เบอร์: { type: Type.STRING },
        // 🔴 D-20: AI ส่งแค่ qty (โค้ดใส่ sku + คิดเงินเอง · ลดภาระ AI) · หลายรายการได้
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              qty: { type: Type.NUMBER },
            },
          },
        },
      },
    },
    payment_method: { type: Type.STRING },
    order_edit_request: { type: Type.BOOLEAN },
    image_intent: { type: Type.STRING },
    image_note: { type: Type.STRING },
    objection_detected: { type: Type.STRING },
  },
  required: [
    "reply",
    "stage",
    "tags_add",
    "handoff",
    "handoff_reason",
    "order_data",
    "payment_method",
    "order_edit_request",
    "image_intent",
    "image_note",
    "objection_detected",
  ],
};

/**
 * D-48: schema จิ๋วสำหรับ extraction call — สกัดข้อมูลออเดอร์ล้วน ไม่มีช่องขาย/objection/handoff
 * ใช้เฉพาะเมื่อ call หลักถูกบล็อก → ตัด prompt ขาย/ตารางราคา/สารบัญ step ออก = ลด "กลิ่นเงิน" ที่ทริกเกอร์ classifier
 */
const EXTRACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    order_data: {
      type: Type.OBJECT,
      properties: {
        ชื่อ: { type: Type.STRING },
        ที่อยู่: { type: Type.STRING },
        เบอร์: { type: Type.STRING },
        items: {
          type: Type.ARRAY,
          items: { type: Type.OBJECT, properties: { qty: { type: Type.NUMBER } } },
        },
      },
    },
    payment_method: { type: Type.STRING },
  },
  required: ["order_data", "payment_method"],
};

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

function fallback(stage: string, botName: string): GeminiTurnOutput {
  return {
    reply: defaultReply(botName),
    stage,
    tagsAdd: [],
    handoff: false,
    handoffReason: "",
    orderData: {},
    paymentMethod: "",
    orderEditRequest: false,
    imageIntent: "other",
    imageNote: "",
    objectionDetected: "none",
    degraded: true,
  };
}

function toPaymentMethod(value: unknown): PaymentMethod {
  return value === "โอน" || value === "COD" ? value : "";
}

/**
 * แปลง order_data ดิบจาก AI → OrderDataFromAI (เก็บเฉพาะช่องที่มีค่าจริง)
 * items: รับเฉพาะ {sku:string, qty:number>0} · กันของแปลก/ไม่ครบ (parse ไม่พังทั้งเทิร์น)
 */
function parseOrderData(raw: unknown): OrderDataFromAI {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  // 🔬 DIAG: raw ที่ AI ส่ง "ก่อนกรอง" — ชี้ขาดว่า AI ส่ง items มั้ย + sku ว่าง/ผิดมั้ย + เบอร์มั่วมั้ย
  //    sku = product code (ไม่ใช่ PII · log ค่าได้) · เบอร์ = อาจเป็นเบอร์จริง (PII) → log แค่ len/digits
  if (process.env.DIAG_PROMPT_TOKENS === "1") {
    const rawItems = Array.isArray(o["items"]) ? (o["items"] as unknown[]) : [];
    const phone = typeof o["เบอร์"] === "string" ? (o["เบอร์"] as string).trim() : "";
    console.log(JSON.stringify({
      scope: "gemini", event: "orderdata-raw",
      keys: Object.keys(o),
      rawItems: rawItems.map((el) => {
        const e = (el ?? {}) as Record<string, unknown>;
        return { sku: e.sku ?? null, qty: e.qty ?? null };
      }),
      phoneShape: phone ? { len: phone.length, digits: /^\d+$/.test(phone) } : null,
    }));
  }
  const out: OrderDataFromAI = {};
  if (typeof o["ชื่อ"] === "string" && o["ชื่อ"].trim()) out["ชื่อ"] = o["ชื่อ"];
  if (typeof o["ที่อยู่"] === "string" && o["ที่อยู่"].trim()) out["ที่อยู่"] = o["ที่อยู่"];
  if (typeof o["เบอร์"] === "string" && o["เบอร์"].trim()) out["เบอร์"] = o["เบอร์"];
  if (Array.isArray(o["items"])) {
    // D-20: AI ส่งแค่ qty (sku โค้ดใส่เอง) · รับเฉพาะ qty>0
    const items: AiOrderItem[] = [];
    for (const el of o["items"] as unknown[]) {
      if (!el || typeof el !== "object") continue;
      const e = el as Record<string, unknown>;
      const qty = typeof e.qty === "number" ? e.qty : Number(e.qty);
      if (Number.isFinite(qty) && qty > 0) items.push({ qty });
    }
    if (items.length > 0) out.items = items;
  }
  return out;
}

function isValidImageIntent(value: unknown): value is ImageIntent {
  return value === "slip" || value === "damage" || value === "address" || value === "other";
}

/**
 * D-48: extraction call — บันไดสำรองเมื่อ call หลักถูกบล็อก (แทน retry prompt เดิม ที่ไร้ผลกับ combo deterministic)
 * systemInstruction สั้นเฉพาะกิจ "สกัดข้อมูล" · user = ข้อความลูกค้าล้วน (ไม่มี history/ตารางราคา/สารบัญ step/catalog)
 * = ตัดกลิ่นเงินเกือบหมด → ผ่าน classifier · ผล order_data/payment ป้อน gate ตามปกติ · stage = current (route)
 * คืน null ถ้า extraction ก็ถูกบล็อก/พัง → caller ตก fallback (degraded · ตาข่าย D-46 = last resort)
 */
async function runExtraction(input: GeminiTurnInput): Promise<GeminiTurnOutput | null> {
  const system =
    "คุณคือตัวสกัดข้อมูลออเดอร์ ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น\n" +
    "สกัดจาก \"ข้อความลูกค้า\" ด้านล่าง: ชื่อผู้รับ / ที่อยู่จัดส่ง (ก้อนดิบตามที่พิมพ์) / เบอร์โทร / " +
    "วิธีชำระ (payment_method = \"โอน\" หรือ \"COD\" หรือ \"\") / จำนวนสินค้า (items:[{qty}])\n" +
    "🔴 ใส่เฉพาะที่ลูกค้าให้จริงในข้อความนี้ · ไม่ได้ให้ = เว้นว่าง/ไม่ใส่ key · ห้ามเดา · เลขจำนวน = qty ไม่ใช่เบอร์";
  const model = input.config.geminiModel;
  const startedAt = Date.now();
  try {
    const response = await getClient().models.generateContent({
      model,
      contents: [{ text: `ข้อความลูกค้า: ${input.userMessage}` }],
      config: {
        systemInstruction: system,
        temperature: 0.1,
        maxOutputTokens: 1024,
        thinkingConfig: resolveThinkingConfig(model, input.config.thinkingLevelRaw),
        responseMimeType: "application/json",
        responseSchema: EXTRACT_SCHEMA,
        safetySettings: SAFETY_SETTINGS,
      },
    });
    const eu = reportUsage("extraction", model, response.usageMetadata, Date.now() - startedAt, { stage: input.currentStage });
    void recordAiUsage({
      userId: input.userId ?? null, channel: channelOfUserId(input.userId), model, callKind: "extraction",
      promptTokens: eu.promptTokens, candidatesTokens: eu.candidatesTokens, thoughtsTokens: eu.thoughtsTokens,
      cachedTokens: eu.cachedTokens, latencyMs: eu.latencyMs, degraded: false, stage: input.currentStage,
    });
    const text = response.text;
    if (!text) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = response as any;
      console.error(JSON.stringify({
        scope: "extraction", warning: "extraction ก็ถูกบล็อก — ตก degraded (last resort)",
        blockReason: r.promptFeedback?.blockReason, msgLen: input.userMessage.length,
      }));
      return null;
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const orderData = parseOrderData(parsed.order_data);
    const paymentMethod = toPaymentMethod(parsed.payment_method);
    console.log(JSON.stringify({
      scope: "extraction", recovered: true,
      keys: Object.keys(orderData), payment: paymentMethod, // sku/qty/payment = ไม่ใช่ PII · เบอร์/ที่อยู่ log แค่ key
    }));
    return {
      reply: defaultReply(input.config.botName), // ไม่ใช้ (verbatim) — stage=current ให้ route ส่ง pattern ประตูปัจจุบัน
      stage: input.currentStage,
      tagsAdd: [],
      handoff: false,
      handoffReason: "",
      orderData,
      paymentMethod,
      orderEditRequest: false,
      imageIntent: "other",
      imageNote: "",
      objectionDetected: "none",
      degraded: false, // flow ต่อเนื่อง (ลูกค้าไม่เห็นดราม่า) — ไม่ใช่ degraded reply
      recovered: true, // D-49: route เลือกประตูปลายทางเองจากผล gate (stage=current เป็นค่าชั่วคราว)
    };
  } catch (error) {
    console.error(JSON.stringify({ scope: "extraction", warning: "extraction failed", error: String(error).slice(0, 80) }));
    return null;
  }
}

/** D-68: v3 เหลือสมองเดียว — ไม่มีตัวเลือกอีกแล้ว (v2 ถูกถอด) */
function buildSystemInstruction(input: GeminiTurnInput): string {
  return buildSalesSystemV3({
    botName: input.config.botName,
    shopName: input.config.shopName,
    personaGender: input.config.personaGender,
    useEmoji: input.config.useEmoji,
  });
}

export async function runSalesTurn(input: GeminiTurnInput): Promise<GeminiTurnOutput> {
  const systemInstruction = buildSystemInstruction(input);

  const userText = buildUserContent({
    configText: input.configText,
    stepText: input.stepText,
    faqText: input.faqText,
    catalogText: input.catalogText,
    objectionText: input.objectionText,
    stateText: input.stateText,
    historyText: input.historyText,
    userMessage: input.userMessage,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [{ text: userText }];
  if (input.image) {
    parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.base64Data } });
  }
  // D-61.A (v3): regenerate — แนบเหตุผลที่คำตอบรอบก่อนถูกบล็อก ให้เขียนใหม่โดยไม่ใช้คำรับรอง
  if (input.correction) {
    parts.push({ text: `\n🔴 คำตอบรอบก่อนถูกระบบบล็อก: ${input.correction}\nเขียนคำตอบใหม่ทั้งหมด (เนื้อหาเดิมได้ แต่ห้ามมีประโยครับรองข้างต้น)` });
  }

  // แยกขนาดแต่ละส่วน (char = estimate เท่านั้น) — หาว่าส่วนไหนใหญ่สุด selective ทำงานจริงมั้ย
  console.log(
    JSON.stringify({
      scope: "prompt-size",
      note: "char = estimate ไม่ใช่ token จริง (ดู prompt-tokens ถ้า DIAG_PROMPT_TOKENS=1)",
      chars: {
        system: systemInstruction.length,
        config: input.configText.length,
        step: input.stepText.length,
        faq: input.faqText.length,
        catalog: input.catalogText.length,
        state: input.stateText.length,
        history: input.historyText.length,
        grandTotal: systemInstruction.length + userText.length,
      },
    }),
  );

  // preview 200 ตัวอักษรแรก (เนื้อจากชีต ไม่ใช่ PII) — eyeball ว่าสารบัญสั้นจริง/catalog ยัดทั้งตาราง
  console.log(
    JSON.stringify({
      scope: "prompt-preview",
      step: input.stepText.slice(0, 200),
      catalog: input.catalogText.slice(0, 200),
      faq: input.faqText.slice(0, 200),
    }),
  );

  // token จริงต่อ segment (gate ด้วย env กัน N countTokens calls ทุกเทิร์นใน production ปกติ)
  // ตั้ง DIAG_PROMPT_TOKENS=1 แล้วเทส → ได้ token จริงต่อส่วน + เทียบ promptTokenCount ที่ Gemini คืน
  if (process.env.DIAG_PROMPT_TOKENS === "1") {
    const countTok = async (text: string): Promise<number> => {
      if (!text) return 0;
      try {
        const r = await getClient().models.countTokens({ model: input.config.geminiModel, contents: text });
        return r.totalTokens ?? -1;
      } catch {
        return -1;
      }
    };
    const [system, config, step, faq, catalog, state, history, user] = await Promise.all([
      countTok(systemInstruction),
      countTok(input.configText),
      countTok(input.stepText),
      countTok(input.faqText),
      countTok(input.catalogText),
      countTok(input.stateText),
      countTok(input.historyText),
      countTok(input.userMessage),
    ]);
    const segmentSum = [system, config, step, faq, catalog, state, history, user].reduce((a, b) => a + Math.max(0, b), 0);
    console.log(
      JSON.stringify({
        scope: "prompt-tokens",
        real: true,
        segments: { system, config, step, faq, catalog, state, history, user },
        segmentSum,
        note: "sum ≈ promptTokenCount (ต่างเพราะ responseSchema+role overhead ที่ไม่ได้นับต่อ segment)",
      }),
    );
  }

  // D-69: โมเดล + ระดับการคิด ตั้งจากชีตได้ · ไม่มีแถว = ค่าเดิม (gemini-3.5-flash / low)
  const model = input.config.geminiModel;
  warnIfDeprecatedModel(model);
  const thinkingConfig = resolveThinkingConfig(model, input.config.thinkingLevelRaw);
  const startedAt = Date.now();

  try {
    const response = await getClient().models.generateContent({
      model,
      contents: parts,
      config: {
        systemInstruction,
        temperature: input.config.temperature,
        maxOutputTokens: input.config.maxOutputTokens,
        thinkingConfig,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        safetySettings: SAFETY_SETTINGS, // D-46: OFF 5 หมวด (บอทรับ PII เป็นเนื้องาน)
      },
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    const usage = response.usageMetadata;
    // D-69: kind = regen เมื่อมี correction (assurance guard ยิงซ้ำ = จ่ายสองเท่าในเทิร์นเดียว)
    const kind: AiCallKind = input.correction ? "regen" : "main";
    const u = reportUsage(kind, model, usage, Date.now() - startedAt, { finishReason, stage: input.currentStage });
    void recordAiUsage({
      userId: input.userId ?? null, channel: channelOfUserId(input.userId), model, callKind: kind,
      promptTokens: u.promptTokens, candidatesTokens: u.candidatesTokens, thoughtsTokens: u.thoughtsTokens,
      cachedTokens: u.cachedTokens, latencyMs: u.latencyMs, degraded: finishReason === "MAX_TOKENS", stage: input.currentStage,
    });
    // thinking+output ใช้เพดานร่วมกัน → ต้องเห็นสัดส่วนถึงจะรู้ว่าใครกิน budget
    const budget = {
      finishReason,
      model,
      maxOutputTokens: input.config.maxOutputTokens,
      thoughtsTokenCount: usage?.thoughtsTokenCount, // thinking กินเท่าไหร่
      candidatesTokenCount: usage?.candidatesTokenCount, // คำตอบจริงกินเท่าไหร่
      totalTokenCount: usage?.totalTokenCount,
      promptTokenCount: usage?.promptTokenCount, // prompt บวมมั้ย (Step/FAQ/ประวัติ)
    };

    if (finishReason === "MAX_TOKENS") {
      // ชนเพดาน = JSON ขาดกลางคัน → ห้าม parse เด็ดขาด (จะได้ค่าครึ่ง ๆ / throw) · extraction ไม่ช่วย (คนละเหตุ)
      console.error(JSON.stringify({ scope: "gemini", warning: "MAX_TOKENS — ตอบไม่จบ ใช้ fallback", ...budget }));
      return fallback(input.currentStage, input.config.botName);
    }

    console.log(JSON.stringify({ scope: "gemini", ...budget }));

    const text = response.text;
    if (!text) {
      // 🔬 candidates ว่าง/ไม่มี text = Gemini ไม่ผลิต output (prompt ถูกบล็อก / safety / อื่นๆ)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = response as any;
      const raw = {
        blockReason: r.promptFeedback?.blockReason,
        promptSafety: r.promptFeedback?.safetyRatings,
        candidatesLen: response.candidates?.length ?? 0,
        candFinishReason: response.candidates?.[0]?.finishReason,
        candSafety: response.candidates?.[0]?.safetyRatings,
        candFinishMessage: r.candidates?.[0]?.finishMessage,
      };
      // D-47 ชิ้น 4: log pattern เทิร์นที่โดนบล็อก (สะสมหลักฐานว่าเทิร์นแบบไหนโดนบ่อย · ตัดทอน กัน PII)
      console.error(JSON.stringify({
        scope: "gemini", warning: "no text — candidates ว่าง/ถูกบล็อก", ...raw, ...budget,
        historyLen: input.historyText.length, msgLen: input.userMessage.length,
        msgHead: input.userMessage.slice(0, 16), msgHasDigit: /\d/.test(input.userMessage), hasImage: Boolean(input.image),
      }));
      if (process.env.DIAG_PROMPT_TOKENS === "1") {
        console.log(JSON.stringify({ scope: "gemini", event: "raw-empty", promptFeedback: r.promptFeedback ?? null, candidate0: r.candidates?.[0] ? { ...r.candidates[0], content: undefined } : null }));
      }
      // D-48: call หลัก blocked → บันได extraction จิ๋ว (แทน retry prompt เดิม) · อยู่ในงบ withTimeout 8s เดิม
      const extracted = await runExtraction(input);
      if (extracted) return extracted; // สกัดผ่าน → order_data เข้า gate · ลูกค้าได้ flow ต่อ
      return fallback(input.currentStage, input.config.botName); // extraction ก็บล็อก → degraded (ตาข่าย D-46 last resort)
    }

    const parsed: Record<string, unknown> = JSON.parse(text);

    return {
      reply: typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : defaultReply(input.config.botName),
      stage: typeof parsed.stage === "string" && parsed.stage ? parsed.stage : input.currentStage,
      tagsAdd: Array.isArray(parsed.tags_add) ? parsed.tags_add.filter((t: unknown) => typeof t === "string") : [],
      handoff: Boolean(parsed.handoff),
      handoffReason: typeof parsed.handoff_reason === "string" ? parsed.handoff_reason : "",
      orderData: parseOrderData(parsed.order_data),
      paymentMethod: toPaymentMethod(parsed.payment_method),
      orderEditRequest: Boolean(parsed.order_edit_request),
      imageIntent: isValidImageIntent(parsed.image_intent) ? parsed.image_intent : "other",
      imageNote: typeof parsed.image_note === "string" ? parsed.image_note : "",
      objectionDetected: typeof parsed.objection_detected === "string" && parsed.objection_detected.trim() ? parsed.objection_detected.trim() : "none",
      degraded: false,
    };
  } catch (error) {
    console.error(JSON.stringify({ scope: "gemini", warning: "request failed", error: String(error) }));
    return fallback(input.currentStage, input.config.botName);
  }
}
