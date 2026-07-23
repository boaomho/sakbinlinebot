import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * lib/train/auth.ts — auth ง่ายๆ ของห้องซ้อม /train (ENV TRAIN_PASSWORD + cookie HMAC)
 * All-or-nothing: ENV ไม่ครบ (TRAIN_PASSWORD/DATABASE_URL_TRAIN) = ฟีเจอร์ปิดทั้งก้อน → 404 + log
 */

export const TRAIN_COOKIE = "train_auth";

export function trainEnabled(): boolean {
  const ok = Boolean(process.env.TRAIN_PASSWORD && process.env.DATABASE_URL_TRAIN);
  if (!ok) {
    console.warn(JSON.stringify({ scope: "train", warning: "ปิดฟีเจอร์ /train — ENV ไม่ครบ (TRAIN_PASSWORD/DATABASE_URL_TRAIN) · All-or-nothing" }));
  }
  return ok;
}

/** token ประจำรหัสปัจจุบัน — เปลี่ยนรหัสใน Vercel = ทุก session เก่าหลุดเอง */
function sessionToken(): string {
  return crypto.createHmac("sha256", process.env.TRAIN_PASSWORD ?? "").update("sakbin-train-session-v1").digest("hex");
}

export function checkPassword(password: string): boolean {
  const expect = Buffer.from(process.env.TRAIN_PASSWORD ?? "");
  const got = Buffer.from(password);
  return expect.length > 0 && expect.length === got.length && crypto.timingSafeEqual(expect, got);
}

export function isAuthed(req: NextRequest): boolean {
  const cookie = req.cookies.get(TRAIN_COOKIE)?.value ?? "";
  const expect = sessionToken();
  return cookie.length === expect.length && crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expect));
}

export function attachAuthCookie(res: NextResponse): NextResponse {
  res.cookies.set(TRAIN_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}

/** ครอบทุก endpoint /train/api/* — 404 เมื่อฟีเจอร์ปิด · 401 เมื่อยังไม่ล็อกอิน (ยกเว้น login เอง) */
export function guardTrainRequest(req: NextRequest, opts: { skipAuth?: boolean } = {}): NextResponse | null {
  if (!trainEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!opts.skipAuth && !isAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
