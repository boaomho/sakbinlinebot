import { describe, it, expect, vi } from "vitest";
import { buildStepInjection, buildFaqInjection, buildCatalogInjection, buildObjectionInjection, buildExampleInjection, readConfigDescription, resolveDestinations, validateStepFunnelStages, VALID_FUNNEL_STAGES } from "@/lib/agent/inject";
import { tabToText } from "@/lib/sheets/columns";
import { cleanHeader } from "@/lib/sheets/clean";
import { productsRows, promoRows, PRICING_CONFIG } from "../harness/botlib-fixture";

/**
 * Part 4 — Selective injection: ลด token + คงความฉลาด (บอทเห็นทางเข้าทุกประตูเสมอ)
 * 🔴 กติกา: สารบัญครบทุกประตูเสมอ · เต็มเฉพาะที่เกี่ยว · กำกวม=ยัดมากขึ้น · handoff lean
 */

// header 16 คอลัมน์ (มีวงเล็บกำกับที่ cleanHeader ต้องตัด: "ตัวอย่างคำตอบ (บอลลูน)")
const STEP_HEADER = [
  "step_id", "funnel_stage", "ชื่อประตู", "กรณี", "เข้าเมื่อ",
  "ความรู้สึกลูกค้าตอนนี้", "ทำไมประตูนี้สำคัญ", "หลักการนำพา", "ห้ามทำ", "ต้องเก็บข้อมูล",
  "ตัวอย่างคำตอบ (บอลลูน)", "ตัวอย่างประโยคปิดท้าย", "ติดแท็ก", "ไปประตูถัดไปเมื่อ", "funnel_label", "สถานะ",
];

/** สร้างแถว step (ใส่เฉพาะช่องที่เทสสน · ที่เหลือ fill ตามตำแหน่ง header) */
function step(o: Partial<Record<string, string>>): string[] {
  return STEP_HEADER.map((h) => o[h] ?? `${o.step_id ?? ""}-${h}`);
}

/** funnel_stage ตรงกับชีตจริง · S3_* = quoted (สรุปยอด) · X1/X2 = ประตูข้าม (ไม่มีใครชี้มา) */
function stepSheet(): string[][] {
  return [
    STEP_HEADER,
    step({ step_id: "S1", funnel_stage: "lead", ชื่อประตู: "ทักทาย", เข้าเมื่อ: 'ทักทายลอยๆ เช่น "สวัสดี"', ไปประตูถัดไปเมื่อ: "รู้ว่าสนใจ → S2", หลักการนำพา: "ทักทายอบอุ่น", ห้ามทำ: "ห้ามรีบขาย" }),
    step({ step_id: "S2", funnel_stage: "qualified", ชื่อประตู: "นำเสนอ", เข้าเมื่อ: "รู้แล้วว่าสนใจตัวไหน", ไปประตูถัดไปเมื่อ: "แจ้งจำนวน → S2_CONFIRM", หลักการนำพา: "เสนอโปร", ห้ามทำ: "ห้ามกดดัน" }),
    step({ step_id: "S2_DIRECT", funnel_stage: "qualified", ชื่อประตู: "สั่งตรง", เข้าเมื่อ: 'บอกจำนวนเลย เช่น "สั่ง 3 ถ้วยครับ"', ไปประตูถัดไปเมื่อ: "→ S2_CONFIRM" }),
    step({ step_id: "S2_CONFIRM", funnel_stage: "qualified", ชื่อประตู: "สรุปยอด", เข้าเมื่อ: "มีจำนวนแล้ว", ไปประตูถัดไปเมื่อ: "เลือกวิธีจ่าย → S3", หลักการนำพา: "สรุปยอดชวนเลือกจ่าย", ห้ามทำ: "ห้ามข้ามยอด" }),
    step({ step_id: "S3_TRANSFER", funnel_stage: "quoted", ชื่อประตู: "โอน", เข้าเมื่อ: "เลือกโอนแล้ว", ไปประตูถัดไปเมื่อ: "รอสลิป → S4C" }),
    step({ step_id: "S3_COD", funnel_stage: "quoted", ชื่อประตู: "ปลายทาง", เข้าเมื่อ: "เลือกเก็บปลายทาง COD", ไปประตูถัดไปเมื่อ: "ที่อยู่ครบ → S4A" }),
    step({ step_id: "X1", funnel_stage: "quoted", ชื่อประตู: "เปลี่ยนวิธีจ่าย", เข้าเมื่อ: 'ขอเปลี่ยนวิธีจ่าย เช่น "เปลี่ยนเป็นโอน"', ไปประตูถัดไปเมื่อ: "" }),
    step({ step_id: "S4C", funnel_stage: "awaiting_payment", ชื่อประตู: "รอสลิปโอน", เข้าเมื่อ: "โอนแล้วรอสลิป", ไปประตูถัดไปเมื่อ: "ได้สลิป → S4A" }),
    step({ step_id: "S4A", funnel_stage: "awaiting_address", ชื่อประตู: "เก็บที่อยู่", เข้าเมื่อ: "ต้องเก็บที่อยู่", ไปประตูถัดไปเมื่อ: "ครบ → S4B" }),
    step({ step_id: "S4B", funnel_stage: "won", ชื่อประตู: "ปิดจบ", เข้าเมื่อ: "ครบแล้ว", ไปประตูถัดไปเมื่อ: "" }),
    step({ step_id: "X2", funnel_stage: "post_sale", ชื่อประตู: "หลังขาย", เข้าเมื่อ: 'ถามหลังซื้อ เช่น "ของถึงยัง"', ไปประตูถัดไปเมื่อ: "" }),
    step({ step_id: "H1", funnel_stage: "handoff", ชื่อประตู: "เคลม", เข้าเมื่อ: 'ของเสีย/แพ้อาหาร เช่น "แพ้อาหาร"', ห้ามทำ: "ห้ามตอบเอง ห้ามมั่ว", "ตัวอย่างคำตอบ (บอลลูน)": "ขอตามแอดมินมาดูแลนะคะ", ความรู้สึกลูกค้าตอนนี้: "กังวลมาก", ทำไมประตูนี้สำคัญ: "ความปลอดภัย" }),
    step({ step_id: "H2", funnel_stage: "handoff", ชื่อประตู: "ต่อรอง", เข้าเมื่อ: "ขอส่วนลด", ห้ามทำ: "ห้ามลดเอง", "ตัวอย่างคำตอบ (บอลลูน)": "ขอส่งต่อแอดมินนะคะ" }),
  ];
}

