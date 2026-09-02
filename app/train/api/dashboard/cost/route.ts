import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { aiUsageDaily, aiUsageDailyCustomers, wonOrdersSince } from "@/lib/db";
import { orderAmountMap } from "@/lib/orders";
import { summarizeAiUsage, COST_APPROX_NOTE } from "@/lib/train/ai-cost";
import { bangkokDayStart, bangkokYMD } from "@/lib/core/time";

export const maxDuration = 20;

/**
 * D-70 · หน้าต้นทุนบอท (read-only · ไม่มี cron) — อ่าน `ai_usage` แล้วคำนวณเงินซ้ำจาก token
 * 🔴 จำนวน query คงที่ต่อการโหลด (ไม่ N+1): ai_usage 2 · orders_written 1 · ชีต Orders 1 (cache 60 วิ)
 * 🔴 ขอบวัน = เวลาไทย (SQL shift +7 ก่อนตัดวัน · ai_usage.at เก็บ UTC)
 */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { seriesDays?: number; day?: string };
  const seriesDays = body.seriesDays === 30 ? 30 : 7;
  const now = new Date();
  const targetDay = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : bangkokYMD(now);

  try {
    // ช่วงที่ต้องดึง = ครอบทั้งกราฟ (seriesDays) และวันที่เลือกดู (อาจเก่ากว่ากราฟ)
    const daysBack = Math.max(seriesDays, daysAgoOf(targetDay, now) + 1);
    const start = bangkokDayStart(now, daysBack - 1);
    // ออเดอร์ของ "วันที่เลือก" — แหล่งเดียวกับการ์ดยอดขาย (orders_written + ยอดในชีต · ข้ามที่ยกเลิก)
    const dayStart = bangkokDayStart(now, daysAgoOf(targetDay, now));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [rows, customerRows, won, amounts] = await Promise.all([
      aiUsageDaily(start),
      aiUsageDailyCustomers(start),
      wonOrdersSince(dayStart),
      orderAmountMap(),
    ]);

    const orders = won.filter((w) => {
      const a = amounts.get(w.orderId);
      return Boolean(a) && !a!.cancelled;
    }).length;

    const summary = summarizeAiUsage({ rows, customerRows, now, seriesDays, targetDay, orders });
    return NextResponse.json({ ...summary, seriesDays, note: COST_APPROX_NOTE, generatedAt: now.toISOString(), dayEnd: dayEnd.toISOString() });
  } catch (error) {
    console.error(JSON.stringify({ scope: "dashboard-cost", warning: "load failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "โหลดหน้าต้นทุนไม่ได้" }, { status: 500 });
  }
}

/** จำนวนวัน (ไทย) ที่ targetDay อยู่ก่อนวันนี้ — 0 = วันนี้ · ใช้กับ bangkokDayStart(now, n) */
function daysAgoOf(targetDay: string, now: Date): number {
  const today = bangkokYMD(now);
  if (targetDay >= today) return 0;
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${targetDay}T00:00:00Z`);
  const d = Math.round(ms / 86_400_000);
  return Number.isFinite(d) && d > 0 ? Math.min(d, 365) : 0;
}
