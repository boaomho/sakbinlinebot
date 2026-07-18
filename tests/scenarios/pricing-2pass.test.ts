import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, geminiState, lineCalls, adminPushes, harnessOverrides } from "../harness/state";
import { orderCount, orderRowAt } from "../harness/sheet";
import { seedBotLib } from "../harness/botlib-fixture";

/**
 * D-15 2-pass orchestration (E2E ผ่าน webhook จริง · Gemini scripted)
 * - เทิร์นที่ items เปลี่ยน = 2-pass (กิน 2 script) · ไม่เปลี่ยน = 1-pass
 * - guard 1 (fail-safe) / 2 (เลขไม่ตรง) / 5 (เหลือ {...}) · quota-saver 2 โหมด
 */

const U = "Uharnesstestcustomer0000000000031";
const NPT = (qty: number) => ({ items: [{ sku: "NPT-10G", qty }] });

const replyTexts = () => lineCalls.replies.flatMap((s) => s.messages).map((m) => (m as { text?: string }).text ?? "").join(" | ");
const userPushTexts = () => lineCalls.pushes.flatMap((s) => s.messages).map((m) => (m as { text?: string }).text ?? "").join(" | ");
const FAILSAFE = "แอดมินยืนยัน"; // ตรงกับ FAILSAFE_REPLY จริงใน route ("ขอให้แอดมินยืนยันให้...")

beforeEach(() => seedBotLib());

describe("2-pass — item เปลี่ยน = pass2 · ไม่เปลี่ยน = pass เดียว", () => {
  it("pending มี items แล้ว + เทิร์นถัดไปไม่ส่ง items → ไม่เรียก pass2 + resolve {ยอดรวม} ที่ outgoing", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(3), needsPriceQuote: true }),
      turn({ reply: "น้ำพริกปลาทู 3 ถ้วย 275 บาท ส่งฟรีค่ะ", stage: "2" }),
      // เทิร์นจ่ายเงิน: reply ก็อป {ยอดรวม} จากสเต็ป → โค้ดต้อง resolve ที่ outgoing (pending มี items[3])
      turn({ reply: "ยอดรวม {ยอดรวม} บาทค่ะ โอนได้เลยนะคะ", stage: "3", paymentMethod: "โอน" }),
    ]);

    await sendText(U, "เอา 3 ถ้วยค่ะ");
    expect(geminiState.cursor, "เทิร์นสั่ง = 2-pass").toBe(2);

    await sendText(U, "โอนนะคะ");
    expect(geminiState.cursor, "เทิร์นจ่ายเงิน items ไม่เปลี่ยน = 1-pass (ไม่เรียก pass2)").toBe(3);
    expect(replyTexts(), "{ยอดรวม} ต้องถูก resolve เป็น 275").toContain("275");
    expect(replyTexts(), "ห้ามเหลือวงเล็บถึงลูกค้า").not.toContain("{ยอดรวม}");
  });

  it("items เปลี่ยน 3→6 → เรียก pass2 · ยอดอัปเดต (528)", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(3), needsPriceQuote: true }),
      turn({ reply: "3 ถ้วย 275 บาท ส่งฟรีค่ะ", stage: "2" }),
      turn({ reply: "ขอคิดยอดใหม่สักครู่นะคะ", stage: "2", orderData: NPT(6), needsPriceQuote: true }),
      turn({ reply: "6 ถ้วย 528 บาท ส่งฟรีค่ะ", stage: "2" }),
    ]);

    await sendText(U, "เอา 3 ถ้วย");
    await sendText(U, "ขอเพิ่มเป็น 6 ถ้วยดีกว่า");
    expect(geminiState.cursor, "2 เทิร์นสั่ง = 4 call").toBe(4);
    expect(userPushTexts() + replyTexts(), "ยอดใหม่ 528 ต้องถึงลูกค้า").toContain("528");
  });

  it("needs_price_quote=true แต่ items ว่าง → ไม่เรียก pass2 (กัน call เปล่า)", async () => {
    scriptGemini([turn({ reply: "ยินดีให้บริการค่ะ", stage: "1", needsPriceQuote: true, orderData: {} })]);
    await sendText(U, "ราคาเท่าไหร่คะ");
    expect(geminiState.cursor, "items ว่าง = ไม่ pass2").toBe(1);
  });
});

