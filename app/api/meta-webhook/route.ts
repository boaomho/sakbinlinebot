import { NextRequest, NextResponse } from "next/server";
import { metaVerifyChallenge, processMetaWebhook } from "@/lib/channel/meta-webhook";

/**
 * Meta Messenger webhook (M-2)
 * GET  = verify (echo hub.challenge ถ้า verify_token ตรง)
 * POST = event (verify X-Hub-Signature-256 แล้วเข้า pipeline เดิม)
 */
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const challenge = metaVerifyChallenge(p.get("hub.mode"), p.get("hub.verify_token"), p.get("hub.challenge") ?? "");
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 }); // Meta ต้องการ challenge เป็น body ดิบ
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const { status } = await processMetaWebhook(rawBody, signature);
  return NextResponse.json({ status: status === 200 ? "ok" : "error" }, { status });
}
