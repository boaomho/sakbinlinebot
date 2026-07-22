import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, adminPushes, lineCalls, harnessOverrides, sheetsCalls } from "../harness/state";
import { seedBotLib, PRICING_CONFIG } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { parseThinkMode, stepVerbatim, buildObjectionInjection } from "@/lib/agent/inject";
import { dropUnresolvedVarBubbles, KNOWN_RUNTIME_VARS } from "@/lib/agent/quote";

/**
 * Phase2 #1 · ชั้น③ "คิดเอง" (เปิด/ปิด) + verbatim path
 *  - ปิด → ส่ง "ตัวอย่างคำตอบ" ชีตเป๊ะ + แทนตัวแปร (ไม่ใช่ reply ที่ AI แต่ง)
 *  - เปิด/ว่าง → AI เรียบเรียง (เดิม) · ปิด+ตัวอย่างว่าง → fallback AI
 *  - objection ปิด(มี pattern) ชนะ step · เปิด/ไม่มี pattern → ไม่บังคับชนะ
 *  - var-guard (ทั้งเปิด/ปิด): ตัวแปร "ที่รู้จัก" ค้าง → ไม่ส่งบอลลูนนั้น (ลูกค้าไม่เห็น {...} ดิบ)
 *  - gate/handoff ยังทำงานในโหมดปิด (คุมแค่ข้อความ ไม่แตะ logic)
 */
const U = "Uharnesstestcustomer0000000000021";
const FOOTER = "บอทปิดการทำงานกับลูกค้ารายนี้แล้ว";

const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ความรู้สึกลูกค้าตอนนี้", "ทำไมประตูนี้สำคัญ", "หลักการนำพา", "ห้ามทำ", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "คิดเอง"];
function r(step_id: string, funnel_stage: string, o: Partial<Record<string, string>> = {}): string[] {
  return STEP_H.map((h) => (h === "step_id" ? step_id : h === "funnel_stage" ? funnel_stage : o[h] ?? ""));
}
function stepSheet(): string[][] {
  return [
    STEP_H,
    r("S1", "lead", { ตัวอย่างคำตอบ: "ตัวอย่างทักทายในชีต", หลักการนำพา: "ทักทาย" }), // คิดเอง ว่าง = เปิด (default)
    r("S_OPEN", "quoted", { ตัวอย่างคำตอบ: "แพตเทิร์นในชีตที่ไม่ควรส่ง", คิดเอง: "เปิด" }),
    r("S_CLOSED", "quoted", { ตัวอย่างคำตอบ: "สนใจโปรไหนดีคะ โอนมาที่ {เลขที่บัญชี} ได้เลยค่ะ", คิดเอง: "ปิด" }),
    r("S_EMPTY", "quoted", { ตัวอย่างคำตอบ: "", คิดเอง: "ปิด" }),
    r("S_TYPO", "awaiting_address", { ตัวอย่างคำตอบ: "สวัสดีค่ะ[[เว้น]]ที่อยู่เดิมคือ {ออเดอร์_ที่อยู่}", คิดเอง: "ปิด" }),
    r("S_CAT", "quoted", { ตัวอย่างคำตอบ: "{ชื่อสินค้า} เก็บ{วิธีเก็บรักษา}ค่ะ[[แยก]]โปรตอนนี้:\n{โปรโมชั่นทั้งหมด}", คิดเอง: "ปิด" }),
    r("S_PEND", "awaiting_address", { ตัวอย่างคำตอบ: "ยืนยันนะคะ[[เว้น]]{ชื่อ}\n{ที่อยู่เต็ม}\n{เบอร์}", คิดเอง: "ปิด" }),
    r("S_DELIV", "won", { ตัวอย่างคำตอบ: "รับของ{วันจัดส่ง}ค่ะ · จ่าย{การชำระเงินใหม่}", คิดเอง: "ปิด" }),
    r("S_BOTH", "quoted", { ตัวอย่างคำตอบ: "รับทราบค่ะ", ตัวอย่างประโยคปิดท้าย: "ขอบคุณนะคะ 🙏", คิดเอง: "ปิด" }),
    r("S_CLOSEONLY", "quoted", { ตัวอย่างคำตอบ: "", ตัวอย่างประโยคปิดท้าย: "แล้วเจอกันค่ะ", คิดเอง: "ปิด" }),
    r("S_MULTI", "quoted", { ตัวอย่างคำตอบ: "บรรทัดแรกค่ะ[[แยก]]บรรทัดสองค่ะ", ตัวอย่างประโยคปิดท้าย: "ปิดท้ายค่ะ", คิดเอง: "ปิด" }),
    r("H1", "handoff", { ตัวอย่างคำตอบ: "เดี๋ยวแอดมินมาช่วยดูแลนะคะ", คิดเอง: "ปิด", ห้ามทำ: "ห้ามตอบเอง" }),
  ];
}
function textBubbles(): string[] {
  return lineCalls.replies.flatMap((rr) => rr.messages).map((m) => (m.type === "text" ? m.text : "[IMG]"));
}
const OBJ_H = ["objection_id", "ลูกค้าพูดแบบไหนบ้าง", "ความกังวลที่แท้จริง", "หลักการตอบ", "คิดเอง", "ตัวอย่างคำตอบ"];
function cfg(extra: [string, string][] = []): Map<string, string> {
  return new Map<string, string>([...Object.entries(PRICING_CONFIG), ...extra]);
}
function customerText(): string {
  return lineCalls.replies.flatMap((rr) => rr.messages).map((m) => (m.type === "text" ? m.text : "")).join(" ");
}

