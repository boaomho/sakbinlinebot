import { resolveAllVars, KNOWN_RUNTIME_VARS, computeQuote, AllVarsContext } from "@/lib/agent/quote";
import { buildProductNameMap, RuntimeVarContext } from "@/lib/core/pricing";
import { buildFaqInjection } from "@/lib/agent/inject";
import { composeKnowledgeAnswer, isHandoffFlag } from "@/lib/sheets/normalize-bundle";
import { cleanHeader, cleanCell } from "@/lib/sheets/clean";
import { tabKeyColumn } from "./sandbox";
import { lintPattern, LintFinding } from "./lint";
import type { AppConfig } from "@/lib/config";
import type { BotLibrary, RawSheets } from "@/lib/sheets/loader";
import type { CustomerState } from "@/lib/db";

/**
 * lib/train/preview.ts — เฟส ข: provenance + render preview + dropped bubble
 * 🔴 reuse resolver/matcher/joiner ตัวเดียวกับ production (resolveAllVars/buildFaqInjection/composeKnowledgeAnswer) — ไม่ duplicate logic
 * 🔴 D-72b: คอลัมน์ที่โชว์/แก้ = **ชื่อจริงตามชีต** (อ่านจาก RawSheets) · lint/resolve ยังใช้ bundle ที่ normalize แล้ว (มุมมองบอท)
 */

const EMPTY_VARS: RuntimeVarContext = { summary: null, total: null, payment: null, breakdown: null, nextTierOffer: null };

/**
 * คอลัมน์ที่แก้ได้ต่อแท็บ — 🔴 D-72b: ชื่อคอลัมน์จริงตามชีต (เจ้าของเคาะ)
 * · Steps `แนวตอบ` **ไม่เข้า prompt** (D-66 §4) — UI ติดป้ายบอก · ช่องที่เข้า prompt คือ `สาระที่ต้องสื่อ`
 * · Knowledge `keyword` แก้ได้ (บั๊กที่แพงที่สุดของโปรเจกต์คือ keyword ไม่ match — K018 "ถ้วยแตก")
 * · `ลูกค้าพูดยังไง` = key ที่ใช้หาแถว → ไม่เปิดให้แก้
 */
