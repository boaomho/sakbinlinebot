import { NextRequest, NextResponse } from "next/server";
import { getConfig, resolveFeatureSwitches } from "@/lib/config";
import { listPendingOrders, listOrdersToNotifyShipping, markOrderSent, OrderRow } from "@/lib/orders";
import { nextOrderNumber, clearDeliveredStepsExceptCurrent, markShippingNotified, getCustomer, getRecentHistory } from "@/lib/db";
import { bangkokShift } from "@/lib/core/time";
import { pushRawText, pushMessages } from "@/lib/line";
import { formatShippingMessage, DEFAULT_SHIPPING_TEMPLATE, DEFAULT_CARRIER } from "@/lib/shipping";
import { isFirstMessageOfDay, prependToFirstTextBubble, DEFAULT_DAILY_GREETING } from "@/lib/greeting";
import { channelLabel } from "@/lib/channel/label";

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
    `${channelLabel(order.lineUserId)} ${order.customerName}`,
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
      // D-45b · v1 hook "ออเดอร์ปิดจบ" = จังหวะแจกเลข (จุดเดิม ไม่ประดิษฐ์ event ใหม่):
      // ล้างธง delivered_steps (คงเฉพาะ step ปัจจุบัน) → ลูกค้ากลับมาซื้อรอบสองเห็นเนื้อหา S2/โปรได้อีก
      // เฟสหลังการขาย (Follow CRM) จะย้าย/เพิ่มจุดล้างตามสัญญาณ "ได้รับของจริง" ได้
      if (order.lineUserId) await clearDeliveredStepsExceptCurrent(order.lineUserId);
      processed++;
    } catch (error) {
      console.error(
        JSON.stringify({ scope: "cron-orders", warning: "process order failed", rowIndex: order.rowIndex, error: String(error) }),
      );
    }
  }

  console.log(JSON.stringify({ scope: "cron-orders", processed, total: orders.length }));

  // ---- D-50 แจ้งเลขพัสดุลูกค้า ----
  // ทริกเกอร์: แจกเลขแล้ว(O) + มีเลขพัสดุ(P) + ยังไม่แจ้ง (Neon shipping_notified · atomic claim)
  // ผ่าน greeting D-51 (push แรกของวัน ได้ "สวัสดีค่ะ " นำหน้า) · human_mode/บอทปิด → แจ้งกลุ่มแอดมิน
  const shipped = await notifyShipping(config, orderGroupId);

  console.log(JSON.stringify({ scope: "cron-orders", event: "shipping-notify-done", shipped }));
  return NextResponse.json({ status: "ok", processed, shipped }, { status: 200 });
}

async function notifyShipping(
  config: Awaited<ReturnType<typeof getConfig>>,
  orderGroupId: string,
): Promise<number> {
  const template = (config.raw.get("ข้อความแจ้งพัสดุ") ?? DEFAULT_SHIPPING_TEMPLATE).trim();
  if (!template) return 0; // ค่าว่าง = ปิดฟีเจอร์แจ้งพัสดุ
  const carrier = (config.raw.get("ขนส่ง_เริ่มต้น") ?? "").trim() || DEFAULT_CARRIER;
  const rawGreet = config.raw.get("ทักทายรายวัน");
  const greet = rawGreet === undefined ? DEFAULT_DAILY_GREETING : rawGreet;
  const adminGroupId = process.env.ADMIN_GROUP_ID;

  let toNotify: OrderRow[];
  try {
    toNotify = await listOrdersToNotifyShipping();
  } catch (error) {
    console.error(JSON.stringify({ scope: "cron-orders", warning: "listOrdersToNotifyShipping failed", error: String(error) }));
    return 0;
  }

  let shipped = 0;
  for (const o of toNotify) {
    try {
      if (!o.orderId) {
        console.warn(JSON.stringify({ scope: "cron-shipping", warning: "ข้าม: ไม่มี order_id (แถวเก่าก่อน D-29)", rowIndex: o.rowIndex }));
        continue;
      }
      // M-2: ออเดอร์ช่องทาง Messenger (fb:) — cron LINE push ไม่ได้ → ข้าม (ไม่เคลม · M-4 ค่อย route ตาม prefix)
      if (o.lineUserId.startsWith("fb:")) {
        console.warn(JSON.stringify({ scope: "cron-shipping", warning: "ข้าม messenger (รอ M-4 route push ตาม channel)", orderId: o.orderId }));
        continue;
      }
      // เคลม atomic ก่อนแจ้ง (กัน cron รันซ้อน/ซ้ำ) — เคยเคลม = ข้าม
      if (!(await markShippingNotified(o.orderId))) continue;

      if (!o.lineUserId) {
        console.warn(JSON.stringify({ scope: "cron-shipping", warning: "ข้าม: line_user_id(R) ว่าง (แถวเก่าก่อน KI-06)", orderId: o.orderId }));
        continue; // เคลมแล้ว → ไม่วน log ซ้ำทุกรอบ
      }

      const customer = await getCustomer(o.lineUserId);
      // human_mode/บอทถูกปิด (หรือหา customer ไม่เจอ) → ไม่ push ลูกค้า · แจ้งกลุ่มแอดมินให้แจ้งเอง
      if (!customer || customer.humanMode) {
        if (adminGroupId) {
          await pushRawText(adminGroupId, `⚠️ ลูกค้าอยู่โหมดแอดมิน/บอทปิด — โปรดแจ้งเลขพัสดุเอง\nออเดอร์ ${o.orderNumber || o.orderId} · ${carrier} ${o.trackingNumber}\n${channelLabel(o.lineUserId)} ${o.customerName} ${o.phone}`);
        }
        continue;
      }

      let msg = formatShippingMessage(template, carrier, o.trackingNumber);
      if (greet) {
        const hist = await getRecentHistory(o.lineUserId, 1);
        if (isFirstMessageOfDay(hist.length, customer.lastSeen, new Date())) msg = prependToFirstTextBubble(msg, greet);
      }
      const ok = await pushMessages(o.lineUserId, msg);
      if (ok) {
        shipped++;
        // แจ้งกลุ่ม (ทีมแพ็คเห็นสถานะจากกลุ่ม — ทดแทนคอลัมน์สถานะในชีต)
        if (adminGroupId) await pushRawText(adminGroupId, `แจ้งพัสดุลูกค้าแล้ว ✓ ${o.orderNumber || o.orderId} · ${carrier} ${o.trackingNumber}`);
      } else {
        // push ล้ม (เคลมไปแล้ว) → แจ้งแอดมินให้แจ้งเอง กันลูกค้าไม่ได้เลข
        console.error(JSON.stringify({ scope: "cron-shipping", warning: "push ลูกค้าล้ม (เคลมแล้ว)", orderId: o.orderId }));
        if (adminGroupId) await pushRawText(adminGroupId, `⚠️ แจ้งพัสดุลูกค้าไม่สำเร็จ (push ล้ม) — โปรดแจ้งเอง\nออเดอร์ ${o.orderNumber || o.orderId} · ${carrier} ${o.trackingNumber}`);
      }
    } catch (error) {
      console.error(JSON.stringify({ scope: "cron-shipping", warning: "notify failed", orderId: o.orderId, error: String(error) }));
    }
  }
  return shipped;
}