beforeEach(() => seedBotLib({ stepRows: stepSheet() }));

// ──────────────────────────── pure units ────────────────────────────
describe("parseThinkMode + stepVerbatim (pure)", () => {
  it("parseThinkMode: ปิด/off/ไม่ = ปิด · ว่าง/เปิด/อื่น = เปิด (default)", () => {
    expect(parseThinkMode("ปิด")).toBe("ปิด");
    expect(parseThinkMode("off")).toBe("ปิด");
    expect(parseThinkMode("ไม่")).toBe("ปิด");
    expect(parseThinkMode("")).toBe("เปิด");
    expect(parseThinkMode("เปิด")).toBe("เปิด");
    expect(parseThinkMode("อะไรก็ไม่รู้")).toBe("เปิด");
  });
  it("stepVerbatim: ปิด → {mode,pattern} · เปิด · ไม่มี step → null", () => {
    const rows = stepSheet();
    expect(stepVerbatim(rows, "S_CLOSED")).toEqual({ mode: "ปิด", pattern: "สนใจโปรไหนดีคะ โอนมาที่ {เลขที่บัญชี} ได้เลยค่ะ" });
    expect(stepVerbatim(rows, "S_OPEN")?.mode).toBe("เปิด");
    expect(stepVerbatim(rows, "S1")?.mode, "ว่าง = เปิด (default)").toBe("เปิด");
    expect(stepVerbatim(rows, "ไม่มีจริง")).toBeNull();
  });
  it("stepVerbatim รวม 2 ช่อง: ตัวอย่างคำตอบ [[แยก]] ปิดท้าย (D-39B2)", () => {
    const rows = stepSheet();
    expect(stepVerbatim(rows, "S_BOTH")?.pattern, "2 ช่อง → คั่น [[แยก]]").toBe("รับทราบค่ะ[[แยก]]ขอบคุณนะคะ 🙏");
    expect(stepVerbatim(rows, "S_CLOSEONLY")?.pattern, "คำตอบว่าง → แค่ปิดท้าย").toBe("แล้วเจอกันค่ะ");
    expect(stepVerbatim(rows, "S_CLOSED")?.pattern, "ปิดท้ายว่าง → แค่คำตอบ").toBe("สนใจโปรไหนดีคะ โอนมาที่ {เลขที่บัญชี} ได้เลยค่ะ");
  });
  it("ชีตเดิมไม่มีคอลัมน์ คิดเอง → default เปิด (ไม่ regression)", () => {
    const noThink = stepSheet().map((row) => row.slice(0, 12)); // ตัดคอลัมน์ คิดเอง ทิ้ง
    expect(stepVerbatim(noThink, "S_CLOSED")?.mode).toBe("เปิด");
  });
});

