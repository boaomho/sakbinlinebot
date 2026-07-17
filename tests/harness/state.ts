import type { messagingApi } from "@line/bot-sdk";
import type { GeminiTurnOutput, PaymentMethod, ImageIntent } from "@/lib/gemini";
import type { NewOrderInput } from "@/lib/orders";

/**
 * state กลางของ harness — mock factory (ที่ถูก hoist) import ไฟล์นี้เข้าไปใช้
 * ทุกอย่างเป็น module-level เพื่อให้ทั้ง mock และ assertion มองเห็นก้อนเดียวกัน
 */

export interface SentMessage {
  to: string;
  messages: messagingApi.Message[];
}

/** ทุกอย่างที่ "ยิงออก LINE" — lib/line ของจริงทำงานเต็ม (mock แค่ SDK client ชั้นล่างสุด) */
export const lineCalls = {
  replies: [] as SentMessage[],
  pushes: [] as SentMessage[],
  loadingIndicators: [] as string[],
};

/** แถวที่ "เขียนลงชีต Orders" (mock appendOrderRow) */
export const orderRows: NewOrderInput[] = [];

/** สลิปที่อัปโหลด (mock lib/blob) */
export const blobState = {
  uploaded: [] as string[],
  seq: 0,
};

/** ชื่อโปรไฟล์ LINE ที่ fake client จะคืน */
export const LINE_DISPLAY_NAME = "คุณทดสอบ";

/** สคริปต์คำตอบ Gemini ต่อเทิร์น — harness เทสโค้ดเรา ไม่ใช่ LLM */
export const geminiState = {
  script: [] as GeminiTurnOutput[],
  cursor: 0,
  /** เทิร์นที่ script หมด = ใช้ตัวนี้ (กันเทสพังเงียบ ๆ) */
  overflowCalls: 0,
};

/** ค่า default ของ GeminiTurnOutput — scenario ระบุเฉพาะ field ที่สนใจ */
export function turn(partial: Partial<GeminiTurnOutput> = {}): GeminiTurnOutput {
  return {
    reply: "รับทราบค่ะ",
    stage: "2",
    tagsAdd: [],
    handoff: false,
    handoffReason: "",
    orderData: {},
    paymentMethod: "" as PaymentMethod,
    orderEditRequest: false,
    imageIntent: "other" as ImageIntent,
    imageNote: "",
    degraded: false,
    ...partial,
  };
}

export function scriptGemini(turns: GeminiTurnOutput[]): void {
  geminiState.script = turns;
  geminiState.cursor = 0;
  geminiState.overflowCalls = 0;
}

export function resetState(): void {
  lineCalls.replies.length = 0;
  lineCalls.pushes.length = 0;
  lineCalls.loadingIndicators.length = 0;
  orderRows.length = 0;
  blobState.uploaded.length = 0;
  blobState.seq = 0;
  geminiState.script = [];
  geminiState.cursor = 0;
  geminiState.overflowCalls = 0;
}

/** ข้อความทั้งหมดที่ส่งถึงลูกค้า (reply + push หาลูกค้า) เรียงตามลำดับจริง */
export function customerMessages(userId: string): messagingApi.Message[][] {
  const out: messagingApi.Message[][] = [];
  for (const r of lineCalls.replies) out.push(r.messages);
  for (const p of lineCalls.pushes) {
    if (p.to === userId) out.push(p.messages);
  }
  return out;
}

/** ข้อความที่ push เข้ากลุ่มแอดมิน */
export function adminPushes(): SentMessage[] {
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  return lineCalls.pushes.filter((p) => p.to === adminGroupId);
}
