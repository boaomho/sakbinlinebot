import {
  DownloadedContent,
  replyMessages,
  pushMessages,
  getProfileName,
  startLoadingIndicator,
  downloadMessageContent,
  parseReplyIntoMessages,
} from "@/lib/line";
import { sendMessengerText, sendMessengerImage, sendMessengerAction, getMessengerProfileName, downloadFromUrl } from "@/lib/channel/meta";
import type { PageContext } from "@/lib/channel/pages";

/**
 * lib/channel/transport.ts — M-1 · นามธรรมช่องทาง (ระดับเดียวกับ ShippingProvider)
 * processMessage (สมองปลาทู) คุยกับลูกค้าผ่าน interface นี้ ไม่ผูก LINE/Messenger ตรง
 * 🔴 หมายเหตุขอบเขต: interface นี้ = "ช่องทางของลูกค้า" เท่านั้น
 *    การแจ้งกลุ่มแอดมิน (pushRawText/pushRawMessages ไปกลุ่ม ops) ไม่ผ่านที่นี่ — เป็น LINE ตามเดิม
 */
export interface ChannelTransport {
  readonly channel: "line" | "messenger";
  /** ตอบข้อความถึงลูกค้า (LINE=reply token · Messenger=Send API push ด้วย PSID) · คืน true เมื่อส่งจริง */
  reply(text: string, collapseBubbles?: boolean): Promise<boolean>;
  /** push ถึงลูกค้า (fallback ของ reply / resume notice) */
  push(text: string, collapseBubbles?: boolean): Promise<boolean>;
  /** typing/loading indicator (LINE=startLoadingIndicator · Messenger=sender_action typing_on) */
  typing(seconds: number): Promise<void>;
  /** ชื่อโปรไฟล์ลูกค้า (ใช้ประกอบข้อความแจ้งแอดมิน) */
  getProfileName(): Promise<string>;
  /** โหลดรูปที่ลูกค้าส่ง (LINE=messageId · Messenger=CDN url) */
  downloadInboundImage(ref: string): Promise<DownloadedContent | null>;
}

/**
 * LINE transport — ห่อ lib/line เดิมทุกบรรทัด (พฤติกรรมไม่เปลี่ยน)
 * ALS sandbox guard ที่อยู่ใน lib/line ยังทำงานปกติ → T-STUDIO ใช้ transport นี้ได้ (redirect เข้า collector)
 */
export class LineTransport implements ChannelTransport {
  readonly channel = "line" as const;
  constructor(
    private readonly replyToken: string,
    private readonly userId: string,
  ) {}
  reply(text: string, collapseBubbles = false): Promise<boolean> {
    return replyMessages(this.replyToken, text, collapseBubbles);
  }
  push(text: string, collapseBubbles = false): Promise<boolean> {
    return pushMessages(this.userId, text, collapseBubbles);
  }
  typing(seconds: number): Promise<void> {
    return startLoadingIndicator(this.userId, seconds);
  }
  getProfileName(): Promise<string> {
    return getProfileName(this.userId);
  }
  downloadInboundImage(ref: string): Promise<DownloadedContent | null> {
    return downloadMessageContent(ref);
  }
}

/**
 * Messenger transport (M-2) — Send API ด้วย PSID (ไม่มี reply token)
 * 🔴 reuse parseReplyIntoMessages → invariant "cap 5 บอลลูน + ห้ามจบด้วยรูป" อยู่ที่เดียวกับ LINE
 */
export class MessengerTransport implements ChannelTransport {
  readonly channel = "messenger" as const;
  constructor(
    private readonly page: PageContext,
    private readonly psid: string,
  ) {}
  private async send(text: string, collapseBubbles: boolean): Promise<boolean> {
    const messages = parseReplyIntoMessages(text, collapseBubbles); // แตกบอลลูน + กฎเหล็กเดียวกับ LINE
    let ok = messages.length > 0;
    for (const m of messages) {
      const anyM = m as { type: string; text?: string; originalContentUrl?: string };
      const sent =
        anyM.type === "image" && anyM.originalContentUrl
          ? await sendMessengerImage(this.page.pageId, this.page.pageAccessToken, this.psid, anyM.originalContentUrl)
          : await sendMessengerText(this.page.pageId, this.page.pageAccessToken, this.psid, anyM.text ?? "");
      ok = ok && sent;
    }
    return ok;
  }
  reply(text: string, collapseBubbles = false): Promise<boolean> {
    return this.send(text, collapseBubbles);
  }
  push(text: string, collapseBubbles = false): Promise<boolean> {
    return this.send(text, collapseBubbles);
  }
  async typing(_seconds: number): Promise<void> {
    void _seconds; // Messenger typing ไม่มี duration → typing_on อย่างเดียว
    await sendMessengerAction(this.page.pageId, this.page.pageAccessToken, this.psid, "typing_on");
  }
  getProfileName(): Promise<string> {
    return getMessengerProfileName(this.psid, this.page.pageAccessToken);
  }
  downloadInboundImage(ref: string): Promise<DownloadedContent | null> {
    return downloadFromUrl(ref);
  }
}