describe("dropUnresolvedVarBubbles (pure)", () => {
  it("บอลลูนที่มีตัวแปรรู้จักค้าง → ทิ้ง · บอลลูนสะอาด → คง", () => {
    const res = dropUnresolvedVarBubbles("สวัสดีค่ะ[[เว้น]]ที่อยู่ {ออเดอร์_ที่อยู่}");
    expect(res.clean).toBe("สวัสดีค่ะ");
    expect(res.dropped).toContain("{ออเดอร์_ที่อยู่}");
  });
  it("ทุกบอลลูนมีตัวแปรค้าง → clean ว่าง", () => {
    expect(dropUnresolvedVarBubbles("ยอด {ยอดรวม}[[แยก]]โอน {เลขที่บัญชี}").clean).toBe("");
  });
  it("🔴 กันเฉพาะตัวแปรที่รู้จัก ไม่ใช่ { ทุกตัว (token ที่ไม่มี resolver ไม่โดน)", () => {
    const res = dropUnresolvedVarBubbles("ราคาดีมาก {น่าสนใจ} 😊 {อะไรสักอย่าง}");
    expect(res.dropped).toEqual([]);
    expect(res.clean).toBe("ราคาดีมาก {น่าสนใจ} 😊 {อะไรสักอย่าง}");
  });
  it("KNOWN_RUNTIME_VARS ครอบ pricing + transfer + order", () => {
    expect(KNOWN_RUNTIME_VARS).toContain("{ยอดรวม}");
    expect(KNOWN_RUNTIME_VARS).toContain("{เลขที่บัญชี}");
    expect(KNOWN_RUNTIME_VARS).toContain("{ออเดอร์_ที่อยู่}");
  });
});

describe("buildObjectionInjection.verbatim (pure)", () => {
  it("match + ปิด + มี pattern → verbatim set", () => {
    const rows = [OBJ_H, ["OBJ1", "แพง", "กลัวไม่คุ้ม", "เน้นคุณค่า", "ปิด", "ของเราคุ้มมากค่ะ"]];
    expect(buildObjectionInjection(rows, "แพงจัง", 2).verbatim).toEqual({ id: "OBJ1", pattern: "ของเราคุ้มมากค่ะ" });
  });
  it("match + เปิด → null (ไม่บังคับชนะ)", () => {
    const rows = [OBJ_H, ["OBJ1", "แพง", "กลัวไม่คุ้ม", "เน้นคุณค่า", "เปิด", "ของเราคุ้มมากค่ะ"]];
    expect(buildObjectionInjection(rows, "แพงจัง", 2).verbatim).toBeNull();
  });
  it("match + ปิด + ไม่มี pattern → null (ปิดชนะเฉพาะเมื่อมี pattern)", () => {
    const rows = [OBJ_H, ["OBJ1", "แพง", "กลัวไม่คุ้ม", "เน้นคุณค่า", "ปิด", ""]];
    expect(buildObjectionInjection(rows, "แพงจัง", 2).verbatim).toBeNull();
  });
  it("ไม่ match → null", () => {
    const rows = [OBJ_H, ["OBJ1", "แพง", "กลัวไม่คุ้ม", "เน้นคุณค่า", "ปิด", "ของเราคุ้มมากค่ะ"]];
    expect(buildObjectionInjection(rows, "ส่งกี่วัน", 2).verbatim).toBeNull();
  });
});

// ──────────────────────────── pipeline (route) ────────────────────────────
describe("verbatim path — โหมดปิด/เปิด ใน pipeline จริง", () => {
  it("🔴 ปิด → ส่งชีตเป๊ะ + แทนตัวแปร ({เลขที่บัญชี}) ไม่ใช่ reply ที่ AI แต่ง", async () => {
    harnessOverrides.config = { raw: cfg([["เลขที่บัญชี", "1234567890"]]) };
    scriptGemini([turn({ reply: "ข้อความที่ AI แต่งเอง", stage: "S_CLOSED" })]);
    await sendText(U, "สนใจค่ะ");
    const t = customerText();
    expect(t, "แทนตัวแปรแล้ว").toContain("โอนมาที่ 1234567890");
    expect(t, "ไม่ใช่ reply ของ AI").not.toContain("ข้อความที่ AI แต่งเอง");
    expect(t, "ไม่เหลือตัวแปรดิบ").not.toContain("{เลขที่บัญชี}");
  });

  it("เปิด → ส่ง reply ที่ AI แต่ง (ไม่ใช่ตัวอย่างในชีต)", async () => {
    scriptGemini([turn({ reply: "สวัสดีค่ะ รับอะไรดีคะ", stage: "S_OPEN" })]);
    await sendText(U, "สวัสดี");
    const t = customerText();
    expect(t).toContain("สวัสดีค่ะ รับอะไรดีคะ");
    expect(t).not.toContain("แพตเทิร์นในชีตที่ไม่ควรส่ง");
  });

  it("ว่าง (ไม่เซตคิดเอง) → default เปิด → AI reply", async () => {
    scriptGemini([turn({ reply: "AI ทักทายเอง", stage: "S1" })]);
    await sendText(U, "หวัดดี");
    const t = customerText();
    expect(t).toContain("AI ทักทายเอง");
    expect(t).not.toContain("ตัวอย่างทักทายในชีต");
  });

  it("ปิด + ตัวอย่างว่าง → fallback AI (ไม่ส่งข้อความว่าง)", async () => {
    scriptGemini([turn({ reply: "AI ตอบแทนตอนชีตว่าง", stage: "S_EMPTY" })]);
    await sendText(U, "ถามหน่อย");
    expect(customerText()).toContain("AI ตอบแทนตอนชีตว่าง");
  });

  it("🔴 ปิด + ตัวแปรค้าง (ไม่มี last_order) → บอลลูนนั้นไม่ส่ง ลูกค้าไม่เห็น {ออเดอร์_ที่อยู่}", async () => {
    scriptGemini([turn({ reply: "AI reply", stage: "S_TYPO" })]);
    await sendText(U, "ทักหน่อย");
    const t = customerText();
    expect(t, "บอลลูนสะอาดยังส่ง").toContain("สวัสดีค่ะ");
    expect(t, "บอลลูนตัวแปรค้าง ไม่ส่งดิบ").not.toContain("{ออเดอร์_ที่อยู่}");
  });
});

