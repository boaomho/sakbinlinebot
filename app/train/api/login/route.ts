import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest, checkPassword, attachAuthCookie } from "@/lib/train/auth";

export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req, { skipAuth: true });
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (!checkPassword(body.password ?? "")) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 401 });
  }
  return attachAuthCookie(NextResponse.json({ ok: true }));
}
