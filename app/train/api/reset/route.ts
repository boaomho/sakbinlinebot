import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { runTrainReset } from "@/lib/train/turn";

export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!body.sessionId) return NextResponse.json({ error: "sessionId ไม่ถูกต้อง" }, { status: 400 });

  await runTrainReset(body.sessionId);
  return NextResponse.json({ ok: true });
}
