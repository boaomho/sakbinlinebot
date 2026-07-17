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
 * ตัดอักขระที่ไม่ใช่ตัวเลขออก แล้วรับเฉพาะความยาวที่เป็นเบอร์ไทยจริง
 *   มือถือ = 10 หลัก (06/08/09) · เบอร์บ้าน/ออฟฟิศ = 9 หลัก (เช่น 02 + 7 ตัว)
 * "081-112 2334" → "0811122334" · "02-1234567" → "021234567"
 *
 * 🔴 เดิมบังคับ 10 หลักเป๊ะ → เบอร์บ้านทุกเบอร์ในประเทศตกหมด (9 หลักเสมอ)
 *    ทำให้ลูกค้าที่โอนเงินมาแล้วปิดออเดอร์ไม่ได้
 */
export function sanitizePhone(phone: string | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return /^\d{9,10}$/.test(digits) ? digits : "";
}

export function sanitizeAmount(amount: string | undefined): string {
  if (!amount) return "";
  return amount.replace(/[^\d.]/g, "");
}

export function sanitizeShortText(text: string | undefined, maxLen = 200): string {
  if (!text) return "";
  return text.replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}

/**
 * เบอร์มือถือไทย: 10 หลัก ขึ้นต้น 06/08/09
 * ใช้เฉพาะ COD (ต้องโทรหาลูกค้าตอนส่งของ) · โอนไม่บังคับ (เบอร์บ้าน/ออฟฟิศผ่าน)
 */
export function isMobilePhone(phone: string | undefined): boolean {
  const digits = sanitizePhone(phone);
  return digits.length === 10 && /^0[689]/.test(digits);
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
  /** แท็กรอที่ควรเป็น ณ ตอนนี้ (null = ไม่มีแท็กรอ) */
  waitTag: WaitTag;
  /**
   * ไม่ครบ แต่ลูกค้า "สั่งแล้ว" (เลือกวิธีจ่ายแล้ว) → push แจ้งแอดมิน ⚠️ ให้ตามเก็บ
   * 🔴 คนที่มาถึงขั้นนี้ = จ่ายแล้ว(โอน)/ตกลงแล้ว(COD) — ห้ามเงียบเด็ดขาด
   */
  incompleteWithIntent: boolean;
  /**
   * COD + เบอร์ไม่ใช่มือถือ = เงื่อนไขเดียวที่ block COD
   * บอทถามขอเบอร์มือถือเอง → ยังไม่ปิด และ "ยังไม่ push" (บอทกำลังจัดการอยู่ ไม่ต้องกวนแอดมิน)
   */
  codPhoneBlocked: boolean;
  /** อะไรขาดบ้าง — เอาไปประกอบข้อความ push ⚠️ ให้แอดมินรู้ว่าต้องตามอะไร */
  missing: string[];
}

/**
 * gate ออเดอร์ 2 ระดับ — โค้ดตัดสินจาก pending_order ที่มีจริงเท่านั้น ไม่พึ่ง AI signal
 *
 *   COD ปิด = ชื่อ + เบอร์มือถือ 10 หลัก + ที่อยู่(ก้อนไม่ว่าง)
 *   โอน ปิด = ชื่อ + เบอร์ 10 หลัก + ที่อยู่(ก้อนไม่ว่าง) + สลิป
 *   ครบ           → เขียนชีต + push 📦
 *   ไม่ครบ+สั่งแล้ว → push ⚠️ อย่างเดียว (ยังไม่เขียนแถว — ยังไม่มี order_id ให้เติมทีหลังจน Step 2)
 *   ยังไม่สั่ง      → เงียบได้ (ยังไม่ใช่ลูกค้าที่จ่ายเงิน)
 *
 * เป็น pure function: ไม่มี I/O ไม่แตะ DB — ผู้เรียกเอาผลไปลงมือเอง
 */
export function evaluateOrderGate({ pending, slipPresent }: OrderGateInput): OrderGateResult {
  const payment = (pending["การชำระเงิน"] ?? "").trim();
  const name = nameComplete(pending);
  const addr = addressComplete(pending);
  const phone10 = sanitizePhone(pending["เบอร์"]) !== "";
  const mobile = isMobilePhone(pending["เบอร์"]);

  const complete =
    (payment === "COD" && name && addr && mobile) ||
    (payment === "โอน" && name && addr && phone10 && slipPresent);

  const hasIntent = payment !== ""; // เลือกวิธีจ่ายแล้ว = สั่งแล้ว
  const codPhoneBlocked = !complete && payment === "COD" && !mobile;

  const missing: string[] = [];
  if (!complete) {
    if (!name) missing.push("ชื่อ");
    if (!addr) missing.push("ที่อยู่");
    if (payment === "COD" && !mobile) missing.push("เบอร์มือถือ");
    else if (payment === "โอน" && !phone10) missing.push("เบอร์");
    if (payment === "โอน" && !slipPresent) missing.push("สลิป");
  }

  // ไม่ครบ + สั่งแล้ว → กวนแอดมิน ยกเว้นเคส COD เบอร์ไม่ใช่มือถือ (บอทถามเองอยู่)
  const incompleteWithIntent = !complete && hasIntent && !codPhoneBlocked;

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

  return { payment, complete, waitTag, incompleteWithIntent, codPhoneBlocked, missing };
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

/**
 * ข้อความแจ้งแอดมินเมื่อ "ลูกค้าสั่งแล้วแต่ข้อมูลไม่ครบ" — ยังไม่ขึ้นชีต ต้องมีคนตามเก็บ
 * ใส่ของที่มีอยู่ให้หมดเท่าที่มี เพื่อให้แอดมินตามต่อได้ทันทีโดยไม่ต้องไล่อ่านแชท
 */
export function buildIncompleteOrderAdminText(
  pending: Record<string, string>,
  payment: string,
  missing: string[],
  lineName: string,
): string {
  const lines = [
    `⚠️ ลูกค้าสั่งแล้วแต่ข้อมูลไม่ครบ (${payment})`,
    `ยังขาด: ${missing.join(", ")}`,
    "———",
  ];
  const productLine = formatProductAndQty(pending);
  if (productLine) lines.push(productLine);
  if (pending["ยอด"]) lines.push(pending["ยอด"]);
  if (pending["ชื่อ"]) lines.push(`ชื่อ: ${pending["ชื่อ"]}`);
  if (pending["เบอร์"]) lines.push(`เบอร์: ${pending["เบอร์"]}`);
  if (pending["ที่อยู่"]) lines.push(`ที่อยู่: ${pending["ที่อยู่"]}`);
  lines.push("———", `LineOA: ${lineName}`);
  return lines.join("\n");
}
