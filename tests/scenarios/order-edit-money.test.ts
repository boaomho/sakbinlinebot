import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, sheetsCalls, adminPushes, lineCalls } from "../harness/state";
import { appendedRows, activeOrdersHeader, columnOf } from "../harness/sheet";
import { FULL_ADDRESS } from "../harness/fixtures";
import { seedBotLib } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { updateOrderRow, cancelOrderRow } from "@/lib/orders";
import { hasCancelEvidence } from "@/lib/core/orders";

/**
 * D-77 · ขยายการแก้ออเดอร์ — จำนวน/รายการ/ยกเลิก บน COD ก่อนส่ง
 * 🔴 money guard อ่านจาก "แถวชีตจริง" (ไม่ใช่ state) · เงินเคลื่อนแล้ว/มี tracking = คน
 * 🔴 ยกเลิก = พยาน 2 ชั้น (tag จาก AI + คำจริงในข้อความ) — N=TRUE คือ action ทำลายล้างเดียวในชุด
 */

const OID = "SKB-20260721-abc123";
const NOW = new Date("2026-07-21T02:34:00Z");
const U = "Uharnesstestcustomer0000000000077";
const FOOTER = "บอทปิดการทำงานกับลูกค้ารายนี้แล้ว";

function makeRow(overrides: Record<string, string> = {}): string[] {
  const header = activeOrdersHeader();
  const row = new Array(header.length).fill("");
  const set = (h: string, v: string) => (row[header.indexOf(h)] = v);
  set("order_id", OID);
  set("คอนเฟิร์ม", "FALSE");
  set("การชำระเงิน", "COD");
  set("สินค้า+จำนวน", "น้ำพริกปลาทูฟรีซดราย x3");
  set("ยอดเงิน", "275");
  for (const [h, v] of Object.entries(overrides)) set(h, v);
  return row;
}
function updatedOf(header: string): string | undefined {
  const u = sheetsCalls.batchUpdates.find((b) => b.range.includes(`!${columnOf(header)}`));
  return u?.values[0][0];
}
function customerText(): string {
  return lineCalls.replies.flatMap((r) => r.messages).map((m) => (m.type === "text" ? (m as { text?: string }).text ?? "" : "")).join(" ");
}

describe("D-77 · updateOrderRow money guard (unit) — อ่านจากแถวจริง", () => {
  beforeEach(() => seedBotLib());

  it("🔴 การชำระเงิน=โอน (เงินเข้าแล้ว) + แก้ยอด → money_locked · ไม่แตะชีต", async () => {
    sheetsCalls.getReturn = [makeRow({ การชำระเงิน: "โอน" })];
    const r = await updateOrderRow(OID, { ยอดเงิน: "440", "สินค้า+จำนวน": "x5" }, NOW);
    expect(r.status).toBe("money_locked");
    expect(r.lockReason).toContain("โอน");
    expect(sheetsCalls.batchUpdates, "ห้ามเขียน").toHaveLength(0);
  });

  it("🔴 มีเลข Tracking (ของเดินทางแล้ว) + แก้ยอด → money_locked", async () => {
    sheetsCalls.getReturn = [makeRow({ เลขTracking: "TH123456" })];
    const r = await updateOrderRow(OID, { items_json: '[{"sku":"NPT-10G","qty":5}]' }, NOW);
    expect(r.status).toBe("money_locked");
    expect(r.lockReason).toContain("Tracking");
    expect(sheetsCalls.batchUpdates).toHaveLength(0);
  });

  it("COD ก่อนส่ง + แก้ยอด → updated (+ คืนค่าเดิมของแถวไว้ประกอบ 🔔)", async () => {
    sheetsCalls.getReturn = [makeRow()];
    const r = await updateOrderRow(OID, { ยอดเงิน: "440" }, NOW);
    expect(r.status).toBe("updated");
    expect(r.row?.total, "ค่าเดิมก่อนแก้").toBe("275");
    expect(updatedOf("ยอดเงิน")).toBe("440");
  });

  it("แก้เฉพาะผู้รับ (เบอร์) บนออเดอร์โอน → พฤติกรรมเดิม (guard ไม่เกี่ยว)", async () => {
    sheetsCalls.getReturn = [makeRow({ การชำระเงิน: "โอน" })];
    const r = await updateOrderRow(OID, { เบอร์โทร: "0911123344" }, NOW);
    expect(r.status, "เส้นผู้รับไม่โดน money guard").toBe("updated");
  });
});

