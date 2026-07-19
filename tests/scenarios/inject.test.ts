import { describe, it, expect, vi } from "vitest";
import { buildStepInjection, buildFaqInjection, buildCatalogInjection, resolveDestinations } from "@/lib/agent/inject";
import { tabToText } from "@/lib/sheets/columns";

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

  it("🔴 funnel_stage ว่าง/ไม่รู้จัก → log เตือน (ไม่เงียบ)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = stepSheet();
    rows.push(step({ step_id: "BAD", funnel_stage: "", ชื่อประตู: "พัง", เข้าเมื่อ: "x" }));
    buildStepInjection(rows, PRE("hi"));
    const logged = spy.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("funnel_stage");
    expect(logged).toContain("BAD");
    spy.mockRestore();
  });

  it("header ไม่ครบ → fallback ยัดทั้งก้อน (ไม่ตาบอด)", () => {
    const broken = [["step_id", "ชื่อประตู"], ["S1", "ทักทาย"]];
    const out = buildStepInjection(broken, PRE("hi"));
    expect(out).toBe(tabToText(broken));
  });
});

describe("buildCatalogInjection — ยัดราคาโปรเสมอ (บอทห้ามแต่งราคา C6)", () => {
  const products = [["sku", "ชื่อ", "ราคาปกติ"], ["NPT-10G", "น้ำพริกปลาทู", "95"]];
  const promo = [
    ["โปร", "จำนวน", "ราคา", "หมายเหตุ"],
    ["P1", "1", "95", ""],
    ["P3", "3", "275", "ส่งฟรี"],
    ["P5", "5", "440", ""],
    ["P10", "10", "850", ""],
  ];

  it("มีราคาโปรครบ 95/275/440/850 จาก CSV_Promo", () => {
    const out = buildCatalogInjection(products, promo);
    for (const price of ["95", "275", "440", "850"]) {
      expect(out, `ต้องมีราคา ${price}`).toContain(price);
    }
    expect(out, "มีคำสั่งห้ามแต่งราคา").toContain("ห้ามคิด");
  });

  it("ไม่มีข้อมูล → บอกว่าไม่มี (ไม่ทำให้บอทเดา)", () => {
    const out = buildCatalogInjection([], []);
    expect(out).toContain("ไม่มีข้อมูลสินค้า");
    expect(out).toContain("ไม่มีข้อมูลโปรโมชั่น");
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
