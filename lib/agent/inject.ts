import { resolveColumns, cell, tabToText, ColumnMap } from "@/lib/sheets/columns";
import { cleanCell, cleanHeader } from "@/lib/sheets/clean";

/**
 * lib/agent/inject.ts — Selective injection (Part 4) แก้ราก MAX_TOKENS ที่ prompt ใหญ่
 *
 * หลักการ (เจ้าของย้ำ): ลูกค้าไม่เดินเรียงประตู โผล่ตรงไหนก็ได้ → บอทต้อง "เห็นทางเข้าทุกประตูเสมอ"
 *   - สารบัญ (index) = ทุกประตู เสมอ (step_id+ชื่อ+funnel_stage+เข้าเมื่อ+ไปประตูถัดไป) — ความฉลาด
 *   - เนื้อเต็ม (brain) = เฉพาะประตูที่เกี่ยว: ปัจจุบัน + ปลายทาง + entry match + handoff
 *   - กำกวม = ยัดมากขึ้น (ไม่ใช่พลาดแล้วยัดน้อย)
 *   - handoff (funnel_stage=handoff) = ยัด lean (เข้าเมื่อ+ห้ามทำ+ตัวอย่าง) ตัดสมองการขายออก
 *
 * 🔴 pure ล้วน (rows+stage+message → text) · ไม่ import LINE/Gemini · reuse ได้ทุก channel
 * header ไม่ครบ → fallback ยัดทั้งก้อน (tabToText) — ยอม token เยอะ ดีกว่าบอทตาบอด
 */

// ---- ชื่อคอลัมน์ (สะอาดแล้ว · "ตัวอย่างคำตอบ (บอลลูน)" → cleanHeader → "ตัวอย่างคำตอบ") ----
const STEP_COLS = [
  "step_id",
  "funnel_stage",
  "ชื่อประตู",
  "เข้าเมื่อ",
  "ไปประตูถัดไปเมื่อ",
  "ความรู้สึกลูกค้าตอนนี้",
  "ทำไมประตูนี้สำคัญ",
  "หลักการนำพา",
  "ห้ามทำ",
  "ต้องเก็บข้อมูล",
  "ตัวอย่างคำตอบ",
  "ตัวอย่างประโยคปิดท้าย",
];

/** ลำดับ funnel (ไม่รวม handoff) — ใช้หา "ประตูถัดไป" ตอน parse ปลายทางพลาด + กำกวม */
const FUNNEL_ORDER = ["lead", "qualified", "quoted", "awaiting_payment", "awaiting_address", "won", "post_sale"];
/** ตอนกำกวม (ไม่รู้ลูกค้าอยู่ประตูไหน) ยัดเต็ม funnel_stage ต้น ๆ ให้บอทจับทางได้ */
const AMBIGUOUS_STAGES = ["lead", "qualified", "quoted"];
const HANDOFF = "handoff";
/** D-34: ประตูที่บอท "คุยเก็บข้อมูลก่อน" แล้วค่อย handoff (ต่างจาก handoff ทันที) — inject เนื้อเต็มเหมือนประตูขาย */
const HANDOFF_AFTER_INTAKE = "handoff_after_intake";

interface StepRow {
  stepId: string;
  funnelStage: string;
  name: string;
  entryWhen: string;
  nextWhen: string;
  feeling: string;
  why: string;
  principle: string;
  dont: string;
  collect: string;
  example: string;
  closing: string;
  /** โหมด "คิดเอง" — 🔴 D-40: default = "ปิด" (verbatim) · "เปิด" = override รายแถว (AI เรียบเรียง) */
  think: ThinkMode;
}

export type ThinkMode = "เปิด" | "ปิด";

/**
 * แปลงค่าช่อง "คิดเอง" → โหมด · 🔴 D-40: verbatim = default ของทั้งระบบ
 * ว่าง/ไม่มีคอลัมน์/ไม่รู้จัก = **ปิด (verbatim)** · เฉพาะ "เปิด/true/on/1/ใช่/yes" = เปิด (AI · override รายแถว)
 * (ชีต v2.0 ไม่มีคอลัมน์ `คิดเอง` แล้ว → ทุกประตูปิด · ถ้าคอลัมน์กลับมาโผล่ ยังอ่านเป็น override ได้)
 */
export function parseThinkMode(raw: string): ThinkMode {
  const v = (raw ?? "").trim().toLowerCase();
  return ["เปิด", "true", "on", "1", "ใช่", "yes"].includes(v) ? "เปิด" : "ปิด";
}

interface ParsedSteps {
  steps: StepRow[];
  stepIds: Set<string>;
}

