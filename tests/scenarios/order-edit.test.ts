import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, sheetsCalls, adminPushes } from "../harness/state";
import { appendedRows } from "../harness/sheet";
import { FULL_ADDRESS } from "../harness/fixtures";
import { seedBotLib } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { ORDERS_HEADER, updateOrderRow } from "@/lib/orders";

/**
 * D-31 · Plan B — ลูกค้าแก้ออเดอร์ที่เขียนแล้ว (M≠TRUE) → แก้แถวเดิมด้วย order_id ไม่ handoff
 * M=TRUE (แอดมินคอนเฟิร์ม) → handoff · หา order_id ไม่เจอ → handoff (ห้ามเขียนแถวใหม่)
 * แก้ Bug 2: "ถูกต้องครับ" (ไม่มีค่าใหม่) → no_change → ไม่แก้ ไม่ push ไม่ handoff
 */

const OID = "SKB-20260721-abc123";
const NOW = new Date("2026-07-21T02:34:00Z"); // ไทย 09:34

function makeRow(overrides: Record<string, string> = {}): string[] {
  const row = new Array(ORDERS_HEADER.length).fill("");
  const set = (h: string, v: string) => (row[ORDERS_HEADER.indexOf(h)] = v);
  set("order_id", OID);
  set("คอนเฟิร์ม", "FALSE");
  set("ชื่อ-นามสกุล", "สมชาย ใจดี");
  set("เบอร์โทร", "0811122334");
  set("ที่อยู่", "123/45 ชลบุรี");
  for (const [h, v] of Object.entries(overrides)) set(h, v);
  return row;
}

/** ค่าที่ batchUpdate เขียนลงคอลัมน์ (ตัวอักษร) — undefined = ไม่ถูกแตะ */
function updated(colLetter: string): string | undefined {
  const u = sheetsCalls.batchUpdates.find((b) => b.range.includes(`!${colLetter}`));
  return u?.values[0][0];
}

const Y = String.fromCharCode(65 + ORDERS_HEADER.indexOf("แก้ไขล่าสุด"));
const Z = String.fromCharCode(65 + ORDERS_HEADER.indexOf("แก้ไขกี่ครั้ง"));

describe("updateOrderRow (unit) — header-driven แก้แถวเดิม (D-31)", () => {
  beforeEach(() => seedBotLib());

  it("M≠TRUE + เบอร์ใหม่ → updated · แก้ E · Y=timestamp+สรุป · Z=1", async () => {
    sheetsCalls.getReturn = [makeRow()];
    const r = await updateOrderRow(OID, { เบอร์โทร: "0911123344" }, NOW);
    expect(r.status).toBe("updated");
    expect(updated("E"), "เบอร์ใหม่ลง E").toBe("0911123344");
    expect(updated(Y)).toBe("2026-07-21 09:34 · เบอร์: 0811122334 → 0911123344");
    expect(updated(Z), "Z นับครั้งแรก").toBe("1");
  });

  it("🔴 M=TRUE (คอนเฟิร์มแล้ว) → confirmed · ไม่แตะแถว", async () => {
    sheetsCalls.getReturn = [makeRow({ คอนเฟิร์ม: "TRUE" })];
    const r = await updateOrderRow(OID, { เบอร์โทร: "0911123344" }, NOW);
    expect(r.status).toBe("confirmed");
    expect(sheetsCalls.batchUpdates.length, "ห้ามเขียน").toBe(0);
  });

  it("🔴 หา order_id ไม่เจอ → not_found · ไม่เขียนแถวใหม่", async () => {
    sheetsCalls.getReturn = [makeRow({ order_id: "SKB-อื่น" })];
    const r = await updateOrderRow(OID, { เบอร์โทร: "0911123344" }, NOW);
    expect(r.status).toBe("not_found");
    expect(appendedRows().length, "ห้าม append").toBe(0);
    expect(sheetsCalls.batchUpdates.length).toBe(0);
  });

  it("🔴 ไม่มีค่าใหม่ต่างจริง (ยืนยันเฉยๆ) → no_change · ไม่แตะ Y/Z", async () => {
    sheetsCalls.getReturn = [makeRow()];
    const same = await updateOrderRow(OID, { เบอร์โทร: "0811122334" }, NOW); // เท่าเดิม
    expect(same.status).toBe("no_change");
    const empty = await updateOrderRow(OID, {}, NOW); // ไม่ส่งค่าเลย
    expect(empty.status).toBe("no_change");
    expect(sheetsCalls.batchUpdates.length).toBe(0);
  });

  it("🔴 ที่อยู่ใหม่สั้นผิดปกติ (AI ส่งเศษ '21') → ไม่ทับ + suspect (กันเขียนที่อยู่ผิด)", async () => {
    sheetsCalls.getReturn = [makeRow({ ที่อยู่: "11 ถนนเจริญกรุง เขตบางรัก กรุงเทพ 10500" })];
    const r = await updateOrderRow(OID, { ที่อยู่: "21" }, NOW);
    expect(r.status).toBe("no_change");
    expect(r.suspect).toContain("ที่อยู่");
    expect(sheetsCalls.batchUpdates.length, "ห้ามเขียนที่อยู่ผิด").toBe(0);
  });

  it("ที่อยู่ใหม่เต็มก้อน (AI ประกอบแล้ว) → updated ปกติ", async () => {
    sheetsCalls.getReturn = [makeRow({ ที่อยู่: "11 ถนนเจริญกรุง เขตบางรัก กรุงเทพ 10500" })];
    const r = await updateOrderRow(OID, { ที่อยู่: "21 ถนนเจริญกรุง เขตบางรัก กรุงเทพ 10500" }, NOW);
    expect(r.status).toBe("updated");
    expect(updated("F"), "ที่อยู่ใหม่ลง F").toContain("21 ถนนเจริญกรุง");
  });

  it("Y ต่อท้ายประวัติ (ไม่ทับ) · Z อ่านเดิม+1 · หลายฟิลด์คั่น ·", async () => {
    sheetsCalls.getReturn = [makeRow({ แก้ไขล่าสุด: "2026-07-20 10:00 · ชื่อ: ก → สมชาย ใจดี", แก้ไขกี่ครั้ง: "2" })];
    const r = await updateOrderRow(OID, { เบอร์โทร: "0911123344", ที่อยู่: "999 กรุงเทพ" }, NOW);
    expect(r.status).toBe("updated");
    expect(updated(Y), "ต่อท้ายบรรทัดใหม่").toContain("2026-07-20 10:00");
    expect(updated(Y)).toContain("เบอร์: 0811122334 → 0911123344 · ที่อยู่: 123/45 ชลบุรี → 999 กรุงเทพ");
    expect(updated(Z), "2+1").toBe("3");
  });
});

