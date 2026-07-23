import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runSalesTurn } from "@/lib/gemini";
import { buildStepInjection, buildObjectionInjection, buildCatalogInjection, buildFaqInjection, funnelStageOf } from "@/lib/agent/inject";
import { productsRows, promoRows, PRICING_CONFIG } from "../harness/botlib-fixture";
import { testConfig } from "../harness/fixtures";

/**
 * D-44c · Golden routing — 25 เคสจาก docs/golden-routing-cases.csv (spec จากเจ้าของ)
 * assert เฉพาะ "การจำแนก": stage / objection_detected / handoff — 🔴 ไม่ assert ข้อความ (คำพูด = ชีต)
 *
 * รัน: HARNESS_REAL_GEMINI=1 GEMINI_API_KEY=... npx vitest run golden-routing
 * (scripted mode = skip อัตโนมัติ · ไม่ block npm test — Gemini ถูก mock จับ routing จริงไม่ได้)
 *
 * ⚠️ fixture step/objection ด้านล่างจำลองชีต v2.0 (routing cols เท่านั้น) — ชีตจริงแก้ "เข้าเมื่อ/กรณี"
 *    แล้วผล routing เปลี่ยน = ของคาดหวัง · ให้ sync fixture นี้กับชีตจริงเมื่อเทสแดง
 * เกณฑ์ handoff: ผ่านเมื่อ AI ตั้ง flag เอง หรือเลือกประตู funnel=handoff/handoff_after_intake
 * (intake = จะถึงมือคนผ่านจังหวะ D-34 · CSV หมายถึง "เคสนี้จบที่คน" ไม่ใช่ flag เทิร์นแรกเสมอ)
 */
const RUN = process.env.HARNESS_REAL_GEMINI === "1" && Boolean(process.env.GEMINI_API_KEY);
const NOW = new Date("2026-07-22T03:00:00Z");