describe("D-77 · cancelOrderRow (unit)", () => {
  beforeEach(() => seedBotLib());

  it("🔴 COD ก่อนส่ง → ติ๊ก N=TRUE ถูกช่อง + Y ประวัติ + Z นับ · ห้ามลบแถว/แตะช่องอื่น", async () => {
    sheetsCalls.getReturn = [makeRow()];
    const r = await cancelOrderRow(OID, NOW);
    expect(r.status).toBe("cancelled");
    expect(updatedOf("ยกเลิก"), "N=TRUE").toBe("TRUE");
    expect(updatedOf("แก้ไขล่าสุด")).toContain("ยกเลิกออเดอร์");
    expect(updatedOf("แก้ไขกี่ครั้ง")).toBe("1");
    expect(sheetsCalls.batchUpdates, "แตะแค่ N + Y + Z สามเซลล์").toHaveLength(3);
    expect(r.row?.items).toContain("x3");
  });

  it("🔴 โอนแล้ว → money_locked · M=TRUE → confirmed · ยกเลิกซ้ำ → money_locked (แถวถูกยกเลิกแล้ว)", async () => {
    sheetsCalls.getReturn = [makeRow({ การชำระเงิน: "โอน" })];
    expect((await cancelOrderRow(OID, NOW)).status).toBe("money_locked");
    sheetsCalls.getReturn = [makeRow({ คอนเฟิร์ม: "TRUE" })];
    expect((await cancelOrderRow(OID, NOW)).status).toBe("confirmed");
    sheetsCalls.getReturn = [makeRow({ ยกเลิก: "TRUE" })];
    expect((await cancelOrderRow(OID, NOW)).status).toBe("money_locked");
    expect(sheetsCalls.batchUpdates).toHaveLength(0);
  });
});

describe("D-77 · hasCancelEvidence (pure) — พยานชั้น 2", () => {
  const KW = ["ยกเลิก", "ไม่เอาแล้ว", "ไม่สั่งแล้ว", "ขอเลิก"];
  it("คำอยู่ในเทิร์นปัจจุบันหรือเทิร์นก่อน → จริง", () => {
    expect(hasCancelEvidence(["ยืนยันค่ะ", "ขอยกเลิกออเดอร์หน่อยค่ะ"], KW)).toBe(true);
    expect(hasCancelEvidence(["ไม่เอาแล้วค่ะ", ""], KW)).toBe(true);
  });
  it("ไม่มีคำตระกูลยกเลิกเลย → เท็จ (โมเดลฝ่ายเดียวไม่พอ)", () => {
    expect(hasCancelEvidence(["ขอบคุณค่ะ", "สั่งเพิ่มได้ไหม"], KW)).toBe(false);
  });
});

// ═══════════ scenario เต็มสาย (webhook → handler → ชีต) ═══════════

