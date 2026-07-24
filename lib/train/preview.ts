import { resolveAllVars, KNOWN_RUNTIME_VARS, computeQuote, AllVarsContext } from "@/lib/agent/quote";
import { buildProductNameMap, RuntimeVarContext } from "@/lib/core/pricing";
import { joinVerbatimParts, buildFaqInjection, buildObjectionInjection } from "@/lib/agent/inject";
import { cleanHeader, cleanCell } from "@/lib/sheets/clean";
import { tabKeyColumn } from "./sandbox";
import { lintPattern, LintFinding } from "./lint";
import type { AppConfig } from "@/lib/config";
import type { BotLibrary } from "@/lib/sheets/loader";
import type { CustomerState } from "@/lib/db";

/**
 * lib/train/preview.ts — เฟส ข: provenance + render preview + dropped bubble
 * 🔴 reuse resolver/matcher/joiner ตัวเดียวกับ production (resolveAllVars/buildFaqInjection/...) — ไม่ duplicate logic
 */

const EMPTY_VARS: RuntimeVarContext = { summary: null, total: null, payment: null, breakdown: null, nextTierOffer: null };

/** คอลัมน์ที่แก้ได้ (=บอลลูน) ต่อแท็บ */
const EDITABLE_COLS: Record<string, string[]> = {
  CSV_Step: ["ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย"],
  CSV_Objections: ["ตัวอย่างคำตอบ"],
  CSV_FAQ: ["คำตอบ"],
  CSV_Vars: ["ค่า"],
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

// ---- อ่านแถวตาม key (header-driven) ----
function rowByKey(lib: BotLibrary, tab: string, key: string): Record<string, string> | null {
  const rows = (lib as Record<string, string[][]>)[tab];
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

function replySource(lib: BotLibrary, tab: string, key: string): ReplySource | null {
  const row = rowByKey(lib, tab, key);
  const keyCol = tabKeyColumn(tab);
  if (!row || !keyCol) return null;
  const cols = EDITABLE_COLS[tab] ?? [];
  const label = tab === "CSV_FAQ" ? `${tab} · ${key.slice(0, 24)}` : `${tab} · ${key}`;
  return { tab, key, keyCol, label, columns: cols.map((name) => ({ name, value: row[name] ?? "" })) };
}

// ---- var context (mirror handler varCtx · ประกอบ input ด้วย production builder) ----
// 🔴 mirror ของ handler.ts varCtx — ถ้า handler เพิ่ม field ใน AllVarsContext ต้อง sync ที่นี่
export function buildTrainVarCtx(customer: CustomerState | null, lib: BotLibrary, config: AppConfig, now: Date): AllVarsContext {
  const pending = customer?.pendingOrder ?? {};
  const quote = computeQuote(pending, lib, config, now);
  const lastOrder = customer?.lastOrder ?? null;
  const nameMap = buildProductNameMap(lib.CSV_Products ?? []);
  const lastOrderItemsText = lastOrder?.items?.length
    ? lastOrder.items.map((it) => `${nameMap.get(it.sku) ?? it.sku} x${it.qty}`).join(" · ")
    : "";
  return {
    priceVars: quote?.vars ?? EMPTY_VARS,
    config,
    lastOrder,
    lastOrderItemsText,
    pending,
    products: lib.CSV_Products ?? [],
    promo: lib.CSV_Promo ?? [],
    varsRows: lib.CSV_Vars ?? [],
    now,
  };
}

/** สร้างแพตเทิร์นจากคอลัมน์ (draft ทับแล้ว) ตามแท็บ */
function patternFromColumns(tab: string, cols: Record<string, string>): string {
  if (tab === "CSV_Step") return joinVerbatimParts(cols["ตัวอย่างคำตอบ"] ?? "", cols["ตัวอย่างประโยคปิดท้าย"] ?? "");
  if (tab === "CSV_Objections") return (cols["ตัวอย่างคำตอบ"] ?? "").trim();
  if (tab === "CSV_FAQ") return (cols["คำตอบ"] ?? "").trim();
  if (tab === "CSV_Vars") return (cols["ค่า"] ?? "").trim();
  return "";
}

const VAR_TOKEN = /\{[^}]+\}/g;

/** render แพตเทิร์นดิบ (+draft) → บอลลูน resolve แล้ว + ตารางตัวแปร + lint (สำหรับ editor สด) */
export function renderPreview(
  lib: BotLibrary,
  config: AppConfig,
  customer: CustomerState | null,
  tab: string,
  key: string,
  draft: Record<string, string>,
  now: Date,
): RenderResult {
  const row = rowByKey(lib, tab, key) ?? {};
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
  const lint = lintPattern(rawPattern, { config, lib, payment, now });

  return { rawPattern, columns: Object.entries(cols).filter(([k]) => (EDITABLE_COLS[tab] ?? []).includes(k)).map(([name, value]) => ({ name, value })), segments, vars, lint };
}

// ---- provenance: เทิร์นนี้ประกอบจากแถวไหนบ้าง (จาก X-ray verbatim log + re-run production matcher) ----
export function buildReplySources(
  logs: Record<string, unknown>[],
  lib: BotLibrary | null,
  userMessage: string,
  fallbackStage: string | null,
): ReplySource[] {
  if (!lib) return [];
  if (logs.some((l) => l.scope === "degraded")) return []; // ข้อความระบบ (ไม่ได้มาจากชีต)

  const vb = logs.filter((l) => l.scope === "verbatim" && typeof l.source === "string").pop();
  const source = vb?.source as string | undefined;
  const stage = (vb?.stage as string | undefined) ?? fallbackStage ?? "";
  const out: (ReplySource | null)[] = [];

  if (source === "objection") {
    const obj = buildObjectionInjection(lib.CSV_Objections, userMessage, 5);
    if (obj.verbatim) out.push(replySource(lib, "CSV_Objections", obj.verbatim.id));
    out.push(replySource(lib, "CSV_Step", stage)); // กลับบ้าน
  } else if (source === "faq") {
    const faq = buildFaqInjection(lib.CSV_FAQ, userMessage);
    if (faq.verbatim) {
      const key = faqKeyByAnswer(lib.CSV_FAQ, faq.verbatim.answer);
      if (key) out.push(replySource(lib, "CSV_FAQ", key));
    }
    out.push(replySource(lib, "CSV_Step", stage)); // กลับบ้าน
  } else if (stage) {
    // step / step-complete / undefined → ประตูที่ส่ง
    out.push(replySource(lib, "CSV_Step", stage));
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

/** บอลลูนที่ถูก var-guard ทิ้งเทิร์นนี้ (จาก log before+dropped) — โชว์ขีดฆ่า ห้ามหายเงียบ */
export function collectDroppedBubbles(logs: Record<string, unknown>[]): { text: string; vars: string[] }[] {
  const vg = logs.filter((l) => l.scope === "var-guard" && l.event === "unresolved-runtime-var").pop();
  if (!vg) return [];
  const before = String(vg.before ?? "");
  const dropped = (vg.dropped as string[] | undefined) ?? [];
  if (!before || dropped.length === 0) return [];
  const bodies = before.split(/(?:\[\[เว้น\]\]|\[\[แยก\]\])/);
  const out: { text: string; vars: string[] }[] = [];
  for (const body of bodies) {
    const hit = [...new Set(dropped.filter((v) => body.includes(v)))];
    if (hit.length > 0) out.push({ text: body.trim(), vars: hit });
  }
  return out;
}