// ---- fixture ชีต v2.0 (routing columns) — จำลองประตูที่ golden cases อ้างถึง ----
const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "กรณี", "เข้าเมื่อ (สัญญาณจากลูกค้า)", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ (บอลลูน)", "ตัวอย่างประโยคปิดท้าย", "ติดแท็ก", "ไปประตูถัดไปเมื่อ", "funnel_label", "โน้ตเจ้าของ (ไม่เข้า prompt)", "สถานะ"];
function s(id: string, funnel: string, name: string, kase: string, entry: string, next: string): string[] {
  return [id, funnel, name, kase, entry, "", "(pattern)", "", "", next, "", "", "live"];
}
const STEPS: string[][] = [
  STEP_H,
  s("S1", "lead", "ค้นหาความต้องการ", "ปกติ", 'ทักทายลอยๆ ยังไม่บอกสินค้า เช่น "สวัสดี" "สนใจค่ะ"', "รู้ว่าสนใจตัวไหน → S2"),
  s("S2", "qualified", "นำเสนอสินค้า", "ถามถึงสินค้า/คุยเรื่องสินค้า/คุยเล่นระหว่างขาย", 'ถามว่าสินค้าคืออะไร ดียังไง เช่น "อันนี้คืออะไร" · รวมคุยเล่น/objection ระหว่างนำเสนอ', "บอกจำนวน → S2_ASK/S2_DIRECT"),
  s("S2_ASK", "qualified", "ถามราคาตามจำนวน", "บอกจำนวน+ถามราคา ยังไม่มีคำตัดสินใจ", 'บอกจำนวนพร้อมถามราคา ไม่มีคำว่า สั่ง/ซื้อ/รับ/เอา เช่น "3 ถ้วยเท่าไหร่"', "มีคำตัดสินใจ → S2_DIRECT"),
  s("S2_DIRECT", "qualified", "สั่งตรง", "มีคำตัดสินใจซื้อ", 'บอกจำนวนพร้อมคำตัดสินใจ เช่น "เอา 3 ถ้วย" "สั่ง 5 ถ้วย" "รับ 2"', "เลือกวิธีจ่าย → S3"),
  s("S3_TRANSFER", "quoted", "แจ้งโอน", "เลือกโอนแล้ว", 'เลือกโอน/ขอเลขบัญชี เช่น "ขอเลขบัญชี" "โอนช่องทางไหน"', "โอนแล้ว → S4A"),
  s("S3_COD", "quoted", "เก็บปลายทาง", "เลือก COD", "เลือกเก็บเงินปลายทาง COD", "ที่อยู่ครบ → S4B"),
  s("S4A", "awaiting_address", "รับสลิป-ขอที่อยู่", "ส่งสลิปแล้ว", "ส่งสลิปโอนเงินมา (รูปสลิป)", "ที่อยู่ครบ → S4B"),
  s("S4B", "won", "ปิดจบ", "ข้อมูลครบ", "ให้ที่อยู่/ข้อมูลจัดส่งครบ", ""),
  s("X1", "quoted", "เปลี่ยนวิธีจ่าย", "ขอเปลี่ยนช่องทางชำระ", 'ขอเปลี่ยนวิธีจ่าย เช่น "เปลี่ยนเป็นเก็บปลายทาง" "เปลี่ยนเป็นโอน"', ""),
  s("S_EDIT", "won", "แก้ข้อมูลออเดอร์", "แก้ออเดอร์ที่ยังไม่คอนเฟิร์ม", "order_editable (ลูกค้าขอแก้ ชื่อ/ที่อยู่/เบอร์/จำนวน ของออเดอร์ที่บันทึกแล้ว)", ""),
  s("X2", "handoff", "แก้หลังคอนเฟิร์ม", "ออเดอร์ล็อกแล้ว", "order_confirmed_locked (ขอแก้ออเดอร์ที่คอนเฟิร์มแล้ว)", ""),
  s("H1", "handoff", "สุขภาพ-แพ้อาหาร", "เสี่ยงสุขภาพ", 'แพ้อาหาร/โรค/เด็ก/คนท้อง/ยา เช่น "แพ้กุ้ง" "ลูกกินได้มั้ย" "เป็นเบาหวาน"', ""),
  s("H2", "handoff_after_intake", "ต่อรองราคา", "ขอส่วนลดตรงๆ", 'ขอลด/ต่อรอง/ขายส่ง เช่น "ลดหน่อยได้มั้ย" "ซื้อเยอะลดมั้ย"', ""),
  s("H3", "handoff_after_intake", "เคลม-ของมีปัญหา", "ของไม่ถึง/ของเสีย", 'ของไม่ถึง/ของเสีย/ขอคืนเงิน เช่น "ของยังไม่ถึง" "ของเสีย"', ""),
  s("S_UNKNOWN", "handoff", "นอกตาราง", "ไม่เข้าประตูไหนเลย", "ไม่ match ประตู/objection/FAQ ไหนเลย · นอกเรื่องธุรกิจ · ไม่มีข้อมูลรองรับ", ""),
];

const OBJ_H = ["objection_id", "ชื่อข้อโต้แย้ง", "ลูกค้าพูดแบบไหนบ้าง (keywords/สำนวน)", "ความกังวลที่แท้จริง (Need)", "ตัวอย่างคำตอบ (บอลลูน)", "ถ้ายังยืนยัน", "โน้ตเจ้าของ (ไม่เข้า prompt)", "สถานะ"];
function o(id: string, name: string, says: string, need: string): string[] {
  return [id, name, says, need, "(pattern)", "", "", "live"];
}
const OBJECTIONS: string[][] = [
  OBJ_H,
  o("OBJ_PRICE", "ราคาแพง", "แพง,แพงจัง,แพงไป,95 บาทเนี่ยนะ", "ยังไม่เห็นความคุ้ม เทียบผิดหมวด"),
  o("OBJ_SCAM", "กลัวโดนโกง", "กลัวโอนแล้วไม่ได้ของ,โกง,ไม่กล้าโอน", "ไม่ไว้ใจร้านออนไลน์"),
  o("OBJ_THINK", "ขอคิดดูก่อน", "ขอคิดดูก่อน,เดี๋ยวมาใหม่,ไว้ก่อน", "มีข้อกังวลที่ยังไม่พูด"),
  o("OBJ_SIZE", "ปริมาณน้อย", "10 กรัมเอง,นิดเดียว,น้อยจัง", "เทียบปริมาณกับราคาไม่ถูก"),
  o("OBJ_REVIEW", "ขอรีวิว", "มีรีวิวมั้ย,ใครกินแล้วบ้าง,มีคนกินแล้วยัง", "อยากได้หลักฐานจากคนจริง"),
  o("OBJ_HOMEMADE", "เทียบน้ำพริกถูก", "ตลาดถุงละ 20,ทำเองก็ได้,ของถูกกว่า", "เทียบผิดหมวด ไม่เห็นความต่าง"),
  o("OBJ_MIN_QTY", "อยากลองน้อยๆ", "ขอลองถ้วยเดียว,ซื้อชิ้นเดียวได้มั้ย,ลองก่อน", "ยังไม่กล้าซื้อเยอะ"),
];

