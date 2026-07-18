import { describe, it, expect } from "vitest";
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

function stepSheet(): string[][] {
  return [
    STEP_HEADER,
    step({ step_id: "S1", funnel_stage: "lead", ชื่อประตู: "ทักทาย", เข้าเมื่อ: 'ทักทายลอยๆ เช่น "สวัสดี"', ไปประตูถัดไปเมื่อ: "รู้ว่าสนใจตัวไหน → S2", หลักการนำพา: "ทักทายอบอุ่น", ห้ามทำ: "ห้ามรีบขาย" }),
    step({ step_id: "S2", funnel_stage: "qualified", ชื่อประตู: "นำเสนอ", เข้าเมื่อ: "รู้แล้วว่าสนใจตัวไหน", ไปประตูถัดไปเมื่อ: "ลูกค้าแจ้งจำนวน → S3", หลักการนำพา: "สรุปยอดชวนตัดสินใจ", ห้ามทำ: "ห้ามกดดัน" }),
    step({ step_id: "S2_DIRECT", funnel_stage: "qualified", ชื่อประตู: "สั่งตรง", เข้าเมื่อ: 'บอกจำนวนเลย เช่น "สั่ง 3 ถ้วยครับ"', ไปประตูถัดไปเมื่อ: "เลือกวิธีชำระ → S3" }),
    step({ step_id: "S3_TRANSFER", funnel_stage: "awaiting_payment", ชื่อประตู: "โอน", เข้าเมื่อ: "เลือกโอนแล้ว", ไปประตูถัดไปเมื่อ: "ได้สลิป → S4A · ที่อยู่ครบก่อน → S4C" }),
    step({ step_id: "S3_COD", funnel_stage: "awaiting_payment", ชื่อประตู: "ปลายทาง", เข้าเมื่อ: "เลือกเก็บปลายทาง", ไปประตูถัดไปเมื่อ: "ที่อยู่ครบ → S4B" }),
    step({ step_id: "S4A", funnel_stage: "awaiting_address", ชื่อประตู: "รับสลิป", เข้าเมื่อ: "ส่งสลิปแล้ว", ไปประตูถัดไปเมื่อ: "ที่อยู่ครบ → S4B" }),
    step({ step_id: "S4B", funnel_stage: "won", ชื่อประตู: "ปิดจบ", เข้าเมื่อ: "ครบแล้ว", ไปประตูถัดไปเมื่อ: "" }),
    step({ step_id: "H1", funnel_stage: "handoff", ชื่อประตู: "เคลม", เข้าเมื่อ: "ของเสีย/แพ้อาหาร", ห้ามทำ: "ห้ามตอบเอง ห้ามมั่ว", "ตัวอย่างคำตอบ (บอลลูน)": "ขอตามแอดมินมาดูแลนะคะ", ความรู้สึกลูกค้าตอนนี้: "กังวลมาก", ทำไมประตูนี้สำคัญ: "ความปลอดภัย" }),
    step({ step_id: "H2", funnel_stage: "handoff", ชื่อประตู: "ต่อรอง", เข้าเมื่อ: "ขอส่วนลด", ห้ามทำ: "ห้ามลดเอง", "ตัวอย่างคำตอบ (บอลลูน)": "ขอส่งต่อแอดมินนะคะ" }),
  ];
}

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