export const EDITABLE_COLS: Record<string, string[]> = {
  Steps: ["สาระที่ต้องสื่อ", "แนวตอบ"],
  Knowledge: ["ความกังวลจริง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "แนวตอบ", "keyword"],
  Vars: ["ค่า"],
};

/** คอลัมน์ที่ "ไม่เข้า prompt" (แก้ได้แต่บอทไม่เห็น) — UI ใช้ติดป้ายเตือน (D-66 §4) */
export const COLS_NOT_IN_PROMPT: Record<string, string[]> = {
  Steps: ["แนวตอบ"],
};

export interface ReplySource {
  tab: string;
  key: string;
  keyCol: string;
  label: string;
  columns: { name: string; value: string }[];
}

export interface PreviewSegment {
  text: string;
  /** true = บอลลูนนี้จะโดน var-guard ทิ้ง (เหลือตัวแปรระบบ resolve ไม่ได้) */
  dropped: boolean;
  vars: string[];
}

export interface RenderResult {
  rawPattern: string;
  columns: { name: string; value: string }[];
  segments: PreviewSegment[];
  vars: { token: string; value: string; resolved: boolean; unknown: boolean }[];
  lint: LintFinding[];
}

// ---- อ่านแถวตาม key (header-driven · 🔴 D-72b: จาก "แถวดิบตามชีต" เท่านั้น) ----
function rowByKey(raw: RawSheets, tab: string, key: string): Record<string, string> | null {
  const rows = (raw as Record<string, string[][]>)[tab];
  const keyCol = tabKeyColumn(tab);
  if (!rows || rows.length < 2 || !keyCol) return null;
  const header = rows[0].map(cleanHeader);
  const keyIdx = header.indexOf(keyCol);
  if (keyIdx === -1) return null;
  const row = rows.find((r, i) => i > 0 && cleanCell(r[keyIdx] ?? "") === key);
  if (!row) return null;
  const obj: Record<string, string> = {};
  header.forEach((h, i) => {
    if (h) obj[h] = row[i] ?? "";
  });
  return obj;
}

function replySource(raw: RawSheets, tab: string, key: string): ReplySource | null {
  const row = rowByKey(raw, tab, key);
  const keyCol = tabKeyColumn(tab);
  if (!row || !keyCol) return null;
  const cols = EDITABLE_COLS[tab] ?? [];
  const label = tab === "Knowledge" ? `${tab} · ${key.slice(0, 24)}` : `${tab} · ${key}`;
  return { tab, key, keyCol, label, columns: cols.map((name) => ({ name, value: row[name] ?? "" })) };
}

// ---- var context (mirror handler varCtx · ประกอบ input ด้วย production builder) ----
// 🔴 mirror ของ handler.ts varCtx — ถ้า handler เพิ่ม field ใน AllVarsContext ต้อง sync ที่นี่
export function buildTrainVarCtx(customer: CustomerState | null, lib: BotLibrary, config: AppConfig, now: Date): AllVarsContext {
  const pending = customer?.pendingOrder ?? {};
  const quote = computeQuote(pending, lib, config, now);
  const lastOrder = customer?.lastOrder ?? null;
  const nameMap = buildProductNameMap(lib.Products ?? []);
  const lastOrderItemsText = lastOrder?.items?.length
    ? lastOrder.items.map((it) => `${nameMap.get(it.sku) ?? it.sku} x${it.qty}`).join(" · ")
    : "";
  return {
    priceVars: quote?.vars ?? EMPTY_VARS,
    config,
    lastOrder,
    lastOrderItemsText,
    pending,
    products: lib.Products ?? [],
    promo: lib.Promo ?? [],
    varsRows: lib.Vars ?? [],
    now,
  };
}

/** คอลัมน์ "สิ่งที่ลูกค้าพูด/ถาม" ต่อแท็บ (🔴 D-72b: ชื่อดิบตามชีต) — ป้อน lintHealthH1: แถว trigger สุขภาพ = ห้ามคำรับรอง */
const H1_TRIGGER_COLS: Record<string, string[]> = {
  Knowledge: ["ลูกค้าพูดยังไง", "keyword"],
  Steps: [],
  Vars: [],
};

/** รวมข้อความ trigger (คำถาม/สิ่งที่ลูกค้าพูด) ของแถว — ป้อน lintHealthH1 คู่กับคำตอบ */
export function triggerTextForTab(tab: string, cols: Record<string, string>): string {
  return (H1_TRIGGER_COLS[tab] ?? []).map((c) => cols[c] ?? "").filter(Boolean).join(" ");
}

/**
 * D-58: ประตู Steps ที่เป็น handoff → ยกเว้น H1 (คำตอบสุขภาพเป็นดีไซน์) · notify → +warn วลีรับรอง
 * 🔴 D-72b: cols เป็นแถวดิบ → ธง handoff อ่านจากคอลัมน์ `handoff` (กติกาเดียวกับ normalizeSteps ผ่าน isHandoffFlag)
 *    + คอลัมน์ `funnel_stage` (optional D-68) ถ้าเจ้าของเปิดใช้
 */
export function h1FlagsForRow(tab: string, cols: Record<string, string>): { h1Exempt: boolean; h1Notify: boolean } {
  if (tab !== "Steps") return { h1Exempt: false, h1Notify: false };
  const f = cleanCell(cols["funnel_stage"] ?? "").toLowerCase();
  const handoff = isHandoffFlag(cols["handoff"]) || f === "handoff" || f === "handoff_notify";
  return { h1Exempt: handoff, h1Notify: f === "handoff_notify" };
}

/**
 * สร้างแพตเทิร์น "ตามที่บอทเห็นจริง" จากคอลัมน์ดิบ (draft ทับแล้ว) — reuse โดย write.ts (lint gate)
 * 🔴 D-72b: Knowledge ประกอบก้อนเดียวกับที่เข้า prompt ผ่าน `composeKnowledgeAnswer` (แหล่งเดียวกับ normalize)
 *    Steps ใช้ `สาระที่ต้องสื่อ` (ช่องเดียวที่เข้า prompt — `แนวตอบ` ไม่เข้า D-66 §4 จึงไม่ปนใน pattern)
 */
export function patternFromColumns(tab: string, cols: Record<string, string>): string {
  if (tab === "Steps") return (cols["สาระที่ต้องสื่อ"] ?? "").trim();
  if (tab === "Knowledge") return composeKnowledgeAnswer(cols["ความกังวลจริง"] ?? "", cols["ข้อเท็จจริง/สิ่งที่อยากให้รู้"] ?? "", cols["แนวตอบ"] ?? "");
  if (tab === "Vars") return (cols["ค่า"] ?? "").trim();
  return "";
}

const VAR_TOKEN = /\{[^}]+\}/g;