const FAQ_ROWS: string[][] = [
  ["faq_id", "หมวด", "คำถาม", "action", "คำตอบ (บอลลูน)", "keywords", "image_url", "status", "updated_at"],
  ["FAQ01", "สินค้า", "มีอะไรเป็นส่วนประกอบบ้าง", "answer", "{ส่วนประกอบตามฉลาก}", "ส่วนประกอบ,ส่วนผสม,ทำจากอะไร", "", "live", ""],
  ["FAQ02", "จัดส่ง", "ส่งกี่วัน", "answer", "1-2 วันค่ะ", "ส่งกี่วัน,กี่วันถึง", "", "live", ""],
  // sync กับชีตจริง v2.0 (เจ้าของเพิ่ม FAQ25) → G23 "มีขายที่ 7-11" ไม่ใช่ S_UNKNOWN อีกต่อไป (D-42 ตอบ FAQ วกกลับ funnel)
  ["FAQ25", "ช่องทางขาย", "มีขายที่ไหนบ้าง", "answer", "ตอนนี้ขายออนไลน์ทางเดียวค่ะ ยังไม่มีหน้าร้าน/7-11", "7-11,เซเว่น,หน้าร้าน,ขายที่ไหน,ช่องทาง", "", "live", ""],
];

/** map "สถานะก่อนหน้า" (คอลัมน์ CSV) → บริบทที่ route จะประกอบจริง */
function stateFor(prev: string): { stateText: string; historyText: string; currentStage: string; quoted: boolean; payment: string; signals: string[] } {
  switch (prev) {
    case "ลูกค้าใหม่":
      return { stateText: "ลูกค้าใหม่ ยังไม่มีข้อมูล", historyText: "(เริ่มบทสนทนา)", currentStage: "", quoted: false, payment: "", signals: [] };
    case "คุยอยู่ S2":
      return { stateText: "ประตูปัจจุบัน: S2 (กำลังนำเสนอสินค้า) · ยังไม่มีออเดอร์", historyText: "ลูกค้า: อันนี้คืออะไร\nบอท: (แนะนำสินค้า+โปร)", currentStage: "S2", quoted: false, payment: "", signals: [] };
    case "เลือกโอนแล้ว":
      return { stateText: "ประตูปัจจุบัน: S3_TRANSFER · เลือกช่องทาง โอน แล้ว · มี items แล้ว", historyText: "ลูกค้า: เอา 3 ถ้วย โอนค่ะ\nบอท: (สรุปยอด ชวนโอน)", currentStage: "S3_TRANSFER", quoted: true, payment: "โอน", signals: [] };
    case "สั่งแล้ว เลือกโอน":
      return { stateText: "ประตูปัจจุบัน: S3_TRANSFER · มี items แล้ว · เลือกโอน · ยังไม่มีสลิป ยังไม่มีที่อยู่", historyText: "บอท: โอนแล้วส่งสลิปมาได้เลยค่ะ", currentStage: "S3_TRANSFER", quoted: true, payment: "โอน", signals: [] };
    case "มีสลิปแล้ว":
      return { stateText: "ประตูปัจจุบัน: S4A · มี items + สลิปแล้ว · ยังขาด: ที่อยู่/ชื่อ/เบอร์", historyText: "บอท: ได้รับสลิปแล้วค่ะ ขอชื่อ ที่อยู่ เบอร์ สำหรับจัดส่งด้วยนะคะ", currentStage: "S4A", quoted: true, payment: "โอน", signals: [] };
    case "สรุปยอดโอนแล้ว ยังไม่จ่าย":
      return { stateText: "ประตูปัจจุบัน: S3_TRANSFER · สรุปยอดแบบโอนแล้ว · ยังไม่โอน", historyText: "บอท: ยอดโอน 275 บาทค่ะ", currentStage: "S3_TRANSFER", quoted: true, payment: "โอน", signals: [] };
    case "ออเดอร์บันทึกแล้ว ยังไม่คอนเฟิร์ม":
      return { stateText: "ออเดอร์ที่บันทึกแล้ว SKB-20260722-000001: ชื่อ สมชาย · ที่อยู่ 11 ถ.เจริญกรุง กทม. 10500 · เบอร์ 0899999999 · สถานะ: ยังแก้ได้", historyText: "บอท: บันทึกออเดอร์เรียบร้อยค่ะ", currentStage: "S4B", quoted: false, payment: "", signals: ["order_editable"] };
    case "ออเดอร์คอนเฟิร์มแล้ว":
      return { stateText: "ออเดอร์ที่บันทึกแล้ว SKB-20260722-000001: สถานะ: คอนเฟิร์มแล้ว (ของอาจแพ็คแล้ว · แก้เองไม่ได้ ส่งต่อแอดมิน)", historyText: "บอท: ออเดอร์คอนเฟิร์มแล้วค่ะ", currentStage: "S4B", quoted: false, payment: "", signals: ["order_confirmed_locked"] };
    case "ลูกค้าเก่า":
      return { stateText: "ลูกค้าเก่า เคยซื้อแล้ว 1 ออเดอร์ (จัดส่งแล้ว)", historyText: "(ออเดอร์ก่อนหน้าปิดจบแล้ว)", currentStage: "", quoted: false, payment: "", signals: [] };
    default:
      return { stateText: prev, historyText: "(เริ่มบทสนทนา)", currentStage: "", quoted: false, payment: "", signals: [] };
  }
}

