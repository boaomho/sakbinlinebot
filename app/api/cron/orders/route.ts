import { NextRequest, NextResponse } from "next/server";
import { getConfig, resolveFeatureSwitches } from "@/lib/config";
import { listPendingOrders, markOrderSent, OrderRow } from "@/lib/orders";
import { nextOrderNumber } from "@/lib/db";
import { bangkokShift } from "@/lib/core/time";
import { pushRawText } from "@/lib/line";

export const maxDuration = 30;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** อิงเวลารอบตัดออเดอร์ (เวลาปัจจุบันตอน cron รัน ไม่ใช่เวลาที่ลูกค้าสั่ง): ก่อนตัด=วันนี้ / หลังตัด=วันถัดไป */
function resolveOrderDay(cutoffTime: string): string {
  const bkk = bangkokShift(); // เวลาไทย (D-37 · ฐานเดียว)
  const [cutHRaw, cutMRaw] = cutoffTime.split(":");
  const cutH = parseInt(cutHRaw, 10) || 0;
  const cutM = parseInt(cutMRaw, 10) || 0;
  const cutoffMinutes = cutH * 60 + cutM;
  const nowMinutes = bkk.getUTCHours() * 60 + bkk.getUTCMinutes();
  const dayOffset = nowMinutes < cutoffMinutes ? 0 : 1;
  const target = new Date(bkk.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  return `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}-${pad2(target.getUTCDate())}`;
}

function formatOrderMessage(orderNumber: string, order: OrderRow): string {
  return [
    `${orderNumber}.${order.productAndQty} ด้วยค่ะ`,
    "",
    `${order.total} ${order.paymentMethod || "-"} ${order.province}ค่ะ.`,
    "",
    order.customerName,
    [order.address, order.province, order.postalCode].filter(Boolean).join(" "),
    order.phone,
    "",
    `LineOA: ${order.lineDisplayName}`,
  ].join("\n");
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = await getConfig();
  const switches = resolveFeatureSwitches(config);

  if (!switches.orders) {
    console.warn(JSON.stringify({ scope: "cron-orders", warning: "orders switch off or env missing, skip" }));
    return NextResponse.json({ status: "skipped" }, { status: 200 });
  }

  const orderGroupId = process.env.ORDER_GROUP_ID;
  if (!orderGroupId) {
    return NextResponse.json({ status: "skipped", reason: "ORDER_GROUP_ID missing" }, { status: 200 });
  }

  let orders: OrderRow[];
  try {
    orders = await listPendingOrders();
  } catch (error) {
    console.error(JSON.stringify({ scope: "cron-orders", warning: "listPendingOrders failed", error: String(error) }));
    return NextResponse.json({ status: "error" }, { status: 200 });
  }

  const day = config.orderNumberResetDaily ? resolveOrderDay(config.orderCutoffTime) : "ALL";
  let processed = 0;

  for (const order of orders) {
    try {
      const seq = await nextOrderNumber(day);
      const orderNumber = config.orderNumberResetDaily ? `${day.slice(5).replace("-", "")}-${seq}` : String(seq);
      await markOrderSent(order.rowIndex, orderNumber);
      await pushRawText(orderGroupId, formatOrderMessage(orderNumber, order));
      processed++;
    } catch (error) {
      console.error(
        JSON.stringify({ scope: "cron-orders", warning: "process order failed", rowIndex: order.rowIndex, error: String(error) }),
      );
    }
  }

  console.log(JSON.stringify({ scope: "cron-orders", processed, total: orders.length }));
  return NextResponse.json({ status: "ok", processed }, { status: 200 });
}