/**
 * render แพตเทิร์นดิบ (+draft) → บอลลูน resolve แล้ว + ตารางตัวแปร + lint (สำหรับ editor สด)
 * 🔴 D-72b: อ่านแถวจาก raw (คอลัมน์จริงตามชีต) · resolve/lint ใช้ lib (bundle มุมมองบอท) — สองเส้นจาก batchGet เดียวกัน
 */
export function renderPreview(
  lib: BotLibrary,
  raw: RawSheets,
  config: AppConfig,
  customer: CustomerState | null,
  tab: string,
  key: string,
  draft: Record<string, string>,
  now: Date,
): RenderResult {
  const row = rowByKey(raw, tab, key) ?? {};
  const cols = { ...row, ...draft };
  const rawPattern = patternFromColumns(tab, cols);
  const ctx = buildTrainVarCtx(customer, lib, config, now);
  const resolved = resolveAllVars(rawPattern, ctx);

  // แยกบอลลูน + มาร์คตัวที่ var-guard จะทิ้ง (เหลือตัวแปรระบบ = KNOWN_RUNTIME_VARS)
  const bodies = resolved.split(/\[\[(?:เว้น|แยก)\]\]/);
  const segments: PreviewSegment[] = bodies
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((text) => {
      const vars = KNOWN_RUNTIME_VARS.filter((v) => text.includes(v));
      return { text, dropped: vars.length > 0, vars: [...vars] };
    });

  // ตารางตัวแปร: token ที่พบในแพตเทิร์นดิบ → resolve เดี่ยว (ค่าเดียวกับตอนอยู่ในแพตเทิร์น)
  const knownSet = new Set<string>(KNOWN_RUNTIME_VARS as readonly string[]);
  const tokens = [...new Set(rawPattern.match(VAR_TOKEN) ?? [])];
  const vars = tokens.map((token) => {
    const value = resolveAllVars(token, ctx);
    const resolvedOk = value !== token;
    return { token, value: resolvedOk ? value : "", resolved: resolvedOk, unknown: !resolvedOk && !knownSet.has(token) };
  });

  const payment = customer?.pendingOrder["การชำระเงิน"] ?? "";
  const lint = lintPattern(rawPattern, { config, lib, payment, now, trigger: triggerTextForTab(tab, cols), ...h1FlagsForRow(tab, cols), varName: tab === "Vars" ? key : undefined });

  return { rawPattern, columns: Object.entries(cols).filter(([k]) => (EDITABLE_COLS[tab] ?? []).includes(k)).map(([name, value]) => ({ name, value })), segments, vars, lint };
}

