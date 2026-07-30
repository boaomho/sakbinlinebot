import { resolveAppContext, resolvePageContext, PageContext, AppContext } from "./pages";
import { MessengerTransport } from "./transport";
import { verifyMetaSignature, sendMessengerAction, downloadFromUrl } from "./meta";
import { runInboundText, runInboundImage } from "@/app/api/line-webhook/handler";
import { resolveFeatureSwitches, FeatureSwitches } from "@/lib/config";
import { setHumanMode } from "@/lib/db";

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
  const psid = m.sender?.id;
  if (!msg || !psid) return; // postback/delivery/read = เพิกเฉย (M-2)
  const userId = metaUserId(page.pageId, psid);

  // ---- echo (5.4): บอทเราส่ง → ทิ้ง (กันลูป) · แอดมิน/แอปอื่น → human_mode ----
  if (msg.is_echo) {
    const echoAppId = msg.app_id != null ? String(msg.app_id) : null;
    if (app.appId) {
      if (echoAppId === app.appId) return; // บอทเราส่งเอง → ทิ้งเสมอ
      if (switches.handoff) await setHumanMode(userId, true); // แอปอื่น/แอดมินพิมพ์ → human_mode
      console.log(JSON.stringify({ scope: "meta", event: "echo-human-agent", pageId: page.pageId }));
      return;
    }
    // 🔴 META_APP_ID ไม่ตั้ง → fallback heuristic (เตือนดังๆ ทุกครั้ง — ไม่ทำงานเงียบ)
    console.warn(JSON.stringify({ scope: "meta", warning: "META_APP_ID ไม่ตั้ง — echo filter ทำงานแบบเดา (heuristic)", hasAppId: echoAppId != null }));
    if (echoAppId != null) return; // มี app_id = สมมติบอทเรา → ทิ้ง
    if (switches.handoff) await setHumanMode(userId, true); // ไม่มี app_id = แอดมินพิมพ์ในกล่องเพจ → human_mode
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

// ---- โครง payload (บางส่วนที่ใช้) ----
interface MetaEntry {
  id?: string;
  messaging?: MetaMessaging[];
}
interface MetaMessaging {
  sender?: { id?: string };
  message?: {
    is_echo?: boolean;
    app_id?: string | number;
    text?: string;
    attachments?: { type?: string; payload?: { url?: string } }[];
  };
}