describe("2-pass — item ว่างจาก AI ต้องไม่ wipe pending (เจอมา 3 รอบ)", () => {
  it("pending มี 4 ถ้วย + เทิร์นถัดไป AI ไม่ส่ง items → pending คงอยู่ → ปิดออเดอร์ได้ (367)", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "3", paymentMethod: "COD", orderData: NPT(4), needsPriceQuote: true }),
      turn({ reply: "4 ถ้วย 367 บาท เก็บปลายทางนะคะ ขอชื่อ ที่อยู่ เบอร์ค่ะ", stage: "3", paymentMethod: "COD" }),
      // AI ลืมส่ง items (ตอบเฉย ๆ) — ต้องไม่ wipe
      turn({ reply: "ได้เลยค่ะ", stage: "3", paymentMethod: "COD", orderData: {} }),
      // ให้ที่อยู่ครบ → complete ด้วย items เดิม
      turn({ reply: "สรุปที่อยู่นะคะ", stage: "4b", paymentMethod: "COD", orderData: { ชื่อ: "สมชาย", ที่อยู่: "1 ถ.เจริญ กทม.", เบอร์: "0811111111" } }),
    ]);

    await sendText(U, "เอา 4 ถ้วย เก็บปลายทาง");
    await sendText(U, "โอเคค่ะ");
    expect(orderCount(), "ยังไม่มีที่อยู่").toBe(0);
    await sendText(U, "สมชาย 1 ถ.เจริญ กทม. 0811111111");

    expect(orderCount(), "items 4 ถ้วยต้องไม่หาย → ปิดได้").toBe(1);
    expect(orderRowAt(0)["ยอดเงิน"], "qty4 = 367").toBe("367");
    expect(orderRowAt(0)["สินค้า+จำนวน"]).toBe("น้ำพริกปลาทูฟรีซดราย x4");
  });
});

describe("2-pass — guard (fail-safe) ต้องไม่ปล่อยลูกค้าค้าง/เห็นเลขมั่ว", () => {
  it("sku ไม่รู้จัก (pricing error) → บอกลูกค้าสุภาพ + แจ้งแอดมิน + ไม่เขียนชีต", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: { items: [{ sku: "NPX-999", qty: 2 }] }, needsPriceQuote: true }),
    ]);
    await sendText(U, "เอาอันนี้ 2 อัน");

    expect(geminiState.cursor, "pricing error → ไม่เรียก pass2").toBe(1);
    expect(userPushTexts(), "ลูกค้าได้ข้อความสุภาพ ไม่ค้างเงียบ").toContain(FAILSAFE);
    expect(JSON.stringify(adminPushes()), "แจ้งแอดมิน").toContain("คิดยอดให้ลูกค้าไม่สำเร็จ");
    expect(orderCount()).toBe(0);
  });

  it("pass2 พูดเลขไม่ตรง Core (999) → บล็อก ไม่ถึงลูกค้า + fail-safe", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(3), needsPriceQuote: true }),
      turn({ reply: "รับ 3 ถ้วย 999 บาทค่ะ", stage: "2" }), // 999 ไม่ตรง Core (275)
    ]);
    await sendText(U, "เอา 3 ถ้วย");

    const all = replyTexts() + " " + userPushTexts();
    expect(all, "เลขมั่ว 999 ต้องไม่ถึงลูกค้า").not.toContain("999");
    expect(all, "แทนด้วย fail-safe").toContain(FAILSAFE);
    expect(JSON.stringify(adminPushes())).toContain("คิดยอดให้ลูกค้าไม่สำเร็จ");
  });

  it("guard 5: reply เหลือ {ยอดรวม} ที่ resolve ไม่ได้ (ไม่มี items) → ไม่ส่งวงเล็บ + fail-safe", async () => {
    scriptGemini([turn({ reply: "ยอด {ยอดรวม} บาทค่ะ", stage: "1" })]); // ไม่มี items เลย
    await sendText(U, "สวัสดีค่ะ");
    expect(replyTexts(), "ห้ามส่งวงเล็บดิบถึงลูกค้า").not.toContain("{ยอดรวม}");
    expect(replyTexts(), "แทนด้วย fail-safe").toContain(FAILSAFE);
  });
});

