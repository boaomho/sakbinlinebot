import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { runTrainPreview } from "@/lib/train/turn";

export const maxDuration = 20;

const SESSION_RE = /^[a-zA-Z0-9-]{8,64}$/;

export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    tab?: string;
    key?: string;
    draft?: Record<string, string>;
  };
  if (!body.sessionId || !SESSION_RE.test(body.sessionId)) return NextResponse.json({ error: "sessionId ไม่ถูกต้อง" }, { status: 400 });
  if (!body.tab || !body.key) return NextResponse.json({ error: "ต้องมี tab + key" }, { status: 400 });

  try {
    const result = await runTrainPreview(body.sessionId, body.tab, body.key, body.draft ?? {});
    return NextResponse.json(result);
  } catch (error) {
    console.error(JSON.stringify({ scope: "train", warning: "preview failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "preview ล้มเหลว" }, { status: 500 });
  }
}