/** นับ block เต็ม [Sx]/[Hx] ในผลลัพธ์ (เนื้อเต็ม ไม่ใช่สารบัญ) */
function fullIds(out: string): string[] {
  const after = out.split("=== ประตูที่เกี่ยวข้องตอนนี้")[1] ?? "";
  return [...after.matchAll(/\[([A-Z0-9_]+)\]/g)].map((m) => m[1]);
}
const PRE: (u: string) => Parameters<typeof buildStepInjection>[1] = (u) => ({ quoted: false, payment: "", userMessage: u });

describe("resolveDestinations — parse ปลายทาง (regex + prefix + หลายปลายทาง)", () => {
  const ids = new Set(["S1", "S2", "S2_DIRECT", "S3_TRANSFER", "S3_COD", "S4A", "S4B", "S4C"]);

  it("exact: S4A → S4A เท่านั้น (ไม่ลาม S4B)", () => {
    expect([...resolveDestinations("ที่อยู่ครบ → S4A", ids)]).toEqual(["S4A"]);
  });
  it("🔴 prefix: S3 → S3_TRANSFER + S3_COD", () => {
    const out = resolveDestinations("ลูกค้าแจ้งจำนวน → S3", ids);
    expect(out.has("S3_TRANSFER")).toBe(true);
    expect(out.has("S3_COD")).toBe(true);
  });
  it("หลายปลายทาง คั่นด้วย ·", () => {
    const out = resolveDestinations("ได้สลิป → S4A · ที่อยู่ครบก่อน → S4C", ids);
    expect([...out].sort()).toEqual(["S4A", "S4C"]);
  });
  it("format แปลก (ไม่มี step_id) → เซ็ตว่าง (ผู้เรียก fallback)", () => {
    expect(resolveDestinations("คุยกันรู้เรื่องแล้ว", ids).size).toBe(0);
  });
});

