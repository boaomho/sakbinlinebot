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

/**
 * ตัดอักขระที่ไม่ใช่ตัวเลขออก — "081-112 2334" → "0811122334"
 *
 * 🔴 ไม่เช็คจำนวนหลัก ไม่เช็คมือถือ ไม่แยก COD/โอน — "มีตัวเลข = ผ่าน" จบ
 *    เคยบังคับ 10 หลัก → เบอร์บ้าน (9 หลัก) ตกหมด · เคยบังคับมือถือกับ COD → เคสเยอะ เทสบาน
 *    โดยไม่สร้างมูลค่า เพราะแอดมินโทรถามเบอร์เอาเองได้อยู่แล้ว
 */
export function sanitizePhone(phone: string | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
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

/**
 * ชื่อผู้รับใช้ได้: ไม่ว่าง + ยาว ≥2 ตัวอักษร (รับได้ทั้งชื่อคน/ชื่อเล่น/ชื่อร้าน/บริษัท)
 * ไม่บังคับนามสกุล — ลูกค้าจริงพิมพ์ชื่อเล่นเยอะ บังคับแล้วเสียออเดอร์
 */
export function nameComplete(p: Record<string, string>): boolean {
  return (p["ชื่อ"] ?? "").trim().length >= 2;
}

/**
 * "ที่อยู่ครบ" = ช่องที่อยู่ (ก้อนดิบ) ไม่ว่าง — แค่นั้น
 *
 * 🔴 เปลี่ยนจากเดิมที่บังคับ ตำบล/อำเภอ/จังหวัด/รหัส แยกเป็นฟิลด์ ซึ่งทำออเดอร์หายเงียบ:
 * ลูกค้าพิมพ์ที่อยู่ก้อนเดียวไม่มี ต./อ./จ. นำ → AI ไม่ส่งฟิลด์แยก → complete=false ตลอดกาล
 * ทั้งที่ลูกค้าจ่ายเงินแล้ว
 *
 * การจับคู่ตำบล-อำเภอ-รหัสเป็นหน้าที่ระบบขนส่ง+แอดมิน ไม่ใช่บอท
 * จังหวัด/รหัสไปรษณีย์ = metadata ที่ AI หยิบได้ก็ใส่ ไม่ได้ก็เว้น ไม่กระทบการปิดออเดอร์
 */
export function addressComplete(p: Record<string, string>): boolean {
  return (p["ที่อยู่"] ?? "").trim() !== "";
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
  /** ครบ = เขียนลงชีตได้ + push 📦 */
  complete: boolean;
  /** แท็กรอที่ควรเป็น ณ ตอนนี้ (null = ไม่มีแท็กรอ) — ป้อน Follow engine (ยังไม่เปิด) */
  waitTag: WaitTag;
  /** อะไรขาดบ้าง (ชื่อ/ที่อยู่/เบอร์/สลิป) — บอทเอาไปขอลูกค้าเฉพาะที่ขาด · ใช้ log ด้วย */
  missing: string[];
}

/**
 * gate ออเดอร์ — โค้ดตัดสินจาก pending_order ที่มีจริงเท่านั้น ไม่พึ่ง AI signal
 *
 *   COD ปิด = ชื่อ + เบอร์(มีตัวเลข) + ที่อยู่(ก้อนไม่ว่าง)
 *   โอน ปิด = เหมือน COD + สลิป
 *   ครบ    → เขียนชีต + push 📦
 *   ไม่ครบ → ไม่เขียน ไม่แจ้งกลุ่ม · บอทขอสิ่งที่ยังขาดจากลูกค้าเอง (missing)
 *
 * 🔴 จังหวะแจ้งกลุ่ม (ผู้เรียกจัดการ · D-11): ตัด push ⚠️ ระหว่างทางออก — มันแจ้งเร็วไป
 *   (COD ยังไม่ได้ที่อยู่ก็ยิงกลุ่ม) · COD ยังไม่จ่าย บอทเก็บข้อมูลเองพอ ครบค่อย 📦
 *   โอน แอดมินรู้ตอนสลิปอยู่แล้ว (push 💰 แยก) ครบค่อย 📦 อีกรอบ
 *
 * เป็น pure function: ไม่มี I/O ไม่แตะ DB — ผู้เรียกเอาผลไปลงมือเอง
 */
export function evaluateOrderGate({ pending, slipPresent }: OrderGateInput): OrderGateResult {
  const payment = (pending["การชำระเงิน"] ?? "").trim();
  const name = nameComplete(pending);
  const addr = addressComplete(pending);
  const phone = sanitizePhone(pending["เบอร์"]) !== ""; // มีตัวเลข = ผ่าน (แอดมินตรวจเบอร์เอง)
  const base = name && addr && phone;

  const complete = (payment === "COD" && base) || (payment === "โอน" && base && slipPresent);

  // เช็คครบ 3 อย่างแยกกัน — ขาดอันไหนบอทขออันนั้น (ได้ที่อยู่แล้วยังต้องขอชื่อ+เบอร์ต่อ)
  const missing: string[] = [];
  if (!complete) {
    if (!name) missing.push("ชื่อ");
    if (!addr) missing.push("ที่อยู่");
    if (!phone) missing.push("เบอร์");
    if (payment === "โอน" && !slipPresent) missing.push("สลิป");
  }

  let waitTag: WaitTag = null;
  if (!complete) {
    if (payment === "โอน" && addr && !slipPresent) {
      waitTag = "รอโอน";
    } else if (payment === "โอน" && slipPresent && !addr) {
      waitTag = "รอที่อยู่";
    } else if (payment === "COD" && !addr) {
      waitTag = "รอที่อยู่";
    } else {
      waitTag = null; // payment ยังไม่ตัดสิน / สถานะกลาง → ไม่มีแท็กรอ
    }
  }

  return { payment, complete, waitTag, missing };
}

/** ข้อความแจ้งกลุ่มแอดมินเมื่อออเดอร์สมบูรณ์ขึ้นชีต (push จุดที่ 2) */
export function buildNewOrderAdminText(pending: Record<string, string>, payment: string, name: string): string {
  const icon = payment === "COD" ? "📦" : "💰";
  return (
    `${icon} ออเดอร์ใหม่ (${payment})\n` +
    `${formatProductAndQty(pending)}\n` +
    `${pending["ยอด"] ?? ""}\n` +
    `${pending["ชื่อ"] ?? ""} ${sanitizePhone(pending["เบอร์"])}\n` +
    `${pending["จังหวัด"] ?? ""}`
  );
}

