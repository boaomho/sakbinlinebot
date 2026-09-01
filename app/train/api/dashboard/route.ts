import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { dashboardSummaryCounts, dashboardCustomerRows, wonOrdersSince } from "@/lib/db";
import { orderAmountMap } from "@/lib/orders";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { funnelStageOf } from "@/lib/agent/inject";
import { channelOf, deriveStatus } from "@/lib/train/dashboard";
import { listChannelStates } from "@/lib/train/bot-switch";
import { bangkokDayStart } from "@/lib/core/time";

export const maxDuration = 20;

/**
 * T2-ก · Dashboard (ร้านจริง · อ่าน PROD Neon อย่างเดียว) — summary + ตารางลูกค้า
 * 🔴 รันนอก sandbox → getSql()=DATABASE_URL (prod) · แยกจากห้องซ้อม (train DB) โดยธรรมชาติ
 */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { range?: "today" | "7d"; includeTrain?: boolean };
  const now = new Date();
  const start = bangkokDayStart(now, body.range === "7d" ? 6 : 0);
  const includeTrain = Boolean(body.includeTrain);

  try {
    const lib = await loadBotLibrary(); // funnel map + (ถ้า null → funnelStage=null, status ยังทำงาน)
    const stepRows = lib?.Steps ?? [];

    const [counts, won, amounts, rows, channels] = await Promise.all([
      dashboardSummaryCounts(start),
      wonOrdersSince(start),
      orderAmountMap(),
      dashboardCustomerRows(includeTrain),
      listChannelStates(),
    ]);

    // ยอดขายแยกช่อง: won (Neon range+channel) join ยอด (ชีต) — ข้ามที่ยกเลิก/หายอดไม่เจอ
    const sales = { lineTotal: 0, lineCount: 0, fbTotal: 0, fbCount: 0 };
    for (const w of won) {
      const a = amounts.get(w.orderId);
      if (!a || a.cancelled) continue;
      const ch = channelOf(w.userId);
      if (ch === "fb") { sales.fbTotal += a.total; sales.fbCount++; }
      else if (ch === "line") { sales.lineTotal += a.total; sales.lineCount++; }
    }

    const customers = rows.map((r) => {
      const funnelStage = r.stage ? funnelStageOf(stepRows, r.stage) : null;
      return {
        userId: r.userId,
        channel: channelOf(r.userId),
        displayName: r.displayName,
        stage: r.stage,
        funnelStage,
        lastSeen: r.lastSeen,
        turns: r.turns,
        humanMode: r.humanMode,
        status: deriveStatus({ hasOrder: r.hasOrder, humanMode: r.humanMode, funnelStage, lastSeen: r.lastSeen, now }),
      };
    });

    return NextResponse.json({ range: body.range ?? "today", counts, sales, customers, channels, generatedAt: now.toISOString(), capped: rows.length >= 300 });
  } catch (error) {
    console.error(JSON.stringify({ scope: "dashboard", warning: "load failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "โหลด dashboard ไม่ได้" }, { status: 500 });
  }
}