describe("items_source — แยก 'บอทเสนอ' ออกจาก 'ลูกค้ายืนยัน' (กัน pending เพี้ยน)", () => {
  const readItems = async () => {
    const { readCustomer } = await import("../harness/db");
    const c = await readCustomer(U);
    return ((c?.pending_order as { items?: { sku: string; qty: number }[] } | null)?.items ?? []).map((i) => i.qty);
  };

  it("บอทเสนอ 5 (bot_proposal) → pending ยังเป็น 4 · ไม่เรียก pass2", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(4), needsPriceQuote: true }),
      turn({ reply: "4 ถ้วย 367 บาทค่ะ", stage: "2" }),
      // บอทเสนอเพิ่มเป็น 5 เอง — items_source=bot_proposal
      turn({ reply: "หรือรับ 5 ถ้วย 440 บาท คุ้มกว่านะคะ", stage: "2", orderData: NPT(5), itemsSource: "bot_proposal" }),
    ]);
    await sendText(U, "เอา 4 ถ้วย");
    const cursorAfterOrder = geminiState.cursor;
    await sendText(U, "มีโปรอื่นมั้ย");
    expect(geminiState.cursor - cursorAfterOrder, "bot_proposal ไม่เรียก pass2").toBe(1);
    expect(await readItems(), "pending ต้องยังเป็น 4 (บอทเสนอไม่นับ)").toEqual([4]);
  });

  it("ลูกค้าตอบ 'เอา 5' (customer) → pending เป็น 5", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(4), needsPriceQuote: true }),
      turn({ reply: "4 ถ้วย 367 บาทค่ะ", stage: "2" }),
      turn({ reply: "หรือรับ 5 ถ้วย 440 ดีคะ", stage: "2", orderData: NPT(5), itemsSource: "bot_proposal" }),
      turn({ reply: "ขอคิดยอดใหม่นะคะ", stage: "2", orderData: NPT(5), needsPriceQuote: true }), // ลูกค้ายืนยัน 5
      turn({ reply: "5 ถ้วย 440 บาทค่ะ", stage: "2" }),
    ]);
    await sendText(U, "เอา 4 ถ้วย");
    await sendText(U, "เสนอมาหน่อย");
    await sendText(U, "เอา 5 เลย");
    expect(await readItems(), "ลูกค้ายืนยัน → pending 5").toEqual([5]);
  });

  it("ลูกค้าตอบ 'เอา 4 เหมือนเดิม' (customer) → pending ยัง 4 · ไม่ pass2 ซ้ำ", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(4), needsPriceQuote: true }),
      turn({ reply: "4 ถ้วย 367 บาทค่ะ", stage: "2" }),
      turn({ reply: "หรือรับ 5 ถ้วยดีคะ", stage: "2", orderData: NPT(5), itemsSource: "bot_proposal" }),
      turn({ reply: "ได้ค่ะ 4 ถ้วยเหมือนเดิมนะคะ", stage: "2", orderData: NPT(4), itemsSource: "customer" }),
    ]);
    await sendText(U, "เอา 4 ถ้วย");
    await sendText(U, "เสนอมาหน่อย");
    const before = geminiState.cursor;
    await sendText(U, "เอา 4 เหมือนเดิม");
    expect(geminiState.cursor - before, "4=4 ไม่เปลี่ยน → ไม่ pass2").toBe(1);
    expect(await readItems(), "pending ยัง 4").toEqual([4]);
  });

  it("บอทเสนอ 5 แล้วลูกค้าเงียบข้ามเทิร์นกลับมา → pending ยัง 4 (proposed ไม่ทำ pending เพี้ยน)", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(4), needsPriceQuote: true }),
      turn({ reply: "4 ถ้วย 367 บาทค่ะ", stage: "2" }),
      turn({ reply: "หรือรับ 5 ถ้วยดีคะ", stage: "2", orderData: NPT(5), itemsSource: "bot_proposal" }),
      turn({ reply: "ส่งภายใน 1-2 วันค่ะ", stage: "2", orderData: {} }), // คำถามอื่น ไม่มี items
    ]);
    await sendText(U, "เอา 4 ถ้วย");
    await sendText(U, "เสนอมาหน่อย");
    await sendText(U, "ส่งกี่วัน");
    expect(await readItems(), "pending ยัง 4").toEqual([4]);
  });
});

describe("2-pass — โหมดประหยัดโควตา (รองรับทั้ง 2 ทาง)", () => {
  it("quotaSaver OFF (default) → bubble1 reply + bubble2 push (2 บับเบิล)", async () => {
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(3), needsPriceQuote: true }),
      turn({ reply: "3 ถ้วย 275 บาท ส่งฟรีค่ะ", stage: "2" }),
    ]);
    await sendText(U, "เอา 3 ถ้วย");
    expect(replyTexts(), "bubble1 (คิดยอด) ไป reply").toContain("คิดยอด");
    expect(userPushTexts(), "bubble2 (ยอด) ไป push").toContain("275");
  });

  it("quotaSaver ON → ยุบเป็น reply เดียว (บับเบิลยอด · ไม่มี user-push)", async () => {
    harnessOverrides.config = { quotaSaver: true };
    scriptGemini([
      turn({ reply: "ขอคิดยอดสักครู่นะคะ", stage: "2", orderData: NPT(3), needsPriceQuote: true }),
      turn({ reply: "3 ถ้วย 275 บาท ส่งฟรีค่ะ", stage: "2" }),
    ]);
    await sendText(U, "เอา 3 ถ้วย");
    expect(replyTexts(), "ยอดอยู่ใน reply เดียว").toContain("275");
    expect(lineCalls.pushes.length, "ไม่มี push แยก (ยุบทีเดียว)").toBe(0);
  });
});