describe("buildStepInjection — region routing (D-18)", () => {
  it("🔴 สารบัญมีทุกประตูเสมอ (เห็นทางเข้าทุกประตู)", () => {
    const out = buildStepInjection(stepSheet(), PRE("เอาสองถ้วย"));
    for (const id of ["S1", "S2", "S2_DIRECT", "S3_TRANSFER", "S3_COD", "X1", "S4A", "S4B", "X2", "H1", "H2"]) {
      expect(out, `สารบัญต้องมี ${id}`).toContain(id);
    }
  });

  it("🔴 ไม่ข้าม S3: ยังไม่มี items (quoted=false) → region มี quoted → S3 (สรุปยอด/quoted) เข้าถึงได้", () => {
    const out = buildStepInjection(stepSheet(), PRE("เอา 3 ถ้วย"));
    const full = fullIds(out);
    // S2_CONFIRM (สรุปยอด) หรือ S3_* (quoted) ต้องมีเนื้อเต็มอย่างน้อยหนึ่ง — ไม่โดนข้าม
    expect(full.some((id) => ["S2_CONFIRM", "S3_TRANSFER", "S3_COD"].includes(id)), "S3/สรุปยอด ต้องเต็ม").toBe(true);
    // S4 (post-quote) ยังไม่เต็ม
    expect(full).not.toContain("S4A");
    expect(full).not.toContain("S4B");
  });

  it("🔴 มี items แล้ว (quoted=true) + COD → region S4 · S3_TRANSFER(quoted) ไม่เต็ม", () => {
    const out = buildStepInjection(stepSheet(), { quoted: true, payment: "COD", userMessage: "โอเคค่ะ" });
    const full = fullIds(out);
    expect(full).toContain("S4A"); // awaiting_address (COD ต้องเก็บที่อยู่)
    expect(full, "S3_TRANSFER = quoted stage นอก region").not.toContain("S3_TRANSFER");
    expect(full, "S3_COD = quoted stage นอก region").not.toContain("S3_COD");
  });

  it("🔴 filter วิธีจ่าย: quoted=true payment=COD → S4C (โอน) ไม่เต็ม", () => {
    const out = buildStepInjection(stepSheet(), { quoted: true, payment: "COD", userMessage: "โอเคค่ะ" });
    expect(fullIds(out), "S4C ผูกโอน (รอสลิป) → ไม่ยัดตอน COD").not.toContain("S4C");
  });

  it("🔴 X1 (crossover) เต็มเฉพาะพูดถึง + ไม่นับ cap · ปกติไม่เต็ม", () => {
    const noMention = buildStepInjection(stepSheet(), PRE("เอา 3 ถ้วย"));
    expect(fullIds(noMention), "ไม่พูดถึง = X1 ไม่เต็ม").not.toContain("X1");
    const mention = buildStepInjection(stepSheet(), { quoted: true, payment: "COD", userMessage: "ขอเปลี่ยนเป็นโอน" });
    expect(fullIds(mention), "พูดถึงเปลี่ยนวิธีจ่าย → X1 เต็ม").toContain("X1");
  });

  it("🔴 handoff เต็มเฉพาะ entry-match (ไม่ใช่เต็มตลอด) · มี ห้ามทำ · ไม่มี ความรู้สึก/ทำไมสำคัญ", () => {
    const noMatch = buildStepInjection(stepSheet(), PRE("เอา 3 ถ้วย"));
    expect(fullIds(noMatch), "ไม่ match = H1 ไม่เต็ม").not.toContain("H1");
    const match = buildStepInjection(stepSheet(), PRE("แพ้อาหาร กินได้มั้ย"));
    expect(match).toContain("[H1] เคลม (handoff)");
    expect(match).toContain("ห้ามทำ: ห้ามตอบเอง ห้ามมั่ว");
    expect(match, "handoff ไม่ยัด ความรู้สึก").not.toContain("ความรู้สึกลูกค้า: กังวลมาก");
    expect(match, "handoff ไม่ยัด ทำไมสำคัญ").not.toContain("ทำไมสำคัญ");
  });

  it("🔴 cap 4: ปลายทางได้ slot ก่อนประตูร่วม stage · full ≤ 4 (ไม่นับ crossover/handoff)", () => {
    const out = buildStepInjection(stepSheet(), PRE("ราคาเท่าไหร่"));
    const full = fullIds(out).filter((id) => !["X1", "X2", "H1", "H2"].includes(id));
    expect(full.length, "region full ≤ cap 4").toBeLessThanOrEqual(4);
    // S2_CONFIRM (ปลายทางของ S2/S2_DIRECT) ต้องได้ slot ก่อนเพื่อน qualified
    expect(full, "ปลายทาง S2_CONFIRM ต้องเต็ม").toContain("S2_CONFIRM");
  });

  it("🔴 fullSalesBlock: ตัด 'ทำไมสำคัญ' · คง หลักการ/ห้ามทำ · ตัวอย่างชุดแรก", () => {
    const rows = stepSheet();
    rows[4][STEP_HEADER.indexOf("ตัวอย่างคำตอบ (บอลลูน)")] = "ชุดแรกค่ะ[[เว้น]]ชุดสองไม่ควรมา";
    rows[4][STEP_HEADER.indexOf("ทำไมประตูนี้สำคัญ")] = "เหตุผลคนเทรน";
    const out = buildStepInjection(rows, { quoted: false, payment: "", userMessage: "สรุปยอด" });
    expect(out, "ต้องมีตัวอย่างชุดแรก").toContain("ตัวอย่างคำตอบ: ชุดแรกค่ะ");
    expect(out, "ชุดสองต้องไม่มา").not.toContain("ชุดสองไม่ควรมา");
    expect(out, "ตัด ทำไมสำคัญ ออกจากเนื้อเต็ม").not.toContain("ทำไมสำคัญ: เหตุผลคนเทรน");
  });

  it("growth: เพิ่มประตูเท่าตัว → region full ยังคุมที่ cap 4 (ไม่ unbounded)", () => {
    const rows = stepSheet();
    for (let i = 0; i < 8; i++) rows.push(step({ step_id: `EX${i}`, funnel_stage: "qualified", ชื่อประตู: `พิเศษ${i}`, เข้าเมื่อ: "x", ไปประตูถัดไปเมื่อ: "→ S2_CONFIRM" }));
    const out = buildStepInjection(rows, PRE("ราคาเท่าไหร่"));
    const full = fullIds(out).filter((id) => !["X1", "X2", "H1", "H2"].includes(id));
    expect(full.length, "cap คุมไว้แม้ประตูเยอะ").toBeLessThanOrEqual(4);
  });

  it("🔴 funnel_stage ว่าง/ไม่รู้จัก → validateStepFunnelStages จับได้ (Step 6 · ย้ายจาก warn ต่อ turn ไปตอนโหลด)", () => {
    const rows = stepSheet();
    rows.push(step({ step_id: "BAD", funnel_stage: "", ชื่อประตู: "พัง", เข้าเมื่อ: "x" }));
    const bad = validateStepFunnelStages(rows);
    expect(bad.map((b) => b.stepId)).toContain("BAD");
    expect(bad.find((b) => b.stepId === "BAD")).toMatchObject({ value: "", severity: "normal" });
    // buildStepInjection ไม่ warn ต่อ turn แล้ว (validate ที่ loader) · แถวยังโหลด
    expect(buildStepInjection(rows, PRE("hi"))).toContain("BAD");
  });

  it("header ไม่ครบ → fallback ยัดทั้งก้อน (ไม่ตาบอด)", () => {
    const broken = [["step_id", "ชื่อประตู"], ["S1", "ทักทาย"]];
    const out = buildStepInjection(broken, PRE("hi"));
    expect(out).toBe(tabToText(broken));
  });
});

