import { getConfig } from "@/lib/config";
import type { AppConfig } from "@/lib/config";

/**
 * lib/channel/pages.ts — M-2 · จุดเดียวที่อ่าน META_* (กติกา §4.3: ห้ามอ่านนอกไฟล์นี้)
 * วันนี้ 1 เพจอ่านจาก env · อนาคตเปลี่ยน "ภายใน" resolvePageContext ให้อ่านตาราง channel_pages
 * โดยไม่แตะ webhook/transport/handler (ระดับเดียวกับ ShippingProvider)
 */

/** ระดับ "แอป" (ใช้ verify webhook · 1 แอปรับได้หลายเพจ) */
export interface AppContext {
  appSecret: string;
  verifyToken: string;
  /** app id ของเรา — ใช้แยก echo "บอทเราส่ง" vs "แอปอื่น/แอดมิน" (5.4) · null = ไม่ตั้ง (heuristic) */
  appId: string | null;
}

/** ระดับ "เพจ" (token + config ต่อเพจ) */
export interface PageContext {
  channel: "messenger";
  pageId: string;
  pageAccessToken: string;
  config: AppConfig;
}

/** อ่าน config ระดับแอป — คืน null = ฟีเจอร์ปิด (ENV ไม่ครบ · All-or-nothing) */
export function resolveAppContext(): AppContext | null {
  const appSecret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!appSecret || !verifyToken) return null;
  return { appSecret, verifyToken, appId: process.env.META_APP_ID ?? null };
}

/**
 * รายการ page_id ที่ระบบรู้จัก (D-53 · ใช้ resolve คำสั่ง "ปิดบอท fb" → key "fb:<pageId>")
 * วันนี้: env 1 เพจ · 🔴 อนาคตหลายเพจ (อ่านจากตาราง channel_pages) → "ปิดบอท fb" (ไม่ระบุเพจ)
 * ควรตอบรายชื่อเพจให้แอดมินเลือก แทนการเดา (ยังไม่ build)
 */
export function messengerPageIds(): string[] {
  const id = process.env.META_PAGE_ID;
  return id ? [id] : [];
}

/** map page_id → context · วันนี้: env 1 เพจ (pageId ไม่ตรง/ENV ขาด = null → ข้าม+log) */
export async function resolvePageContext(pageId: string): Promise<PageContext | null> {
  const envPageId = process.env.META_PAGE_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!envPageId || !token) return null;
  if (pageId !== envPageId) {
    console.warn(JSON.stringify({ scope: "meta", warning: "page_id ไม่รู้จัก (ยังไม่ได้ผูกกับระบบ)", pageId }));
    return null;
  }
  // เพจแรกใช้ config/ชีต/สินค้าชุดเดียวกับ LINE (เคาะ §5.6)
  return { channel: "messenger", pageId, pageAccessToken: token, config: await getConfig() };
}