function parseStepRows(rows: string[][]): ParsedSteps | null {
  if (rows.length < 2) return null;
  const cols = resolveColumns(rows[0], STEP_COLS, "CSV_Step");
  if (!cols) return null;

  // "คิดเอง" = คอลัมน์ optional (ไม่อยู่ใน STEP_COLS required) → ชีตเดิมไม่มี = ทุกประตูเปิด (ไม่ regression)
  const thinkIdx = rows[0].map(cleanHeader).indexOf("คิดเอง");

  const steps: StepRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const stepId = cleanCell(cell(r, cols, "step_id"));
    if (!stepId) continue;
    steps.push({
      stepId,
      funnelStage: cleanCell(cell(r, cols, "funnel_stage")).toLowerCase(),
      name: cell(r, cols, "ชื่อประตู").trim(),
      entryWhen: cell(r, cols, "เข้าเมื่อ").trim(),
      nextWhen: cell(r, cols, "ไปประตูถัดไปเมื่อ").trim(),
      feeling: cell(r, cols, "ความรู้สึกลูกค้าตอนนี้").trim(),
      why: cell(r, cols, "ทำไมประตูนี้สำคัญ").trim(),
      principle: cell(r, cols, "หลักการนำพา").trim(),
      dont: cell(r, cols, "ห้ามทำ").trim(),
      collect: cell(r, cols, "ต้องเก็บข้อมูล").trim(),
      example: cell(r, cols, "ตัวอย่างคำตอบ").trim(),
      closing: cell(r, cols, "ตัวอย่างประโยคปิดท้าย").trim(),
      think: parseThinkMode(thinkIdx >= 0 ? (r[thinkIdx] ?? "") : ""),
    });
  }
  if (steps.length === 0) return null;
  return { steps, stepIds: new Set(steps.map((s) => s.stepId)) };
}

/**
 * แยก "ไปประตูถัดไปเมื่อ" (ข้อความ+step_id ปน, หลายปลายทางคั่นด้วย ·) → เซ็ต step_id ปลายทาง
 *   - exact match ก่อน (S4A → S4A เท่านั้น ไม่ลาม S4B)
 *   - ไม่มี exact → prefix match (S3 → S3_TRANSFER + S3_COD)
 * คืนเซ็ตว่างถ้าหา step_id ไม่เจอเลย (ผู้เรียกไป fallback funnel_stage ถัดไป)
 */
export function resolveDestinations(nextWhen: string, stepIds: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const clause of nextWhen.split("·")) {
    const tokens = clause.match(/[SXH]\d[0-9A-Z_]*/g) ?? [];
    for (const tok of tokens) {
      if (stepIds.has(tok)) {
        out.add(tok);
        continue;
      }
      for (const id of stepIds) if (id.startsWith(tok)) out.add(id);
    }
  }
  return out;
}

/** funnel_stage ของ step_id ที่ระบุ (D-33) — โค้ดใช้การันตี handoff เมื่อ AI อยู่ประตู funnel_stage=handoff */
export function funnelStageOf(rows: string[][], stepId: string): string | null {
  if (!stepId) return null;
  const parsed = parseStepRows(rows);
  return parsed?.steps.find((s) => s.stepId === stepId)?.funnelStage ?? null;
}

/** funnel_stage ที่ถูกต้องทั้งหมด (region 7 + handoff 2) — โค้ดใช้จริงเท่านี้ (Step 6) */
export const VALID_FUNNEL_STAGES = [...FUNNEL_ORDER, HANDOFF, HANDOFF_AFTER_INTAKE] as const;

export interface BadFunnelStage {
  stepId: string;
  value: string;
  /** high = typo ของกลุ่ม handoff (ตาข่ายความปลอดภัยหาย · พ.ร.บ.อาหาร) → เด่นกว่าประตูขาย */
  severity: "high" | "normal";
}

/**
 * ตรวจ funnel_stage ทุกแถวเทียบ VALID_FUNNEL_STAGES (Step 6) — คืนแถวที่ผิด (value+stepId+severity)
 * 🔴 typo ของ handoff/handoff_after_intake (มี "handof"/"intake") = severity high — ตาข่าย handoff หาย = อันตรายสุด
 * fail-safe: ไม่ skip/remap แถว (คนแก้คือเจ้าของ) · header พัง (parse ไม่ได้) → [] (คนละปัญหา · loader อื่นจับ)
 */
export function validateStepFunnelStages(rows: string[][]): BadFunnelStage[] {
  const parsed = parseStepRows(rows);
  if (!parsed) return [];
  const valid = new Set<string>(VALID_FUNNEL_STAGES);
  const out: BadFunnelStage[] = [];
  for (const s of parsed.steps) {
    if (valid.has(s.funnelStage)) continue;
    out.push({ stepId: s.stepId, value: s.funnelStage, severity: /handof|intake/i.test(s.funnelStage) ? "high" : "normal" });
  }
  return out;
}

/** ชื่อประตู (ชื่อประตู) ของ step_id — ใช้ในข้อความแจ้งแอดมิน push-on-exit (D-34) */
export function stepNameOf(rows: string[][], stepId: string): string | null {
  if (!stepId) return null;
  const parsed = parseStepRows(rows);
  return parsed?.steps.find((s) => s.stepId === stepId)?.name ?? null;
}

