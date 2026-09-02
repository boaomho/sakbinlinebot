import { describe, it, expect, beforeEach, vi } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, adminPushes, lineCalls, harnessOverrides, geminiState } from "../harness/state";
import { sendImage } from "../harness/replay";
import { FULL_ADDRESS, testConfig } from "../harness/fixtures";
import { seedBotLib, PRICING_CONFIG, v3StepRows } from "../harness/botlib-fixture";
import { readCustomer, setLastSeenAgo } from "../harness/db";

/**
 * D-34 · funnel_stage=handoff_after_intake — บอทคุยเก็บข้อมูลก่อน แล้วค่อย handoff
 * เพดานกันค้าง + "ขอคุยแอดมิน"(keyword) + AI ตัดสิน → handoff (footer) · pivot ออก → push-on-exit (ไม่ footer)
 */
const U = "Uharnesstestcustomer0000000000014";
const FOOTER = "บอทปิดการทำงานกับลูกค้ารายนี้แล้ว";

/**
 * 🔴 D-73b: seed "ชีตดิบ" 9 คอลัมน์ตามชีตจริง — ไม่มีคอลัมน์ funnel_stage แล้ว
 * ประตู intake ระบุด้วยป้ายคอลัมน์ handoff = "เก็บข้อมูลก่อน" (ตรงกับแถว H_CLAIM/H_BULK ที่เจ้าของเพิ่มจริง)
 * funnel ของประตูขายมาจาก FIXED_FUNNEL (S1=lead · S2=qualified · S4=won) — ใช้ id จริงของชีต
 */
function stepSheet(): string[][] {
  return v3StepRows([
    { step_id: "S1", essence: "ทักทาย" },
    { step_id: "S2", entry: 'บอกจำนวน เช่น "สั่ง"', essence: "สรุปยอด" },
    { step_id: "S4", essence: "ปิดจบ" },
    { step_id: "H_CLAIM", intake: true, name: "เคลม-คุยก่อน", entry: 'ของเสีย เช่น "ของเสีย"', essence: "ขอรูปสินค้า+กล่อง และสิ่งที่เกิดขึ้น 🔴 ห้ามรับปากผลลัพธ์ทุกชนิด (คืนเงิน/ส่งของใหม่/เปลี่ยนของ)" },
    { step_id: "H9", handoff: true, name: "เคลมด่วน", entry: "แพ้อาหาร" },
  ]);
}
function cfg(extra: [string, string][] = []): Map<string, string> {
  return new Map<string, string>([...Object.entries(PRICING_CONFIG), ...extra]);
}
function customerText(): string {
  return lineCalls.replies.flatMap((rr) => rr.messages).map((m) => (m.type === "text" ? m.text : "")).join(" ");
}

beforeEach(() => seedBotLib({ stepRows: stepSheet() }));

