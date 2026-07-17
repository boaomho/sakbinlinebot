import type { messagingApi } from "@line/bot-sdk";
import type { GeminiTurnOutput, PaymentMethod, ImageIntent } from "@/lib/gemini";

/**
 * state กลางของ harness — mock factory (ที่ถูก hoist) import ไฟล์นี้เข้าไปใช้
 * ทุกอย่างเป็น module-level เพื่อให้ทั้ง mock และ assertion มองเห็นก้อนเดียวกัน
 *
 * 🔴 ไฟล์นี้ห้าม import @/lib/orders (หรืออะไรที่ import googleapis) เด็ดขาด
 *    เพราะ mock factory ของ googleapis import ไฟล์นี้ → จะเกิด circular dependency
 *    แล้วเทสค้างแบบไม่มี error (เคยโดนมาแล้ว) · helper ที่ต้องใช้ ORDERS_HEADER อยู่ที่ ./sheet.ts
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

/**
 * ทุก call ที่ยิงเข้า Google Sheets API — mock ที่ชั้น googleapis (ชั้นล่างสุด)
 * ไม่ใช่ที่ lib/orders → appendOrderRow ตัวจริงทำงานเต็ม (sanitize + จัดคอลัมน์ A–P)
 * 🔴 สำคัญ: ถ้า mock lib/orders จะมองไม่เห็น "ค่าลงผิดช่อง" ซึ่งคือบั๊กที่แพงที่สุดของระบบนี้
 */
export const sheetsCalls = {
  appends: [] as { range: string; values: string[][] }[],
  batchUpdates: [] as { range: string; values: string[][] }[],
  /** ค่าที่จะให้ values.get คืน (สำหรับ cron ออเดอร์) */
  getReturn: [] as string[][],
};

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
  sheetsCalls.appends.length = 0;
  sheetsCalls.batchUpdates.length = 0;
  sheetsCalls.getReturn.length = 0;
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
