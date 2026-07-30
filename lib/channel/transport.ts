import {
  DownloadedContent,
  replyMessages,
  pushMessages,
  getProfileName,
  startLoadingIndicator,
  downloadMessageContent,
} from "@/lib/line";

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
