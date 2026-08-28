import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, lineCalls, harnessOverrides } from "../harness/state";
import { seedBotLib, PRICING_CONFIG, v3StepRows } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { addDeliveredStep, resetCustomerMemory, ensureCustomer } from "@/lib/db";
import { dropUnresolvedVarBubbles, KNOWN_RUNTIME_VARS } from "@/lib/agent/quote";

/**
 * เดิมชื่อ verbatim.test.ts — D-68 ถอด v2 แล้ว "verbatim" ไม่มีอยู่ในระบบอีก
 * ไฟล์นี้เก็บเฉพาะ 3 การันตีที่ยังจริงใน v3 และ **ไม่มีไฟล์อื่นคุม**:
 *   1. var-guard  — ตัวแปรระบบที่ resolve ไม่ได้ ต้องไม่หลุดดิบถึงลูกค้า (ทิ้งทั้งบอลลูน)
 *   2. D-51 ทักทายรายวัน — เติม prefix บอลลูนข้อความแรก เทิร์นแรกของวัน (delivery ล้วน)
 *   3. D-46 degraded — Gemini ไม่ตอบ → ข้อความขัดข้อง ไม่ยัดเนื้อ step / ไม่เขียนออเดอร์
 * (ส่วนที่ลบ = โหมด "คิดเอง เปิด/ปิด" · objection/FAQ ชนะ step · pattern verbatim — เป็นกลไก v2 ล้วน)
 */
const U = "Uharnesstestcustomer0000000000021";

/** 🔴 D-68: seed "ชีตดิบ v3" ผ่านเส้นทางเดียวกับ prod (loader → adapter) */
function stepSheet(): string[][] {
  return v3StepRows([
    { step_id: "S1", funnel: "lead", essence: "ทักทาย" },
    { step_id: "S3", funnel: "quoted", essence: "สรุปยอด" },
    { step_id: "H1", handoff: true, name: "ส่งต่อ" },
  ]);
}
function cfg(extra: [string, string][] = []): Map<string, string> {
  // D-51: ปิดทักทายรายวันโดยดีฟอลต์ใน harness (เทสอื่นไม่โดน prefix) · extra ทับได้
  return new Map<string, string>([...Object.entries(PRICING_CONFIG), ["ทักทายรายวัน", ""], ...extra]);
}
function customerText(): string {
  return lineCalls.replies.flatMap((rr) => rr.messages).map((m) => (m.type === "text" ? m.text : "")).join(" ");
}

beforeEach(() => seedBotLib({ stepRows: stepSheet() }));

// ──────────────────────────── 1 · var-guard (pure) ────────────────────────────
describe("dropUnresolvedVarBubbles (pure) — ลูกค้าห้ามเห็น {ตัวแปร} ดิบ", () => {
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
  it("🔴 end-to-end: AI พ่นตัวแปรค้าง → บอลลูนนั้นไม่ถึงลูกค้า (v3 เรียบเรียงสด)", async () => {
    harnessOverrides.config = { raw: cfg() };
    scriptGemini([turn({ reply: "ยืนยันนะคะ[[เว้น]]ที่อยู่เดิม {ออเดอร์_ที่อยู่}", stage: "S3" })]);
    await sendText(U, "ขอยืนยัน");
    const t = customerText();
    expect(t).toContain("ยืนยันนะคะ");
    expect(t, "ตัวแปรค้างห้ามหลุดดิบ").not.toContain("{ออเดอร์_ที่อยู่}");
  });
});