describe("buildStepInjection signals — S_EDIT/X2 routing จาก 'เข้าเมื่อ' (D-32 · ไม่ hardcode step_id)", () => {
  const sheet = () => [
    STEP_HEADER,
    step({ step_id: "S1", funnel_stage: "lead", ชื่อประตู: "ทักทาย", เข้าเมื่อ: "ทักทาย", ไปประตูถัดไปเมื่อ: "→ S2" }),
    step({ step_id: "S_EDIT", funnel_stage: "won", ชื่อประตู: "แก้ข้อมูล", เข้าเมื่อ: "order_editable (ลูกค้าขอแก้ก่อนคอนเฟิร์ม)", หลักการนำพา: "ทวนข้อมูลใหม่", ไปประตูถัดไปเมื่อ: "" }),
    step({ step_id: "X2E", funnel_stage: "handoff", ชื่อประตู: "แก้หลังล็อก", เข้าเมื่อ: "order_confirmed_locked", ห้ามทำ: "ห้ามแก้เอง", "ตัวอย่างคำตอบ (บอลลูน)": "ให้แอดมินดูแลนะคะ" }),
  ];

  it("🔴 signal order_editable → S_EDIT เนื้อเต็ม (ไม่ต้องมี keyword ในข้อความ · ไม่โยนกลับต้นกรวย)", () => {
    const out = buildStepInjection(sheet(), { quoted: false, payment: "", userMessage: "แก้เบอร์หน่อย", signals: ["order_editable"] });
    expect(fullIds(out)).toContain("S_EDIT");
    expect(fullIds(out)).not.toContain("X2E");
  });
  it("signal order_confirmed_locked → X2E (handoff)", () => {
    const out = buildStepInjection(sheet(), { quoted: false, payment: "", userMessage: "แก้เบอร์", signals: ["order_confirmed_locked"] });
    expect(fullIds(out)).toContain("X2E");
    expect(fullIds(out)).not.toContain("S_EDIT");
  });
  it("ไม่มีสัญญาณ → ไม่ยัด S_EDIT/X2E (โค้ดไม่ผูก step_id กับสัญญาณ)", () => {
    const out = buildStepInjection(sheet(), { quoted: false, payment: "", userMessage: "แก้เบอร์", signals: [] });
    expect(fullIds(out)).not.toContain("S_EDIT");
    expect(fullIds(out)).not.toContain("X2E");
  });
});