describe("route order-edit (scenario) — Bug 2 หาย + แก้ชีต", () => {
  const U = "Uharnesstestcustomer0000000000012";
  beforeEach(() => seedBotLib());

  async function writeFirstOrder() {
    scriptGemini([
      turn({ reply: "รับ 1 ถ้วย เก็บปลายทางค่ะ", stage: "4b", paymentMethod: "COD", orderData: { items: [{ qty: 1 }], ...FULL_ADDRESS } }),
    ]);
    await sendText(U, "เอา 1 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 ชลบุรี 20000 0811122334");
    expect(appendedRows().length).toBe(1);
    // จำลองว่าแถวที่เขียนอยู่ในชีตแล้ว ให้ updateOrderRow อ่านเจอ
    sheetsCalls.getReturn = [appendedRows()[0]];
  }

  it("hasWrittenOrder + M≠TRUE + แก้เบอร์ → แก้แถวเดิม · push edit · ไม่ handoff", async () => {
    await writeFirstOrder();
    scriptGemini([turn({ reply: "แก้เบอร์ให้แล้วนะคะ", stage: "4b", orderEditRequest: true, paymentMethod: "COD", orderData: { เบอร์: "0911123344" } })]);
    await sendText(U, "ขอเปลี่ยนเบอร์เป็น 0911123344");

    expect(updated("E"), "เบอร์ใหม่ลงแถวเดิม").toBe("0911123344");
    expect(JSON.stringify(adminPushes())).toContain("ลูกค้าแก้ออเดอร์");
    expect(appendedRows().length, "ไม่เขียนแถวใหม่").toBe(1);
    const c = await readCustomer(U);
    expect(c?.human_mode, "🔴 ไม่ handoff (Bug 2)").toBe(false);
  });

  it("🔴 hasWrittenOrder + 'ถูกต้องครับ' (ไม่มีค่าใหม่) → ไม่แก้ ไม่ push ไม่ handoff (Bug 2)", async () => {
    await writeFirstOrder();
    scriptGemini([turn({ reply: "ขอบคุณค่ะ", stage: "4b", orderEditRequest: true, orderData: {} })]);
    await sendText(U, "ถูกต้องครับ ขอบคุณ");

    expect(sheetsCalls.batchUpdates.length, "ไม่แตะชีต").toBe(0);
    expect(JSON.stringify(adminPushes()), "ไม่ push แก้").not.toContain("ลูกค้าแก้ออเดอร์");
    const c = await readCustomer(U);
    expect(c?.human_mode, "ไม่ handoff").toBe(false);
  });

  it("🔴 เขียนชีต → last_order เก็บ snapshot (D-32) · แก้ได้หลัง pending clear", async () => {
    await writeFirstOrder();
    const c = await readCustomer(U);
    expect(c?.pending_order, "pending ถูก clear (D-29)").toBeNull();
    expect(c?.last_order, "last_order เก็บ snapshot").toBeTruthy();
    expect((c?.last_order as Record<string, unknown>).order_id).toMatch(/^SKB-/);
    expect(c?.last_order_locked).toBe(false);
  });

  it("hasWrittenOrder + M=TRUE + แก้เบอร์ → handoff · ล็อก last_order · ไม่แก้แถว", async () => {
    await writeFirstOrder();
    sheetsCalls.getReturn = [ (() => { const row = [...appendedRows()[0]]; row[ORDERS_HEADER.indexOf("คอนเฟิร์ม")] = "TRUE"; return row; })() ];
    scriptGemini([turn({ reply: "เดี๋ยวให้แอดมินดูแลนะคะ", stage: "4b", orderEditRequest: true, orderData: { เบอร์: "0911123344" } })]);
    await sendText(U, "ขอเปลี่ยนเบอร์");

    expect(sheetsCalls.batchUpdates.length, "M=TRUE ห้ามแก้").toBe(0);
    expect(JSON.stringify(adminPushes())).toContain("คอนเฟิร์มแล้ว");
    const c = await readCustomer(U);
    expect(c?.human_mode, "handoff").toBe(true);
    expect(c?.last_order_locked, "ล็อก").toBe(true);
  });
});
