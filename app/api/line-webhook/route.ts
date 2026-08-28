import { NextRequest, NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import { getConfig, resolveFeatureSwitches } from "@/lib/config";
import { handleEvent } from "./handler";

/**
 * route.ts บาง — เนื้อ pipeline ทั้งหมดอยู่ ./handler.ts (ย้ายเชิงกลไกตอน T-STUDIO เฟส ก:
 * Next.js ห้าม route.ts export อะไรนอกจาก HTTP handler/config → processMessage ที่ /train
 * ต้องใช้ จึง export จาก handler.ts แทน · โค้ดข้างในไม่แตะสักบรรทัด)
 */

// 🔴 D-69: 30 → 60 — timeout Gemini ขึ้นเป็น 15 วิ (debounce 6 + main 15 + regen 8 = 29)
//    Vercel Fluid compute (default) รองรับถึง 300 วิทุกแพลน · LINE reply token อายุ 1 นาที → 60 ยังปลอดภัย
//    🔴 ต้องตรงกับ WEBHOOK_MAX_DURATION_MS ใน handler.ts (การ์ด clamp อ่านค่าจากตรงนั้น)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!signature || !validateSignature(rawBody, process.env.LINE_CHANNEL_SECRET ?? "", signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body: webhook.CallbackRequest = JSON.parse(rawBody);
  const events = body.events ?? [];

  const config = await getConfig();
  const switches = resolveFeatureSwitches(config);

  await Promise.all(events.map((event) => handleEvent(event, config, switches)));

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
