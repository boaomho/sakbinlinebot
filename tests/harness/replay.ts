import crypto from "node:crypto";
import { POST } from "@/app/api/line-webhook/route";
import type { NextRequest } from "next/server";

/**
 * replay บทสนทนาเข้า handler จริง — ยิงเข้า POST() ของ route โดยตรง
 * คำนวณ x-line-signature ด้วย HMAC จริง เพื่อเดินผ่าน validateSignature() ของ @line/bot-sdk
 * (ไม่ mock ตัว verify → พาธ auth ถูกเทสไปด้วย)
 */

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}-${Date.now()}`;
}

function sign(body: string): string {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) throw new Error("LINE_CHANNEL_SECRET ไม่ได้ตั้งใน .env.test");
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

function post(body: string): Promise<Response> {
  const req = new Request("https://harness.invalid/api/line-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": sign(body) },
    body,
  });
  return POST(req as unknown as NextRequest) as unknown as Promise<Response>;
}

interface EventSourceUser {
  type: "user";
  userId: string;
}
interface EventSourceGroup {
  type: "group";
  groupId: string;
  userId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function envelope(source: EventSourceUser | EventSourceGroup, message: any, replyToken: string) {
  return JSON.stringify({
    destination: "Uharnessdestination",
    events: [
      {
        type: "message",
        mode: "active",
        timestamp: Date.now(),
        source,
        webhookEventId: nextId("evt"),
        deliveryContext: { isRedelivery: false },
        replyToken,
        message,
      },
    ],
  });
}

/** ลูกค้าพิมพ์ข้อความ 1 ข้อความ (เดินผ่าน debounce ของจริง) */
export function sendText(userId: string, text: string): Promise<Response> {
  return post(
    envelope({ type: "user", userId }, { type: "text", id: nextId("msg"), text }, nextId("rt")),
  );
}

/** ลูกค้าส่งรูป 1 รูป (image event แยกจาก text — ไม่มี caption ตาม LINE API) */
export function sendImage(userId: string): Promise<Response> {
  return post(
    envelope(
      { type: "user", userId },
      { type: "image", id: nextId("img"), contentProvider: { type: "line" } },
      nextId("rt"),
    ),
  );
}

/** แอดมินพิมพ์ในกลุ่ม ADMIN_GROUP_ID */
export function sendAdminGroupText(text: string): Promise<Response> {
  const groupId = process.env.ADMIN_GROUP_ID!;
  return post(
    envelope(
      { type: "group", groupId, userId: "Uadminuser" },
      { type: "text", id: nextId("msg"), text },
      nextId("rt"),
    ),
  );
}
