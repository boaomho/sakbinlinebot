import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { runTrainCron } from "@/lib/train/turn";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string; tracking?: string; schema?: string };
  if (!body.sessionId) return NextResponse.json({ error: "sessionId ไม่ถูกต้อง" }, { status: 400 });
  const tracking = typeof body.tracking === "string" ? body.tracking.trim().slice(0, 60) : undefined;
  const schema = body.schema === "v3" ? "v3" : body.schema === "v2" ? "v2" : undefined; // D-61.C

  try {
    const result = await runTrainCron(body.sessionId, { tracking: tracking || undefined, schema });
    return NextResponse.json(result);
  } catch (error) {
    console.error(JSON.stringify({ scope: "train", warning: "cron-sim failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "cron จำลองล้มเหลว — ดู log" }, { status: 500 });
  }
}
