import { NextRequest, NextResponse } from "next/server";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { validateStepFunnelStages, VALID_FUNNEL_STAGES } from "@/lib/agent/inject";

/**
 * Step 6 · ตัวเช็ค typo funnel_stage แบบ instant (เจ้าของยิงหลังแก้ชีต ไม่ต้องรอ cache/ลูกค้า)
 * 🔴 read-only: แค่โหลดชีต → validate → คืนแถวผิด (JSON) · ไม่แตะ state ไม่เขียน · auth CRON_SECRET
 */
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const lib = await loadBotLibrary();
  if (!lib) {
    return NextResponse.json({ status: "error", reason: "โหลด BotLibrary ไม่ได้ (SHEET_BOTLIB_ID?)" }, { status: 200 });
  }

  const bad = validateStepFunnelStages(lib.CSV_Step);
  return NextResponse.json(
    { status: bad.length === 0 ? "ok" : "invalid", badCount: bad.length, bad, allowed: VALID_FUNNEL_STAGES },
    { status: 200 },
  );
}
