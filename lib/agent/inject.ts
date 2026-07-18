import { resolveColumns, cell, tabToText, ColumnMap } from "@/lib/sheets/columns";
import { cleanCell } from "@/lib/sheets/clean";

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
}

interface ParsedSteps {
  steps: StepRow[];
  stepIds: Set<string>;
}

function parseStepRows(rows: string[][]): ParsedSteps | null {
  if (rows.length < 2) return null;
  const cols = resolveColumns(rows[0], STEP_COLS, "CSV_Step");
  if (!cols) return null;

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

function fullSalesBlock(s: StepRow): string {
  const parts = [
    `[${s.stepId}] ${s.name} (funnel: ${s.funnelStage})`,
    `เข้าเมื่อ: ${s.entryWhen}`,
    s.feeling && `ความรู้สึกลูกค้า: ${s.feeling}`,
    s.why && `ทำไมสำคัญ: ${s.why}`,
    s.principle && `หลักการนำพา: ${s.principle}`,
    s.dont && `ห้ามทำ: ${s.dont}`,
    s.collect && `ต้องเก็บข้อมูล: ${s.collect}`,
    s.example && `ตัวอย่างคำตอบ: ${s.example}`,
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

/**
 * ประกอบเนื้อ Step ที่จะยัดเข้า prompt สำหรับเทิร์นนี้
 * @param currentStage stage ที่เก็บไว้ (step_id) — ถ้าหา exact ไม่เจอ = กำกวม → ยัดมากขึ้น
 */
export function buildStepInjection(rows: string[][], currentStage: string, userMessage: string): string {
  const parsed = parseStepRows(rows);
  if (!parsed) {
    const whole = tabToText(rows);
    // 🔴 fallback = selective ไม่ทำงาน (header ไม่ match) → prompt ไม่ลด · resolveColumns log missing/available แล้ว
    console.warn(JSON.stringify({ scope: "inject", tab: "CSV_Step", mode: "fallback-whole", chars: whole.length }));
    return whole;
  }
  const { steps, stepIds } = parsed;
  const cur = steps.find((s) => s.stepId === (currentStage ?? "").trim());

  const fullIds = new Set<string>();
  if (cur) {
    fullIds.add(cur.stepId);
    const dests = resolveDestinations(cur.nextWhen, stepIds);
    if (dests.size === 0) {
      const next = nextFunnelStage(cur.funnelStage); // parse ปลายทางพลาด → funnel ถัดไป
      if (next) for (const id of gatesInStages(steps, [next])) fullIds.add(id);
    } else {
      for (const id of dests) fullIds.add(id);
    }
  } else {
    // กำกวม: ไม่รู้ลูกค้าอยู่ประตูไหน → ยัดเต็ม funnel ต้น ๆ (บอทจับทางเอง)
    for (const id of gatesInStages(steps, AMBIGUOUS_STAGES)) fullIds.add(id);
  }
  // entry match (bonus) — ประตูขายที่ตัวอย่าง "เข้าเมื่อ" ตรงข้อความลูกค้า
  for (const s of steps) {
    if (s.funnelStage !== HANDOFF && matchesEntry(s.entryWhen, userMessage)) fullIds.add(s.stepId);
  }

  const fullBlocks: string[] = [];
  for (const s of steps) {
    if (s.funnelStage === HANDOFF) fullBlocks.push(leanHandoffBlock(s)); // เสมอ (lean)
    else if (fullIds.has(s.stepId)) fullBlocks.push(fullSalesBlock(s));
  }

  return [
    "=== สารบัญประตูทั้งหมด (ทางเข้าทุกประตู — ดูว่าลูกค้าอยู่ประตูไหน) ===",
    ...steps.map(indexLine),
    "",
    "=== ประตูที่เกี่ยวข้องตอนนี้ (เนื้อเต็ม) ===",
    ...fullBlocks,
  ].join("\n");
}

// ---- Catalog (สินค้า + ราคาโปร) ----

/**
 * ยัดสินค้า+ราคาโปรเข้า prompt "เสมอ" (ตารางเล็ก) — บอทใช้ราคานี้เท่านั้น ห้ามแต่งเอง (C6)
 * ใช้ tabToText ทั้งก้อน (ไม่ต้อง header-driven เพราะบอทอ่านตารางเอง + โครงคอลัมน์ยังไม่ล็อก)
 * 🔴 หมายเหตุ: การ "คำนวณยอดจากจำนวน" ให้เป็นเลขสำเร็จรูป (C6 เต็มรูป) = Step 3 (pricing.ts)
 *    ตอนนี้ยัดตารางโปรให้บอทเปิดดูราคาตรง ๆ (ดีกว่าบอทเดา · ราคาตรงชีต)
 */
export function buildCatalogInjection(productsRows: string[][], promoRows: string[][]): string {
  const products = productsRows.length > 0 ? tabToText(productsRows) : "(ไม่มีข้อมูลสินค้า)";
  const promo = promoRows.length > 0 ? tabToText(promoRows) : "(ไม่มีข้อมูลโปรโมชั่น)";
  return [
    "สินค้า:",
    products,
    "",
    "ราคา/โปรโมชั่น (🔴 ใช้ราคาตามตารางนี้เท่านั้น ห้ามคิด/แต่งราคาเอง — ไม่มีในตาราง = ไม่มีโปร):",
    promo,
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