describe("validateStepFunnelStages — จับ typo funnel_stage (Step 6 · visibility ไม่ auto-แก้)", () => {
  const sheet = () => [
    STEP_HEADER,
    step({ step_id: "S1", funnel_stage: "lead", ชื่อประตู: "ทักทาย", เข้าเมื่อ: "ทักทาย", ไปประตูถัดไปเมื่อ: "→ S2" }),
    step({ step_id: "S2", funnel_stage: "qualified", ชื่อประตู: "นำเสนอ", ไปประตูถัดไปเมื่อ: "" }),
    step({ step_id: "H5", funnel_stage: "handof", ชื่อประตู: "เคลม-typo", ไปประตูถัดไปเมื่อ: "" }), // typo handoff → high
    step({ step_id: "H6", funnel_stage: "handoff_after_intak", ชื่อประตู: "intake-typo", ไปประตูถัดไปเมื่อ: "" }), // typo intake → high
    step({ step_id: "X9", funnel_stage: "quotedd", ชื่อประตู: "ขาย-typo", ไปประตูถัดไปเมื่อ: "" }), // typo ขาย → normal
  ];

  it("คืนแถวผิด พร้อม value + stepId + severity", () => {
    const bad = validateStepFunnelStages(sheet());
    expect(bad.map((b) => b.stepId).sort()).toEqual(["H5", "H6", "X9"]);
    expect(bad.find((b) => b.stepId === "H5")).toMatchObject({ value: "handof", severity: "high" });
  });

  it("🔴 typo กลุ่ม handoff (handof/intake) = severity high · ขาย = normal", () => {
    const bad = validateStepFunnelStages(sheet());
    expect(bad.find((b) => b.stepId === "H5")?.severity, "typo handoff").toBe("high");
    expect(bad.find((b) => b.stepId === "H6")?.severity, "typo intake").toBe("high");
    expect(bad.find((b) => b.stepId === "X9")?.severity, "typo ขาย").toBe("normal");
  });

  it("stage ถูกทุกตัว → ไม่มี error", () => {
    const good = [STEP_HEADER, step({ step_id: "S1", funnel_stage: "lead", ไปประตูถัดไปเมื่อ: "" }), step({ step_id: "H1", funnel_stage: "handoff", ไปประตูถัดไปเมื่อ: "" })];
    expect(validateStepFunnelStages(good)).toEqual([]);
  });

  it("🔴 fail-safe: แถว typo ยังโหลด (ขึ้นสารบัญ ไม่ถูก skip)", () => {
    const out = buildStepInjection(sheet(), { quoted: false, payment: "", userMessage: "hi" });
    expect(out, "H5 ยังอยู่ในสารบัญ (ไม่ auto-skip)").toContain("H5");
  });

  it("VALID_FUNNEL_STAGES ครบ 9 (region 7 + handoff 2)", () => {
    expect(VALID_FUNNEL_STAGES).toContain("handoff");
    expect(VALID_FUNNEL_STAGES).toContain("handoff_after_intake");
    expect(VALID_FUNNEL_STAGES.length).toBe(9);
  });
});

describe("buildStepInjection stayStage — คงประตู handoff_after_intake ข้ามเทิร์น (D-34 · additive)", () => {
  const sheet = () => [
    STEP_HEADER,
    step({ step_id: "S1", funnel_stage: "lead", ชื่อประตู: "ทักทาย", เข้าเมื่อ: "ทักทาย", ไปประตูถัดไปเมื่อ: "→ S2" }),
    step({ step_id: "S2_DIRECT", funnel_stage: "qualified", ชื่อประตู: "สั่งตรง", เข้าเมื่อ: 'บอกจำนวน เช่น "สั่ง 3 ถ้วย"', ไปประตูถัดไปเมื่อ: "" }),
    step({ step_id: "H_CLAIM", funnel_stage: "handoff_after_intake", ชื่อประตู: "เคลม-คุยก่อน", เข้าเมื่อ: 'ของเสีย เช่น "ของเสีย"', หลักการนำพา: "ทวนปัญหาก่อนส่งแอดมิน", ห้ามทำ: "ห้ามรับปาก", ไปประตูถัดไปเมื่อ: "" }),
  ];

  it("อยู่ H_CLAIM → คงประตูเต็ม แม้ข้อความไม่ entry-match (บอทคุย intake ต่อ)", () => {
    const out = buildStepInjection(sheet(), { quoted: false, payment: "", userMessage: "แล้วยังไงต่อคะ", stayStage: "H_CLAIM" });
    expect(fullIds(out), "คงประตู intake").toContain("H_CLAIM");
    expect(out, "หลักการนำพาให้บอทคุย").toContain("ทวนปัญหาก่อนส่งแอดมิน");
  });

  it("🔴 additive ไม่ล็อก — ประตูขายยังยัด (ลูกค้า pivot 'สั่ง 3 ถ้วย' → เห็น S2_DIRECT ด้วย)", () => {
    const out = buildStepInjection(sheet(), { quoted: false, payment: "", userMessage: "ขอสั่ง 3 ถ้วยเพิ่ม", stayStage: "H_CLAIM" });
    expect(fullIds(out), "intake คงอยู่").toContain("H_CLAIM");
    expect(fullIds(out), "ประตูขายก็ยัด (AI ย้ายออกได้)").toContain("S2_DIRECT");
  });

  it("ไม่ได้อยู่ intake (stayStage ประตูขาย) → ไม่ force ประตูใด", () => {
    const out = buildStepInjection(sheet(), { quoted: false, payment: "", userMessage: "เฉยๆ", stayStage: "S2_DIRECT" });
    expect(fullIds(out), "S2_DIRECT ไม่ใช่ intake → ไม่ force ผ่าน stayMatch").not.toContain("H_CLAIM");
  });
});

