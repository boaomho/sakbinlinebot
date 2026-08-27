import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, adminPushes, lineCalls, harnessOverrides } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { buildSalesSystemV3 } from "@/prompt/system-v3";
import { findAssuranceHits, cutAssuranceLines, DEFAULT_ASSURANCE_PHRASES } from "@/lib/guards/assurance";
import { defaultReply } from "@/lib/config";

/**
 * D-61.A · สมอง v3 (D-68: v3 เหลือโหมดเดียว — ไม่ต้องตั้ง SHEET_SCHEMA อีกแล้ว)
 * ครอบ: เรียบเรียงสด (pattern ไม่ทับ) · FAQ/OBJ ไม่ force · handoff จริงชนะ · ธงสุขภาพ (hint+🔔 dedup+ไม่ปิดบอท) ·
 * assurance guard (block→regenerate→cut→fallback · ห้ามเงียบ) · DEFAULT_HANDOFF_KEYWORDS_V3 (คำสุขภาพไม่ปิดบอท)
 */
const U = "Uv3braincustomer0000000000000001";
const FOOTER = "บอทปิดการทำงานกับลูกค้ารายนี้แล้ว";

const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย"];
function row(step_id: string, funnel: string, o: Partial<Record<string, string>> = {}): string[] {
  return STEP_H.map((h) => (h === "step_id" ? step_id : h === "funnel_stage" ? funnel : o[h] ?? ""));
}
function v3Sheet(): string[][] {
  return [
    STEP_H,
    row("S1", "lead", { ตัวอย่างคำตอบ: "สวัสดีค่ะ (PATTERN-S1)" }),
    row("S2", "qualified", { ตัวอย่างคำตอบ: "รายละเอียดสินค้า (PATTERN-S2)", ตัวอย่างประโยคปิดท้าย: "สนใจโปรไหนดีคะ (PATTERN-CLOSE)" }),
    row("HX", "handoff", { ตัวอย่างคำตอบ: "ขอตามแอดมินนะคะ" }),
  ];
}
function seedV3(): void {
  seedBotLib({ stepRows: v3Sheet() });
}
function bubbles(): string[] {
  return lineCalls.replies.flatMap((r) => r.messages).map((m) => (m.type === "text" ? (m.text ?? "") : "[IMG]"));
}
function healthPushCount(): number {
  return adminPushes().filter((p) => p.messages.some((m) => m.type === "text" && (m as { text: string }).text.includes("🔔"))).length;
}
/** config v3 มาตรฐานของเทส: คำ_handoff = เรียกคนเท่านั้น (ตรงชีตจริงตาม spec) + ธงสุขภาพ */
function cfgV3(over: Record<string, unknown> = {}): void {
  harnessOverrides.config = { handoffKeywords: ["ขอแอดมิน", "คุยกับคน", "ฟ้อง"], healthFlagKeywords: ["แพ้", "เบาหวาน"], ...over };
}

beforeEach(() => seedV3());

// ---------- unit · assurance guard (pure) ----------
describe("D-61.A · assurance guard (pure)", () => {
  it("จับคำรับรอง · รูปคำถามไม่นับ (ทานได้ไหม = คำถาม ไม่ใช่รับรอง)", () => {
    expect(findAssuranceHits("ทานได้เลยค่ะ ไม่ต้องห่วง")).toContain("ทานได้");
    expect(findAssuranceHits("ลูกค้าถามว่าทานได้ไหมใช่มั้ยคะ")).toHaveLength(0);
    expect(findAssuranceHits("สินค้ามีส่วนผสมปลาค่ะ แนะนำปรึกษาแพทย์ก่อนนะคะ")).toHaveLength(0);
  });
  it("ตัดรายบรรทัด · บอลลูนว่างถูกทิ้ง · ทั้งหมดว่าง = ''", () => {
    const r = cutAssuranceLines("มีปลาเป็นส่วนผสมค่ะ\nทานได้เลยค่ะ[[เว้น]]สอบถามเพิ่มได้นะคะ");
    expect(r.text).toContain("มีปลาเป็นส่วนผสมค่ะ");
    expect(r.text).not.toContain("ทานได้");
    expect(r.cutLines).toBe(1);
    const empty = cutAssuranceLines("ทานได้ค่ะ[[เว้น]]ปลอดภัยแน่นอนค่ะ");
    expect(empty.text).toBe("");
    expect(empty.droppedBubbles).toBe(2);
    expect(DEFAULT_ASSURANCE_PHRASES.length).toBeGreaterThan(3);
  });
});

