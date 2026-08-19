import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, sheetsCalls } from "../harness/state";
import { appendedRows } from "../harness/sheet";
import { seedBotLib } from "../harness/botlib-fixture";
import { listOrdersToNotifyShipping, ORDERS_HEADER } from "@/lib/orders";

beforeEach(() => seedBotLib());

/**
 * 🔴 Part B — Orders header-driven: อ่าน/เขียนจากชื่อ header ไม่ใช่ index ตายตัว
 * สลับ/แทรกคอลัมน์ในชีต Orders → ยังเขียน/อ่านถูกช่อง (CONTRACTS C1)
 * บั๊ก column offset ที่แพงที่สุด (ค่าลงผิดช่องเงียบ ๆ) จะไม่เกิดอีก
 */

const U = "Uharnesstestcustomer0000000000021";

/** สร้าง header จำลองที่สลับตำแหน่ง: ย้าย order_id + ยอดเงิน ไปไว้หน้าสุด */
function reorderedHeader(): string[] {
  const moved = ["order_id", "ยอดเงิน"];
  return [...moved, ...ORDERS_HEADER.filter((h) => !moved.includes(h))];
}

describe("appendOrderRow — สลับคอลัมน์ Orders → ยังเขียนถูกช่อง", () => {
  it("ย้าย ยอดเงิน/order_id ไปหน้าสุด → ค่าไปตามตำแหน่ง header ใหม่", async () => {
    const header = reorderedHeader();
    sheetsCalls.ordersHeader = header;

    scriptGemini([
      turn({
        reply: "รับ 3 ถ้วย 275 บาท ส่งของให้เลยนะคะ",
        stage: "4b",
        paymentMethod: "COD",
        orderData: {
          items: [{ qty: 3 }],
          ชื่อ: "สมหญิง ใจดี",
          เบอร์: "0811122334",
          ที่อยู่: "1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120",
        },
      }),
    ]);

    await sendText(U, "เอา 3 ถ้วย สมหญิง ใจดี 1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120 0811122334 เก็บปลายทาง");

    expect(appendedRows(), "ต้องเขียน 1 แถว").toHaveLength(1);
    const row = appendedRows()[0];

    // อ่านค่าจาก "ตำแหน่งตาม header ใหม่" ต้องตรงกับที่ตั้งใจเขียน
    const at = (name: string) => row[header.indexOf(name)];
    expect(at("ยอดเงิน"), "ยอดเงิน (ย้ายไป index 1) = 275 จาก pricing").toBe("275");
    expect(at("ชื่อ-นามสกุล")).toBe("สมหญิง ใจดี");
    expect(at("เบอร์โทร")).toBe("0811122334");
    expect(at("ที่อยู่")).toBe("1 ถนนเจริญ ช่องนนทรี ยานนาวา กทม. 10120");
    expect(at("การชำระเงิน")).toBe("COD");
    expect(at("ส่งออเดอร์แล้ว")).toBe("FALSE");
    // 🔴 พิสูจน์ไม่ใช่ index เดิม: ยอดเงิน "ไม่" อยู่ index 9 (J) แบบ layout เก่าแล้ว
    expect(row[9], "index 9 เดิมของยอดเงิน ตอนนี้ต้องไม่ใช่ 275").not.toBe("275");
  });
});

// 🔴 D-64: ย้ายมาจาก listPendingOrders (ลบแล้ว) — พิสูจน์ header-driven ได้เท่ากันด้วยฟังก์ชันที่ prod ใช้จริง
describe("listOrdersToNotifyShipping — สลับคอลัมน์ → อ่าน order_id ถูก (ไม่ใช่ r[16])", () => {
  it("order_id ย้ายไป index 0 → ยังอ่านเจอโดยชื่อ", async () => {
    const header = reorderedHeader(); // order_id อยู่ index 0
    sheetsCalls.ordersHeader = header;

    // แถวข้อมูล 1 แถว: เข้าคิวแจ้งพัสดุตามเงื่อนไข D-64 = ลำดับ(A) มีเลข + เลขTracking ไม่ว่าง + ไม่ยกเลิก
    const dataRow = new Array<string>(header.length).fill("");
    dataRow[header.indexOf("order_id")] = "SKB-20260718-abc123";
    dataRow[header.indexOf("ชื่อ-นามสกุล")] = "สมชาย ใจดี";
    dataRow[header.indexOf("ยอดเงิน")] = "285";
    dataRow[header.indexOf("ลำดับ")] = "0819_1";
    dataRow[header.indexOf("เลขTracking")] = "TH123456789";
    dataRow[header.indexOf("ยกเลิก")] = "FALSE";
    dataRow[header.indexOf("ส่งออเดอร์แล้ว")] = "FALSE"; // 🔴 O=FALSE ต้องไม่กันออกจากคิว
    sheetsCalls.getReturn = [dataRow];

    const queue = await listOrdersToNotifyShipping();
    expect(queue, "O=FALSE ต้องยังเข้าคิว (ไม่พึ่ง O แล้ว)").toHaveLength(1);
    expect(queue[0].orderId, "อ่าน order_id จากชื่อ ไม่ใช่ r[16]").toBe("SKB-20260718-abc123");
    expect(queue[0].customerName).toBe("สมชาย ใจดี");
    expect(queue[0].total).toBe("285");
    expect(queue[0].orderNumber).toBe("0819_1");
  });

  it("🔴 ลำดับ(A) ว่าง → ไม่เข้าคิว แม้มีเลขพัสดุ (ยังไม่คอนเฟิร์ม)", async () => {
    const header = reorderedHeader();
    sheetsCalls.ordersHeader = header;
    const dataRow = new Array<string>(header.length).fill("");
    dataRow[header.indexOf("order_id")] = "SKB-x";
    dataRow[header.indexOf("เลขTracking")] = "TH999";
    dataRow[header.indexOf("ยกเลิก")] = "FALSE";
    sheetsCalls.getReturn = [dataRow];
    expect(await listOrdersToNotifyShipping()).toHaveLength(0);
  });

  it("🔴 ยกเลิก(N)=TRUE → ไม่เข้าคิว แม้ครบทุกอย่าง", async () => {
    const header = reorderedHeader();
    sheetsCalls.ordersHeader = header;
    const dataRow = new Array<string>(header.length).fill("");
    dataRow[header.indexOf("order_id")] = "SKB-y";
    dataRow[header.indexOf("ลำดับ")] = "0819_2";
    dataRow[header.indexOf("เลขTracking")] = "TH888";
    dataRow[header.indexOf("ยกเลิก")] = "TRUE";
    sheetsCalls.getReturn = [dataRow];
    expect(await listOrdersToNotifyShipping()).toHaveLength(0);
  });
});