interface GoldenCase { id: string; message: string; prev: string; step: string; objection: string; handoff: boolean; note: string; }
function loadCases(): GoldenCase[] {
  const csv = readFileSync(new URL("../../docs/golden-routing-cases.csv", import.meta.url), "utf8");
  return csv.trim().split("\n").slice(1).map((line) => {
    const parts = line.split(",");
    const [id, message, prev, step, objection, handoff] = parts;
    return { id, message, prev, step, objection, handoff: handoff.trim() === "true", note: parts.slice(6).join(",") };
  });
}

const RUN_CASES = loadCases();

describe.skipIf(!RUN)("golden routing — 25 เคสจำแนกประตู/objection/handoff (real Gemini · D-44c)", () => {
  const catalog = buildCatalogInjection(productsRows(), promoRows(), { config: PRICING_CONFIG, payment: "", now: NOW });

  it.each(RUN_CASES.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const ctx = stateFor(c.prev);
    const stepText = buildStepInjection(STEPS, { quoted: ctx.quoted, payment: ctx.payment, userMessage: c.message, signals: ctx.signals, stayStage: ctx.currentStage || undefined });
    const objection = buildObjectionInjection(OBJECTIONS, c.message, 2);
    const faq = buildFaqInjection(FAQ_ROWS, c.message);

    const out = await runSalesTurn({
      config: testConfig(),
      configText: "เปิด_ส่งต่อแอดมิน: เปิด · เปิด_ติดแท็ก: เปิด · เปิด_ระบบออเดอร์: เปิด",
      stepText,
      faqText: faq.text,
      catalogText: catalog,
      objectionText: objection.text,
      stateText: ctx.stateText,
      historyText: ctx.historyText,
      userMessage: c.message,
      currentStage: ctx.currentStage,
    });

    expect(out.degraded, `${c.id} ต้องไม่ degraded`).toBe(false);
    expect(out.stage, `${c.id} stage (${c.note})`).toBe(c.step);
    // 🔴 objection: assert เฉพาะเทิร์นที่ "ไม่ handoff" — เทิร์น handoff โค้ด (isHandoffTurn) ตัด objection pattern ทิ้งอยู่แล้ว
    //    objection_detected ที่ AI ตั้งบนเทิร์น handoff ไม่มีผลกับ output → assert = เปราะเกินเหตุ
    if (!c.handoff) {
      expect(out.objectionDetected || "none", `${c.id} objection`).toBe(c.objection || "none");
    }
    // handoff (เกณฑ์หัวไฟล์): AI flag หรือประตู funnel=handoff/handoff_after_intake
    const funnel = funnelStageOf(STEPS, out.stage);
    const effectiveHandoff = out.handoff || funnel === "handoff" || funnel === "handoff_after_intake";
    expect(effectiveHandoff, `${c.id} handoff (${c.note})`).toBe(c.handoff);
  }, 30_000);
});
