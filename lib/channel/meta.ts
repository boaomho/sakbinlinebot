import crypto from "node:crypto";
import type { DownloadedContent } from "@/lib/line";

/**
 * lib/channel/meta.ts — M-2 · Messenger Send API client + verify ลายเซ็น (ระดับล่าง · ไม่รู้จัก pipeline)
 * 🔴 verify version/rate limit จริงที่ App Dashboard ตอนใช้จริง (research 2026-07 เห็น v25.0)
 */
const GRAPH = "https://graph.facebook.com";
const GRAPH_VERSION = "v21.0"; // long-lived · bump ได้เมื่อ Meta sunset

/** verify X-Hub-Signature-256 = HMAC-SHA256(app_secret, rawBody) · timing-safe */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function graphPost(pageId: string, token: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/${GRAPH_VERSION}/${pageId}/messages?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error(JSON.stringify({ scope: "meta", warning: "Send API ล้ม", status: res.status, body: t.slice(0, 200) }));
      return false;
    }
    return true;
  } catch (error) {
    console.error(JSON.stringify({ scope: "meta", warning: "Send API error", error: String(error).slice(0, 120) }));
    return false;
  }
}

export function sendMessengerText(pageId: string, token: string, psid: string, text: string): Promise<boolean> {
  return graphPost(pageId, token, { recipient: { id: psid }, messaging_type: "RESPONSE", message: { text } });
}

export function sendMessengerImage(pageId: string, token: string, psid: string, url: string): Promise<boolean> {
  return graphPost(pageId, token, {
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: { attachment: { type: "image", payload: { url, is_reusable: true } } },
  });
}

/** sender_action: typing_on | typing_off | mark_seen */
export function sendMessengerAction(pageId: string, token: string, psid: string, action: string): Promise<boolean> {
  return graphPost(pageId, token, { recipient: { id: psid }, sender_action: action });
}

/** ชื่อโปรไฟล์ลูกค้า (Graph /{psid}?fields=name) · ล้ม = "" */
export async function getMessengerProfileName(psid: string, token: string): Promise<string> {
  try {
    const res = await fetch(`${GRAPH}/${GRAPH_VERSION}/${encodeURIComponent(psid)}?fields=name&access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return "";
    const data = (await res.json()) as { name?: string };
    return String(data.name ?? "");
  } catch {
    return "";
  }
}

/** โหลดรูปจาก CDN url (webhook ให้ url ชั่วคราว) → buffer + contentType */
export async function downloadFromUrl(url: string): Promise<DownloadedContent | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  } catch {
    return null;
  }
}