/** ต่อ "ตัวอย่างคำตอบ" + "ตัวอย่างประโยคปิดท้าย" เป็น pattern เดียว (D-39B2) — ปิดท้าย = บอลลูนสุดท้ายเสมอ
 *  🔴 คั่นด้วย [[แยก]] อัตโนมัติ (เจ้าของไม่ต้องพิมพ์เอง) · ช่องว่างถูกข้าม (ไม่มีบอลลูนเปล่า/[[แยก]] เกิน) */
export function joinVerbatimParts(...parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join("[[แยก]]");
}

/**
 * Phase2 ชั้น③ — โหมด "คิดเอง" + pattern (ตัวอย่างคำตอบ + ปิดท้าย) ของ step_id ที่ AI เลือก
 * โหมดปิด → route ส่ง pattern เป๊ะ (verbatim) แทน reply ที่ AI แต่ง · ไม่เจอ step → null (route ใช้ AI)
 * pattern = "ตัวอย่างคำตอบ" [[แยก]] "ปิดท้าย" (ข้ามช่องว่าง) · resolve/แยกบอลลูน ทำที่ route เหมือน AI reply
 */
export function stepVerbatim(rows: string[][], stepId: string): { mode: ThinkMode; pattern: string } | null {
  if (!stepId) return null;
  const parsed = parseStepRows(rows);
  const s = parsed?.steps.find((x) => x.stepId === stepId);
  return s ? { mode: s.think, pattern: joinVerbatimParts(s.example, s.closing) } : null;
}

function nextFunnelStage(stage: string): string | null {
  const idx = FUNNEL_ORDER.indexOf(stage);
  return idx >= 0 && idx + 1 < FUNNEL_ORDER.length ? FUNNEL_ORDER[idx + 1] : null;
}

function gatesInStages(steps: StepRow[], stages: string[]): string[] {
  return steps.filter((s) => stages.includes(s.funnelStage)).map((s) => s.stepId);
}

