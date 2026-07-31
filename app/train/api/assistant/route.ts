import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { runTrainAssistant, type AssistantMessage } from "@/lib/train/assistant";
import { buildAssistantKB } from "@/lib/train/assistant-kb";

export const maxDuration = 30;

/**
 * D-59 จ-1 · ผู้ช่วยเทรน — call Gemini แยก (ไม่ปน prompt ขาย) · คืน reply + proposals
 * 🔴 ไม่เขียนชีตที่นี่ — proposal ไปเขียนผ่าน /train/api/write เดิม (lint gate สุดท้าย · origin=ai)
 */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; excludeKeys?: unknown };
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: AssistantMessage[] = raw
    .filter((m): m is AssistantMessage => Boolean(m) && typeof m === "object" && typeof (m as AssistantMessage).text === "string")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.text.slice(0, 4000) }));
  if (messages.length === 0) return NextResponse.json({ error: "ต้องมีข้อความ" }, { status: 400 });
  const excludeKeys = Array.isArray(body.excludeKeys) ? body.excludeKeys.filter((k): k is string => typeof k === "string").slice(0, 200) : [];

  try {
    const kb = await buildAssistantKB();
    const result = await runTrainAssistant(messages, kb, excludeKeys);
    return NextResponse.json(result);
  } catch (error) {
    console.error(JSON.stringify({ scope: "train-assistant", warning: "route failed", error: String(error).slice(0, 160) }));
    return NextResponse.json({ error: "ผู้ช่วยขัดข้อง" }, { status: 500 });
  }
}
