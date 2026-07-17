/**
 * lib/core/orders.ts — โดเมนออเดอร์ล้วน (Step 0 · CONTRACTS §1)
 *
 * 🔴 ห้าม import อะไรที่เกี่ยวกับ LINE / Gemini — ต้อง reuse ได้จากทุก channel
 *    (Salepage ไม่มี pending_order ไม่มี Gemini แต่ต้องตัดสิน "ออเดอร์ครบมั้ย" ด้วยกติกาเดียวกัน
 *     ถ้า logic นี้ยังฝังใน LINE webhook handler → วันหนึ่งราคา/กติกาสองช่องทางจะไม่ตรงกันโดยไม่มีใครรู้)
 *
 * ไฟล์นี้เป็นการ "ย้าย" ของเดิมจาก app/api/line-webhook/route.ts + lib/orders.ts
 * เงื่อนไขทุกข้อยกมาเป๊ะ ไม่มีการเพิ่ม/แก้ branch หรือ state
 */

// ---- sanitizers: กัน order_data จาก AI มีคำสั่งแฝง/ข้อมูลผิดรูปแบบก่อนเขียนลงชีต ----
// (ย้ายมาจาก lib/orders.ts — pure ไม่เกี่ยวกับ I/O)

export function sanitizePhone(phone: string | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return /^\d{10}$/.test(digits) ? digits : "";
}

export function sanitizeAmount(amount: string | undefined): string {
  if (!amount) return "";
  return amount.replace(/[^\d.]/g, "");
}

export function sanitizeShortText(text: string | undefined, maxLen = 200): string {
  if (!text) return "";
  return text.replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}

// ---- โดเมนออเดอร์ ----

/** แท็ก "รอ" ที่โค้ดเป็นคนจัดการเอง (ห้ามให้ AI ใส่ผ่าน tags_add) */
export type WaitTag = "รอโอน" | "รอที่อยู่" | null;

/** ช่อง สินค้า+จำนวน ที่คนอ่าน เช่น "น้ำพริกปลาทู x3" */
export function formatProductAndQty(orderData: Record<string, string>): string {
  return [orderData["สินค้า"], orderData["จำนวน"]].filter(Boolean).join(" x");
}

/** "ที่อยู่ครบ" = ชื่อ-นามสกุล + ที่อยู่เต็ม (ที่อยู่/ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์) + เบอร์ 10 หลัก */
export function addressComplete(p: Record<string, string>): boolean {
  const has = (k: string) => (p[k] ?? "").trim() !== "";
  return (
    has("ชื่อ") &&
    has("ที่อยู่") &&
    has("ตำบล") &&
    has("อำเภอ") &&
    has("จังหวัด") &&
    has("รหัสไปรษณีย์") &&
    sanitizePhone(p["เบอร์"]) !== ""
  );
}

export interface OrderGateInput {
  /** pending_order ที่ merge สะสมแล้ว (โค้ดตัดสินจาก "ของที่มีจริง" เท่านั้น) */
  pending: Record<string, string>;
  /** มีสลิปผูกอยู่กับลูกค้ารายนี้หรือยัง (เทิร์นนี้ หรือที่จำไว้) */
  slipPresent: boolean;
}

export interface OrderGateResult {
  /** ช่องทางชำระล่าสุดที่อ่านได้จาก pending ("" = ยังไม่ตัดสิน) */
  payment: string;
  /** ครบ = เขียนลงชีตได้ (ห้ามเขียนแถวครึ่ง ๆ) */
  complete: boolean;
  /** แท็กรอที่ควรเป็น ณ ตอนนี้ (null = ไม่มีแท็กรอ) */
  waitTag: WaitTag;
  /** เคสพิเศษเดียวที่ต้องรบกวนแอดมิน: โอนแล้ว (มีสลิป) แต่ยังไม่ได้ที่อยู่ */
  paidNoAddress: boolean;
}

/**
 * gate ออเดอร์ — โค้ดตัดสินจาก pending_order ที่มีจริงเท่านั้น ไม่พึ่ง AI signal
 *   COD ครบเมื่อที่อยู่ครบ · โอน ครบเมื่อที่อยู่ครบ + มีสลิป
 *   ไม่ครบ = สภาพปกติ (ไม่เขียนชีต ไม่รบกวนแอดมิน) แค่ติดแท็กรอตามสถานะ
 * เป็น pure function: ไม่มี I/O ไม่แตะ DB — ผู้เรียกเอาผลไปลงมือเอง
 */
export function evaluateOrderGate({ pending, slipPresent }: OrderGateInput): OrderGateResult {
  const payment = (pending["การชำระเงิน"] ?? "").trim();
  const addr = addressComplete(pending);
  const complete = (payment === "COD" && addr) || (payment === "โอน" && addr && slipPresent);

  let waitTag: WaitTag = null;
  let paidNoAddress = false;

  if (!complete) {
    if (payment === "โอน" && addr && !slipPresent) {
      waitTag = "รอโอน";
    } else if (payment === "โอน" && slipPresent && !addr) {
      waitTag = "รอที่อยู่";
      paidNoAddress = true;
    } else if (payment === "COD" && !addr) {
      waitTag = "รอที่อยู่";
    } else {
      waitTag = null; // payment ยังไม่ตัดสิน / สถานะกลาง → ไม่มีแท็กรอ
    }
  }

  return { payment, complete, waitTag, paidNoAddress };
}

/** ข้อความแจ้งกลุ่มแอดมินเมื่อออเดอร์สมบูรณ์ขึ้นชีต (push จุดที่ 2) */
export function buildNewOrderAdminText(pending: Record<string, string>, payment: string, name: string): string {
  const icon = payment === "COD" ? "📦" : "💰";
  const loc = [pending["อำเภอ"], pending["จังหวัด"]].filter(Boolean).join(" ");
  return (
    `${icon} ออเดอร์ใหม่ (${payment})\n` +
    `${formatProductAndQty(pending)}\n` +
    `${pending["ยอด"] ?? ""}\n` +
    `${pending["ชื่อ"] ?? ""} ${sanitizePhone(pending["เบอร์"])}\n` +
    `${loc}`
  );
}