/** entry match แบบ data-driven: ดึงตัวอย่างในเครื่องหมายคำพูดจาก "เข้าเมื่อ" แล้วเทียบข้อความลูกค้า */
function matchesEntry(entryWhen: string, userMessage: string): boolean {
  const quoted = entryWhen.match(/["'“”‘’]([^"'“”‘’\n]{1,40})["'“”‘’]/g);
  if (!quoted) return false;
  for (const q of quoted) {
    const inner = q.replace(/["'“”‘’]/g, "").trim();
    if (inner && userMessage.includes(inner)) return true;
  }
  return false;
}

function indexLine(s: StepRow): string {
  return `${s.stepId} | ${s.name} | ${s.funnelStage} | เข้าเมื่อ: ${s.entryWhen} | ไปต่อ: ${s.nextWhen}`;
}

/** เอาบอลลูนแรกของ "ตัวอย่างคำตอบ" (คั่นด้วย [[เว้น]]/[[แยก]]) — ลด token คงตัวอย่าง 1 ชุด */
function firstBubble(example: string): string {
  return example.split(/\[\[เว้น\]\]|\[\[แยก\]\]/)[0].trim();
}

function fullSalesBlock(s: StepRow): string {
  // 🔴 ตัด "ทำไมสำคัญ" (meta สำหรับคนเทรน) · คง ความรู้สึก/หลักการ/ห้ามทำ (สมองการขาย) · ตัวอย่างชุดแรก
  const parts = [
    `[${s.stepId}] ${s.name} (funnel: ${s.funnelStage})`,
    `เข้าเมื่อ: ${s.entryWhen}`,
    s.feeling && `ความรู้สึกลูกค้า: ${s.feeling}`,
    s.principle && `หลักการนำพา: ${s.principle}`,
    s.dont && `ห้ามทำ: ${s.dont}`,
    s.collect && `ต้องเก็บข้อมูล: ${s.collect}`,
    s.example && `ตัวอย่างคำตอบ: ${firstBubble(s.example)}`,
    s.closing && `ประโยคปิดท้าย: ${s.closing}`,
    `ไปต่อ: ${s.nextWhen}`,
  ];
  return parts.filter(Boolean).join("\n");
}

/** handoff = "หยุดแล้วส่งต่อ" ไม่ใช่ "เข้าใจเพื่อขาย" → ตัด ความรู้สึก/ทำไมสำคัญ (สมองการขาย) ออก */
function leanHandoffBlock(s: StepRow): string {
  const parts = [
    `[${s.stepId}] ${s.name} (handoff)`,
    `เข้าเมื่อ: ${s.entryWhen}`,
    s.dont && `ห้ามทำ: ${s.dont}`, // 🔴 รั้ว ห้ามตัด
    s.example && `ตัวอย่างคำตอบ: ${s.example}`,
  ];
  return parts.filter(Boolean).join("\n");
}

/** region routing (D-18): โค้ดตัดสิน funnel จาก pending ไม่พึ่ง AI stage */
const PRE_QUOTE_REGION = ["lead", "qualified", "quoted"]; // ยังไม่สรุปยอด (items ยังไม่เข้า) — S3 สรุปยอดเข้าถึงได้
const POST_QUOTE_REGION = ["awaiting_payment", "awaiting_address", "won"]; // สรุปยอดแล้ว (มี items) — เก็บของ/ปิดจบ
const FULL_CAP = 4;

export interface StepInjectionInput {
  /** pending_order (ก่อน merge เทิร์นนี้) มี items แล้วหรือยัง = "สรุปยอดแล้ว" */
  quoted: boolean;
  /** ช่องทางชำระที่เลือกแล้วใน pending ("COD"/"โอน"/"") — filter ประตูอีกฝั่งออก */
  payment: string;
  userMessage: string;
  /**
   * สัญญาณสถานะจากโค้ด (D-32) เช่น ["order_editable"] / ["order_confirmed_locked"]
   * ประตูที่ "เข้าเมื่อ" มี token ตรงสัญญาณที่ active → ยัดเต็มเสมอ (เจ้าของคุมว่าประตูไหนใช้สัญญาณไหน · ไม่ hardcode step_id)
   */
  signals?: string[];
  /**
   * step_id ที่ลูกค้าอยู่ตอนนี้ (customer.stage · D-34) — ถ้าเป็นประตู funnel_stage=handoff_after_intake
   * → คงประตูนั้นไว้เต็ม (บอทคุย intake ต่อข้ามเทิร์น) · **additive** ไม่ล็อก (ประตูอื่นยังยัดตามปกติ AI ย้ายออกได้)
   */
  stayStage?: string;
}

/** ประตูนี้ผูกกับวิธีจ่ายไหน — อ่านจาก "เข้าเมื่อ" (data-driven ไม่ hardcode step_id) */
function gatePayment(s: StepRow): "COD" | "โอน" | "" {
  const cod = /COD|ปลายทาง/i.test(s.entryWhen);
  const transfer = /โอน/.test(s.entryWhen);
  if (cod && !transfer) return "COD";
  if (transfer && !cod) return "โอน";
  return "";
}

/**
 * ประกอบเนื้อ Step สำหรับเทิร์นนี้ — region routing จาก pending (โค้ด) ไม่ใช่ stage ที่ AI ตอบ
 *  - สารบัญ = ทุกประตูเสมอ · เนื้อเต็ม = region ปัจจุบัน (cap 4 ตาม priority)
 *  - handoff + ประตูข้าม (crossover: ไม่มีใครชี้มา · ไม่ใช่ lead) = เต็มเฉพาะ entry-match · ไม่นับ cap
 */
export function buildStepInjection(rows: string[][], input: StepInjectionInput): string {
  const parsed = parseStepRows(rows);
  if (!parsed) {
    const whole = tabToText(rows);
    console.warn(JSON.stringify({ scope: "inject", tab: "CSV_Step", mode: "fallback-whole", chars: whole.length }));
    return whole;
  }
  const { steps, stepIds } = parsed;
  const { quoted, payment, userMessage, signals = [], stayStage } = input;
  const signalMatch = (s: StepRow) => signals.length > 0 && signals.some((sig) => sig && s.entryWhen.includes(sig));
  // D-34: คงประตู intake ที่ลูกค้าอยู่ (additive · ไม่ล็อก) — บอทคุย intake ต่อได้ข้ามเทิร์น
  const stayMatch = (s: StepRow) => Boolean(stayStage) && s.stepId === stayStage && s.funnelStage === HANDOFF_AFTER_INTAKE;

  // funnel_stage ผิด = validate ตอนโหลด (validateStepFunnelStages · Step 6) ไม่ warn ต่อ turn · แถวยังโหลด (fail-safe)

  // ประตูข้าม (crossover) = ไม่มีประตูอื่นชี้มาใน "ไปประตูถัดไปเมื่อ" และไม่ใช่ lead (ทางเข้าปกติ)
  const incoming = new Set<string>();
  for (const s of steps) for (const d of resolveDestinations(s.nextWhen, stepIds)) incoming.add(d);
  const isCrossover = (s: StepRow) => s.funnelStage !== HANDOFF && s.funnelStage !== FUNNEL_ORDER[0] && !incoming.has(s.stepId);

  const region = quoted ? POST_QUOTE_REGION : PRE_QUOTE_REGION;
  const anchor = quoted ? (payment === "" ? "awaiting_payment" : "awaiting_address") : "qualified";
  const anchorIdx = FUNNEL_ORDER.indexOf(anchor);

  const regionGates = steps.filter((s) => region.includes(s.funnelStage) && !isCrossover(s));

  // entry-match ใน region · ถ้า match > 2 ประตู = คำกว้างเกิน ถือว่าไม่ match (กันบาน)
  const matched = new Set(regionGates.filter((s) => matchesEntry(s.entryWhen, userMessage)).map((s) => s.stepId));
  const entryActive = matched.size <= 2 ? matched : new Set<string>();

  // ปลายทางของประตูใน region (priority #2)
  const regionDest = new Set<string>();
  for (const s of regionGates) for (const d of resolveDestinations(s.nextWhen, stepIds)) regionDest.add(d);

  // filter วิธีจ่าย (C): ประตูผูกวิธีจ่าย "อีกฝั่ง" ตัดออก เว้นแต่ลูกค้าพูดถึง (entry-match = เปลี่ยนใจ)
  const candidates = regionGates.filter((s) => {
    const gp = gatePayment(s);
    const otherPayment = payment !== "" && gp !== "" && gp !== payment;
    return !(otherPayment && !entryActive.has(s.stepId));
  });

  // priority (น้อย = สำคัญ): 0 match วิธีจ่ายเป๊ะ · 1 ปลายทาง · 2 entry-match · 3 อื่น (proximity ตัดสิน)
  const score = (s: StepRow): number => {
    if (payment !== "" && gatePayment(s) === payment) return 0;
    if (regionDest.has(s.stepId)) return 1;
    if (entryActive.has(s.stepId)) return 2;
    return 3;
  };
  const proximity = (s: StepRow) => Math.abs(FUNNEL_ORDER.indexOf(s.funnelStage) - anchorIdx);
  const ranked = [...candidates].sort(
    (a, b) => score(a) - score(b) || proximity(a) - proximity(b) || FUNNEL_ORDER.indexOf(a.funnelStage) - FUNNEL_ORDER.indexOf(b.funnelStage),
  );
  const fullRegionIds = new Set(ranked.slice(0, FULL_CAP).map((s) => s.stepId));

  const fullBlocks: string[] = [];
  for (const s of steps) {
    if (s.funnelStage === HANDOFF) {
      if (matchesEntry(s.entryWhen, userMessage) || signalMatch(s)) fullBlocks.push(leanHandoffBlock(s)); // entry-match/สัญญาณ · ไม่นับ cap
    } else if (signalMatch(s) || stayMatch(s)) {
      fullBlocks.push(fullSalesBlock(s)); // D-32 สัญญาณ / D-34 คงประตู intake → ยัดเต็มเสมอ (ไม่โยนกลับต้นกรวย)
    } else if (isCrossover(s)) {
      if (matchesEntry(s.entryWhen, userMessage)) fullBlocks.push(fullSalesBlock(s)); // ประตูข้าม: เต็มเฉพาะพูดถึง · ไม่นับ cap
    } else if (fullRegionIds.has(s.stepId)) {
      fullBlocks.push(fullSalesBlock(s));
    }
  }

  return [
    "=== สารบัญประตูทั้งหมด (ทางเข้าทุกประตู — ดูว่าลูกค้าอยู่ประตูไหน) ===",
    ...steps.map(indexLine),
    "",
    "=== ประตูที่เกี่ยวข้องตอนนี้ (เนื้อเต็ม) ===",
    ...fullBlocks,
  ].join("\n");
}

// ---- Catalog (สินค้า + ตารางราคาสำเร็จรูป · D-24 C6 เต็มรูป) ----

import { buildPriceTable, liveProductSkus, PriceTable } from "@/lib/core/pricing";

/** คอลัมน์สินค้าที่ยัด (ไม่รวมราคา — ราคาทุกตัวมาจากตารางราคาสำเร็จรูปที่เดียว กันบอทหยิบเลขผิดตาราง) */
const CATALOG_PRODUCT_COLS = ["sku", "ชื่อสินค้า", "หน่วย", "สถานะ"];

/** project ตารางเหลือเฉพาะคอลัมน์ที่ระบุ (จับหัวด้วย cleanHeader · ไม่เจอ = ข้าม) */
function projectColumns(rows: string[][], keep: string[]): string[][] {
  if (rows.length === 0) return rows;
  const header = rows[0].map(cleanHeader);
  const idxs = keep.map((k) => header.indexOf(k)).filter((i) => i >= 0);
  if (idxs.length === 0) return rows; // หัวไม่ตรงเลย = อย่าตัดมั่ว ยัดทั้งก้อน
  return rows.map((r) => idxs.map((i) => r[i] ?? ""));
}

/** ตัดคำอธิบายในวงเล็บท้ายคีย์ (เหมือน config.ts) — "จำนวนที่ไม่มีโปร (auto)" → "จำนวนที่ไม่มีโปร" */
function stripKeyAnnotation(key: string): string {
  return key.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * อ่าน "คำอธิบาย" (คอลัมน์ E ของ CSV_Config) ของคีย์ที่ระบุ — เจ้าของเขียนวิธีคิดไว้ที่นี่
 * โค้ดอ่านค่า (คอลัมน์ C) ไปคำนวณ แต่คำอธิบายไม่เคยถึงบอท → ดึงมายัด prompt (อ่านจากชีต ไม่ hardcode)
 * ไม่มี header/คีย์/คำอธิบาย → คืน "" (graceful — บอทยังมีตารางราคาไว้ตอบได้)
 */
export function readConfigDescription(configRows: string[][], key: string): string {
  if (!configRows || configRows.length === 0) return "";
  for (let h = 0; h < Math.min(configRows.length, 5); h++) {
    const header = configRows[h].map((c) => cleanHeader(c).toLowerCase());
    let keyCol = -1;
    let descCol = -1;
    for (let j = 0; j < header.length; j++) {
      if (keyCol === -1 && (header[j].includes("key") || header[j] === "ค่า")) keyCol = j;
      if (descCol === -1 && header[j].includes("อธิบาย")) descCol = j;
    }
    if (keyCol === -1 || descCol === -1) continue;
    for (let i = h + 1; i < configRows.length; i++) {
      const k = stripKeyAnnotation(cleanCell(configRows[i][keyCol] ?? ""));
      if (k === key) return cleanCell(configRows[i][descCol] ?? "");
    }
    return ""; // เจอ header แต่ไม่มีคีย์นั้น
  }
  return "";
}

export interface CatalogInput {
  /** CSV_Config เป็น key→value (Object.fromEntries(config.raw)) — ให้ buildPriceTable คำนวณ */
  config: Record<string, string>;
  /** ช่องทางชำระใน pending ("COD"/"โอน"/"") — ตารางต้องใช้ตัวเดียวกับที่ gate จะบันทึก */
  payment: string;
  now?: Date;
  /** วิธีคิด (คอลัมน์คำอธิบายของ `จำนวนที่ไม่มีโปร_คิดยังไง` ในชีต) — บอทใช้อธิบายลูกค้าเท่านั้น */
  methodDescription?: string;
}

/**
 * format ตารางราคาของ sku เดียว — แจกแจง 3 ตัวเลขต่อแถว (สินค้า/ค่าส่ง/รวม) ทุกตัวจาก calculatePrice
 * 🔴 ให้ครบพอบอท "แจกแจง" ได้ (ไม่ต้องคิดเลขเอง) + เห็นค่าส่งหายตอนถึงโปรส่งฟรี (เหตุผลขยับชั้น)
 *    ท่าพูด/จะแจกแจงหรือไม่ = ชีต Step คุม · โค้ดแค่ให้ข้อมูลครบ
 */
function formatPriceTable(t: PriceTable): string {
  const lines = t.rows.map((r) =>
    r.freeShip
      ? `${r.qty} ${t.unit}: สินค้า ${r.subtotal} + ส่งฟรี = รวม ${r.total} บาท`
      : `${r.qty} ${t.unit}: สินค้า ${r.subtotal} + ค่าส่ง ${r.shippingFee} = รวม ${r.total} บาท`,
  );
  return [
    `${t.name}:`,
    ...lines,
    `จำนวนเกิน ${t.ceiling} ${t.unit} → ส่งต่อแอดมิน (บอทปิดออเดอร์เองไม่ได้ อย่าเดายอด)`,
  ].join("\n");
}

/**
 * ยัดสินค้า + "ตารางราคาสำเร็จรูป" เข้า prompt เสมอ (C6 เต็มรูป · D-24)
 * 🔴 เลขทุกตัวมาจาก calculatePrice (แหล่งเดียวกับ gate) — บอทหยิบเลข ไม่คำนวณเอง
 *    (LLM เข้าใจ logic แต่ปัดเศษ/ทศนิยมไม่แม่น เช่น หยิบ 95 แทน 91.67 → ต้องให้คำตอบ ไม่ใช่สอนวิธี)
 *    calculatePrice ล้ม (config พัง) → ไม่ยัดตาราง + สั่ง handoff (ตรงกับ priceStuck ฝั่ง gate)
 * ⚠️ ตาราง enumerate ได้เพราะสินค้า live ตัวเดียว · หลาย sku (ตะกร้าผสม) = ต้องใช้ function calling (ดู DECISIONS D-24)
 */
export function buildCatalogInjection(productsRows: string[][], promoRows: string[][], input: CatalogInput): string {
  const products = productsRows.length > 0 ? tabToText(projectColumns(productsRows, CATALOG_PRODUCT_COLS)) : "(ไม่มีข้อมูลสินค้า)";

  // ตารางราคาของสินค้า live ทุกตัว (ปัจจุบันตัวเดียว) — คำนวณจริงจาก calculatePrice
  const liveSkus = productsRows.length > 0 ? liveProductSkus(productsRows) : [];
  const tables = liveSkus.map((sku) => buildPriceTable(sku, promoRows, productsRows, input.config, input.payment, input.now));
  const okTables = tables.filter((t) => t.error === null && t.rows.length > 0);

  const priceBlock =
    okTables.length > 0
      ? [
          "ตารางราคา (🔴 ยอดสำเร็จรูปจากระบบ — หยิบเลขจากตารางนี้เท่านั้น ห้ามคำนวณ/บวก/ลบ/คูณ/ปัดเศษเอง · เลขนี้คือยอดที่ระบบจะบันทึกเป๊ะ):",
          ...okTables.map(formatPriceTable),
        ].join("\n")
      : "ตารางราคา: ⚠️ ระบบคำนวณราคาไม่ได้ตอนนี้ — ห้ามบอกราคา/ปิดออเดอร์ ให้ส่งต่อแอดมินตรวจสอบ";

  const parts = ["สินค้า:", products, "", priceBlock];
  const desc = (input.methodDescription ?? "").trim();
  if (desc && okTables.length > 0) {
    parts.push("", `วิธีคิดราคา (ใช้อธิบายให้ลูกค้าเข้าใจเท่านั้น 🔴 ห้ามใช้คิดเลข — เลขหยิบจากตารางข้างบน): ${desc}`);
  }
  return parts.join("\n");
}

// ---- Objections (D-27) — เข้าใจ "ความกังวลจริง+หลักการตอบ" ประกอบคำตอบเอง ----

const OBJECTION_COLS = ["objection_id", "ลูกค้าพูดแบบไหนบ้าง", "ความกังวลที่แท้จริง", "หลักการตอบ"];

export interface ObjectionInjection {
  text: string;
  matchedIds: string[];
  /**
   * Phase2 ชั้น③ — ข้อโต้แย้งที่ match + คิดเอง=ปิด + มี pattern (ตัวแรก)
   * มีค่า = objection ชนะ step (ส่ง pattern เป๊ะ) · null = ปล่อย AI ตัดสิน (เปิด/ไม่มี pattern = ไม่บังคับชนะ)
   */
  verbatim: { id: string; pattern: string } | null;
}

/**
 * ยัดข้อโต้แย้ง: สารบัญ (id+ชื่อ) ทุกแถวเสมอ + เต็มแถวเฉพาะที่ keyword match (สูงสุด cap)
 * 🔴 เจ้าของยังไม่เติมชีต → header ไม่ครบ/ว่าง = คืน "" ไม่ crash (Step/FAQ พอตอบได้)
 * เต็มแถว = ความกังวลจริง + หลักการตอบ + ห้ามทำ (บอทประกอบคำตอบเอง · ไม่ใช่สคริปต์)
 */
export function buildObjectionInjection(rows: string[][], userMessage: string, cap: number): ObjectionInjection {
  if (!rows || rows.length < 2) return { text: "", matchedIds: [], verbatim: null };
  const cols = resolveColumns(rows[0], OBJECTION_COLS, "CSV_Objections");
  if (!cols) {
    console.warn(JSON.stringify({ scope: "inject", tab: "CSV_Objections", warning: "header ไม่ครบ — ข้าม (Step/FAQ พอ)" }));
    return { text: "", matchedIds: [], verbatim: null };
  }
  const header = rows[0].map(cleanHeader);
  const nameIdx = header.findIndex((h) => h.startsWith("ชื่อ")); // "ชื่อข้อโต้แย้ง" (ชีตจริง)
  const dontIdx = header.indexOf("ห้ามทำ");
  const thinkIdx = header.indexOf("คิดเอง"); // Phase2 optional
  const exampleIdx = header.indexOf("ตัวอย่างคำตอบ"); // Phase2 optional — pattern verbatim ของข้อโต้แย้ง

  interface Obj { id: string; name: string; says: string; concern: string; principle: string; dont: string; think: ThinkMode; pattern: string; }
  const objs: Obj[] = [];
  for (let i = 1; i < rows.length; i++) {
    const id = cleanCell(cell(rows[i], cols, "objection_id"));
    if (!id) continue;
    objs.push({
      id,
      name: nameIdx >= 0 ? cleanCell(rows[i][nameIdx]) : "",
      says: cell(rows[i], cols, "ลูกค้าพูดแบบไหนบ้าง").trim(),
      concern: cell(rows[i], cols, "ความกังวลที่แท้จริง").trim(),
      principle: cell(rows[i], cols, "หลักการตอบ").trim(),
      dont: dontIdx >= 0 ? cleanCell(rows[i][dontIdx]) : "",
      think: parseThinkMode(thinkIdx >= 0 ? (rows[i][thinkIdx] ?? "") : ""),
      pattern: exampleIdx >= 0 ? (rows[i][exampleIdx] ?? "").trim() : "",
    });
  }
  if (objs.length === 0) return { text: "", matchedIds: [], verbatim: null };

  // keyword match: คอลัมน์ "ลูกค้าพูดแบบไหนบ้าง" คั่นด้วย comma → เทียบ substring กับข้อความลูกค้า
  const matched = objs
    .filter((o) => o.says.split(",").map((s) => cleanCell(s)).some((p) => p.length > 0 && userMessage.includes(p)))
    .slice(0, Math.max(0, cap));

  const fullBlocks = matched.map((o) =>
    [
      `[${o.id}] ${o.name}`,
      o.concern && `ความกังวลที่แท้จริง: ${o.concern}`,
      o.principle && `หลักการตอบ: ${o.principle}`,
      o.dont && `ห้ามทำ: ${o.dont}`,
    ].filter(Boolean).join("\n"),
  );

  const text = [
    "=== สารบัญข้อโต้แย้ง (id + ชื่อ) ===",
    ...objs.map((o) => `${o.id} | ${o.name}`),
    ...(fullBlocks.length > 0 ? ["", "=== ข้อโต้แย้งที่ตรวจพบ (ใช้ประกอบคำตอบเอง ห้ามลอกคำ) ===", ...fullBlocks] : []),
  ].join("\n");

  // Phase2 ชั้น③: objection ชนะ step เฉพาะเมื่อ คิดเอง=ปิด + มี pattern (เปิด/ไม่มี pattern = ไม่บังคับชนะ)
  const vObj = matched.find((o) => o.think === "ปิด" && o.pattern.length > 0);
  const verbatim = vObj ? { id: vObj.id, pattern: vObj.pattern } : null;

  return { text, matchedIds: matched.map((o) => o.id), verbatim };
}

// ---- Examples (D-27) — น้ำเสียง เลียนสไตล์ ห้ามลอกคำต่อคำ ----

const EXAMPLE_ANSWER_COL = "คำตอบที่ดี"; // ชีต CSV_Examples จริง (v1.5) ใช้ชื่อนี้ ไม่ใช่ "ตัวอย่างคำตอบที่ดี"

/**
 * ยัดตัวอย่างน้ำเสียง: match จาก step_id ปัจจุบัน และ/หรือ objection_id ที่เจอ (สูงสุด cap)
 * 🔴 เจ้าของยังไม่เติม → คืน "" · ตัวอย่าง = แนวน้ำเสียง ไม่ใช่บทท่อง (apply-not-parrot)
 */
export function buildExampleInjection(rows: string[][], stepId: string, objectionIds: string[], cap: number): string {
  if (!rows || rows.length < 2 || cap <= 0) return "";
  const cols = resolveColumns(rows[0], [EXAMPLE_ANSWER_COL], "CSV_Examples");
  if (!cols) {
    console.warn(JSON.stringify({ scope: "inject", tab: "CSV_Examples", warning: "header ไม่ครบ — ข้าม" }));
    return "";
  }
  const header = rows[0].map(cleanHeader);
  const stepIdx = header.indexOf("step_id");
  const objIdx = header.indexOf("objection_id");
  const objSet = new Set(objectionIds);

  const matches: string[] = [];
  for (let i = 1; i < rows.length && matches.length < cap; i++) {
    const answer = cell(rows[i], cols, EXAMPLE_ANSWER_COL).trim();
    if (!answer) continue;
    const rowStep = stepIdx >= 0 ? cleanCell(rows[i][stepIdx]) : "";
    const rowObj = objIdx >= 0 ? cleanCell(rows[i][objIdx]) : "";
    const hit = (stepId && rowStep === stepId) || (rowObj && objSet.has(rowObj));
    if (hit) matches.push(answer);
  }
  if (matches.length === 0) return "";

  return [
    "=== ตัวอย่างน้ำเสียง (เลียนสไตล์/โทน ห้ามลอกคำต่อคำ · ตัวเลข/ข้อเท็จจริงยึดของจริง) ===",
    ...matches.map((a) => `- ${a}`),
  ].join("\n");
}

// ---- FAQ ----

const FAQ_COLS = ["คำถาม", "keywords", "action", "คำตอบ"];
const FAQ_MAX_FULL = 3;

interface FaqRow {
  question: string;
  keywords: string[];
  action: string;
  answer: string;
}

function parseFaqRows(rows: string[][]): FaqRow[] | null {
  if (rows.length < 2) return null;
  const cols = resolveColumns(rows[0], FAQ_COLS, "CSV_FAQ");
  if (!cols) return null;
  const faqs: FaqRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const question = cell(r, cols, "คำถาม").trim();
    if (!question) continue;
    faqs.push({
      question,
      keywords: cell(r, cols, "keywords")
        .split(",")
        .map((k) => cleanCell(k))
        .filter(Boolean),
      action: cleanCell(cell(r, cols, "action")).toLowerCase(),
      answer: cell(r, cols, "คำตอบ").trim(),
    });
  }
  return faqs.length > 0 ? faqs : null;
}

export function buildFaqInjection(rows: string[][], userMessage: string): string {
  const faqs = parseFaqRows(rows);
  if (!faqs) {
    console.warn(JSON.stringify({ scope: "inject", warning: "CSV_FAQ header ไม่ครบ fallback ยัดทั้งก้อน" }));
    return tabToText(rows);
  }

  const matched = faqs.filter((f) => f.keywords.some((k) => userMessage.includes(k))).slice(0, FAQ_MAX_FULL);

  const fullBlocks = matched.map((f) => {
    // action=handoff → ไม่ยัดคำตอบ (กันบอท parrot) แค่บอกให้ส่งต่อ · การบังคับจริงฝั่งโค้ด = Step 4
    if (f.action === "handoff") return `${f.question}\n[action=handoff — ให้ส่งต่อแอดมิน ห้ามตอบเอง]`;
    return `${f.question}\n→ ${f.answer}`;
  });

  return [
    "=== สารบัญคำถามที่ตอบได้ (ถ้าไม่มีคำตอบเต็ม = ไม่มีข้อมูล ให้ส่งต่อแอดมิน ห้ามเดา) ===",
    ...faqs.map((f) => f.question),
    "",
    "=== คำตอบที่เกี่ยวกับข้อความลูกค้า ===",
    ...(fullBlocks.length > 0 ? fullBlocks : ["(ไม่มีคำถามที่ตรง — ถ้าลูกค้าถามเรื่องที่ไม่มีในสารบัญ ให้ส่งต่อแอดมิน)"]),
  ].join("\n");
}
