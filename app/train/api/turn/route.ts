import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { runTrainTurn } from "@/lib/train/turn";
import type { DownloadedContent } from "@/lib/line";

export const maxDuration = 30; // งบเดียวกับ webhook (Gemini จริง + extraction อยู่ใน 8s เดิม)

const SESSION_RE = /^[a-zA-Z0-9-]{8,64}$/;

export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    text?: string;
    imageBase64?: string;
    imageMime?: string;
  };
  if (!body.sessionId || !SESSION_RE.test(body.sessionId)) {
    return NextResponse.json({ error: "sessionId ไม่ถูกต้อง" }, { status: 400 });
  }

  let image: DownloadedContent | undefined;
  let text = (body.text ?? "").trim();
  if (body.imageBase64) {
    const buffer = Buffer.from(body.imageBase64, "base64");
    if (buffer.length > 5 * 1024 * 1024) return NextResponse.json({ error: "รูปใหญ่เกิน 5MB" }, { status: 400 });
    image = { buffer, contentType: body.imageMime || "image/jpeg" };
    if (!text) text = "[ลูกค้าส่งรูปมา]"; // ตรงกับ placeholder ของ handleImageMessage จริง
  }
  if (!text) return NextResponse.json({ error: "ไม่มีข้อความ" }, { status: 400 });

  try {
    const result = await runTrainTurn(body.sessionId, text, image);
    return NextResponse.json(result);
  } catch (error) {
    console.error(JSON.stringify({ scope: "train", warning: "turn failed", error: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "เทิร์นล้มเหลว — ดู log" }, { status: 500 });
  }
}
