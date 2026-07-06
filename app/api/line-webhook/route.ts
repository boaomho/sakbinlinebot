import { NextRequest, NextResponse } from "next/server";
import { validateSignature, messagingApi, webhook } from "@line/bot-sdk";
import { getFaqCsv } from "@/lib/sheet";
import { askPlatoo, DEFAULT_REPLY } from "@/lib/gemini";

export const maxDuration = 30;

const GEMINI_TIMEOUT_MS = 8_000;

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
});

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function buildReplyText(userText: string): Promise<string> {
  try {
    const faqCsv = await getFaqCsv();
    return await withTimeout(askPlatoo(faqCsv, userText), GEMINI_TIMEOUT_MS, DEFAULT_REPLY);
  } catch (error) {
    console.error("[line-webhook] failed to build reply", error);
    return DEFAULT_REPLY;
  }
}

async function handleEvent(event: webhook.Event): Promise<void> {
  if (event.type !== "message" || event.message.type !== "text") {
    return;
  }

  const replyToken = event.replyToken;
  if (!replyToken) {
    return;
  }

  const replyText = await buildReplyText(event.message.text);

  try {
    await lineClient.replyMessage({
      replyToken,
      messages: [{ type: "text", text: replyText }],
    });
  } catch (error) {
    console.error("[line-webhook] failed to reply to LINE", error);
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!signature || !validateSignature(rawBody, process.env.LINE_CHANNEL_SECRET ?? "", signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body: webhook.CallbackRequest = JSON.parse(rawBody);
  const events = body.events ?? [];

  await Promise.all(events.map(handleEvent));

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
