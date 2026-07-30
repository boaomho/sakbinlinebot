import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { listOrdersForDashboard } from "@/lib/orders";
import { listNotifiedOrderIds } from "@/lib/db";
import { channelOf, deriveOrderStatus, ORDER_STATUS_META, type OrderStatus } from "@/lib/train/dashboard";

export const maxDuration = 20;

/**
 * T2-ฉ · แท็บออเดอร์ (ร้านจริง · อ่านชีต Orders อย่างเดียว · cache 60วิ)
 * 🔴 read-only ล้วน — derive สถานะจากคอลัมน์จริง M/N/O/P + shipping_notified · ไม่เขียน/ไม่เพิ่มคอลัมน์
 * การกระทำจริง (คอนเฟิร์ม/กรอกเลข/ยกเลิก) ยังทำในชีต — แท็บนี้แค่ "กระจก"
 */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { includeTrain?: boolean };
  const includeTrain = Boolean(body.includeTrain);

  try {
    const rows = await listOrdersForDashboard();
    // shipping_notified: อ่านครั้งเดียวตาม order_id ที่มีจริง (กัน N+1 · ว่าง=ข้าม)
    const notified = await listNotifiedOrderIds(rows.map((r) => r.orderId).filter(Boolean));

    const orders = rows
      .map((r) => {
        const channel = channelOf(r.lineUserId);
        const status = deriveOrderStatus({
          cancelled: r.cancelled,
          confirmed: r.confirmed,
          sent: r.sent,
          hasTracking: r.trackingNumber.trim() !== "",
          notified: notified.has(r.orderId),
        });
        return {
          rowIndex: r.rowIndex,
          orderNumber: r.orderNumber, // A ลำดับ (cron แจกตอนคอนเฟิร์ม · ว่าง=ยังไม่แจก)
          orderId: r.orderId, // Q idempotency key
          channel,
          lineUserId: r.lineUserId,
          name: r.customerName || r.lineDisplayName || "(ไม่มีชื่อ)",
          productAndQty: r.productAndQty,
          total: r.total,
          paymentMethod: r.paymentMethod,
          trackingNumber: r.trackingNumber,
          phone: r.phone,
          address: [r.address, r.province, r.postalCode].filter(Boolean).join(" "),
          status,
        };
      })
      .filter((o) => includeTrain || o.channel !== "train") // 🔴 TRAIN กรอง default (เหมือน T2-ก)
      .sort((a, b) => b.rowIndex - a.rowIndex); // ใหม่สุดก่อน (append order)

    // ตัวเลขหัวจอ — นับทุกสถานะที่ยัง pending (คอขวดที่ต้องเคลียร์)
    const counts = {} as Record<OrderStatus, number>;
    for (const k of Object.keys(ORDER_STATUS_META) as OrderStatus[]) counts[k] = 0;
    for (const o of orders) counts[o.status]++;

    return NextResponse.json({ orders, counts, total: orders.length });
  } catch (error) {
    console.error(JSON.stringify({ scope: "dashboard-orders", warning: "load failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "โหลดออเดอร์ไม่ได้" }, { status: 500 });
  }
}