describe("D-77 · scenario — แก้จำนวน/ยกเลิก บน COD ก่อนส่ง", () => {
  beforeEach(() => seedBotLib());

  /** เขียนออเดอร์ COD 3 ถ้วย (275 ส่งฟรี) แล้วให้แถวอยู่ในชีต mock */
  async function writeCodOrder() {
    scriptGemini([turn({ reply: "รับ 3 ถ้วยส่งฟรีค่ะ", stage: "S4", paymentMethod: "COD", orderData: { items: [{ qty: 3 }], ...FULL_ADDRESS } })]);
    await sendText(U, "เอา 3 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 ชลบุรี 20000 0811122334");
    expect(appendedRows().length).toBe(1);
    sheetsCalls.getReturn = [appendedRows()[0]];
    sheetsCalls.batchUpdates.length = 0;
    lineCalls.replies.length = 0;
    lineCalls.pushes.length = 0;
  }

  it("🔴 แก้ 3→5 ถ้วย: ยอดใหม่มาจากตารางโปร (440) ไม่ใช่เลขของโมเดล · แตะเฉพาะเซลล์เป้าหมาย · 🔔 เตือนยอด COD เปลี่ยน · ไม่ปิดบอท · snapshot sync", async () => {
    await writeCodOrder();
    // 🔴 AI ไม่ได้บอกราคา (และห้ามเชื่อถ้าบอก) — ส่งแค่ qty ใหม่
    scriptGemini([turn({ reply: "เปลี่ยนเป็น 5 ถ้วยนะคะ ยอดใหม่ 440 บาทส่งฟรีค่ะ", stage: "S_EDIT", orderEditRequest: true, paymentMethod: "COD", orderData: { items: [{ qty: 5 }] } })]);
    await sendText(U, "ยืนยันเปลี่ยนเป็น 5 ถ้วยค่ะ");

    expect(updatedOf("ยอดเงิน"), "🔴 ยอดจาก computeQuote (โปร P5 = 440) ไม่ใช่โมเดล").toBe("440");
    expect(updatedOf("สินค้า+จำนวน")).toContain("x5");
    expect(updatedOf("items_json")).toBe('[{"sku":"NPT-10G","qty":5}]');
    expect(updatedOf("ค่าส่ง"), "ค่าส่ง 0→0 เท่าเดิม = ไม่ถูกเขียนซ้ำ (diff เฉพาะที่ต่างจริง)").toBeUndefined();
    // คอลัมน์อื่นไม่โดน: ทุก range ที่เขียนต้องเป็นของ 4 คอลัมน์เงิน + Y + Z เท่านั้น
    const allowed = ["สินค้า+จำนวน", "ยอดเงิน", "ค่าส่ง", "items_json", "แก้ไขล่าสุด", "แก้ไขกี่ครั้ง"].map(columnOf);
    for (const b of sheetsCalls.batchUpdates) {
      expect(allowed.some((c) => b.range.includes(`!${c}`)), `range แปลกปลอม: ${b.range}`).toBe(true);
    }
    const admin = JSON.stringify(adminPushes());
    expect(admin, "เตือนดัง: ยอด COD เปลี่ยน").toContain("ยอดเก็บเงิน COD เปลี่ยน");
    expect(admin).toContain("275");
    expect(admin).toContain("440");
    expect(admin, "ไม่ปิดบอท").not.toContain(FOOTER);
    const c = await readCustomer(U);
    expect(c?.human_mode).toBe(false);
    expect(JSON.stringify(c?.last_order), "ข้อ 7: snapshot ตามชีต (ยอดใหม่)").toContain("440");
  });

  it("🔴 ออเดอร์โอนแล้ว (เงินเข้า) ขอเพิ่มจำนวน → ไม่แตะยอด · ข้อความอบอุ่น · 🔔 + ปิดบอท · ไม่มีคำว่าเรียบร้อย", async () => {
    await writeCodOrder();
    // จำลองแถวจริงเป็นออเดอร์โอน
    const header = activeOrdersHeader();
    const row = [...appendedRows()[0]];
    row[header.indexOf("การชำระเงิน")] = "โอน";
    sheetsCalls.getReturn = [row];
    scriptGemini([turn({ reply: "แก้ให้เรียบร้อยแล้วค่ะ", stage: "S_EDIT", orderEditRequest: true, paymentMethod: "โอน", orderData: { items: [{ qty: 5 }] } })]);
    await sendText(U, "ขอเพิ่มเป็น 5 ถ้วยค่ะ");
    expect(sheetsCalls.batchUpdates, "ห้ามแตะชีต").toHaveLength(0);
    expect(customerText(), "🔴 คำโกหก 'เรียบร้อย' ของ AI ต้องไม่หลุด").not.toContain("เรียบร้อย");
    expect(customerText(), "ข้อความอบอุ่นไม่รับปากผล").toContain("ส่งต่อให้ทีมแอดมิน");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("🔴 มี tracking แล้ว ขอแก้จำนวน → handoff (ของกำลังเดินทาง)", async () => {
    await writeCodOrder();
    const header = activeOrdersHeader();
    const row = [...appendedRows()[0]];
    row[header.indexOf("เลขTracking")] = "TH999";
    sheetsCalls.getReturn = [row];
    scriptGemini([turn({ reply: "ได้ค่ะ", stage: "S_EDIT", orderEditRequest: true, paymentMethod: "COD", orderData: { items: [{ qty: 1 }] } })]);
    await sendText(U, "ขอลดเหลือ 1 ถ้วยค่ะ");
    expect(sheetsCalls.batchUpdates).toHaveLength(0);
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
  });

  it("🔴 ยกเลิก COD ก่อนส่ง (พยานครบ 2 ชั้น) → ติ๊ก N + 🔔 + ตอบยืนยัน · ไม่ปิดบอท · ล้าง snapshot", async () => {
    await writeCodOrder();
    scriptGemini([
      turn({ reply: "ยืนยันยกเลิกเลยไหมคะ", stage: "S_EDIT" }),
      turn({ reply: "กำลังดำเนินการยกเลิกให้นะคะ", stage: "S_EDIT", orderEditRequest: true, tagsAdd: ["ยกเลิกออเดอร์"] }),
    ]);
    await sendText(U, "ขอยกเลิกออเดอร์ค่ะ"); // เทิร์น 1: มีคำยกเลิก (พยานชั้น 2)
    await sendText(U, "ยืนยันค่ะ"); // เทิร์น 2: AI ใส่ tag (พยานชั้น 1)
    expect(updatedOf("ยกเลิก"), "ติ๊กถูกช่อง").toBe("TRUE");
    const admin = JSON.stringify(adminPushes());
    expect(admin).toContain("ยกเลิกออเดอร์");
    expect(admin, "ไม่ปิดบอท (จัดการเองจบ)").not.toContain(FOOTER);
    const c = await readCustomer(U);
    expect(c?.human_mode).toBe(false);
    expect(c?.last_order, "ข้อ 7: snapshot ถูกล้าง (แถวในชีตยังอยู่)").toBeNull();
  });

  it("🔴 เคาะเจ้าของ: tag มาแต่ไม่มีคำยกเลิกในข้อความ 1-2 เทิร์น → ห้ามแตะชีต · handoff + 🔔 (ไม่เงียบ)", async () => {
    await writeCodOrder();
    scriptGemini([turn({ reply: "ยกเลิกให้แล้วนะคะ", stage: "S_EDIT", orderEditRequest: true, tagsAdd: ["ยกเลิกออเดอร์"] })]);
    await sendText(U, "ขอบคุณมากค่ะ"); // ไม่มีคำตระกูลยกเลิกเลย
    expect(sheetsCalls.batchUpdates, "ห้ามติ๊ก N ด้วยคำของโมเดลฝ่ายเดียว").toHaveLength(0);
    expect(JSON.stringify(adminPushes()), "fallback = คน ไม่ใช่เงียบ").toContain(FOOTER);
    expect(customerText(), "คำ 'ยกเลิกให้แล้ว' ของ AI ต้องไม่หลุด").not.toContain("ยกเลิกให้แล้ว");
  });

  it("🔴 เขียนชีตพลาด (batchUpdate ล้ม) → ไม่มีคำว่าเรียบร้อย · 🔔 + ปิดบอท", async () => {
    await writeCodOrder();
    sheetsCalls.failBatchUpdate = true;
    scriptGemini([turn({ reply: "แก้ให้เรียบร้อยแล้วค่ะ", stage: "S_EDIT", orderEditRequest: true, paymentMethod: "COD", orderData: { items: [{ qty: 5 }] } })]);
    await sendText(U, "เปลี่ยนเป็น 5 ถ้วยค่ะ");
    expect(customerText()).not.toContain("เรียบร้อย");
    expect(customerText()).toContain("บันทึกการแก้ไขไม่สำเร็จ");
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
    expect((await readCustomer(U))?.human_mode).toBe(true);
  });

  it("ก่อนเขียนชีต (ยังสั่งไม่จบ) — tag ยกเลิกโผล่ก็ไม่เข้าเส้นนี้ (hasWrittenOrder gate) · order flow เดิม", async () => {
    scriptGemini([turn({ reply: "รับ 3 ถ้วยนะคะ", stage: "S2", tagsAdd: ["ยกเลิกออเดอร์"], orderData: { items: [{ qty: 3 }] } })]);
    await sendText(U, "เอา 3 ถ้วยค่ะ");
    expect(sheetsCalls.batchUpdates, "ไม่มีการแก้/ยกเลิกใดๆ").toHaveLength(0);
    expect(JSON.stringify(adminPushes())).not.toContain(FOOTER);
    expect(JSON.stringify((await readCustomer(U))?.pending_order), "order flow เดิมเดินต่อ (items เข้า pending)").toContain('"qty":3');
  });

  it("คำ_handoff ชนะทุกอย่าง — 'ขอคุยกับแอดมิน' แม้กำลังคุยเรื่องแก้ออเดอร์ → handoff ทันที ไม่แตะชีต", async () => {
    await writeCodOrder();
    await sendText(U, "ขอคุยกับแอดมินเรื่องแก้ออเดอร์ค่ะ");
    expect(sheetsCalls.batchUpdates).toHaveLength(0);
    expect(JSON.stringify(adminPushes())).toContain(FOOTER);
  });
});
