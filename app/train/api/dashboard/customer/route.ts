import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { getCustomer, getRecentHistory } from "@/lib/db";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { funnelStageOf } from "@/lib/agent/inject";
import { buildProductNameMap } from "@/lib/core/pricing";
import { channelOf, deriveStatus, formatOrderSummary } from "@/lib/train/dashboard";

export const maxDuration = 20;

/** T2-ก · หน้าลูกค้า (read-only) — ประวัติแชท + สถานะ + ออเดอร์ (format คนอ่าน · JSON ดิบซ่อน collapse) */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const { userId } = (await req.json().catch(() => ({}))) as { userId?: string };
  if (!userId) return NextResponse.json({ error: "ต้องมี userId" }, { status: 400 });

  try {
    const customer = await getCustomer(userId);
    if (!customer) return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });

    const [messages, lib] = await Promise.all([getRecentHistory(userId, 200), loadBotLibrary()]);
    const nameMap = buildProductNameMap(lib?.Products ?? []);
    const funnelStage = customer.stage ? funnelStageOf(lib?.Steps ?? [], customer.stage) : null;

    return NextResponse.json({
      userId,
      channel: channelOf(userId),
      displayName: customer.displayName,
      stage: customer.stage,
      funnelStage,
      humanMode: customer.humanMode,
      deliveredSteps: customer.deliveredSteps,
      lastSeen: customer.lastSeen,
      status: deriveStatus({ hasOrder: Boolean(customer.lastOrder || customer.lastOrderId), humanMode: customer.humanMode, funnelStage, lastSeen: customer.lastSeen, now: new Date() }),
      pendingSummary: formatOrderSummary(customer.pendingOrder as Record<string, unknown>, nameMap),
      lastOrderSummary: formatOrderSummary(customer.lastOrder as Record<string, unknown> | null, nameMap),
      pendingRaw: customer.pendingOrder,
      lastOrderRaw: customer.lastOrder,
      messages: messages.map((m) => ({ role: m.role, text: m.text, at: m.createdAt })),
    });
  } catch (error) {
    console.error(JSON.stringify({ scope: "dashboard", warning: "customer detail failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "โหลดข้อมูลลูกค้าไม่ได้" }, { status: 500 });
  }
}