describe("objection verbatim — precedence over step", () => {
  it("🔴 objection ปิด(มี pattern) ชนะ step เปิด", async () => {
    sheetsCalls.botLibReturn.CSV_Objections = [OBJ_H, ["OBJ1", "แพง", "กลัวไม่คุ้ม", "เน้นคุณค่า", "ปิด", "เข้าใจค่ะ ของเราคุ้มมากนะคะ"]];
    scriptGemini([turn({ reply: "AI ตอบเรื่องแพงเอง", stage: "S_OPEN" })]);
    await sendText(U, "แพงจัง");
    const t = customerText();
    expect(t).toContain("ของเราคุ้มมากนะคะ");
    expect(t).not.toContain("AI ตอบเรื่องแพงเอง");
  });

  it("objection เปิด → ไม่บังคับชนะ (AI ตัดสินเดิม)", async () => {
    sheetsCalls.botLibReturn.CSV_Objections = [OBJ_H, ["OBJ1", "แพง", "กลัวไม่คุ้ม", "เน้นคุณค่า", "เปิด", "แพตเทิร์นที่ไม่ควรส่ง"]];
    scriptGemini([turn({ reply: "AI ตอบเรื่องแพงเอง", stage: "S_OPEN" })]);
    await sendText(U, "แพงจัง");
    const t = customerText();
    expect(t).toContain("AI ตอบเรื่องแพงเอง");
    expect(t).not.toContain("แพตเทิร์นที่ไม่ควรส่ง");
  });
});

describe("verbatim Group X — catalog/pending/delivery resolve ครบ (D-39)", () => {
  it("🔴 ปิด + catalog: {ชื่อสินค้า}/{วิธีเก็บรักษา}/{โปรโมชั่นทั้งหมด} → ค่าจริง + [[แยก]] แยกบอลลูน", async () => {
    scriptGemini([turn({ reply: "AI พูดเอง", stage: "S_CAT" })]);
    await sendText(U, "ขอข้อมูลหน่อย");
    const bubbles = textBubbles();
    expect(bubbles.length, "[[แยก]] แยกเป็น 2 บอลลูน").toBe(2);
    expect(bubbles[0]).toContain("น้ำพริกปลาทูฟรีซดราย");
    expect(bubbles[0]).toContain("อุณหภูมิห้อง");
    expect(bubbles[1], "โปรทั้งหมด \\n คั่น").toContain("1 ถ้วย 95 บาท");
    expect(bubbles[1]).toContain("10 ถ้วย");
    expect(customerText()).not.toContain("{"); // ไม่เหลือตัวแปรดิบ
  });

  it("ปิด + pending: {ชื่อ}/{ที่อยู่เต็ม}/{เบอร์} = ออเดอร์ที่กำลังคุย (เก็บจากเทิร์นก่อน)", async () => {
    scriptGemini([
      turn({ reply: "รับข้อมูลแล้วค่ะ", stage: "S_OPEN", orderData: { ชื่อ: "สมหญิง", ที่อยู่: "9 ถ.รักดี กทม 10230", เบอร์: "0899999999" } }),
      turn({ reply: "AI", stage: "S_PEND" }),
    ]);
    await sendText(U, "ชื่อสมหญิง 9 ถ.รักดี กทม 10230 เบอร์ 0899999999");
    await sendText(U, "ถูกแล้วค่ะ");
    const t = customerText();
    expect(t).toContain("สมหญิง");
    expect(t).toContain("9 ถ.รักดี กทม 10230");
    expect(t).toContain("0899999999");
    expect(t).not.toContain("{ชื่อ}");
  });

  it("ปิด + delivery: {วันจัดส่ง} จากเวลาตัดรอบ + {การชำระเงินใหม่}", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_DELIV", paymentMethod: "โอน" })]);
    harnessOverrides.config = { raw: cfg([["เวลาตัดรอบออเดอร์", "23:59"]]) };
    await sendText(U, "โอนแล้วค่ะ");
    const t = customerText();
    expect(t).toContain("รับของวันนี้ค่ะ"); // 23:59 → ก่อนตัดรอบเสมอ
    expect(t).toContain("โอนเงิน");
  });

  it("🔴 resolver ไม่ครบ (pending ไม่มีข้อมูล) → ไม่ส่ง {...} ดิบ", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_PEND" })]); // ลูกค้าใหม่ pending ว่าง
    await sendText(U, "ทัก");
    const t = customerText();
    expect(t, "ไม่มีตัวแปรดิบหลุด").not.toContain("{");
    expect(t, "บอลลูน 'ยืนยันนะคะ' ยังส่ง").toContain("ยืนยันนะคะ");
  });
});

