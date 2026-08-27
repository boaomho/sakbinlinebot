import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sendText, sendImage } from "../harness/replay";
import { scriptGemini, turn, adminPushes, lineCalls, harnessOverrides, sheetsCalls } from "../harness/state";
import { seedBotLib, PRICING_CONFIG } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { adaptV3Bundle, validateV3Bundle } from "@/lib/sheets/adapter-v3";
import { findAssuranceHits } from "@/lib/guards/assurance";
import { createSandbox, runInSandbox } from "@/lib/train/sandbox";
import { getConfig, __resetConfigCache } from "@/lib/config";

/**
 * D-61.C · golden ชั้น D (deterministic · รันทุก npm test) — invariant ระดับโค้ดของ v3
 * บทสนทนาจริง (คุณภาพคำพูด) = ชั้น G ใน v3-golden-live.test.ts (gated real Gemini)
 * ครอบ: payment-first gate · ราคาจาก engine · choice-close ban · ธง/🔔 dedup · assurance · handoff · sandbox override
 */
const U = "Uv3goldencustomer000000000000001";
const FOOTER = "บอทปิดการทำงานกับลูกค้ารายนี้แล้ว";

// ชีต v3 ดิบ (โครงจริงตาม seed) → adapter → bundle ที่ pipeline ใช้
const V3_STEP = [
  ["step_id", "ชื่อประตู", "เข้าเมื่อ", "สาระที่ต้องสื่อ", "ต้องได้อะไรถึงไปต่อ", "ไปประตูไหน", "แนวตอบ (ตัวอย่าง)", "handoff", "สถานะ"],
  ["S1", "ค้นหาความต้องการ", "ทักเปล่าๆ", "ทักทาย+เกริ่นสินค้า", "รู้ความสนใจ", "S2", "สวัสดีค่ะ", "", "live"],
  ["S2", "แนะนำ+โปร", "ถามสินค้า/ราคา", "จุดเด่น+โปร+choice close", "จำนวน", "S3", "", "", "live"],
  ["S2Q", "เคสมาพร้อมจำนวน", "ทักมาพร้อมจำนวน", "ตอบราคาตรง+โปร+choice close", "จำนวนสรุป", "S3", "", "", "live"],
  ["S3", "สรุปยอด+ชำระเงิน", "ได้จำนวนแล้ว", "สรุปยอด+เลขบัญชี+ชวนโอน", "สลิป/คอนเฟิร์ม COD", "S4", "", "", "live"],
  ["S4", "ปิดจบ", "ได้สลิป/ที่อยู่", "ทวนที่อยู่+รอบส่ง", "ครบ", "จบ", "", "", "live"],
  ["HX", "เรียกคน", "ขอคุยแอดมิน/เคลม/ขายส่ง", "รับเรื่องอบอุ่นแล้วส่งต่อ", "", "", "", "ใช่", "live"],
];
const V3_KNOW = [
  ["id", "ลูกค้าพูดยังไง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "ความกังวลจริง", "แนวตอบ (ตัวอย่าง)", "keyword", "สถานะ"],
  ["K005", "ส่งกี่วันถึง", "ส่ง 1-2 วันทำการ", "กลัวรอนาน", "ปกติ 1-2 วันค่ะ", "ส่งกี่วัน", "live"],
  ["K014", "แพ้กุ้งทานได้ไหม", "มีกะปิซึ่งทำจากกุ้ง · ฉลากระบุมีปลา · ไลน์ผลิตไม่ทราบ ให้แอดมินเช็ค", "กลัวแพ้", "ขอข้อมูลเพิ่มก่อนนะคะ", "แพ้กุ้ง,แพ้", "live"],
  ["K017", "ของเสีย/ของไม่ถึง", "รับเคลมทุกกรณี ส่งต่อแอดมินตรวจสอบ", "กลัวเสียเงินฟรี", "รับเรื่องแล้วค่ะ ขอส่งต่อแอดมิน", "ของเสีย,ยังไม่ถึง", "live"],
  ["K018", "ขายส่ง/ราคาส่ง", "มีราคาส่ง ให้แอดมินคุยรายละเอียด", "อยากได้ราคาดี", "ขอส่งต่อแอดมินดูแลเรื่องราคาส่งนะคะ", "ขายส่ง,ราคาส่ง", "live"],
  ["K019", "แถวร่างยังไม่เปิด", "ยังไม่พร้อม", "", "", "ร่าง", ""], // ว่าง = draft
];
const V3_PRODUCTS = [
  ["sku", "ชื่อสินค้า", "หน่วย", "ราคาปกติ_ต่อหน่วย", "สารก่อภูมิแพ้", "รูปสินค้า (URL)", "สถานะ"],
  ["NPT-10G", "น้ำพริกปลาทูฟรีซดราย", "ถ้วย", "95", "มีปลา · กะปิทำจากกุ้ง · ไลน์ผลิตให้แอดมินเช็ค", "https://ex/npt.jpg", "live"],
];
const V3_PROMO = [
  ["promo_id", "sku", "จำนวน", "ราคาปกติ (auto)", "ราคาโปร", "ค่าส่ง", "ยอดที่ลูกค้าจ่าย (auto)", "ประหยัด (auto)", "ข้อความโชว์ (auto)", "เริ่มใช้", "สิ้นสุด", "สถานะ"],
  ["P1", "NPT-10G", "1", "95", "95", "30", "125", "0", "1 ถ้วย 95 บาท ค่าส่ง 30 บาท", "2026-07-01", "", "live"],
  ["P3", "NPT-10G", "3", "285", "275", "0", "275", "10", "3 ถ้วย 275 บาท ส่งฟรี", "2026-07-01", "", "live"],
];

function seedV3Sheet(): void {
  seedBotLib();
  const bundle = adaptV3Bundle({ เส้นทางขาย: V3_STEP, ความรู้: V3_KNOW, CSV_Products: V3_PRODUCTS, CSV_Promo: V3_PROMO, CSV_Vars: [], CSV_Config: [] });
  sheetsCalls.botLibReturn.CSV_Step = bundle.CSV_Step;
  sheetsCalls.botLibReturn.CSV_FAQ = bundle.CSV_FAQ;
  sheetsCalls.botLibReturn.CSV_Objections = bundle.CSV_Objections;
  sheetsCalls.botLibReturn.CSV_Products = bundle.CSV_Products;
  sheetsCalls.botLibReturn.CSV_Promo = bundle.CSV_Promo;
  harnessOverrides.config = {
    handoffKeywords: ["ขอแอดมิน", "คุยกับคน", "ฟ้อง"],
    healthFlagKeywords: ["แพ้", "เบาหวาน", "ท้อง"],
    raw: new Map<string, string>([
      ...Object.entries(PRICING_CONFIG),
      ["เลขที่บัญชี", "1234567890"], ["ชื่อบัญชี", "ร้านสากบิน"], ["ธนาคาร", "กสิกร"],
    ]),
  };
}
function bubbles(): string[] {
  return lineCalls.replies.flatMap((r) => r.messages).map((m) => (m.type === "text" ? (m.text ?? "") : "[IMG]"));
}
function allText(): string {
  return bubbles().join(" | ");
}
/** ban list ตาม spec หลักปิดการขาย (ห้ามทุกรูป) */
const BANNED_CLOSE = [/รับ(ไป)?(เลย)?(ไหม|มั้ย)/, /รับ(ไป)?เลยนะคะ/];
function hasBannedClose(text: string): boolean {
  return BANNED_CLOSE.some((re) => re.test(text));
}
/** D-61.C2: คำต้องห้ามในข้อความถึงลูกค้า (กฎเหล็ก CLAUDE.md) — คุมทั้งข้อความในโค้ดและแนวตอบในชีต
 *  🔴 ใช้กับ "บอลลูนที่ส่งหาลูกค้า" เท่านั้น — ข้อความแจ้งแอดมิน (🔔/footer) ไม่อยู่ในขอบเขตกฎนี้ */
const BANNED_WORDS = [/รบกวน/];
function hasBannedWord(text: string): boolean {
  return BANNED_WORDS.some((re) => re.test(text));
}

beforeEach(() => seedV3Sheet());

// ═══ กลุ่ม A · order gate ลำดับใหม่ (payment-first) ═══
describe("D-61.C golden · G03/G05 payment-first order gate", () => {
  it("🔴 โอน: ยังไม่มีสลิป แม้ที่อยู่ครบ → ยังไม่เขียนออเดอร์ (สลิปมาก่อน)", async () => {
    scriptGemini([turn({ reply: "รับทราบค่ะ", stage: "S4", orderData: { ชื่อ: "สมชาย", ที่อยู่: "11 ถ.เจริญกรุง กทม 10500", เบอร์: "0899999999", items: [{ qty: 3 }] }, paymentMethod: "โอน" })]);
    await sendText(U, "สมชาย 11 ถ.เจริญกรุง กทม 10500 0899999999");
    expect(sheetsCalls.appends.filter((a) => a.range.startsWith("Orders")), "โอนต้องมีสลิปก่อนถึงเขียน").toHaveLength(0);
  });
  it("🔴 COD: ที่อยู่ครบ + คอนเฟิร์ม COD → เขียนออเดอร์ได้ (ไม่ต้องรอสลิป)", async () => {
    scriptGemini([turn({ reply: "รับทราบค่ะ", stage: "S4", orderData: { ชื่อ: "สมหญิง", ที่อยู่: "22 ถ.พระราม 3 กทม 10120", เบอร์: "0811111111", items: [{ qty: 3 }] }, paymentMethod: "COD" })]);
    await sendText(U, "เก็บปลายทาง สมหญิง 22 ถ.พระราม 3 กทม 10120 0811111111");
    expect(sheetsCalls.appends.filter((a) => a.range.startsWith("Orders")).length, "COD ครบ = เขียนได้").toBeGreaterThan(0);
  });
});

// ═══ กลุ่ม B · ราคาจาก pricing engine (ไม่ใช่แถวความรู้) ═══
describe("D-61.C golden · G09/G10/G24 ราคามาจาก engine", () => {
  it("🔴 ตารางราคาใน prompt = เลขจาก engine (1 ถ้วย 95+30=125 · 3 ถ้วย 275 ส่งฟรี)", async () => {
    scriptGemini([turn({ reply: "1 ถ้วย 95 บาท ค่าส่ง 30 รวม 125 บาทค่ะ รับ 1 ถ้วย หรือ 3 ถ้วยส่งฟรีดีคะ", stage: "S2Q" })]);
    await sendText(U, "1 ถ้วยเท่าไหร่คะ");
    // ผ่าน price guard = เลขทั้งหมดอยู่ใน whitelist ของ engine (ไม่โดน block/เตือน)
    const pushes = JSON.stringify(adminPushes());
    expect(pushes, "ไม่มี alert ราคานอกระบบ").not.toContain("บอทพูดราคานอกระบบ");
    expect(allText()).toContain("125");
  });
  it("🔴 ราคามั่ว (ไม่อยู่ในตาราง) → price guard จับ (ยาม v2 ยังทำงานใน v3)", async () => {
    scriptGemini([turn({ reply: "ลดพิเศษเหลือ 199 บาทค่ะ", stage: "S2" })]);
    await sendText(U, "ลดได้ไหม");
    expect(JSON.stringify(adminPushes()), "guard เดิมยังคุม v3").toContain("บอทพูดราคานอกระบบ");
  });
});

// ═══ กลุ่ม C · choice-close ban ═══
describe("D-61.C golden · G23 choice-close ban", () => {
  it("แนวตอบในชีต v3 (ทุกแถว) ต้องไม่มี 'รับมั้ยคะ' ทุกรูป", () => {
    const cells = [...V3_STEP.slice(1).map((r) => r[6]), ...V3_KNOW.slice(1).map((r) => r[4])];
    for (const c of cells) expect(hasBannedClose(c), `ban close ในชีต: "${c}"`).toBe(false);
  });
  it("ban matcher จับทุกรูปที่ spec ห้าม", () => {
    for (const bad of ["รับมั้ยคะ", "รับไหมคะ", "สนใจรับมั้ยคะ", "รับไปเลยนะคะ", "รับเลยนะคะ"]) {
      expect(hasBannedClose(bad), bad).toBe(true);
    }
    for (const ok of ["รับเป็นโปรโมชั่นไหนดีคะ", "สะดวกโอน หรือเก็บเงินปลายทางดีคะ", "รับออเดอร์แล้วค่ะ"]) {
      expect(hasBannedClose(ok), ok).toBe(false);
    }
  });

  // 🔴 D-61.C2: คำว่า "รบกวน" — กฎเหล็กเดียวกัน สแกนแบบเดียวกับ choice-close
  it("🔴 แนวตอบในชีต v3 (ทุกแถว) ต้องไม่มีคำว่า 'รบกวน'", () => {
    const cells = [...V3_STEP.slice(1).map((r) => r[6]), ...V3_KNOW.slice(1).map((r) => r[4])];
    for (const c of cells) expect(hasBannedWord(c), `พบ "รบกวน" ในแนวตอบชีต: "${c}"`).toBe(false);
  });
  it("🔴 ข้อความ degraded ในโค้ด (ถึงลูกค้าจริง) ต้องไม่มีคำว่า 'รบกวน'", async () => {
    scriptGemini([turn({ degraded: true, stage: "S2" })]);
    await sendText(U, "สวัสดีค่ะ");
    const t = allText();
    expect(t.trim().length, "degraded ต้องยังมีข้อความถึงลูกค้า").toBeGreaterThan(0);
    expect(hasBannedWord(t), `พบ "รบกวน" ในข้อความถึงลูกค้า: ${t}`).toBe(false);
  });
  it("ban matcher คำต้องห้ามจับถูก", () => {
    for (const bad of ["รบกวนพิมพ์ใหม่", "รบกวนแจ้งชื่อค่ะ"]) expect(hasBannedWord(bad), bad).toBe(true);
    for (const ok of ["ช่วยพิมพ์ส่งมาอีกครั้งนะคะ", "ขอชื่อผู้สั่งด้วยนะคะ"]) expect(hasBannedWord(ok), ok).toBe(false);
  });
});

// ═══ กลุ่ม D · สุขภาพ + assurance ═══
describe("D-61.C golden · G14-G19 สุขภาพ/assurance", () => {
  it("🔴 G14: แพ้กุ้ง → ตอบต่อ (ไม่ปิดบอท) + 🔔 + ไม่มีคำรับรอง", async () => {
    scriptGemini([turn({ reply: "มีกะปิซึ่งทำจากกุ้งค่ะ ข้อมูลไลน์ผลิตขอให้แอดมินเช็คให้นะคะ ลูกค้าแพ้เฉพาะกุ้ง หรืออาหารทะเลอื่นด้วยคะ", stage: "S2" })]);
    await sendText(U, "แพ้กุ้งทานได้ไหมคะ");
    expect((await readCustomer(U))?.human_mode).toBe(false);
    expect(JSON.stringify(adminPushes())).toContain("🔔");
    expect(findAssuranceHits(allText()), "ไม่มีคำรับรอง").toHaveLength(0);
  });
  it("🔴 G15: ถามสุขภาพซ้ำ → 🔔 ครั้งเดียวต่อเคส", async () => {
    scriptGemini([
      turn({ reply: "มีกะปิจากกุ้งค่ะ", stage: "S2" }),
      turn({ reply: "เบาหวานแนะนำปรึกษาแพทย์นะคะ", stage: "S2" }),
    ]);
    await sendText(U, "แพ้กุ้งไหม");
    await sendText(U, "แล้วเบาหวานล่ะ");
    const count = adminPushes().filter((p) => p.messages.some((m) => m.type === "text" && (m as { text: string }).text.includes("🔔"))).length;
    expect(count).toBe(1);
  });
  it("🔴 G18: AI หลุดคำรับรอง 2 รอบ → ตัดประโยค ส่วนที่เหลือยังถึงลูกค้า", async () => {
    scriptGemini([
      turn({ reply: "มีกะปิทำจากกุ้งค่ะ\nทานได้เลยค่ะ[[เว้น]]สอบถามเพิ่มได้นะคะ", stage: "S2" }),
      turn({ reply: "ปลอดภัยแน่นอนค่ะ", stage: "S2" }),
    ]);
    await sendText(U, "แพ้กุ้งกินได้ไหม");
    const t = allText();
    expect(t).toContain("มีกะปิทำจากกุ้งค่ะ");
    expect(findAssuranceHits(t)).toHaveLength(0);
  });
  it("🔴 G19: ตัดหมด → fallback สุภาพ ไม่เงียบ", async () => {
    scriptGemini([turn({ reply: "ทานได้ค่ะ", stage: "S2" }), turn({ reply: "ไม่เป็นไรค่ะ", stage: "S2" })]);
    await sendText(U, "แพ้อาหารทะเลรุนแรงทานได้ไหม");
    expect(allText().trim().length, "ต้องมีข้อความถึงลูกค้าเสมอ").toBeGreaterThan(0);
    expect(findAssuranceHits(allText())).toHaveLength(0);
  });
});

// ═══ กลุ่ม C6 · คำถามพาไปต่อ = บอลลูนเดี่ยว (delivery layer · end-to-end) ═══
describe("D-61.C6 golden · splitter ต่อสายจริงใน pipeline v3", () => {
  it("🔴 คำตอบที่คำถามติดท้ายรายการโปร → ส่งถึงลูกค้าเป็นบอลลูนคำถามเดี่ยว", async () => {
    scriptGemini([
      turn({
        reply: "โปรโมชั่นค่ะ\n- 1 ถ้วย: สินค้า 95 + ค่าส่ง 30 = รวม 125 บาท\n- 3 ถ้วย: สินค้า 275 + ส่งฟรี = รวม 275 บาท\nลูกค้ารับเป็นโปรโมชั่นไหนดีคะ",
        stage: "S2",
      }),
    ]);
    await sendText(U, "ราคาเท่าไหร่คะ");
    const bs = bubbles();
    expect(bs[bs.length - 1], "บอลลูนสุดท้าย = คำถามล้วน").toBe("ลูกค้ารับเป็นโปรโมชั่นไหนดีคะ");
    expect(bs[bs.length - 2], "รายการโปรอยู่บอลลูนก่อนหน้า ครบ").toContain("- 3 ถ้วย");
  });

  it("คำถามเป็นบอลลูนเดี่ยวอยู่แล้ว → ไม่เปลี่ยนรูป", async () => {
    scriptGemini([turn({ reply: "โปรโมชั่นค่ะ\n- 1 ถ้วย: 125 บาท[[เว้น]]รับเป็นโปรไหนดีคะ", stage: "S2" })]);
    await sendText(U, "ราคาเท่าไหร่คะ");
    const bs = bubbles();
    expect(bs[bs.length - 1]).toBe("รับเป็นโปรไหนดีคะ");
    expect(bs.filter((b) => b !== "[IMG]"), "ไม่งอกบอลลูนเกิน").toHaveLength(2);
  });

  it("คำตอบไม่จบด้วยคำถาม → ไม่ตัด (ปล่อยตามเดิม)", async () => {
    scriptGemini([turn({ reply: "รับทราบค่ะ\nทีมแอดมินกำลังแพ็คของเตรียมส่งพอดีเลยค่ะ", stage: "S3" })]);
    await sendText(U, "โอนแล้วค่ะ");
    const bs = bubbles().filter((b) => b !== "[IMG]");
    expect(bs, "ยังเป็นบอลลูนเดียว").toHaveLength(1);
  });
});

// ═══ กลุ่ม D2 · D-61.C2 · 🔔 ธงสุขภาพต้องแจ้งเสมอ (แยกด่วน/ไม่ด่วน) ═══
function bells(): string[] {
  return adminPushes()
    .flatMap((p) => p.messages)
    .filter((m) => m.type === "text" && (m as { text: string }).text.includes("🔔"))
    .map((m) => (m as { text: string }).text);
}

describe("D-61.C2 golden · 🔔 ธงสุขภาพ ไม่ผูกกับผลของเทิร์น", () => {
  it("🔴 เทิร์นธงสุขภาพที่ AI ล้ม (degraded) → 🔔 แบบด่วนยิง 1 ครั้ง (เดิมเงียบสนิท)", async () => {
    scriptGemini([turn({ degraded: true, stage: "S2" })]);
    await sendText(U, "แพ้กุ้งทานได้ไหมคะ");
    const b = bells();
    expect(b, "AI ล้มก็ต้องแจ้ง — H1 ห้ามเงียบ").toHaveLength(1);
    expect(b[0], "ต้องบอกชัดว่าบอทยังไม่ได้ตอบ").toContain("บอทยังไม่ได้ตอบ");
    expect((await readCustomer(U))?.human_mode, "ธงสุขภาพไม่ปิดบอท").toBe(false);
  });

  it("เทิร์นปกติ → 🔔 แบบเดิม (ไม่ใช่ข้อความด่วน)", async () => {
    scriptGemini([turn({ reply: "มีกะปิซึ่งทำจากกุ้งค่ะ ขอให้แอดมินเช็คไลน์ผลิตให้นะคะ", stage: "S2" })]);
    await sendText(U, "แพ้กุ้งทานได้ไหมคะ");
    const b = bells();
    expect(b).toHaveLength(1);
    expect(b[0], "เทิร์นปกติห้ามขึ้นข้อความด่วน").not.toContain("บอทยังไม่ได้ตอบ");
  });

  it("🔴 degraded ก่อน → เทิร์นปกติตามมา: dedup ข้ามชนิด ไม่ยิงซ้ำ", async () => {
    scriptGemini([
      turn({ degraded: true, stage: "S2" }),
      turn({ reply: "มีกะปิซึ่งทำจากกุ้งค่ะ", stage: "S2" }),
    ]);
    await sendText(U, "แพ้กุ้งทานได้ไหมคะ");
    await sendText(U, "แล้วแพ้ปลาล่ะคะ");
    const b = bells();
    expect(b, "marker เดียวคุมทั้ง 2 แบบ").toHaveLength(1);
    expect(b[0], "ตัวที่ยิงคือตัวแรก (แบบด่วน)").toContain("บอทยังไม่ได้ตอบ");
  });
});

// ═══ กลุ่ม E · ส่งต่อคน ═══
describe("D-61.C golden · G20-G22 handoff", () => {
  it("G20: 'ขอคุยกับแอดมิน' → handoff เดิม (footer + ปิดบอท)", async () => {
    await sendText(U, "ขอแอดมินหน่อยค่ะ");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });
  it("G21/G22: เคลม (K017) / ขายส่ง (K018) → AI ตั้ง handoff flag → ส่งต่อ", async () => {
    scriptGemini([turn({ reply: "รับเรื่องแล้วค่ะ ขอส่งต่อแอดมินตรวจสอบให้นะคะ", stage: "HX", handoff: true, handoffReason: "เคลมของเสีย (K017)" })]);
    await sendText(U, "ของที่ได้รับเสียหายค่ะ");
    const a = JSON.stringify(adminPushes());
    expect(a).toContain(FOOTER);
    expect(a).toContain("เคลม");
    expect(allText(), "ตอบอบอุ่นก่อนส่งต่อ").toContain("รับเรื่องแล้วค่ะ");
  });
});

// ═══ กลุ่ม F · invariant ระบบ ═══
describe("D-61.C golden · G27/G28 ยามเดิม + delivery invariant ใน v3", () => {
  it("claims guard ยังคุม v3", async () => {
    scriptGemini([turn({ reply: "ทานแล้วรักษาโรคเบาหวานหายขาดค่ะ", stage: "S2" })]);
    harnessOverrides.config = { ...harnessOverrides.config, raw: new Map([...(harnessOverrides.config.raw ?? new Map()), ["คำต้องห้าม_โฆษณา", "รักษา,หายขาด"]]) };
    await sendText(U, "ช่วยเบาหวานไหม");
    expect(JSON.stringify(adminPushes())).toContain("คำโฆษณาต้องห้าม");
  });
  it("บอลลูนเกิน 5 → ตัดเหลือ 5 + ไม่จบด้วยรูป (invariant เดิม)", async () => {
    scriptGemini([turn({ reply: "a[[เว้น]]b[[เว้น]]c[[เว้น]]d[[เว้น]]e[[เว้น]]f[[เว้น]][[รูป:https://ex/x.jpg]]", stage: "S2" })]);
    await sendText(U, "ขอดูรายละเอียด");
    const msgs = lineCalls.replies.flatMap((r) => r.messages);
    expect(msgs.length).toBeLessThanOrEqual(5);
    expect(msgs[msgs.length - 1].type).toBe("text");
  });
  it("รูป (สลิป) ยังเข้า flow เดิมใน v3", async () => {
    scriptGemini([turn({ reply: "ได้รับสลิปแล้วค่ะ ขอที่อยู่จัดส่งด้วยนะคะ", stage: "S4", imageIntent: "slip" })]);
    await sendImage(U);
    expect(allText()).toContain("ได้รับสลิป");
  });
});

// ═══ กลุ่ม G · sandbox + schema card ═══
describe("D-61.C · sandbox + validateV3Bundle", () => {
  it("🔴 config memo ไม่รั่วข้ามโหมด (sandbox ไม่เขียน cache)", async () => {
    __resetConfigCache();
    const ctx = createSandbox("sess-schema-2");
    await runInSandbox(ctx, async () => getConfig()); // sandbox โหลด config
    // prod เรียกต่อ — ต้องไม่ได้ config ที่ sandbox cache ไว้ (ต้องโหลดใหม่เอง ไม่ throw)
    const prodCfg = await getConfig();
    expect(prodCfg).toBeTruthy();
  });
  it("validateV3Bundle: แท็บครบ=ok · header ขาด=⚠️ + นับ live/draft", () => {
    const stats = validateV3Bundle({ เส้นทางขาย: V3_STEP, ความรู้: V3_KNOW, CSV_Products: V3_PRODUCTS, CSV_Promo: V3_PROMO, CSV_Vars: [], CSV_Config: [] });
    const know = stats.find((s) => s.tab === "ความรู้")!;
    expect(know.ok).toBe(true);
    expect(know.live).toBe(4);
    expect(know.draft, "K019 ว่าง = draft").toBe(1);
    const vars = stats.find((s) => s.tab === "CSV_Vars")!;
    expect(vars.ok, "แท็บว่าง = ไม่ ok (ฟ้อง)").toBe(false);
    const broken = validateV3Bundle({ เส้นทางขาย: [["ผิด"], ["x"]] }).find((s) => s.tab === "เส้นทางขาย")!;
    expect(broken.missing).toContain("step_id");
  });
});