describe("handoff_after_intake — คุยก่อนค่อยส่งคน (D-34)", () => {
  it("เข้า intake เทิร์นแรก → ไม่ handoff · intake_turns=1 (บอทคุยก่อน)", async () => {
    scriptGemini([turn({ reply: "เสียใจด้วยนะคะ ขอถามรายละเอียดหน่อยค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "สินค้ามีปัญหาค่ะ");
    expect(JSON.stringify(adminPushes()), "ยังไม่ส่งคน").not.toContain(FOOTER);
    const c = await readCustomer(U);
    expect(c?.human_mode).toBe(false);
    expect(c?.intake_turns).toBe(1);
  });

  it("🔴 เกินเพดาน (เพดาน=2) → handoff + footer (กันค้าง)", async () => {
    harnessOverrides.config = { raw: cfg([["เพดานเทิร์นก่อนส่งแอดมิน", "2"]]) };
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "ขอรูปด้วยค่ะ", stage: "H_CLAIM", handoff: false }),
    ]);
    await sendText(U, "สินค้ามีปัญหา");
    expect((await readCustomer(U))?.human_mode, "เทิร์น 1 ยังคุย").toBe(false);
    await sendText(U, "อธิบายเพิ่ม");
    expect(JSON.stringify(adminPushes()), "เทิร์น 2 เกินเพดาน → handoff").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("'ขอคุยกับแอดมิน' กลาง intake → handoff ทันที (keyword pre-check)", async () => {
    scriptGemini([turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "สินค้ามีปัญหา");
    await sendText(U, "ขอคุยกับแอดมินเลยค่ะ");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 AI ตั้ง handoff=true เทิร์นแรก → ยังไม่ handoff (ถามก่อนอย่างน้อย min=1) · เทิร์น 2 + flag → handoff", async () => {
    scriptGemini([
      turn({ reply: "ขอส่งต่อแอดมินนะคะ", stage: "H_CLAIM", handoff: true, handoffReason: "เคลม" }),
      turn({ reply: "ขอส่งต่อแอดมินค่ะ", stage: "H_CLAIM", handoff: true, handoffReason: "เคลม" }),
    ]);
    await sendText(U, "สินค้ามีปัญหา");
    expect(JSON.stringify(adminPushes()), "เทิร์น 1 แม้ AI flag → ยังถามก่อน").not.toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode, "เทิร์น 1 ไม่ปิดบอท").toBe(false);
    await sendText(U, "รายละเอียดเพิ่มค่ะ");
    expect(JSON.stringify(adminPushes()), "เทิร์น 2 + flag → handoff").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 pivot: เคลมแล้ว 'ขอสั่งเพิ่ม' → ย้ายประตูขาย · push-on-exit (ไม่ footer) · บอทขายต่อ · intake_turns=0", async () => {
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "ได้เลยค่ะ รับ 3 ถ้วยนะคะ", stage: "S2", handoff: false, orderData: { items: [{ qty: 3 }] } }),
    ]);
    await sendText(U, "สินค้ามีปัญหา");
    await sendText(U, "เอาเป็นว่าขอสั่งเพิ่ม 3 ถ้วย");

    const admin = JSON.stringify(adminPushes());
    expect(admin, "(ก) push-on-exit เข้ากลุ่ม").toContain("ลูกค้าเพิ่งคุยเรื่อง");
    expect(admin, "(ก) ไม่มี footer").not.toContain(FOOTER);
    expect(customerText(), "(ข) บอทขายต่อ").toContain("รับ 3 ถ้วย");
    const c = await readCustomer(U);
    expect(c?.human_mode, "(ค) บอทไม่ปิด").toBe(false);
    expect(c?.intake_turns, "(ง) reset").toBe(0);
  });

  it("🔴 pivot + ปิดออเดอร์เทิร์นเดียว → 📦 กับ push-on-exit ไม่ตีกัน (คนละข้อความ)", async () => {
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "รับ 1 ถ้วย เก็บปลายทางค่ะ", stage: "S4", handoff: false, paymentMethod: "COD", orderData: { items: [{ qty: 1 }], ...FULL_ADDRESS } }),
    ]);
    await sendText(U, "สินค้ามีปัญหา");
    await sendText(U, "ขอสั่ง 1 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 ชลบุรี 20000 0811122334");

    const admin = JSON.stringify(adminPushes());
    expect(admin, "📦 ออเดอร์ใหม่").toContain("ออเดอร์ใหม่");
    expect(admin, "push-on-exit").toContain("ลูกค้าเพิ่งคุยเรื่อง");
    expect(admin, "(จ) ไม่มี footer (ทั้งคู่ไม่ใช่ handoff)").not.toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(false);
  });

  it("🔴 reset ตอน handoff จาก intake → intake_turns=0 (กัน counter ค้างข้ามเซสชัน · D-35)", async () => {
    harnessOverrides.config = { raw: cfg([["เพดานเทิร์นก่อนส่งแอดมิน", "1"]]) }; // cap 1 → handoff เทิร์นแรกผ่านเพดาน
    scriptGemini([turn({ reply: "ส่งต่อค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "สินค้ามีปัญหา");
    expect(JSON.stringify(adminPushes()), "เกินเพดาน → handoff").toContain(FOOTER);
    expect((await readCustomer(U))?.intake_turns, "🔴 reset ตอน handoff (ไม่ค้าง)").toBe(0);
  });

  it("🔴 timeout: เงียบเกิน 45 นาที → intake นับใหม่ (ไม่สะสมข้ามเซสชัน · D-35)", async () => {
    scriptGemini([turn({ reply: "ถามค่ะ", stage: "H_CLAIM", handoff: false }), turn({ reply: "ถามอีกค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "สินค้ามีปัญหา");
    expect((await readCustomer(U))?.intake_turns).toBe(1);
    await setLastSeenAgo(U, 60); // เงียบ 60 นาที (> adminSilenceReturnMinutes 45)
    await sendText(U, "สินค้ามีปัญหาอีกค่ะ");
    expect((await readCustomer(U))?.intake_turns, "เงียบนาน → เริ่มนับใหม่ (1 ไม่ใช่ 2)").toBe(1);
  });

  it("ป้าย handoff=\"ใช่\" (H9) → ยัง handoff เทิร์นแรก (D-33 · semantics เดิมเป๊ะ)", async () => {
    scriptGemini([turn({ reply: "...", stage: "H9", handoff: false })]);
    await sendText(U, "กินแล้วแพ้กุ้งไหมคะ");
    expect(JSON.stringify(adminPushes()), "handoff ทันที ไม่ต้องรอ intake").toContain(FOOTER);
  });
});

/** ข้อความ push เข้ากลุ่มแอดมิน เป็น text ต่อ push (D-73 อ่านเนื้อหาข้อความ handoff ตรง ๆ) */
function adminTexts(): string[] {
  return adminPushes().map((p) => p.messages.map((m) => ("text" in m ? String((m as { text?: string }).text ?? "") : "")).join(" "));
}

// ═══════════ D-73 · เปิด intake กลับ — precedence + สรุปข้อมูล + rollback ═══════════

describe("D-73 · precedence P2: ธงสุขภาพโผล่กลาง intake → 🔔 สุขภาพยิง · ไม่ปิดบอท · intake นับต่อ", () => {
  it("เทิร์น 2 ของ intake มีคำสุขภาพ → health 🔔 (ไม่มี footer) + intake_turns=2 + บอทคุยต่อ", async () => {
    // 🔴 fixture เดิมใส่ "แพ้" ไว้ในคำ_handoff (ชุด v2) — เคสนี้จำลองชีต v3 จริง: คำ_handoff = เจตนาเรียกคน · คำสุขภาพอยู่ที่ธง
    harnessOverrides.config = { raw: cfg(), healthFlagKeywords: ["แพ้"], handoffKeywords: ["ขอแอดมิน", "คุยกับคน", "คุยกับแอดมิน"] };
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "รับทราบค่ะ ขอรูปเพิ่มนะคะ", stage: "H_CLAIM", handoff: false }),
    ]);
    await sendText(U, "ของเสียค่ะ");
    await sendText(U, "กินแล้วแพ้ด้วยค่ะ ผื่นขึ้น");
    const admin = JSON.stringify(adminPushes());
    expect(admin, "🔔 ธงสุขภาพยิง (พฤติกรรมเดิม D-61.C2)").toContain("🔔");
    expect(admin, "ไม่ปิดบอท (สุขภาพ ≠ handoff ใน v3)").not.toContain(FOOTER);
    const c = await readCustomer(U);
    expect(c?.human_mode, "บอทคุยต่อ").toBe(false);
    expect(c?.intake_turns, "intake นับต่อปกติ ไม่ถูกธงสุขภาพรบกวน").toBe(2);
  });
});

describe("D-73 · สรุปข้อมูลที่เก็บได้ → ข้อความแจ้งแอดมิน", () => {
  it("🔴 ชนเพดานแล้วลูกค้ายังไม่ให้ข้อมูลครบ → handoff พร้อม 📋 เท่าที่มี (รวมเทิร์นรูปเป็น placeholder)", async () => {
    harnessOverrides.config = { raw: cfg([["เพดานเทิร์นก่อนส่งแอดมิน", "3"]]) };
    scriptGemini([
      turn({ reply: "ขอรูปสินค้ากับกล่องหน่อยค่ะ", stage: "H_CLAIM", handoff: false }),
      // imageIntent "other" = โมเดลยังไม่ชี่ว่าเป็นรูปของเสีย → อยู่ intake ต่อ
      // (ถ้าชี่ "damage" = เส้น D-30 เดิม: handoff ทันทีพร้อมแนบรูป — แรงกว่า intake โดยดีไซน์ ดู DECISIONS D-73)
      turn({ reply: "ได้รับรูปแล้วค่ะ เกิดอะไรขึ้นคะ", stage: "H_CLAIM", handoff: false, imageIntent: "other" }),
      turn({ reply: "ส่งให้ทีมแอดมินตรวจสอบทันทีนะคะ", stage: "H_CLAIM", handoff: false }),
    ]);
    await sendText(U, "ถ้วยแตกมาเลยค่ะ ของเสีย");
    await sendImage(U); // เทิร์นรูป → history เก็บ "[ลูกค้าส่งรูปมา]"
    await sendText(U, "เปิดกล่องมาก็แตกแล้วค่ะ");
    const handoffMsg = adminTexts().find((t) => t.includes(FOOTER));
    expect(handoffMsg, "ชนเพดาน → handoff").toBeTruthy();
    expect(handoffMsg, "มีหัวสรุปข้อมูล").toContain("📋 ข้อมูลที่เก็บได้");
    expect(handoffMsg, "คำบอกเล่าลูกค้าอยู่ในสรุป").toContain("ลูกค้า: เปิดกล่องมาก็แตกแล้วค่ะ");
    expect(handoffMsg, "🔴 เทิร์นรูปโชว์เป็น placeholder — แอดมินรู้ว่ามีรูปรอในแชท").toContain("[ลูกค้าส่งรูปมา]");
  });

  it("handoff ปกติ (ไม่ใช่ intake) → ไม่มีหัว 📋 (ข้อความแอดมินเดิมไม่เปลี่ยน)", async () => {
    scriptGemini([turn({ reply: "...", stage: "H9", handoff: false })]);
    await sendText(U, "กินแล้วแพ้กุ้งไหมคะ");
    const handoffMsg = adminTexts().find((t) => t.includes(FOOTER));
    expect(handoffMsg).toBeTruthy();
    expect(handoffMsg).not.toContain("📋 ข้อมูลที่เก็บได้");
  });
});

describe("D-73 · P4: keyword กลาง intake → reset ตัวนับ (หลัก D-35)", () => {
  it("'ขอคุยกับแอดมิน' กลาง intake → handoff ทันที + intake_turns=0 (ไม่ค้างข้ามเคส)", async () => {
    scriptGemini([turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "ของเสียค่ะ");
    expect((await readCustomer(U))?.intake_turns).toBe(1);
    await sendText(U, "ขอคุยกับแอดมินเลยค่ะ");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.intake_turns, "🔴 keyword handoff ต้อง reset เหมือน intake handoff").toBe(0);
  });
});

describe("D-73 · rollback: แถว intake เป็น draft = พฤติกรรมเหมือนวันนี้ทุกอย่าง", () => {
  it("🔴 H_CLAIM status=draft → AI ตั้ง flag = handoff ทันทีเทิร์นแรก (ไม่เข้า intake) · ตัวนับ 0", async () => {
    // toggle แถวเป็น draft = ปุ่ม rollback ของเจ้าของ (ไม่ต้อง deploy)
    seedBotLib({
      stepRows: v3StepRows([
        { step_id: "S1", essence: "ทักทาย" },
        { step_id: "H_CLAIM", intake: true, name: "เคลม-คุยก่อน", entry: 'ของเสีย เช่น "ของเสีย"', essence: "ทวนปัญหา", status: "draft" },
      ]),
    });
    scriptGemini([turn({ reply: "ขอส่งต่อแอดมินนะคะ", stage: "H_CLAIM", handoff: true, handoffReason: "เคลม" })]);
    await sendText(U, "ของเสียค่ะ");
    expect(JSON.stringify(adminPushes()), "แถว draft = ไม่มีประตู intake → AI flag ส่งทันที (พฤติกรรมก่อน D-73)").toContain(FOOTER);
    const c = await readCustomer(U);
    expect(c?.human_mode).toBe(true);
    expect(c?.intake_turns, "ตัวนับไม่ขยับ (stage ไม่ใช่ intake เพราะแถวถูกกรองทิ้ง)").toBe(0);
  });
});

describe("D-73 · คำสั่ง 'ห้ามรับปาก' (คอลัมน์ D) เข้า prompt จริงทุกเทิร์น intake", () => {
  it("เทิร์น entry-match และเทิร์นถัดไป (stayStage) → stepText มีคำสั่งห้ามรับปากทั้งคู่", async () => {
    scriptGemini([
      turn({ reply: "ขอรูปค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "ขอบคุณค่ะ", stage: "H_CLAIM", handoff: false }),
    ]);
    await sendText(U, "ของเสียค่ะ"); // entry-match (crossover เต็มก้อน)
    expect(geminiState.lastInput?.stepText ?? "", "เทิร์น 1: เนื้อเต็มจาก entry-match").toContain("ห้ามรับปากผลลัพธ์");
    await sendText(U, "เมื่อวานเพิ่งได้ของค่ะ"); // ไม่มีคำ entry — ต้องอยู่ด้วย stayStage (D-34)
    expect(geminiState.lastInput?.stepText ?? "", "🔴 เทิร์น 2: stayStage คงประตูไว้เต็ม — คำสั่งยังอยู่").toContain("ห้ามรับปากผลลัพธ์");
  });
});

// ═══════════ D-73b · ป้ายคอลัมน์ handoff 3 ค่า (แทน funnel_stage) ═══════════

describe("D-73b · ค่าป้าย handoff พิมพ์ผิด → error ดัง + ตีเป็น handoff (ทิศปลอดภัย · ห้ามเงียบ)", () => {
  it("🔴 H=\"เก็บข้อมุลก่อน\" (พิมพ์ผิด) → console.error + ประตูกลายเป็น handoff (ไม่ใช่ประตูขายเงียบ ๆ)", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(String(a[0])); });
    seedBotLib({
      stepRows: v3StepRows([
        { step_id: "S1", essence: "ทักทาย" },
        { step_id: "HX", name: "เคลม", entry: 'ของเสีย เช่น "ของเสีย"', handoffValue: "เก็บข้อมุลก่อน" },
      ]),
    });
    scriptGemini([turn({ reply: "...", stage: "HX", handoff: false })]);
    await sendText(U, "ของเสียค่ะ");
    spy.mockRestore();
    expect(errors.some((e) => e.includes("handoff") && e.includes("เก็บข้อมุลก่อน")), "🔴 error ดัง ระบุค่าที่ผิด").toBe(true);
    // ทิศปลอดภัย: ตีเป็น handoff (ส่งคนเกิน) — ห้าม fallback เงียบเป็นประตูขาย (อันตรายกลับด้าน)
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });
});

describe("D-73b · ป้าย 3 ค่า — semantics ต่อค่า", () => {
  it('H="ใช่" → handoff ทันที · H="เก็บข้อมูลก่อน" → intake · ว่าง → FIXED_FUNNEL (unit บน normalizeBundle)', async () => {
    const { normalizeBundle } = await import("@/lib/sheets/normalize-bundle");
    const { funnelStageOf } = await import("@/lib/agent/inject");
    const steps = normalizeBundle({
      Steps: v3StepRows([
        { step_id: "S1", essence: "x" },
        { step_id: "HY", handoff: true },
        { step_id: "HZ", intake: true },
      ]),
    }).Steps;
    expect(funnelStageOf(steps, "S1"), "ว่าง = FIXED_FUNNEL เดิม").toBe("lead");
    expect(funnelStageOf(steps, "HY"), 'H="ใช่" = handoff (semantics เดิมเป๊ะ)').toBe("handoff");
    expect(funnelStageOf(steps, "HZ"), 'H="เก็บข้อมูลก่อน" = intake (D-73b)').toBe("handoff_after_intake");
  });

  it("validateBundle: ค่าป้ายพิมพ์ผิด → การ์ด schema ⚠️ (ok=false + ข้อความบอกค่าที่ถูก)", async () => {
    const { validateBundle } = await import("@/lib/sheets/normalize-bundle");
    const stats = validateBundle({ Steps: v3StepRows([{ step_id: "HX", handoffValue: "ส่งด่วน" }]) });
    const st = stats.find((t) => t.tab === "Steps")!;
    expect(st.ok, "พิมพ์ผิด = การ์ดต้องแดง").toBe(false);
    expect(st.missing.join(" ")).toContain("ส่งด่วน");
    expect(st.missing.join(" ")).toContain("เก็บข้อมูลก่อน");
  });
});

// ═══════════ D-73c · 🔔 แจ้งแอดมินตอน "เข้าประตู intake" (ไม่ปิดบอท) ═══════════

const ENTER_MARK = "ยังไม่ต้องเข้ามา";

describe("D-73c · แจ้งตอนเข้าประตู — ยิงครั้งเดียวต่อรอบ · ไม่ปิดบอท", () => {
  it("🔴 เทิร์นแรกที่เข้า intake → 🔔 1 ครั้ง (ระบุประตู+ชื่อ+ข้อความ) · ไม่มี footer · บอทคุยต่อ", async () => {
    scriptGemini([turn({ reply: "เสียใจด้วยค่ะ ขอรายละเอียดหน่อยนะคะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "ของเสียค่ะ ถ้วยแตกมา");
    const texts = adminTexts();
    const enter = texts.find((t) => t.includes(ENTER_MARK));
    expect(enter, "ต้องมีข้อความแจ้งตอนเข้าประตู").toBeTruthy();
    expect(enter, "ระบุชื่อประตู").toContain("เคลม-คุยก่อน");
    expect(enter, "ระบุข้อความลูกค้า").toContain("ถ้วยแตกมา");
    expect(enter, "บอกว่าจะแจ้งอีกครั้งพร้อม 📋").toContain("📋");
    expect(enter, "🔴 กฎเหล็ก: ห้ามมีคำว่า 'รบกวน'").not.toContain("รบกวน");
    expect(texts.join(" "), "ไม่ปิดบอท").not.toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(false);
  });

  it("🔴 เทิร์น 2-3 ของ intake รอบเดิม → ไม่ยิงซ้ำ (dedup มาจากตัวนับ 0→1)", async () => {
    harnessOverrides.config = { raw: cfg([["เพดานเทิร์นก่อนส่งแอดมิน", "9"]]) };
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "ขอรูปด้วยค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "รับทราบค่ะ", stage: "H_CLAIM", handoff: false }),
    ]);
    await sendText(U, "ของเสียค่ะ");
    await sendText(U, "เปิดกล่องมาก็แตกแล้ว");
    await sendText(U, "ซื้อเมื่อวานค่ะ");
    expect(adminTexts().filter((t) => t.includes(ENTER_MARK)), "ยิงครั้งเดียวตลอดรอบ").toHaveLength(1);
    expect((await readCustomer(U))?.intake_turns).toBe(3);
  });

  it("ออกจาก intake แล้วกลับเข้าใหม่ (เคสใหม่) → ยิงใหม่ได้", async () => {
    scriptGemini([
      turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false }),
      turn({ reply: "ได้เลยค่ะ รับ 3 ถ้วยนะคะ", stage: "S2", handoff: false, orderData: { items: [{ qty: 3 }] } }),
      turn({ reply: "เสียใจด้วยค่ะ", stage: "H_CLAIM", handoff: false }),
    ]);
    await sendText(U, "ของเสียค่ะ");
    await sendText(U, "เอาเป็นว่าขอสั่งเพิ่ม 3 ถ้วย"); // pivot ออก → ตัวนับ reset
    await sendText(U, "อีกกล่องก็ของเสียค่ะ"); // เข้าใหม่ = เคสใหม่
    expect(adminTexts().filter((t) => t.includes(ENTER_MARK)), "เข้าใหม่ = ยิงใหม่").toHaveLength(2);
  });

  it("🔴 เพดาน=1 (เข้าแล้ว handoff เทิร์นเดียวกัน) → ไม่ยิงข้อความ 'ยังไม่ต้องเข้ามา' ที่ขัดกับ 🔔 ส่งต่อ", async () => {
    harnessOverrides.config = { raw: cfg([["เพดานเทิร์นก่อนส่งแอดมิน", "1"]]) };
    scriptGemini([turn({ reply: "ส่งต่อค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "ของเสียค่ะ");
    const texts = adminTexts();
    expect(texts.some((t) => t.includes(FOOTER)), "handoff ปลายทางยิงตามเดิม").toBe(true);
    expect(texts.some((t) => t.includes(ENTER_MARK)), "ห้ามยิงข้อความเข้าประตูซ้อนในเทิร์นเดียวกัน").toBe(false);
  });

  it("🔴 rollback: แถว intake เป็น draft → ไม่มีการแจ้งอะไรเลย (ไม่ใช่แค่ไม่ handoff)", async () => {
    seedBotLib({
      stepRows: v3StepRows([
        { step_id: "S1", essence: "ทักทาย" },
        { step_id: "H_CLAIM", intake: true, name: "เคลม-คุยก่อน", entry: 'ของเสีย เช่น "ของเสีย"', essence: "ทวนปัญหา", status: "draft" },
      ]),
    });
    scriptGemini([turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "ของเสียค่ะ");
    expect(adminTexts().some((t) => t.includes(ENTER_MARK)), "แถว draft = ไม่มีประตู intake = ไม่แจ้ง").toBe(false);
    expect((await readCustomer(U))?.intake_turns).toBe(0);
  });

  // หมายเหตุ: "ตั้งข้อความจากชีตได้" พิสูจน์ที่ config-parse.test.ts (ที่นี่ fixture hardcode ค่า config ไว้)
  it("ข้อความที่ใช้จริง = ค่าจาก config (fixture) — ไม่ได้ hardcode ในโค้ด handler", async () => {
    scriptGemini([turn({ reply: "ขอรายละเอียดค่ะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "ของเสียค่ะ");
    expect(adminTexts().some((t) => t.includes(testConfig().notifyAdminIntakeTemplate)), "หยิบจาก config ไม่ใช่สตริงในโค้ด").toBe(true);
  });

  it("regression: ประตูขายปกติ / ประตู handoff ทันที → ไม่มีข้อความเข้าประตู intake", async () => {
    scriptGemini([
      turn({ reply: "สวัสดีค่ะ", stage: "S1", handoff: false }),
      turn({ reply: "...", stage: "H9", handoff: false }),
    ]);
    await sendText(U, "สวัสดีค่ะ");
    await sendText(U, "กินแล้วแพ้กุ้งไหมคะ");
    expect(adminTexts().some((t) => t.includes(ENTER_MARK))).toBe(false);
  });

  it("🔴 ธงสุขภาพ regression: เข้า intake + คำสุขภาพเทิร์นเดียวกัน → ได้ทั้ง 🔔 สุขภาพ และแจ้งเข้าประตู · ไม่ปิดบอท", async () => {
    harnessOverrides.config = {
      raw: cfg(), healthFlagKeywords: ["แพ้"],
      handoffKeywords: ["ขอแอดมิน", "คุยกับคน", "คุยกับแอดมิน"],
    };
    scriptGemini([turn({ reply: "เสียใจด้วยค่ะ ขอรายละเอียดนะคะ", stage: "H_CLAIM", handoff: false })]);
    await sendText(U, "ของเสียค่ะ แล้วกินแล้วแพ้ด้วย");
    const texts = adminTexts();
    expect(texts.some((t) => t.includes(ENTER_MARK)), "แจ้งเข้าประตู").toBe(true);
    expect(texts.some((t) => t.includes("สุขภาพ")), "🔔 ธงสุขภาพยังยิงเหมือนเดิม").toBe(true);
    expect(texts.join(" "), "ไม่ปิดบอท").not.toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(false);
  });
});