// ---- provenance: เทิร์นนี้ประกอบจากแถวไหนบ้าง (จาก X-ray verbatim log + re-run production matcher) ----
// 🔴 D-72b: matcher วิ่งบน lib (bundle มุมมองบอท — ตัวเดียวกับ prod) · คอลัมน์ที่โชว์/แก้มาจาก raw
//    key เชื่อมสองฝั่งได้เพราะ normalizeKnowledge คงค่า `ลูกค้าพูดยังไง` ไว้เป็น key เดิม
export function buildReplySources(
  logs: Record<string, unknown>[],
  lib: BotLibrary | null,
  raw: RawSheets | null,
  userMessage: string,
  fallbackStage: string | null,
): ReplySource[] {
  if (!lib || !raw) return [];
  if (logs.some((l) => l.scope === "degraded")) return []; // ข้อความระบบ (ไม่ได้มาจากชีต)

  const vb = logs.filter((l) => l.scope === "verbatim" && typeof l.source === "string").pop();
  const source = vb?.source as string | undefined;
  const stage = (vb?.stage as string | undefined) ?? fallbackStage ?? "";
  const out: (ReplySource | null)[] = [];

  if (source === "faq") {
    const faq = buildFaqInjection(lib.Knowledge, userMessage);
    if (faq.verbatim) {
      const key = faqKeyByAnswer(lib.Knowledge, faq.verbatim.answer);
      if (key) out.push(replySource(raw, "Knowledge", key));
    }
    out.push(replySource(raw, "Steps", stage)); // กลับบ้าน
  } else if (stage) {
    // step / step-complete / undefined → ประตูที่ส่ง
    out.push(replySource(raw, "Steps", stage));
  }
  return out.filter((s): s is ReplySource => s !== null);
}

/** หา key (คำถาม) ของแถว FAQ จากคำตอบ (buildFaqInjection คืนแค่ answer) */
function faqKeyByAnswer(rows: string[][], answer: string): string | null {
  if (rows.length < 2) return null;
  const header = rows[0].map(cleanHeader);
  const qIdx = header.indexOf("คำถาม");
  const aIdx = header.indexOf("คำตอบ");
  if (qIdx === -1 || aIdx === -1) return null;
  const row = rows.find((r, i) => i > 0 && (r[aIdx] ?? "").trim() === answer.trim());
  return row ? cleanCell(row[qIdx] ?? "") : null;
}

/** บอลลูน/รูปที่ถูกทิ้งเทิร์นนี้ (var-guard + D-67 image-dropped) — โชว์ขีดฆ่า ห้ามหายเงียบ */
export function collectDroppedBubbles(logs: Record<string, unknown>[]): { text: string; vars: string[] }[] {
  const out: { text: string; vars: string[] }[] = [];
  const vg = logs.filter((l) => l.scope === "var-guard" && l.event === "unresolved-runtime-var").pop();
  if (vg) {
    const before = String(vg.before ?? "");
    const dropped = (vg.dropped as string[] | undefined) ?? [];
    if (before && dropped.length > 0) {
      const bodies = before.split(/(?:\[\[เว้น\]\]|\[\[แยก\]\])/);
      for (const body of bodies) {
        const hit = [...new Set(dropped.filter((v) => body.includes(v)))];
        if (hit.length > 0) out.push({ text: body.trim(), vars: hit });
      }
    }
  }
  // 🔴 D-67: รูปที่ line.ts ทิ้งเพราะ URL ไม่ใช่ http(s) (ตัวแปรค้าง เช่น {รูปโปรโมชั่น} ค่าว่าง / บอทแต่งชื่อ)
  //   เดิมหายเงียบทั้ง prod และห้องซ้อม → ห้องซ้อมที่ไม่บอกว่าของหาย = ห้องซ้อมโกหก (บทเรียน C6)
  const seen = new Set<string>();
  for (const l of logs.filter((l) => l.scope === "line" && l.event === "image-dropped")) {
    const url = String(l.url ?? "");
    const segment = String(l.segment ?? "");
    const key = `${url}|${segment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: segment || `[[รูป:${url}]]`, vars: [url] });
  }
  return out;
}