// ---------- unit · D-62 guard แยกบริบท (ประโยคจริงจาก probe D-61.C3) ----------
describe("D-62 · เชิงระวัง+ส่งต่อแพทย์/ทีม = ไม่ hit · คำรับรองตรง/มีเงื่อนไข = hit เหมือนเดิม", () => {
  it("🟢 เชิงระวังที่จบด้วยส่งไปแพทย์/ทีม → ไม่ hit (ประโยคจริงที่เคยโดน cut)", () => {
    for (const ok of [
      "เพื่อความสบายใจและปลอดภัยสูงสุด แนะนำให้นำข้อมูลส่วนผสมนี้ปรึกษาแพทย์หรือเภสัชกรประกอบการตัดสินใจนะคะ",
      "เพื่อความมั่นใจและปลอดภัยที่สุด แอดมินแนะนำให้คุณแม่นำข้อมูลส่วนผสมนี้ปรึกษาคุณหมอที่ฝากครรภ์ก่อนรับประทานนะคะ",
      "เพื่อความปลอดภัยสูงสุด แนะนำให้พิจารณาข้อมูลนี้หรือปรึกษาแพทย์ประกอบการตัดสินใจนะคะ",
      "เพื่อความปลอดภัย แอดมินขอให้ทีมงานช่วยตรวจสอบข้อมูลไลน์ผลิตเพิ่มเติมให้นะคะ",
    ]) {
      expect(findAssuranceHits(ok), ok).toHaveLength(0);
    }
  });
  it("🔴 คำรับรองตรง/มีเงื่อนไข/บรรยายสินค้า → hit เหมือนเดิม (รวมประโยค regen-worse จริง)", () => {
    for (const bad of [
      "ปลอดภัยแน่นอนค่ะ",
      "ผ่านกระบวนการฟรีซดรายที่สะอาด ปลอดภัย และมีเลข อย. ตรวจสอบได้ค่ะ", // regen-worse จริงจาก probe
      "หากคุณแม่ไม่ได้แพ้ส่วนผสมเหล่านี้ก็สามารถเลือกทานได้ตามความเหมาะสมเลยนะคะ", // มีเงื่อนไข
      "เพื่อความปลอดภัยของลูกค้า เลือกของเราได้เลยค่ะ", // เพื่อความ... แต่ไม่มีส่งต่อแพทย์/ทีม
      "เพื่อความสบายใจ ทานได้เลยค่ะ แนะนำปรึกษาแพทย์นะคะ", // มีช่องว่างคั่น = ไม่ใช่โครงเดียวกัน
    ]) {
      expect(findAssuranceHits(bad).length, bad).toBeGreaterThan(0);
    }
  });
  it("cut เก็บบรรทัดเชิงระวังไว้ ตัดเฉพาะบรรทัดรับรอง", () => {
    const r = cutAssuranceLines(
      "มีปลาเป็นส่วนผสมค่ะ\nปลอดภัยแน่นอนค่ะ[[เว้น]]เพื่อความปลอดภัยสูงสุด แนะนำปรึกษาแพทย์ก่อนนะคะ",
    );
    expect(r.text).toContain("แนะนำปรึกษาแพทย์");
    expect(r.text).not.toContain("แน่นอน");
    expect(r.cutLines).toBe(1);
  });
});