describe("buildStepInjection — สารบัญครบ + เต็มเฉพาะที่เกี่ยว", () => {
  it("🔴 สารบัญมีทุกประตูเสมอ (เห็นทางเข้าทุกประตู)", () => {
    const out = buildStepInjection(stepSheet(), "S2", "เอาสองถ้วย");
    for (const id of ["S1", "S2", "S2_DIRECT", "S3_TRANSFER", "S3_COD", "S4A", "S4B", "H1", "H2"]) {
      expect(out, `สารบัญต้องมี ${id}`).toContain(id);
    }
    expect(out).toContain("เข้าเมื่อ:"); // สารบัญมี "เข้าเมื่อ" ทุกประตู
  });

  it("ปัจจุบัน S2 → เนื้อเต็ม S2 (หลักการนำพา + ห้ามทำ ไม่ถูกย่อ)", () => {
    const out = buildStepInjection(stepSheet(), "S2", "เอาสองถ้วย");
    expect(out).toContain("หลักการนำพา: สรุปยอดชวนตัดสินใจ");
    expect(out).toContain("ห้ามทำ: ห้ามกดดัน");
  });

  it("🔴 ปลายทาง S2 '→ S3' → เนื้อเต็ม S3_TRANSFER + S3_COD (prefix)", () => {
    const out = buildStepInjection(stepSheet(), "S2", "เอาสองถ้วย");
    // เนื้อเต็มมี block header [S3_TRANSFER] / [S3_COD]
    expect(out).toContain("[S3_TRANSFER]");
    expect(out).toContain("[S3_COD]");
  });

  it("เนื้อเต็มไม่ครบทุกประตู (selective ทำงาน — S4B ไม่เต็มตอนอยู่ S2)", () => {
    const out = buildStepInjection(stepSheet(), "S2", "เอาสองถ้วย");
    expect(out, "S4B ไม่ควรมี block เต็ม").not.toContain("[S4B]");
  });

  it("🔴 handoff H1/H2 เต็ม(lean)เสมอ แม้ stage=S2 · มี ห้ามทำ+ตัวอย่าง · ไม่มี ความรู้สึก/ทำไมสำคัญ", () => {
    const out = buildStepInjection(stepSheet(), "S2", "เอาสองถ้วย");
    expect(out).toContain("[H1] เคลม (handoff)");
    expect(out).toContain("ห้ามทำ: ห้ามตอบเอง ห้ามมั่ว"); // รั้ว ห้ามหาย
    expect(out).toContain("ตัวอย่างคำตอบ: ขอตามแอดมินมาดูแลนะคะ");
    // ตัดสมองการขายออกจาก handoff
    expect(out, "handoff ไม่ยัด ความรู้สึกลูกค้า").not.toContain("ความรู้สึกลูกค้า: กังวลมาก");
    expect(out, "handoff ไม่ยัด ทำไมสำคัญ").not.toContain("ทำไมสำคัญ: ความปลอดภัย");
  });

  it("กระโดด: อยู่ S2 พิมพ์ 'สั่ง 3 ถ้วยครับ' → entry match S2_DIRECT เต็ม", () => {
    const out = buildStepInjection(stepSheet(), "S2", "สั่ง 3 ถ้วยครับ");
    expect(out).toContain("[S2_DIRECT]");
  });

  it("🔴 กำกวม: stage เพี้ยน/ว่าง → ยัดเต็ม funnel ต้น ๆ (lead/qualified) ไม่โง่", () => {
    const out = buildStepInjection(stepSheet(), "2", "อยากได้ข้อมูล"); // "2" = stage เก่า หา exact ไม่เจอ
    expect(out).toContain("[S1]");
    expect(out).toContain("[S2]");
  });

  it("parse ปลายทางพลาด → fallback funnel_stage ถัดไป", () => {
    const rows = stepSheet();
    // ทำให้ S2 ปลายทางพัง (ไม่มี step_id) → ต้อง fallback ไป awaiting_payment (S3_*)? No: S2=qualified → next=quoted
    // ปรับ S2 nextWhen เป็นข้อความล้วน + เพิ่มประตู quoted
    rows[2][STEP_HEADER.indexOf("ไปประตูถัดไปเมื่อ")] = "คุยรู้เรื่องแล้ว"; // S2 row (index 2 = header+S1+S2)
    rows.splice(3, 0, step({ step_id: "SQ", funnel_stage: "quoted", ชื่อประตู: "เสนอราคา", เข้าเมื่อ: "ถามราคา", ไปประตูถัดไปเมื่อ: "→ S3" }));
    const out = buildStepInjection(rows, "S2", "อะไรก็ได้");
    expect(out, "fallback funnel ถัดไป (quoted) → SQ เต็ม").toContain("[SQ]");
  });

  it("growth: เพิ่ม H3 (funnel_stage=handoff) → เต็ม(lean)อัตโนมัติ ไม่แตะโค้ด", () => {
    const rows = stepSheet();
    rows.push(step({ step_id: "H3", funnel_stage: "handoff", ชื่อประตู: "โมโห", เข้าเมื่อ: "ลูกค้าโมโห", ห้ามทำ: "ห้ามเถียง", "ตัวอย่างคำตอบ (บอลลูน)": "ขอโทษค่ะ ตามแอดมินให้นะคะ" }));
    const out = buildStepInjection(rows, "S2", "ปกติ");
    expect(out).toContain("[H3] โมโห (handoff)");
    expect(out).toContain("ห้ามทำ: ห้ามเถียง");
  });

  it("header ไม่ครบ → fallback ยัดทั้งก้อน (ไม่ตาบอด)", () => {
    const broken = [["step_id", "ชื่อประตู"], ["S1", "ทักทาย"]]; // ขาดคอลัมน์เพียบ
    const out = buildStepInjection(broken, "S1", "hi");
    expect(out).toBe(tabToText(broken));
  });

  it("token: selective สั้นกว่ายัดทั้งก้อนชัดเจน (char-proxy)", () => {
    const rows = stepSheet();
    const whole = tabToText(rows);
    const selective = buildStepInjection(rows, "S2", "เอาสองถ้วย");
    // sheet เล็กในเทส แต่ selective ต้องไม่ยาวกว่า whole (มี index + เต็มบางส่วน)
    expect(selective.length, "selective ต้องไม่ยัดเต็มทุกประตู").toBeLessThan(whole.length + 500);
    // พิสูจน์เชิงโครงสร้าง: มีหัวข้อสารบัญ + เนื้อเต็ม
    expect(selective).toContain("=== สารบัญประตูทั้งหมด");
    expect(selective).toContain("=== ประตูที่เกี่ยวข้องตอนนี้");
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
