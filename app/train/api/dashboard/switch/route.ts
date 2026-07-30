import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { getConfig } from "@/lib/config";
import { applyChannelSwitch, applyCustomerBotMode, channelKeys } from "@/lib/train/bot-switch";

export const maxDuration = 20;

/**
 * T2-ข · Dashboard — เปิด/ปิดบอท (รายช่องทาง / รายคน)
 * 🔴 เขียน PROD Neon นอก sandbox · reuse setChannelEnabled / setHumanMode เดิม (ไม่มี SQL ใหม่)
 * แจ้งกลุ่มแอดมินข้อความเดียวกับคำสั่งพิมพ์ + ต่อท้าย (จาก Dashboard) · สถานะอยู่ Neon ที่เดียว
 */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    target?: "channel" | "customer";
    key?: string; // channel: "line" | "fb:<pageId>"
    userId?: string; // customer
    enabled?: boolean; // channel: true=เปิด
    close?: boolean; // customer: true=ปิดบอท (human_mode)
  };

  try {
    if (body.target === "channel") {
      if (!body.key || !channelKeys().includes(body.key)) {
        return NextResponse.json({ error: "channel key ไม่ถูกต้อง" }, { status: 400 });
      }
      const enabled = Boolean(body.enabled);
      const { statusLine, notified } = await applyChannelSwitch(body.key, enabled);
      return NextResponse.json({ ok: true, target: "channel", key: body.key, enabled, statusLine, notified });
    }

    if (body.target === "customer") {
      if (!body.userId) return NextResponse.json({ error: "ต้องมี userId" }, { status: 400 });
      const close = Boolean(body.close);
      const config = await getConfig();
      const { humanMode, name, notified } = await applyCustomerBotMode(body.userId, close, config.adminSilenceReturnMinutes);
      return NextResponse.json({ ok: true, target: "customer", userId: body.userId, humanMode, name, notified });
    }

    return NextResponse.json({ error: "target ต้องเป็น channel หรือ customer" }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ scope: "dashboard-switch", warning: "switch failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "สั่งเปิด/ปิดบอทไม่ได้" }, { status: 500 });
  }
}