// ---------- unit · โครง prompt v3 ----------
describe("D-61.A · buildSalesSystemV3 (โครง + few-shot คำต่อคำ)", () => {
  const s = buildSalesSystemV3({ botName: "ปลาทู", shopName: "สากบิน", personaGender: "หญิง", useEmoji: false });
  it("มีครบ: identity/หมวก 3 ใบ/3C/ตอบแทรก-พากลับ/4 ประตู/สุขภาพ/JSON contract", () => {
    expect(s).toContain("เขียนข้อความถึงลูกค้าเองทุกเทิร์น");
    expect(s).toContain("หมวกนักขาย 3 ใบ");
    expect(s).toContain("choice close");
    expect(s).toContain("รับมั้ยคะ"); // ban list
    expect(s).toContain("say no but never say no");
    expect(s).toContain("3C");
    expect(s).toContain("ตอบแทรก-แล้วพากลับ");
    expect(s).toContain("ชำระเงินมาก่อนที่อยู่");
    // D-61.C3: เส้นห้ามสุขภาพยกระดับจาก "ห้ามประโยครับรอง" → "ห้ามคำ แม้เชิงแนะนำ" + ประโยคแทน
    expect(s).toContain("ห้ามใช้ \"คำ\" เหล่านี้ในทุกรูปประโยค");
    expect(s).toContain("แนะนำนำข้อมูลส่วนผสมนี้ปรึกษาแพทย์เพื่อความสบายใจค่ะ");
    expect(s).toContain("objection_detected"); // JSON contract เดิม
    expect(s).toContain("ค่ะ/นะคะ");
  });
  it("few-shot ภาคผนวก ก คำต่อคำ (ฉาก 1-3)", () => {
    expect(s).toContain("ของเราเน้นเนื้อปลาทูแน่นๆ เครื่องจัดจ้าน");
    expect(s).toContain("ที่อยู่จัดส่งถูกต้องนะคะ");
    // D-61.C5: สลับลำดับ — nudge ก่อน คำถามพาไปต่อปิดท้าย (บอลลูนปิดต้องจบด้วยคำถาม)
    expect(s).toContain("ทีมแอดมินกำลังแพคของเตรียมส่งพอดีเลยค่ะ ลูกค้าสะดวกโอนเลยมั้ยคะ");
    expect(s).toContain("รับน้ำพริกปลาทู 1 ถ้วยตามที่แจ้งมา หรือรับเป็นโปรโมชั่น 3 ถ้วยดีคะ");
  });
});

// ---------- unit · D-61.C4 persona ชื่อบอทตาม Config ----------
describe("D-61.C4 · บอทเรียกตัวเองด้วยชื่อจาก Config (ไม่ใช่ 'แอดมิน')", () => {
  const NAME = "น้องกุ้ง"; // ชื่อสมมติ ไม่ใช่ default — จับ hardcode ได้ทันที
  const s = buildSalesSystemV3({ botName: NAME, shopName: "สากบิน", personaGender: "หญิง", useEmoji: false });

  it("กติกา identity สั่งให้เรียกแทนตัวเองด้วยชื่อจาก Config", () => {
    expect(s).toContain(`เรียกแทนตัวเองว่า "${NAME}" เสมอ`);
    expect(s).toContain("ห้ามเรียกตัวเองว่า \"แอดมิน\" เด็ดขาด");
  });

  it("🔴 few-shot: บทพูดของบอททุกฉากใช้ชื่อจาก Config — ไม่มี 'แอดมิน' ในบทบอท", () => {
    // ตัดเอาเฉพาะบล็อกตัวอย่างบทสนทนา (นอกบล็อกเป็นคำสั่ง/กติกา พูดถึงแอดมินมนุษย์ได้)
    const fewShot = s.slice(s.indexOf("<ตัวอย่างบทสนทนา"), s.indexOf("</ตัวอย่างบทสนทนา>"));
    expect(fewShot.length).toBeGreaterThan(200);
    // "แอดมิน" ที่เหลือได้ต้องเป็นทีมมนุษย์เท่านั้น = ขึ้นต้นด้วย "ทีม"
    const lone = [...fewShot.matchAll(/(.{0,3})แอดมิน/g)].filter((m) => m[1] !== "ทีม");
    expect(lone.map((m) => m[0]), "บทบอทยังเรียกตัวเองว่าแอดมิน").toHaveLength(0);
    expect(fewShot).toContain(`${NAME}สรุปยอดให้เลยนะคะ`);
    expect(fewShot).toContain(`${NAME}ส่งรายละเอียดเพิ่มเติมให้ค่ะ`);
  });

  it("คงคำว่า 'ทีมแอดมิน' ไว้ตรงที่หมายถึงคนจริง (แพ็คของ/จัดส่ง)", () => {
    expect(s).toContain("ทีมแอดมินกำลังแพคของเตรียมส่งพอดีเลยค่ะ");
    expect(s).toContain("ทีมแอดมินจัดส่งของให้ลูกค้า");
  });

  it("ข้อความ fallback ในโค้ดใช้ชื่อจาก Config ไม่ hardcode", () => {
    expect(defaultReply(NAME)).toContain(NAME);
    expect(defaultReply(NAME)).not.toContain("ปลาทู");
  });
});

