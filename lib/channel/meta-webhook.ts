import { resolveAppContext, resolvePageContext, PageContext, AppContext } from "./pages";
import { MessengerTransport } from "./transport";
import { verifyMetaSignature, sendMessengerAction, downloadFromUrl, BOT_ECHO_MARK } from "./meta";
import { runInboundText, runInboundImage } from "@/app/api/line-webhook/handler";
import { resolveFeatureSwitches, FeatureSwitches } from "@/lib/config";
import { setHumanMode, isChannelEnabled } from "@/lib/db";

/**
 * lib/channel/meta-webhook.ts — M-2 · แปลง Messenger event → pipeline เดิม
 * customer id = fb:<pageId>:<psid> (ทะเบียน id: raw U=line · fb:=messenger · TRAIN:=sandbox)
 */
export function metaUserId(pageId: string, psid: string): string {
  return `fb:${pageId}:${psid}`;
}

/** GET verify — คืน challenge ถ้า token ตรง · null = ปฏิเสธ (403) */
export function metaVerifyChallenge(mode: string | null, token: string | null, challenge: string): string | null {
  const app = resolveAppContext();
  if (!app) return null;
  return mode === "subscribe" && token === app.verifyToken ? challenge : null;
}

/** POST — verify ลายเซ็น + แปลง event · คืน HTTP status */
export async function processMetaWebhook(rawBody: string, signature: string | null): Promise<{ status: number }> {
  const app = resolveAppContext();
  if (!app) return { status: 404 }; // ฟีเจอร์ปิด (ENV ไม่ครบ)
  if (!verifyMetaSignature(rawBody, signature, app.appSecret)) return { status: 401 };

  let body: { object?: string; entry?: MetaEntry[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400 };
  }
  if (body.object !== "page") return { status: 200 };

  for (const entry of body.entry ?? []) {
    const pageId = String(entry.id ?? "");
    const page = await resolvePageContext(pageId); // 🔴 page_id ชัดทุก event
    if (!page) continue; // เพจไม่รู้จัก (resolver log แล้ว)
    const switches = resolveFeatureSwitches(page.config);
    if (!switches.salesCore) continue;
    for (const m of entry.messaging ?? []) {
      await handleMetaMessaging(m, page, switches, app);
    }
  }
  return { status: 200 };
}

async function handleMetaMessaging(m: MetaMessaging, page: PageContext, switches: FeatureSwitches, app: AppContext): Promise<void> {
  const msg = m.message;
  if (!msg) return; // postback/delivery/read = เพิกเฉย (M-2)

  // ---- echo (5.4 · D-76): บอทเราส่ง → ทิ้ง (กันลูป) · แอดมินพิมพ์มือ/แอปอื่น → human_mode (เทียบเท่า LINE) ----
  if (msg.is_echo) {
    // 🔴 D-76 บั๊กที่ทำให้ฟีเจอร์นี้ตายเงียบมาตั้งแต่ M-2:
    //    echo event ของ Meta กลับด้าน — sender = **เพจ** · recipient = **ลูกค้า (PSID)**
    //    โค้ดเดิมอ่าน psid จาก sender → ได้ pageId → setHumanMode ลง "fb:<pageId>:<pageId>"
    //    = ลูกค้าตัวจริงไม่เคยถูกปิดบอทเลย (เทสเดิมผ่านเพราะ fixture ใส่ sender=PSID ซึ่งไม่ใช่ของจริง)
    const echoPsid = m.recipient?.id;
    if (!echoPsid) return;
    const echoUserId = metaUserId(page.pageId, echoPsid);
    if (isOwnEcho(msg, app)) return; // บอทเราส่งเอง → ทิ้งเสมอ (ไม่ปิดบอทตัวเอง)
    if (switches.handoff) await setHumanMode(echoUserId, true);
    console.log(JSON.stringify({
      scope: "meta", event: "echo-human-agent", pageId: page.pageId,
      by: msg.app_id != null ? "other-app" : "page-inbox", // แอปอื่น vs แอดมินพิมพ์ในกล่องเพจ
    }));
    return;
  }

  const psid = m.sender?.id;
  if (!psid) return;
  const userId = metaUserId(page.pageId, psid);

  // D-53: ช่อง fb:<pageId> ถูกปิด → เงียบ (log)
  if (switches.memory && !(await isChannelEnabled(`fb:${page.pageId}`))) {
    console.log(JSON.stringify({ scope: "channel-switch", channel: `fb:${page.pageId}`, event: "inbound-silenced" }));
    return;
  }

  const transport = new MessengerTransport(page, psid);

  if (typeof msg.text === "string" && msg.text.trim()) {
    await runInboundText(
      userId,
      msg.text,
      page.config,
      switches,
      () => transport,
      async () => {
        await sendMessengerAction(page.pageId, page.pageAccessToken, psid, "typing_on");
      },
      null,
    );
    return;
  }

  const imageUrl = (msg.attachments ?? []).find((a) => a.type === "image" && a.payload?.url)?.payload?.url;
  if (imageUrl) {
    const content = await downloadFromUrl(imageUrl);
    await runInboundImage(userId, content, page.config, switches, transport);
  }
}

/**
 * 🔴 D-76: echo นี้ "บอทเราส่งเอง" ไหม — 3 ชั้น เรียงจากแน่นอนที่สุด
 *  1. `metadata === BOT_ECHO_MARK` — ลายเซ็นที่เราแปะเองตอนส่ง (Send API คืนกลับใน echo) = **แน่นอน 100%**
 *  2. `app_id === META_APP_ID` — แน่นอนเมื่อ ENV ตั้งไว้ (ครอบข้อความที่ส่งก่อน deploy นี้ ซึ่งยังไม่มี metadata)
 *  3. ไม่มีทั้งคู่ → **ถือว่าไม่ใช่ของเรา** (= แอดมินพิมพ์ → ปิดบอท) · ทิศปลอดภัย: บอทเงียบเกิน
 *     ดีกว่าพิมพ์ชนแอดมินกลางแชท · log ไว้ให้เห็นว่าตัดสินด้วยชั้นไหน
 */
function isOwnEcho(msg: NonNullable<MetaMessaging["message"]>, app: AppContext): boolean {
  if (msg.metadata === BOT_ECHO_MARK) return true; // ชั้น 1
  if (app.appId && msg.app_id != null && String(msg.app_id) === app.appId) return true; // ชั้น 2
  if (!app.appId) {
    console.warn(JSON.stringify({ scope: "meta", warning: "META_APP_ID ไม่ตั้ง — echo แยกด้วย metadata อย่างเดียว (ข้อความที่ส่งก่อน D-76 จะถูกนับเป็นแอดมิน)", hasAppId: msg.app_id != null }));
  }
  return false;
}

// ---- โครง payload (บางส่วนที่ใช้) ----
interface MetaEntry {
  id?: string;
  messaging?: MetaMessaging[];
}
interface MetaMessaging {
  sender?: { id?: string };
  /** 🔴 echo: sender = เพจ · recipient = ลูกค้า (PSID) — กลับด้านจาก event ปกติ */
  recipient?: { id?: string };
  message?: {
    is_echo?: boolean;
    app_id?: string | number;
    /** ลายเซ็นที่เราแปะตอนส่ง (BOT_ECHO_MARK) — Send API คืนกลับมาใน echo */
    metadata?: string;
    text?: string;
    attachments?: { type?: string; payload?: { url?: string } }[];
  };
}