describe("buildCatalogInjection — ตารางราคาสำเร็จรูปจาก calculatePrice จริง (C6 เต็มรูป · D-24)", () => {
  const NOW = new Date("2026-07-18T03:00:00Z"); // โปร fixture live
  const base = (extra?: Record<string, string>, payment = "โอน") =>
    buildCatalogInjection(productsRows(), promoRows(), {
      config: { ...PRICING_CONFIG, ...(extra ?? {}) },
      payment,
      now: NOW,
      methodDescription: "เศษที่เกินโปรคิดตามเรทโปรฐาน",
    });

  it("🔴 4 ถ้วย = 367 (เทียบโปรฐาน default) — แจกแจง สินค้า/ค่าส่ง/รวม ครบ", () => {
    const out = base();
    expect(out, "แถว 4 ถ้วย รวม 367").toMatch(/4 ถ้วย: สินค้า \d+ .* = รวม 367 บาท/);
    expect(out, "3 ถ้วย ส่งฟรี รวม 275").toMatch(/3 ถ้วย: สินค้า 275 \+ ส่งฟรี = รวม 275 บาท/);
    expect(out, "1 ถ้วย แจกแจงค่าส่งแยก").toMatch(/1 ถ้วย: สินค้า 95 \+ ค่าส่ง 30 = รวม 125 บาท/);
    expect(out, "ห้ามคำนวณเอง").toContain("ห้ามคำนวณ");
    expect(out, "วิธีคิดจากชีต").toContain("เศษที่เกินโปรคิดตามเรทโปรฐาน");
  });

  it("🔴 เปลี่ยน config = ราคาปกติ → 4 ถ้วย = รวม 370 (ตารางเปลี่ยนตามชีต ไม่ deploy)", () => {
    const out = base({ จำนวนที่ไม่มีโปร_คิดยังไง: "ราคาปกติ" });
    expect(out).toMatch(/4 ถ้วย: .* = รวม 370 บาท/);
    expect(out, "ไม่ใช่ 367 แล้ว").not.toMatch(/4 ถ้วย: .* = รวม 367 บาท/);
  });

  it("เพดาน 20 (10×2) → มีแถวถึง 20 · แจ้ง handoff เกินเพดาน", () => {
    const out = base();
    expect(out).toMatch(/20 ถ้วย: .* ส่งฟรี = รวม \d+ บาท/);
    expect(out).not.toMatch(/21 ถ้วย/);
    expect(out).toContain("จำนวนเกิน 20");
  });

  it("🔴 config ราคาพัง (คำนวณไม่ได้) → ไม่ยัดตาราง + สั่ง handoff (ตรงกับ priceStuck)", () => {
    const out = base({ ยอดขั้นต่ำส่งฟรี_บาท: "" }); // ตัวเลขหาย → calculatePrice error
    expect(out).toContain("ระบบคำนวณราคาไม่ได้");
    expect(out).toContain("ส่งต่อแอดมิน");
    expect(out, "ห้ามมียอดหลุดออกมา").not.toMatch(/\d+ บาท/);
  });

  it("ไม่มีข้อมูลสินค้า → บอกว่าไม่มี (ไม่ทำให้บอทเดา)", () => {
    const out = buildCatalogInjection([], [], { config: PRICING_CONFIG, payment: "" });
    expect(out).toContain("ไม่มีข้อมูลสินค้า");
  });
});

describe("cleanHeader — strip emoji/สัญลักษณ์/วงเล็บ/ล่องหน (กัน header matching พังซ้ำ · D-27)", () => {
  it("emoji กำกับ (⭐🔴⚠️✅) → ตัดทิ้ง", () => {
    expect(cleanHeader("หลักการตอบ ⭐")).toBe("หลักการตอบ");
    expect(cleanHeader("🔴 ห้ามทำ")).toBe("ห้ามทำ");
    expect(cleanHeader("ราคาโปร ✅")).toBe("ราคาโปร");
  });
  it("วงเล็บกำกับ → ตัด (เดิมทำได้ ยืนยันไม่ regression)", () => {
    expect(cleanHeader("ลูกค้าพูดแบบไหนบ้าง (keywords/สำนวน)")).toBe("ลูกค้าพูดแบบไหนบ้าง");
    expect(cleanHeader("ความกังวลที่แท้จริง (Need)")).toBe("ความกังวลที่แท้จริง");
    expect(cleanHeader("ราคาปกติ (auto)")).toBe("ราคาปกติ");
  });
  it("emoji + วงเล็บ + ช่องว่างซ้อน → สะอาดหมด", () => {
    expect(cleanHeader("  หลักการตอบ ⭐ (สำคัญ) ")).toBe("หลักการตอบ");
  });
  it("ชื่อปกติ (ไทย/อังกฤษ/_/-) ไม่ถูกแตะ", () => {
    expect(cleanHeader("objection_id")).toBe("objection_id");
    expect(cleanHeader("ราคาปกติ_ต่อหน่วย")).toBe("ราคาปกติ_ต่อหน่วย");
    expect(cleanHeader("step_id")).toBe("step_id");
  });
});

