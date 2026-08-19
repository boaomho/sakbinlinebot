import { NextRequest, NextResponse } from "next/server";
import { getConfig, resolveFeatureSwitches } from "@/lib/config";
import { listOrdersToNotifyShipping, OrderRow } from "@/lib/orders";
import { markShippingNotified, getCustomer, getRecentHistory } from "@/lib/db";
import { pushRawText, pushMessages } from "@/lib/line";
import { formatShippingMessage, DEFAULT_SHIPPING_TEMPLATE, DEFAULT_CARRIER, withinMessengerWindow } from "@/lib/shipping";
import { isFirstMessageOfDay, prependToFirstTextBubble, DEFAULT_DAILY_GREETING } from "@/lib/greeting";
import { channelLabel } from "@/lib/channel/label";
import { resolvePageContext } from "@/lib/channel/pages";
import { MessengerTransport } from "@/lib/channel/transport";

export const maxDuration = 30;

/**
 * 🔴 D-64: cron เหลืองานเดียว = "แจ้งเลขพัสดุ" (D-50)
 * งานแจกเลขออเดอร์ย้ายไป Apps Script บนชีตแล้ว (เขียนคอลัมน์ A ตอนติ๊ก M · รูปแบบ MMDD_n เช่น 0819_1)
 * และการส่งออเดอร์เข้ากลุ่มแพ็ค = คน copy จากคอลัมน์สูตรในชีต
 * → ไฟล์นี้ **ไม่เขียนคอลัมน์ A และ O อีกต่อไป** (ตัด listPendingOrders/nextOrderNumber/markOrderSent ทิ้งหมด)
 * ตารางเวลา: cron-job.org วันละ 2 รอบ 15:00 / 18:00 เวลาไทย
 */
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

  // ORDER_GROUP_ID ยังต้องมี — notifyShipping ใช้เป็นปลายทาง fallback แจ้งทีมแพ็ค
  const orderGroupId = process.env.ORDER_GROUP_ID;
  if (!orderGroupId) {
    return NextResponse.json({ status: "skipped", reason: "ORDER_GROUP_ID missing" }, { status: 200 });
  }

  // ---- D-50 แจ้งเลขพัสดุลูกค้า (งานเดียวที่เหลือหลัง D-64) ----
  // ทริกเกอร์ (D-64): มีเลขลำดับ(A) + มีเลขพัสดุ(P) + ไม่ยกเลิก(N) · ยังไม่แจ้ง (Neon shipping_notified · atomic claim)
  // ผ่าน greeting D-51 (push แรกของวัน ได้ "สวัสดีค่ะ " นำหน้า) · human_mode/บอทปิด → แจ้งกลุ่มแอดมิน
  const shipped = await notifyShipping(config, orderGroupId);

  console.log(JSON.stringify({ scope: "cron-orders", event: "shipping-notify-done", shipped }));
  return NextResponse.json({ status: "ok", shipped }, { status: 200 });
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

      // M-4: route push ตาม channel ของ R (raw/TRAIN → LINE · fb: → Messenger + gate 24 ชม.)
      const label = channelLabel(o.lineUserId);
      const orderTag = `${label} ${o.orderNumber || o.orderId} · ${carrier} ${o.trackingNumber}`;
      let ok: boolean;
      if (o.lineUserId.startsWith("fb:")) {
        // 5.3: Messenger free-form ได้เฉพาะลูกค้า active ใน 24 ชม. · เกิน → แจ้งแอดมิน (เคลมแล้ว = ไม่ retry/สแปม)
        if (!withinMessengerWindow(customer.lastSeen, new Date())) {
          if (adminGroupId) await pushRawText(adminGroupId, `⚠️ ${label} เกินหน้าต่าง 24 ชม. — โปรดแจ้งเลขพัสดุเอง\nออเดอร์ ${orderTag}\n${o.customerName} ${o.phone}`);
          continue;
        }
        const [, pageId, psid] = o.lineUserId.split(":");
        const page = pageId ? await resolvePageContext(pageId) : null;
        if (!page || !psid) {
          if (adminGroupId) await pushRawText(adminGroupId, `⚠️ ${label} ส่งแจ้งพัสดุไม่ได้ (เพจไม่พร้อม) — โปรดแจ้งเอง\nออเดอร์ ${orderTag}`);
          continue;
        }
        ok = await new MessengerTransport(page, psid).push(msg);
      } else {
        ok = await pushMessages(o.lineUserId, msg);
      }

      if (ok) {
        shipped++;
        // แจ้งกลุ่ม (ทีมแพ็คเห็นสถานะ+ช่องทางจากกลุ่ม — ทดแทนคอลัมน์สถานะในชีต)
        if (adminGroupId) await pushRawText(adminGroupId, `แจ้งพัสดุลูกค้าแล้ว ✓ ${orderTag}`);
      } else {
        // push ล้ม (เคลมไปแล้ว) → แจ้งแอดมินให้แจ้งเอง กันลูกค้าไม่ได้เลข
        console.error(JSON.stringify({ scope: "cron-shipping", warning: "push ลูกค้าล้ม (เคลมแล้ว)", orderId: o.orderId }));
        if (adminGroupId) await pushRawText(adminGroupId, `⚠️ ${label} แจ้งพัสดุลูกค้าไม่สำเร็จ (push ล้ม) — โปรดแจ้งเอง\nออเดอร์ ${orderTag}`);
      }
    } catch (error) {
      console.error(JSON.stringify({ scope: "cron-shipping", warning: "notify failed", orderId: o.orderId, error: String(error) }));
    }
  }
  return shipped;
}