describe("verbatim รวม 2 ช่อง — คำตอบ + ปิดท้าย (D-39B2 · ปิดท้าย=บอลลูนสุดท้าย)", () => {
  it("🔴 2 ช่องมีทั้งคู่ → 2 บอลลูน (คั่น [[แยก]] อัตโนมัติ · ปิดท้ายสุดท้าย)", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_BOTH" })]);
    await sendText(U, "โอเคค่ะ");
    const b = textBubbles();
    expect(b).toEqual(["รับทราบค่ะ", "ขอบคุณนะคะ 🙏"]);
  });
  it("ปิดท้ายว่าง → แค่คำตอบ (ไม่มีบอลลูนเปล่า)", async () => {
    harnessOverrides.config = { raw: cfg([["เลขที่บัญชี", "1234567890"]]) };
    scriptGemini([turn({ reply: "AI", stage: "S_CLOSED" })]);
    await sendText(U, "สนใจค่ะ");
    expect(textBubbles().length).toBe(1);
  });
  it("คำตอบว่าง + ปิดท้ายมี → แค่ปิดท้าย", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_CLOSEONLY" })]);
    await sendText(U, "บาย");
    expect(textBubbles()).toEqual(["แล้วเจอกันค่ะ"]);
  });
  it("คำตอบมี [[แยก]] เอง + ปิดท้าย → ปิดท้ายเป็นบอลลูนสุดท้าย (3 บอลลูน)", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_MULTI" })]);
    await sendText(U, "ขอข้อมูล");
    expect(textBubbles()).toEqual(["บรรทัดแรกค่ะ", "บรรทัดสองค่ะ", "ปิดท้ายค่ะ"]);
  });
});

describe("โหมดปิด — gate/handoff ยังทำงาน (คุมแค่ข้อความ)", () => {
  it("ปิด + orderData มี items → order logic ยังเก็บ pending (ไม่ถูกทิ้งพร้อม reply)", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_CLOSED", orderData: { items: [{ qty: 3 }] } })]);
    await sendText(U, "สั่ง 3 ถ้วย");
    const c = await readCustomer(U);
    const pending = c?.pending_order as { items?: unknown[] } | null;
    expect(pending?.items?.length ?? 0, "order_data จาก AI ยังไหลเข้า pending ในโหมดปิด").toBeGreaterThan(0);
  });

  it("🔴 ปิด + stage handoff → ส่ง pattern verbatim + ยัง handoff (footer แอดมิน)", async () => {
    scriptGemini([turn({ reply: "AI handoff reply", stage: "H1", handoff: true })]);
    await sendText(U, "ขอสอบถามหน่อยค่ะ");
    expect(customerText(), "ลูกค้าได้ pattern เป๊ะ").toContain("เดี๋ยวแอดมินมาช่วยดูแลนะคะ");
    expect(JSON.stringify(adminPushes()), "handoff ยังทำงาน").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });
});