// ---------- unit · D-61.C5 กติกาโปร/ราคา/บอลลูนปิด ----------
describe("D-61.C5 · ห้ามประดิษฐ์โปร · ราคาแยกค่าส่ง · choice close แยกบอลลูน", () => {
  const s = buildSalesSystemV3({ botName: "ปลาทู", shopName: "สากบิน", personaGender: "หญิง", useEmoji: false });
  it("กติกา: รายการโปร = เฉพาะแถวติดป้าย [โปรโมชั่น]", () => {
    expect(s).toContain("เฉพาะแถวที่ติดป้าย [โปรโมชั่น] ในตารางราคา");
    expect(s).toContain("ห้ามยกแถว [ราคาตามจำนวน ไม่ใช่โปร] ขึ้นมาโชว์เป็นรายการโปร");
  });
  it("กติกา: รูปแบบราคาแยกค่าส่ง + ตัวอย่างผิดที่ห้าม", () => {
    expect(s).toContain("1 ถ้วย 95 บาท + ค่าส่ง 30 บาท = รวม 125 บาทค่ะ");
    expect(s).toContain("125 บาท (มีค่าส่ง 30)");
  });
  it("กติกา: choice close = บอลลูนสุดท้ายแยกเดี่ยว", () => {
    expect(s).toContain("choice close = บอลลูนสุดท้าย แยกเดี่ยวเสมอ");
  });
});

// ---------- pipeline v3 (scripted) ----------
describe("D-61.A · เรียบเรียงสด — pattern ชีตไม่ทับ reply ของ AI", () => {
  it("🔴 reply AI ส่งตรงถึงลูกค้า (ไม่ใช่ PATTERN ของ step)", async () => {
    cfgV3();
    scriptGemini([turn({ reply: "คำตอบเรียบเรียงสดค่ะ[[เว้น]]รับเป็นโปรไหนดีคะ", stage: "S2" })]);
    await sendText(U, "สนใจน้ำพริกค่ะ");
    const t = bubbles().join(" | ");
    expect(t).toContain("คำตอบเรียบเรียงสดค่ะ");
    expect(t, "pattern ชีตต้องไม่ทับ").not.toContain("PATTERN-S2");
    expect(t).not.toContain("PATTERN-CLOSE");
  });

  it("🔴 FAQ keyword match ก็ไม่ force answer (AI ประกอบเอง)", async () => {
    cfgV3();
    scriptGemini([turn({ reply: "ส่งประมาณ 1-2 วันค่ะ มีอะไรให้ช่วยเพิ่มไหมคะ", stage: "S2" })]);
    await sendText(U, "ส่งกี่วันคะ"); // keyword "ส่งกี่วัน" ใน seedBotLib FAQ
    const t = bubbles().join(" ");
    expect(t).toContain("ส่งประมาณ 1-2 วันค่ะ");
    expect(t, "คำตอบ FAQ ดิบต้องไม่ถูก force").not.toContain("1-2 วันค่ะ มีอะไรให้ช่วยเพิ่มไหมคะ 1-2 วันค่ะ");
  });

  it("handoff จริง (AI flag) ยังชนะทุกอย่าง — footer + ปิดบอท", async () => {
    cfgV3();
    scriptGemini([turn({ reply: "ขอส่งต่อแอดมินนะคะ", stage: "HX", handoff: true, handoffReason: "ลูกค้าโกรธ" })]);
    await sendText(U, "จะร้องเรียนพวกคุณ");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 v3 DEFAULT_HANDOFF (fallback): คำสุขภาพไม่ปิดบอท · 'ขอแอดมิน' ยังปิด", async () => {
    cfgV3({ handoffKeywords: [], healthFlagKeywords: [] }); // fallback = DEFAULT_HANDOFF_KEYWORDS_V3
    scriptGemini([turn({ reply: "มีส่วนผสมปลาค่ะ", stage: "S2" })]);
    await sendText(U, "แพ้กุ้งหรือเปล่าคะ");
    expect((await readCustomer(U))?.human_mode, "คำสุขภาพไม่โดนปิดเงียบใน v3").toBe(false);
    await sendText(U, "ขอแอดมินหน่อยค่ะ");
    expect((await readCustomer(U))?.human_mode, "เจตนาเรียกคนยังปิดบอท").toBe(true);
  });
});