// ──────────────────────────── 2 · D-51 ทักทายรายวัน ────────────────────────────
describe("D-51 ทักทายรายวัน — เติม prefix บอลลูนแรก เทิร์นแรกของวัน (delivery ล้วน)", () => {
  const firstText = (idx: number): string => {
    const rr = lineCalls.replies[idx];
    const m = rr?.messages.find((x) => x.type === "text");
    return m?.type === "text" ? m.text : "";
  };
  /** config raw ที่ "ไม่มี key ทักทายรายวัน" → พิสูจน์ค่าเริ่มในโค้ด (สวัสดีค่ะ ) */
  const noKeyRaw = (): Map<string, string> => new Map<string, string>(Object.entries(PRICING_CONFIG));
  const onRaw = (): Map<string, string> => cfg([["ทักทายรายวัน", "สวัสดีค่ะ "]]);

  it("🔴 ลูกค้าใหม่ + ไม่มี key ในชีต → ใช้ค่าเริ่ม 'สวัสดีค่ะ ' (กลืนบอลลูนเดิม ไม่เพิ่มบอลลูน)", async () => {
    harnessOverrides.config = { raw: noKeyRaw() };
    scriptGemini([turn({ reply: "ยินดีต้อนรับค่ะ", stage: "S1" })]);
    await sendText(U, "สวัสดีค่ะ");
    expect(firstText(0)).toBe("สวัสดีค่ะ ยินดีต้อนรับค่ะ");
    expect(lineCalls.replies[0].messages.length, "ไม่เพิ่มจำนวนบอลลูน").toBe(1);
  });

  it("🔴 เทิร์นสองของวันเดียวกัน → ไม่ทัก", async () => {
    harnessOverrides.config = { raw: onRaw() };
    scriptGemini([turn({ reply: "ยินดีต้อนรับค่ะ", stage: "S1" }), turn({ reply: "รับทราบค่ะ", stage: "S3" })]);
    await sendText(U, "สวัสดี");
    expect(firstText(0), "เทิร์นแรก = ทัก").toMatch(/^สวัสดีค่ะ /);
    await sendText(U, "รับทราบ");
    expect(firstText(1), "🔴 เทิร์นสอง (วันเดียวกัน มีประวัติ) = ไม่ทัก").toBe("รับทราบค่ะ");
  });

  it("🔴 หลัง /reset (ประวัติล้าง) → ลูกค้าใหม่ ทักอีกครั้ง", async () => {
    harnessOverrides.config = { raw: onRaw() };
    scriptGemini([
      turn({ reply: "ยินดีต้อนรับค่ะ", stage: "S1" }),
      turn({ reply: "รับทราบค่ะ", stage: "S3" }),
      turn({ reply: "ยินดีต้อนรับค่ะ", stage: "S1" }),
    ]);
    await sendText(U, "สวัสดี");
    await sendText(U, "รับทราบ");
    expect(firstText(1), "เทิร์นสองไม่ทัก").toBe("รับทราบค่ะ");
    await resetCustomerMemory(U);
    await sendText(U, "กลับมาแล้ว");
    expect(firstText(2), "หลัง reset = ทักใหม่").toMatch(/^สวัสดีค่ะ /);
  });

  it("H4/handoff → ไม่ทัก (ลูกค้าไม่พอใจ ทิศปลอดภัย)", async () => {
    harnessOverrides.config = { raw: onRaw() };
    scriptGemini([turn({ reply: "ขอส่งต่อแอดมินนะคะ", stage: "H1", handoff: true })]);
    await sendText(U, "จะฟ้อง");
    expect(firstText(0), "handoff = ไม่ทัก (ไม่มี prefix สวัสดีค่ะ )").not.toMatch(/^สวัสดีค่ะ /);
  });

  it("degraded (ระบบสะดุด) → ไม่ทัก", async () => {
    harnessOverrides.config = { raw: onRaw() };
    scriptGemini([turn({ reply: "AI", stage: "S1", degraded: true })]);
    await sendText(U, "สนใจ");
    expect(firstText(0), "degraded = ไม่ทัก").not.toMatch(/^สวัสดีค่ะ /);
    expect(customerText(), "D-69: ข้อความระบบช้า").toContain("ระบบตอบช้ากว่าปกติ");
  });

  it("config ค่าว่าง → ปิดฟีเจอร์ (ไม่มี prefix)", async () => {
    harnessOverrides.config = { raw: cfg([["ทักทายรายวัน", ""]]) };
    scriptGemini([turn({ reply: "ยินดีต้อนรับค่ะ", stage: "S1" })]);
    await sendText(U, "สวัสดี");
    expect(firstText(0), "ว่าง = ปิด").toBe("ยินดีต้อนรับค่ะ");
  });

  it("ค่ากำหนดเอง → ใช้ข้อความเจ้าของ", async () => {
    harnessOverrides.config = { raw: cfg([["ทักทายรายวัน", "หวัดดีจ้า "]]) };
    scriptGemini([turn({ reply: "ยินดีต้อนรับค่ะ", stage: "S1" })]);
    await sendText(U, "สวัสดี");
    expect(firstText(0)).toBe("หวัดดีจ้า ยินดีต้อนรับค่ะ");
  });
});

// ──────────────────────────── 3 · D-46 degraded ────────────────────────────
describe("D-46 degraded — Gemini ไม่ตอบ (blocked/timeout) → ข้อความขัดข้อง ไม่ยัดเนื้อ step", () => {
  // 🔴 D-69: ข้อความเปลี่ยน — เดิมบอกว่า "ยังไม่ได้รับข้อความ" (ไม่จริง) + สั่งให้พิมพ์ซ้ำ (วงจรบทยาว→ช้าลง)
  const DEGRADED = "ระบบตอบช้ากว่าปกติ";

  it("🔴 degraded + step เคยส่งแล้ว → ข้อความขัดข้อง (ไม่ resend เนื้อ step = รากบั๊กลูปขอที่อยู่)", async () => {
    harnessOverrides.config = { raw: cfg() };
    await ensureCustomer(U);
    await addDeliveredStep(U, "S3"); // เคยส่งเนื้อหา S3 แล้ว
    scriptGemini([turn({ reply: "AI", stage: "S3", degraded: true })]);
    await sendText(U, "เปลี่ยนเป็น COD ชื่อสมชาย ที่อยู่ 1 ถ.สุข กทม เบอร์ 0811111111");
    const t = customerText();
    expect(t, "ได้ข้อความขัดข้อง+ขอส่งใหม่").toContain(DEGRADED);
    expect(t, "🔴 ไม่เอา reply ของ AI มาส่ง").not.toContain("AI");
  });

  it("🔴 degraded + step ยังไม่เคยส่ง → ข้อความขัดข้อง · ธงไม่ตั้ง (เนื้อหาไม่ถึงลูกค้า)", async () => {
    harnessOverrides.config = { raw: cfg() };
    scriptGemini([turn({ reply: "AI", stage: "S3", degraded: true })]);
    await sendText(U, "สนใจค่ะ");
    expect(customerText()).toContain(DEGRADED);
    expect((await readCustomer(U))?.delivered_steps as string[] ?? [], "ธงไม่ตั้ง").not.toContain("S3");
  });

  it("degraded → order gate ไม่เขียน (orderData ว่างจาก fallback)", async () => {
    harnessOverrides.config = { raw: cfg() };
    scriptGemini([turn({ reply: "AI", stage: "S3", degraded: true, orderData: {} })]);
    await sendText(U, "ชื่อสมชาย 1 ถ.สุข กทม 0811111111");
    const c = await readCustomer(U);
    const pending = c?.pending_order as { ชื่อ?: string } | null;
    expect(pending?.ชื่อ, "degraded = ไม่ merge order (orderData ว่าง)").toBeUndefined();
  });
});