describe("buildObjectionInjection — สารบัญเสมอ + เต็มเฉพาะ match + ประกอบเอง (D-27)", () => {
  // 🔴 header จริงจากชีต v1.5: มี emoji (⭐) + วงเล็บกำกับ + คอลัมน์เกิน — cleanHeader ต้อง resolve ได้
  const OBJ = [
    ["objection_id", "ชื่อข้อโต้แย้ง", "ลูกค้าพูดแบบไหนบ้าง (keywords/สำนวน)", "ความกังวลที่แท้จริง (Need)", "หลักการตอบ ⭐", "ห้ามทำ", "ตัวอย่างคำตอบที่ดี", "ถ้ายังยืนยัน", "สถานะ"],
    ["OBJ_PRICE", "ราคาแพง", "แพง,แพงจัง,ราคาสูง", "กลัวไม่คุ้มเงิน", "เทียบคุณค่าต่อมื้อ ไม่ใช่ลดราคา", "ห้ามลดราคา", "ตกมื้อละไม่กี่บาทค่ะ", "ลองชิมก่อนได้ค่ะ", "live"],
    ["OBJ_SHIP", "ค่าส่งแพง", "ค่าส่งแพง,ส่งแพง", "รู้สึกจ่ายเกิน", "ชี้โปรส่งฟรี", "ห้ามยกเว้นค่าส่งเอง", "", "", "live"],
  ];

  it("🔴 header มี emoji ⭐ + วงเล็บ → resolve ได้ (ครั้งที่ 3 · กัน header พังซ้ำ)", () => {
    const r = buildObjectionInjection(OBJ, "โอ้โห แพงจังเลยค่ะ", 2);
    expect(r.matchedIds, "หลักการตอบ ⭐ ต้อง resolve ได้ (ไม่ปิดฟีเจอร์)").toEqual(["OBJ_PRICE"]);
    expect(r.text).toContain("เทียบคุณค่าต่อมื้อ");
    expect(r.text).toContain("ห้ามลดราคา");
    expect(r.text, "ชื่อข้อโต้แย้ง resolve ได้").toContain("ราคาแพง");
    expect(r.text, "สารบัญมี OBJ_SHIP ด้วย").toContain("OBJ_SHIP");
    expect(r.text, "สั่งประกอบเอง ไม่ลอก").toMatch(/ประกอบคำตอบเอง|ห้ามลอก/);
  });

  it("cap จำกัดจำนวนเต็มแถว", () => {
    const r = buildObjectionInjection(OBJ, "แพงจัง ค่าส่งแพงด้วย", 1);
    expect(r.matchedIds).toHaveLength(1); // 2 อันเข้าเงื่อนไข แต่ cap=1
  });

  it("ไม่ match → ไม่มีเต็มแถว (สารบัญยังอยู่) · matchedIds ว่าง", () => {
    const r = buildObjectionInjection(OBJ, "สนใจน้ำพริกค่ะ", 2);
    expect(r.matchedIds).toEqual([]);
    expect(r.text).toContain("OBJ_PRICE"); // สารบัญ
    expect(r.text).not.toContain("เทียบคุณค่าต่อมื้อ"); // ไม่เต็มแถว
  });

  it("header ไม่ครบ/ว่าง → '' ไม่ crash (เจ้าของยังไม่เติมชีต)", () => {
    expect(buildObjectionInjection([], "แพง", 2)).toEqual({ text: "", matchedIds: [], verbatim: null });
    expect(buildObjectionInjection([["a", "b"], ["1", "2"]], "แพง", 2).text).toBe("");
  });
});

