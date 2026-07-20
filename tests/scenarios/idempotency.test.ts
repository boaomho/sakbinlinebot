import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, sheetsCalls } from "../harness/state";
import { orderCount } from "../harness/sheet";
import { FULL_ADDRESS } from "../harness/fixtures";
import { seedBotLib } from "../harness/botlib-fixture";
import { readWrittenOrderIds } from "../harness/db";
import { mergePendingOrder } from "@/lib/db";

/**
 * D-29 · order_id idempotency — แยก 2 สถานะให้ขาด:
 *   "สร้าง id แล้ว" (ใน pending) ≠ "เขียนสำเร็จ" (ใน Neon orders_written)
 * เช็ค dup จากสถานะ "เขียนสำเร็จ" เท่านั้น → append ล้มต้องเขียนใหม่ (ออเดอร์ไม่หาย)
 */

const U = "Uharnesstestcustomer0000000000011";
const COD_ORDER = { items: [{ qty: 1 }], ...FULL_ADDRESS };

beforeEach(() => seedBotLib());

describe("บท A — append สำเร็จ + clear ล้ม → retry → ไม่เขียนซ้ำ (idempotent)", () => {
  it("restore pending (จำลอง clear ล้ม) → เทิร์นถัดไป skip เพราะ order_id เขียนสำเร็จแล้ว", async () => {
    scriptGemini([
      turn({ reply: "รับ 1 ถ้วย เก็บปลายทางค่ะ", stage: "4b", paymentMethod: "COD", orderData: COD_ORDER }),
      turn({ reply: "รับทราบค่ะ", stage: "4b", paymentMethod: "COD" }),
    ]);

    await sendText(U, "เอา 1 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 ชลบุรี 20000 0811122334");
    expect(orderCount(), "เขียน 1 แถว").toBe(1);
    const ids = await readWrittenOrderIds();
    expect(ids, "บันทึก order_id ที่เขียนสำเร็จใน Neon").toHaveLength(1);

    // จำลอง clear ล้ม: pending กลับมาเหมือนเดิม (order_id เดิม)
    await mergePendingOrder(U, { items: [{ sku: "NPT-10G", qty: 1 }], การชำระเงิน: "COD", order_id: ids[0], ...FULL_ADDRESS });

    await sendText(U, "ยังอยู่ไหมคะ");
    expect(orderCount(), "🔴 order_id เขียนแล้ว → ห้ามเขียนซ้ำ").toBe(1);
  });
});

describe("บท B — append ล้มจริง (throw) → retry → เขียนใหม่ (ออเดอร์ไม่หาย)", () => {
  it("append ล้มรอบแรก → pending ยังอยู่ · รอบสองเขียนสำเร็จ", async () => {
    scriptGemini([
      turn({ reply: "รับ 1 ถ้วย เก็บปลายทางค่ะ", stage: "4b", paymentMethod: "COD", orderData: COD_ORDER }),
      turn({ reply: "รับทราบค่ะ", stage: "4b", paymentMethod: "COD" }),
    ]);

    sheetsCalls.failAppend = true;
    await sendText(U, "เอา 1 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 ชลบุรี 20000 0811122334");
    expect(orderCount(), "append ล้ม = 0 แถว").toBe(0);
    expect(await readWrittenOrderIds(), "ยังไม่ mark written (append ล้ม)").toHaveLength(0);

    sheetsCalls.failAppend = false;
    await sendText(U, "ยังอยู่ไหมคะ");
    expect(orderCount(), "🔴 retry → เขียนใหม่ ออเดอร์ไม่หาย").toBe(1);
    expect(await readWrittenOrderIds()).toHaveLength(1);
  });
});

describe("บท C — clear สำเร็จ → สลิป/ข้อความซ้ำ → ไม่เขียนซ้ำ (บท 7 เดิม + order_id)", () => {
  it("หลังเขียนสำเร็จ pending ถูก clear → เทิร์นซ้ำ gate ไม่ครบ → 1 แถว · 1 order_id", async () => {
    scriptGemini([
      turn({ reply: "รับ 1 ถ้วย เก็บปลายทางค่ะ", stage: "4b", paymentMethod: "COD", orderData: COD_ORDER }),
      turn({ reply: "ขอบคุณค่ะ", stage: "4b", paymentMethod: "COD" }),
    ]);

    await sendText(U, "เอา 1 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 ชลบุรี 20000 0811122334");
    await sendText(U, "ขอบคุณค่ะ");
    expect(orderCount()).toBe(1);
    expect(await readWrittenOrderIds()).toHaveLength(1);
  });
});