describe("D-61.A · ธงสุขภาพ (A6) — hint + 🔔 dedup ต่อเคส + ไม่ force + ไม่ปิดบอท", () => {
  it("🔴 flag → บอทตอบสด + 🔔 ครั้งเดียว + human_mode=false + stage จาก AI (ไม่ถูก force)", async () => {
    cfgV3();
    scriptGemini([
      turn({ reply: "สินค้ามีส่วนผสมปลาและกะปิค่ะ แนะนำปรึกษาแพทย์ก่อนนะคะ ลูกค้าแพ้เฉพาะกุ้ง หรืออาหารทะเลอื่นด้วยคะ", stage: "S2" }),
      turn({ reply: "มีกะปิซึ่งทำจากกุ้งค่ะ ขอให้ข้อมูลไลน์ผลิตให้แอดมินเช็คเพิ่มนะคะ", stage: "S2" }),
    ]);
    await sendText(U, "แพ้กุ้งค่ะ กินได้ไหม");
    expect(bubbles().join(" ")).toContain("แนะนำปรึกษาแพทย์");
    expect((await readCustomer(U))?.human_mode).toBe(false);
    expect(healthPushCount(), "🔔 ครั้งแรก").toBe(1);
    expect((await readCustomer(U))?.stage, "stage จาก AI ไม่ใช่ force").toBe("S2");
    // เทิร์นสอง — ธงติดอีกแต่ marker แล้ว → ไม่ push ซ้ำ
    await sendText(U, "แล้วเบาหวานล่ะคะ");
    expect(healthPushCount(), "dedup ต่อเคส").toBe(1);
    const c = await readCustomer(U);
    expect((c?.delivered_steps as string[]) ?? []).toContain("__HEALTH_NOTIFY__");
  });
});

describe("D-61.A · assurance guard ใน pipeline (block→regenerate→cut→fallback)", () => {
  it("🔴 คำตอบแรกหลุด 'ทานได้' → regenerate สะอาด → ลูกค้าเห็นตัว regenerate", async () => {
    cfgV3();
    scriptGemini([
      turn({ reply: "ทานได้เลยค่ะ ไม่ต้องกังวลนะคะ", stage: "S2" }), // call 1 หลุด
      turn({ reply: "สินค้ามีส่วนผสมปลาค่ะ แนะนำปรึกษาแพทย์ก่อนตัดสินใจนะคะ", stage: "S2" }), // regenerate สะอาด
    ]);
    await sendText(U, "แพ้ปลาทานได้ไหมคะ");
    const t = bubbles().join(" ");
    expect(t).toContain("แนะนำปรึกษาแพทย์");
    expect(t, "คำรับรองต้องไม่ถึงลูกค้า").not.toContain("ทานได้เลยค่ะ");
    expect((await readCustomer(U))?.human_mode, "ไม่ล้มเทิร์น ไม่ปิดบอท").toBe(false);
  });

  it("regenerate ยังหลุด → กลับคำตอบแรก ตัดบรรทัดผิด (เจ้าของเคาะ #2)", async () => {
    cfgV3();
    scriptGemini([
      turn({ reply: "มีปลาเป็นส่วนผสมหลักค่ะ\nทานได้เลยค่ะ[[เว้น]]สอบถามเพิ่มได้เลยนะคะ", stage: "S2" }),
      turn({ reply: "ปลอดภัยแน่นอนค่ะ", stage: "S2" }), // regenerate ก็หลุด
    ]);
    await sendText(U, "เป็นเบาหวานทานได้ไหม");
    const t = bubbles().join(" | ");
    expect(t).toContain("มีปลาเป็นส่วนผสมหลักค่ะ");
    expect(t).toContain("สอบถามเพิ่มได้เลยนะคะ");
    expect(t).not.toContain("ทานได้เลยค่ะ");
    expect(t).not.toContain("ปลอดภัย");
  });

  it("🔴 ตัดแล้วว่างหมด → fallback สุภาพ (ห้ามบอทเงียบทุกกรณี)", async () => {
    cfgV3();
    scriptGemini([
      turn({ reply: "ทานได้เลยค่ะ", stage: "S2" }),
      turn({ reply: "ไม่เป็นไรค่ะ หายห่วงได้เลย", stage: "S2" }),
    ]);
    await sendText(U, "แพ้อาหารทะเลรุนแรง ทานได้ไหม");
    const t = bubbles().join(" ");
    expect(t, "ต้องมีข้อความถึงลูกค้าเสมอ").toContain("แอดมินช่วยดูแลต่อ");
    expect(t).not.toContain("ทานได้เลยค่ะ");
  });

  it("ไม่ติดธง → guard ไม่ทำงานแม้มีคำ 'ทานได้' (ใช้ได้ในบริบทปกติ เช่น วิธีทาน)", async () => {
    cfgV3();
    scriptGemini([turn({ reply: "เปิดฝาเติมน้ำอุ่นก็ทานได้เลยค่ะ สะดวกมากค่ะ", stage: "S2" })]);
    await sendText(U, "กินยังไงคะ");
    expect(bubbles().join(" ")).toContain("ทานได้เลยค่ะ");
  });
});