describe("buildExampleInjection — match step/objection · เลียนน้ำเสียง ห้ามลอก (D-27)", () => {
  // header จริง v1.5: example_id | step_id | objection_id | ลูกค้าพูด | คำตอบที่ดี | ทำไมถึงดี | สถานะ
  const EX = [
    ["example_id", "step_id", "objection_id", "ลูกค้าพูด", "คำตอบที่ดี", "ทำไมถึงดี", "สถานะ"],
    ["EX1", "2", "OBJ_PRICE", "แพงจัง", "ราคานี้ตกมื้อละไม่กี่บาทเองค่ะ คุ้มมากเลย", "ตีกรอบคุณค่า", "live"],
    ["EX2", "2", "", "ขอดูก่อน", "ลองชิมดูก่อนได้นะคะ อร่อยแน่นอน", "ลดแรงต้าน", "live"],
    ["EX3", "3", "", "จ่ายยังไง", "โอนแล้วส่งสลิปมาได้เลยค่ะ", "นำพา", "live"],
  ];

  it("match step_id ปัจจุบัน + objection_id ที่เจอ → ยัดตามที่ตรง", () => {
    const out = buildExampleInjection(EX, "2", ["OBJ_PRICE"], 3);
    expect(out).toContain("ตกมื้อละไม่กี่บาท");
    expect(out).toContain("ลองชิมดูก่อน");
    expect(out).not.toContain("โอนแล้วส่งสลิป"); // step 3 ไม่ตรง
    expect(out, "กำกับห้ามลอกคำ").toMatch(/ห้ามลอก|เลียนสไตล์/);
  });

  it("cap จำกัด · ไม่ match → '' · header ไม่ครบ → ''", () => {
    expect(buildExampleInjection(EX, "2", [], 1).split("- ").length - 1).toBe(1);
    expect(buildExampleInjection(EX, "9", [], 3)).toBe("");
    expect(buildExampleInjection([], "2", [], 3)).toBe("");
  });
});

describe("readConfigDescription — ดึงคอลัมน์คำอธิบายของคีย์ (วิธีคิดจากชีต)", () => {
  const rows = [
    ["หมวด", "key", "ค่าที่ตั้ง", "หน่วย", "คำอธิบาย"],
    ["ราคา", "จำนวนที่ไม่มีโปร_คิดยังไง", "เทียบโปรฐาน", "", "เศษคิดตามเรทโปรฐาน ไม่ใช่ราคาเต็ม"],
    ["ราคา", "ค่าส่ง_มาตรฐาน", "30", "บาท", "ค่าส่งเมื่อยอดไม่ถึงเกณฑ์"],
  ];
  it("คืนคำอธิบายของคีย์ที่ตรง", () => {
    expect(readConfigDescription(rows, "จำนวนที่ไม่มีโปร_คิดยังไง")).toBe("เศษคิดตามเรทโปรฐาน ไม่ใช่ราคาเต็ม");
  });
  it("คีย์มีวงเล็บกำกับก็ยังจับได้ · ไม่มีคีย์/ไม่มีคอลัมน์ → ''", () => {
    expect(readConfigDescription(rows, "ไม่มีคีย์นี้")).toBe("");
    expect(readConfigDescription([["key", "ค่าที่ตั้ง"], ["ค่าส่ง_มาตรฐาน", "30"]], "ค่าส่ง_มาตรฐาน")).toBe(""); // ไม่มีคอลัมน์คำอธิบาย
  });
});

describe("buildFaqInjection — สารบัญทุกข้อ + เต็มเฉพาะ keyword ตรง", () => {
  const FAQ_HEADER = ["หมวด", "คำถาม", "action", "คำตอบ (บอลลูน)", "keywords", "image_url", "status", "updated_at"];
  function faqSheet(): string[][] {
    return [
      FAQ_HEADER,
      ["ทั่วไป", "ส่งกี่วัน", "answer", "1-2 วันทำการค่ะ", "ส่ง,กี่วัน,จัดส่ง", "", "", ""],
      ["ทั่วไป", "เก็บได้นานมั้ย", "answer", "ตู้เย็น 1 เดือนค่ะ", "เก็บ,นาน,อายุ", "", "", ""],
      ["สุขภาพ", "แพ้อาหารกินได้มั้ย", "handoff", "ควรปรึกษาแพทย์", "แพ้,ภูมิแพ้", "", "", ""],
    ];
  }

  it("สารบัญมีทุกคำถาม เสมอ", () => {
    const out = buildFaqInjection(faqSheet(), "อะไรก็ได้");
    expect(out).toContain("ส่งกี่วัน");
    expect(out).toContain("เก็บได้นานมั้ย");
    expect(out).toContain("แพ้อาหารกินได้มั้ย");
  });

  it("keyword match → ยัดคำตอบเต็ม", () => {
    const out = buildFaqInjection(faqSheet(), "ของส่งกี่วันคะ");
    expect(out).toContain("→ 1-2 วันทำการค่ะ");
  });

  it("🔴 action=handoff match → ไม่ยัดคำตอบ (กัน parrot) แค่บอกให้ส่งต่อ", () => {
    const out = buildFaqInjection(faqSheet(), "แพ้กุ้งกินได้มั้ย");
    expect(out).toContain("[action=handoff");
    expect(out, "ห้ามยัดคำตอบของ handoff FAQ").not.toContain("ควรปรึกษาแพทย์");
  });

  it("ไม่ match → บอกให้ส่งต่อ ไม่เดา (กฎ 10)", () => {
    const out = buildFaqInjection(faqSheet(), "เรื่องที่ไม่มีในชีตเลย");
    expect(out).toContain("ส่งต่อแอดมิน");
  });
});
