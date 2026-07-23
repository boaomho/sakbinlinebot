import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, adminPushes, lineCalls, harnessOverrides, sheetsCalls } from "../harness/state";
import { seedBotLib, PRICING_CONFIG } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { parseThinkMode, stepVerbatim, buildObjectionInjection } from "@/lib/agent/inject";
import { addDeliveredStep, clearDeliveredStepsExceptCurrent, resetCustomerMemory, ensureCustomer, updateCustomerAfterTurn } from "@/lib/db";
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
    r("S1", "lead", { ตัวอย่างคำตอบ: "ตัวอย่างทักทายในชีต", หลักการนำพา: "ทักทาย" }), // คิดเอง ว่าง = ปิด (D-40 default → verbatim)
    r("S_OPEN", "quoted", { ตัวอย่างคำตอบ: "แพตเทิร์นในชีตที่ไม่ควรส่ง", คิดเอง: "เปิด" }),
    r("S_CLOSED", "quoted", { ตัวอย่างคำตอบ: "สนใจโปรไหนดีคะ โอนมาที่ {เลขที่บัญชี} ได้เลยค่ะ", คิดเอง: "ปิด" }),
    r("S_EMPTY", "quoted", { ตัวอย่างคำตอบ: "", คิดเอง: "ปิด" }),
    r("S_TYPO", "awaiting_address", { ตัวอย่างคำตอบ: "สวัสดีค่ะ[[เว้น]]ที่อยู่เดิมคือ {ออเดอร์_ที่อยู่}", คิดเอง: "ปิด" }),
    r("S_CAT", "quoted", { ตัวอย่างคำตอบ: "{ชื่อสินค้า} เก็บ{วิธีเก็บรักษา}ค่ะ[[แยก]]โปรตอนนี้:\n{โปรโมชั่นทั้งหมด}", คิดเอง: "ปิด" }),
    r("S_PEND", "awaiting_address", { ตัวอย่างคำตอบ: "ยืนยันนะคะ[[เว้น]]{ชื่อ}\n{ที่อยู่เต็ม}\n{เบอร์}", คิดเอง: "ปิด" }),
    r("S_DELIV", "won", { ตัวอย่างคำตอบ: "รับของ{วันจัดส่ง}ค่ะ · จ่าย{การชำระเงินใหม่}", คิดเอง: "ปิด" }),
    r("S_VAR", "quoted", { ตัวอย่างคำตอบ: "ส่วนผสม {สัดส่วนปลาทู} ค่ะ · {นโยบายค่าส่ง}", คิดเอง: "ปิด" }),
    r("S_INVITE", "qualified", { ตัวอย่างคำตอบ: "{ชวนเลือกโปร}", คิดเอง: "ปิด" }),
    r("S_BOTH", "quoted", { ตัวอย่างคำตอบ: "รับทราบค่ะ", ตัวอย่างประโยคปิดท้าย: "ขอบคุณนะคะ 🙏", คิดเอง: "ปิด" }),
    r("S_CLOSEONLY", "quoted", { ตัวอย่างคำตอบ: "", ตัวอย่างประโยคปิดท้าย: "แล้วเจอกันค่ะ", คิดเอง: "ปิด" }),
    r("S_MULTI", "quoted", { ตัวอย่างคำตอบ: "บรรทัดแรกค่ะ[[แยก]]บรรทัดสองค่ะ", ตัวอย่างประโยคปิดท้าย: "ปิดท้ายค่ะ", คิดเอง: "ปิด" }),
    r("H1", "handoff", { ตัวอย่างคำตอบ: "เดี๋ยวแอดมินมาช่วยดูแลนะคะ", คิดเอง: "ปิด", ห้ามทำ: "ห้ามตอบเอง" }),
    r("S_UNKNOWN", "handoff", { ชื่อประตู: "นอกตาราง", เข้าเมื่อ: "ไม่ match ประตู/objection/FAQ ไหนเลย", ตัวอย่างคำตอบ: "ขอโทษนะคะ เรื่องนี้ปลาทูขอให้แอดมินมาดูแลต่อค่ะ", ตัวอย่างประโยคปิดท้าย: "รอสักครู่นะคะ 🙏" }),
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
  it("🔴 D-40: ว่าง/ไม่รู้จัก = ปิด (verbatim default) · เฉพาะ 'เปิด/on/1' = เปิด", () => {
    expect(parseThinkMode("ปิด")).toBe("ปิด");
    expect(parseThinkMode("off")).toBe("ปิด");
    expect(parseThinkMode("ไม่")).toBe("ปิด");
    expect(parseThinkMode(""), "ว่าง = ปิด (D-40 flip)").toBe("ปิด");
    expect(parseThinkMode("อะไรก็ไม่รู้"), "ไม่รู้จัก = ปิด").toBe("ปิด");
    expect(parseThinkMode("เปิด")).toBe("เปิด");
    expect(parseThinkMode("on")).toBe("เปิด");
  });
  it("stepVerbatim: ปิด → {mode,pattern} · เปิด(override) · ไม่มี step → null", () => {
    const rows = stepSheet();
    expect(stepVerbatim(rows, "S_CLOSED")).toEqual({ mode: "ปิด", pattern: "สนใจโปรไหนดีคะ โอนมาที่ {เลขที่บัญชี} ได้เลยค่ะ" });
    expect(stepVerbatim(rows, "S_OPEN")?.mode, "คิดเอง=เปิด → override AI").toBe("เปิด");
    expect(stepVerbatim(rows, "S1")?.mode, "ว่าง = ปิด (D-40 default)").toBe("ปิด");
    expect(stepVerbatim(rows, "ไม่มีจริง")).toBeNull();
  });
  it("stepVerbatim รวม 2 ช่อง: ตัวอย่างคำตอบ [[แยก]] ปิดท้าย (D-39B2)", () => {
    const rows = stepSheet();
    expect(stepVerbatim(rows, "S_BOTH")?.pattern, "2 ช่อง → คั่น [[แยก]]").toBe("รับทราบค่ะ[[แยก]]ขอบคุณนะคะ 🙏");
    expect(stepVerbatim(rows, "S_CLOSEONLY")?.pattern, "คำตอบว่าง → แค่ปิดท้าย").toBe("แล้วเจอกันค่ะ");
    expect(stepVerbatim(rows, "S_CLOSED")?.pattern, "ปิดท้ายว่าง → แค่คำตอบ").toBe("สนใจโปรไหนดีคะ โอนมาที่ {เลขที่บัญชี} ได้เลยค่ะ");
  });
  it("🔴 D-40: ชีตไม่มีคอลัมน์ คิดเอง → default ปิด (verbatim ทั้งระบบ)", () => {
    const noThink = stepSheet().map((row) => row.slice(0, 12)); // ตัดคอลัมน์ คิดเอง ทิ้ง
    expect(stepVerbatim(noThink, "S_CLOSED")?.mode).toBe("ปิด");
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

  it("🔴 D-40: ว่าง (ไม่เซตคิดเอง) → default ปิด → verbatim ชีต (ไม่ใช่ AI)", async () => {
    scriptGemini([turn({ reply: "AI ทักทายเอง", stage: "S1" })]);
    await sendText(U, "หวัดดี");
    const t = customerText();
    expect(t, "blank=ปิด → ส่งชีต").toContain("ตัวอย่างทักทายในชีต");
    expect(t, "ไม่ใช่ reply ของ AI").not.toContain("AI ทักทายเอง");
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

  it("🔴 D-45c: {ชวนเลือกโปร} ใน step pattern → ประโยค 2 ตัวเลือก (เลขจาก calculatePrice · ไม่โดน guard)", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_INVITE" })]);
    await sendText(U, "สนใจค่ะ");
    const t = customerText();
    expect(t).toContain("รับ 1 ถ้วย รวมค่าส่ง 125 บาท หรือโปร 3 ถ้วย 275 บาท ส่งฟรี ดีคะ");
    expect(t).not.toContain("{ชวนเลือกโปร}");
  });

  it("🔴 D-43: CSV_Vars ({สัดส่วนปลาทู}) + {นโยบายค่าส่ง} ไหลผ่าน pipeline (ไม่โดน price-guard/var-guard)", async () => {
    harnessOverrides.config = { raw: cfg([["ค่าส่ง_มาตรฐาน", "30"], ["ยอดขั้นต่ำส่งฟรี_บาท", "275"]]) };
    scriptGemini([turn({ reply: "AI", stage: "S_VAR" })]);
    await sendText(U, "ส่วนผสมมีอะไร");
    const t = customerText();
    expect(t).toContain("เนื้อปลาทู 45%"); // CSV_Vars live
    expect(t).toContain("ค่าส่ง 30 บาทค่ะ สั่งครบ 275 บาท ส่งฟรีเลยค่ะ"); // {นโยบายค่าส่ง} ไม่โดนทิ้ง
    expect(t).not.toContain("{"); // ไม่เหลือตัวแปรดิบ
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

describe("FAQ verbatim (D-42) — precedence handoff > objection > FAQ > step", () => {
  const FAQ_H = ["faq_id", "หมวด", "คำถาม", "action", "คำตอบ (บอลลูน)", "keywords", "image_url", "status", "updated_at"];
  const seedFaq = (rows: string[][]) => { sheetsCalls.botLibReturn.CSV_FAQ = [FAQ_H, ...rows]; };

  it("🔴 FAQ answer + กลับบ้าน (D-45b: ครั้งแรก = เต็มก้อน step · เคยส่งแล้ว = ปิดท้าย)", async () => {
    seedFaq([["FAQ01", "ทั่วไป", "ส่วนประกอบ", "answer", "เนื้อปลาทูล้วนค่ะ", "ส่วนประกอบ,ส่วนผสม", "", "live", ""]]);
    scriptGemini([turn({ reply: "AI", stage: "S_BOTH" })]);
    await sendText(U, "ส่วนประกอบมีอะไรบ้าง");
    expect(textBubbles(), "ครั้งแรก = answer + เต็มก้อน S_BOTH").toEqual(["เนื้อปลาทูล้วนค่ะ", "รับทราบค่ะ", "ขอบคุณนะคะ 🙏"]);
  });

  it("step เคยส่งแล้ว + ปิดท้ายว่าง → ส่งแค่ FAQ answer (ไม่มีบอลลูนเปล่า/[[แยก]] ค้าง)", async () => {
    seedFaq([["FAQ01", "ทั่วไป", "ส่งกี่วัน", "answer", "1-2 วันค่ะ", "ส่งกี่วัน,จัดส่ง", "", "live", ""]]);
    await ensureCustomer(U);
    await addDeliveredStep(U, "S1"); // เคยส่งเนื้อหา S1 แล้ว · S1 ไม่มีปิดท้าย
    scriptGemini([turn({ reply: "AI", stage: "S1" })]);
    await sendText(U, "ของส่งกี่วัน");
    expect(textBubbles()).toEqual(["1-2 วันค่ะ"]);
  });

  it("🔴 handoff turn (stage funnel=handoff) → ไม่แทรก FAQ answer (ส่ง pattern ประตู handoff)", async () => {
    seedFaq([["FAQ01", "ทั่วไป", "ส่งกี่วัน", "answer", "1-2 วันค่ะ", "ส่งกี่วัน", "", "live", ""]]);
    scriptGemini([turn({ reply: "AI", stage: "H1", handoff: false })]); // funnel=handoff → isHandoffTurn
    await sendText(U, "ขอสอบถามส่งกี่วัน");
    const t = customerText();
    expect(t, "ส่ง pattern H1").toContain("เดี๋ยวแอดมินมาช่วยดูแลนะคะ");
    expect(t, "🔴 ไม่แทรก FAQ answer บนเทิร์น handoff").not.toContain("1-2 วันค่ะ");
  });

  it("FAQ action=handoff match → ไม่ส่งคำตอบ (ตกไป step pattern)", async () => {
    seedFaq([["FAQ01", "สุขภาพ", "แพ้อาหาร", "handoff", "ควรปรึกษาแพทย์", "ปรึกษา", "", "live", ""]]);
    scriptGemini([turn({ reply: "AI", stage: "S1" })]);
    await sendText(U, "ขอปรึกษาหน่อย");
    const t = customerText();
    expect(t, "ห้ามส่งคำตอบ FAQ handoff").not.toContain("ควรปรึกษาแพทย์");
    expect(t, "ตกไป step S1 pattern").toContain("ตัวอย่างทักทายในชีต");
  });
});

describe("D-45b ธงต่อ step — ส่งเนื้อหาครั้งเดียว · FAQ/OBJ กลับบ้าน · ล้างธงตอนออเดอร์ปิดจบ", () => {
  const FAQ_H2 = ["faq_id", "หมวด", "คำถาม", "action", "คำตอบ (บอลลูน)", "keywords", "image_url", "status", "updated_at"];

  it("🔴 step เดิม 2 เทิร์น: เทิร์นแรกเต็มก้อน+ตั้งธง · เทิร์นสองปิดท้ายอย่างเดียว (กันโชว์ซ้ำ)", async () => {
    scriptGemini([turn({ reply: "AI1", stage: "S_BOTH" }), turn({ reply: "AI2", stage: "S_BOTH" })]);
    await sendText(U, "สนใจค่ะ");
    const b1 = textBubbles();
    expect(b1, "เทิร์นแรก = เต็มก้อน").toEqual(["รับทราบค่ะ", "ขอบคุณนะคะ 🙏"]);
    expect(((await readCustomer(U))?.delivered_steps as string[]) ?? [], "ธงตั้งหลัง deliver").toContain("S_BOTH");
    await sendText(U, "โอเคค่ะ");
    expect(textBubbles().slice(b1.length), "เทิร์นสอง = ปิดท้ายอย่างเดียว").toEqual(["ขอบคุณนะคะ 🙏"]);
  });

  it("🔴 FAQ กลับบ้าน: ครั้งแรก answer+เต็มก้อน step (ตั้งธง) · ครั้งสอง answer+ปิดท้าย (ไม่มีเนื้อหาซ้ำ = G27 scripted)", async () => {
    sheetsCalls.botLibReturn.CSV_FAQ = [FAQ_H2, ["FAQ01", "ทั่วไป", "ส่งกี่วัน", "answer", "1-2 วันค่ะ", "ส่งกี่วัน", "", "live", ""]];
    scriptGemini([turn({ reply: "AI1", stage: "S_BOTH" }), turn({ reply: "AI2", stage: "S_BOTH" })]);
    await sendText(U, "ส่งกี่วันคะ");
    const b1 = textBubbles();
    expect(b1, "answer + เต็มก้อน S_BOTH").toEqual(["1-2 วันค่ะ", "รับทราบค่ะ", "ขอบคุณนะคะ 🙏"]);
    await sendText(U, "แล้วส่งกี่วันนะ");
    const b2 = textBubbles().slice(b1.length);
    expect(b2, "ครั้งสอง = answer + ปิดท้าย (ไม่ resend เนื้อหา)").toEqual(["1-2 วันค่ะ", "ขอบคุณนะคะ 🙏"]);
  });

  it("เคยส่งแล้ว + ปิดท้ายว่าง → fallback AI (safety net เดิม มี guard ครบ)", async () => {
    harnessOverrides.config = { raw: cfg([["เลขที่บัญชี", "1234567890"]]) };
    scriptGemini([turn({ reply: "AI1", stage: "S_CLOSED" }), turn({ reply: "AI ตอบต่อเอง", stage: "S_CLOSED" })]);
    await sendText(U, "สนใจค่ะ"); // S_CLOSED ไม่มีปิดท้าย → เต็มก้อน + ธง
    await sendText(U, "แล้วไงต่อ");
    expect(customerText(), "เทิร์นสอง ปิดท้ายว่าง → AI fallback").toContain("AI ตอบต่อเอง");
  });

  it("🔴 hook ออเดอร์ปิดจบ: clearDeliveredStepsExceptCurrent คงเฉพาะ step ปัจจุบัน · /reset ล้างหมด", async () => {
    await ensureCustomer(U);
    await addDeliveredStep(U, "S2");
    await addDeliveredStep(U, "S_BOTH");
    await updateCustomerAfterTurn(U, { stage: "S_BOTH", tagsAdd: [] });
    await clearDeliveredStepsExceptCurrent(U);
    expect(((await readCustomer(U))?.delivered_steps as string[]) ?? [], "คงเฉพาะ stage ปัจจุบัน").toEqual(["S_BOTH"]);
    await resetCustomerMemory(U);
    expect(((await readCustomer(U))?.delivered_steps as string[]) ?? [], "/reset ล้างหมด").toEqual([]);
  });
});

describe("D-46 degraded — Gemini ไม่ตอบ (blocked/timeout) → ข้อความขัดข้อง ไม่ resend step", () => {
  const DEGRADED = "ยังไม่ได้รับข้อความล่าสุด";

  it("🔴 degraded + step เคยส่งแล้ว → ข้อความขัดข้อง (ไม่ resend ปิดท้าย = รากบั๊กลูปขอที่อยู่)", async () => {
    await ensureCustomer(U);
    await addDeliveredStep(U, "S_BOTH"); // เคยส่งเนื้อหา S_BOTH แล้ว
    scriptGemini([turn({ reply: "AI", stage: "S_BOTH", degraded: true })]);
    await sendText(U, "เปลี่ยนเป็น COD ชื่อสมชาย ที่อยู่ 1 ถ.สุข กทม เบอร์ 0811111111");
    const t = customerText();
    expect(t, "ได้ข้อความขัดข้อง+ขอส่งใหม่").toContain(DEGRADED);
    expect(t, "🔴 ไม่ resend ปิดท้าย S_BOTH").not.toContain("ขอบคุณนะคะ");
  });

  it("🔴 degraded + step ยังไม่เคยส่ง → ข้อความขัดข้อง (ไม่ใช่เต็มก้อน step · กัน branch เสียบผิดจุด)", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_BOTH", degraded: true })]);
    await sendText(U, "สนใจค่ะ");
    const t = customerText();
    expect(t).toContain(DEGRADED);
    expect(t, "ไม่ส่งเต็มก้อน S_BOTH").not.toContain("รับทราบค่ะ");
    expect((await readCustomer(U))?.delivered_steps as string[] ?? [], "ธงไม่ตั้ง (เนื้อหาไม่ถึง)").not.toContain("S_BOTH");
  });

  it("degraded → order gate ไม่เขียน (orderData ว่างจาก fallback)", async () => {
    scriptGemini([turn({ reply: "AI", stage: "S_BOTH", degraded: true, orderData: {} })]);
    await sendText(U, "ชื่อสมชาย 1 ถ.สุข กทม 0811111111");
    const c = await readCustomer(U);
    const pending = c?.pending_order as { ชื่อ?: string } | null;
    expect(pending?.ชื่อ, "degraded = ไม่ merge order (orderData ว่าง)").toBeUndefined();
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

  it("🔴 D-44: S_UNKNOWN (funnel=handoff) — AI เลือกโดยไม่ตั้ง flag → pattern 2 บอลลูน + code การันตี handoff (D-33)", async () => {
    scriptGemini([turn({ reply: "AI ตอบเอง", stage: "S_UNKNOWN", handoff: false })]); // AI ลืม flag — โค้ดต้องการันตีจาก funnel
    await sendText(U, "ขายคอนโดด้วยมั้ยคะ"); // นอกตาราง · ไม่ชน keyword pre-check ("ท้องฟ้า" เคยชน "ท้อง" — substring)
    expect(textBubbles(), "pattern S_UNKNOWN + ปิดท้าย").toEqual(["ขอโทษนะคะ เรื่องนี้ปลาทูขอให้แอดมินมาดูแลต่อค่ะ", "รอสักครู่นะคะ 🙏"]);
    expect(JSON.stringify(adminPushes()), "การันตี handoff จาก funnel_stage").toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });
});
