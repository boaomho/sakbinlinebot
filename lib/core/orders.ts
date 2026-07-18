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

import { OrderItem } from "./pricing";

/** แท็ก "รอ" ที่โค้ดเป็นคนจัดการเอง (ห้ามให้ AI ใส่ผ่าน tags_add) */
export type WaitTag = "รอโอน" | "รอที่อยู่" | null;

/**
 * pending_order ที่ merge สะสมข้ามเทิร์น (เก็บใน Neon JSONB)
 * 🔴 D-15: order line ไม่ใช่ข้อความ สินค้า/จำนวน/ยอด อีกต่อไป — เป็น items:[{sku,qty}]
 *    (ยอด/ค่าส่ง คิดโดย lib/core/pricing.ts เท่านั้น · AI ไม่แตะตัวเลขเงิน)
 */
export interface PendingOrder {
  ชื่อ?: string;
  ที่อยู่?: string;
  เบอร์?: string;
  การชำระเงิน?: string;
  items?: OrderItem[];
}

/** normalize items เพื่อเทียบ (เรียง sku + sku/qty) — ใช้ตัดสิน "items เปลี่ยนมั้ย" (deterministic) */
export function normalizeItems(items: OrderItem[] | undefined): OrderItem[] {
  return (items ?? [])
    .filter((it) => it && typeof it.sku === "string" && it.sku.trim() !== "" && Number.isFinite(it.qty) && it.qty > 0)
    .map((it) => ({ sku: it.sku.trim(), qty: it.qty }))
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : a.qty - b.qty));
}

/** items เท่ากันไหม (หลัง normalize) */
export function itemsEqual(a: OrderItem[] | undefined, b: OrderItem[] | undefined): boolean {
  const na = normalizeItems(a);
  const nb = normalizeItems(b);
  if (na.length !== nb.length) return false;
  return na.every((it, i) => it.sku === nb[i].sku && it.qty === nb[i].qty);
}

/**
 * ชื่อผู้รับใช้ได้: ไม่ว่าง + ยาว ≥2 ตัวอักษร (รับได้ทั้งชื่อคน/ชื่อเล่น/ชื่อร้าน/บริษัท)
 * ไม่บังคับนามสกุล — ลูกค้าจริงพิมพ์ชื่อเล่นเยอะ บังคับแล้วเสียออเดอร์
 */
export function nameComplete(p: PendingOrder): boolean {
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
export function addressComplete(p: PendingOrder): boolean {
  return (p["ที่อยู่"] ?? "").trim() !== "";
}

export interface OrderGateInput {
  /** pending_order ที่ merge สะสมแล้ว (โค้ดตัดสินจาก "ของที่มีจริง" เท่านั้น) */
  pending: PendingOrder;
  /** มีสลิปผูกอยู่กับลูกค้ารายนี้หรือยัง (เทิร์นนี้ หรือที่จำไว้) */
  slipPresent: boolean;
  /**
   * pricing สำเร็จมั้ย = `error === null && !needsHandoff` (คำนวณโดยผู้เรียกจาก lib/core/pricing)
   * 🔴 D-15: order line ครบ = items ไม่ว่าง **และ** pricing ผ่าน (ยอด/เพดานคำนวณได้ ไม่ใช่แค่มี items)
   */
  priceOk: boolean;
}

export interface OrderGateResult {
  /** ช่องทางชำระล่าสุดที่อ่านได้จาก pending ("" = ยังไม่ตัดสิน) */
  payment: string;
  /** ครบ = เขียนลงชีตได้ + push 📦 */
  complete: boolean;
  /** แท็กรอที่ควรเป็น ณ ตอนนี้ (null = ไม่มีแท็กรอ) — ป้อน Follow engine (ยังไม่เปิด) */
  waitTag: WaitTag;
  /** อะไรขาดบ้าง (ชื่อ/ที่อยู่/เบอร์/รายการสินค้า/สลิป) — บอทเอาไปขอลูกค้าเฉพาะที่ขาด · ใช้ log ด้วย */
  missing: string[];
  /**
   * "ออเดอร์พัง" = ข้อมูลจัดส่งครบ (ชื่อ+ที่อยู่+เบอร์) แต่ยังไม่มี items (AI ไม่ extract รายการ)
   * → ควรแจ้งแอดมินให้ช่วย (ไม่ใช่เคส D-11 early ที่ยังไม่มีที่อยู่)
   */
  brokenOrder: boolean;
}

/**
 * gate ออเดอร์ — โค้ดตัดสินจาก pending_order ที่มีจริงเท่านั้น ไม่พึ่ง AI signal
 *
 *   COD ปิด = ชื่อ + เบอร์(มีตัวเลข) + ที่อยู่(ก้อนไม่ว่าง) + order line (สินค้า+จำนวน+ยอด)
 *   โอน ปิด = เหมือน COD + สลิป
 *   ครบ    → เขียนชีต + push 📦
 *   ไม่ครบ → ไม่เขียน · บอทขอสิ่งที่ยังขาดจากลูกค้าเอง (missing)
 *
 * 🔴 จังหวะแจ้งกลุ่ม (ผู้เรียกจัดการ):
 *   - D-11: ไม่ push ⚠️ ตอนข้อมูลจัดส่งยังไม่ครบ (COD ยังไม่ได้ที่อยู่ = แจ้งเร็วไป · บอทเก็บเอง)
 *   - D-13: push ⚠️ เฉพาะ "ออเดอร์พัง" (จัดส่งครบแต่ order line ขาด = AI ไม่ extract สินค้า/จำนวน/ยอด)
 *
 * เป็น pure function: ไม่มี I/O ไม่แตะ DB — ผู้เรียกเอาผลไปลงมือเอง
 */
export function evaluateOrderGate({ pending, slipPresent, priceOk }: OrderGateInput): OrderGateResult {
  const payment = (pending["การชำระเงิน"] ?? "").trim();
  const name = nameComplete(pending);
  const addr = addressComplete(pending);
  const phone = sanitizePhone(pending["เบอร์"]) !== ""; // มีตัวเลข = ผ่าน (แอดมินตรวจเบอร์เอง)
  const shipping = name && addr && phone;
  const itemsOk = normalizeItems(pending.items).length > 0;
  const product = itemsOk && priceOk; // order line ครบ = มี items + pricing ผ่าน (ยอด/เพดานคำนวณได้)
  const base = shipping && product;

  const complete = (payment === "COD" && base) || (payment === "โอน" && base && slipPresent);

  // เช็คแยกทีละช่อง — ขาดอันไหนขึ้น missing อันนั้น (บอทขอเฉพาะที่ขาด)
  const missing: string[] = [];
  if (!complete) {
    if (!name) missing.push("ชื่อ");
    if (!addr) missing.push("ที่อยู่");
    if (!phone) missing.push("เบอร์");
    if (!itemsOk) missing.push("รายการสินค้า");
    if (payment === "โอน" && !slipPresent) missing.push("สลิป");
  }

  // ออเดอร์พัง: จัดส่งครบ + เลือกวิธีจ่ายแล้ว แต่ยังไม่มี items → AI ไม่ extract รายการ → แจ้งแอดมิน (ไม่ใช่ D-11 early)
  // (กรณี items มีแต่ pricing ล้ม → ผู้เรียกจัดการแยกจาก priceResult.error/needsHandoff โดยตรง)
  const brokenOrder = !complete && payment !== "" && shipping && !itemsOk;

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

  return { payment, complete, waitTag, missing, brokenOrder };
}

/** สรุป items ที่คนอ่านได้จาก pending (เช่น "NPT-10G x4 · NPT-20G x2") — ใช้ในข้อความแอดมินตอน pricing ยังคำนวณไม่ได้ */
function itemsToText(items: OrderItem[] | undefined): string {
  const norm = normalizeItems(items);
  return norm.length > 0 ? norm.map((it) => `${it.sku} x${it.qty}`).join(" · ") : "(ไม่มี)";
}

/** ข้อความแจ้งแอดมินเมื่อ "ออเดอร์พัง" — จัดส่งครบแต่ยังไม่มี items (AI ไม่ extract รายการ) */
export function buildBrokenOrderAdminText(pending: PendingOrder, missing: string[], lineName: string): string {
  return [
    "⚠️ ออเดอร์ตกหล่น (ข้อมูลจัดส่งครบ แต่ยังไม่มีรายการสินค้า)",
    `ยังขาด: ${missing.join(", ")}`,
    "———",
    `ชื่อ: ${pending["ชื่อ"] ?? ""}`,
    `เบอร์: ${sanitizePhone(pending["เบอร์"])}`,
    `ที่อยู่: ${pending["ที่อยู่"] ?? ""}`,
    `รายการ: ${itemsToText(pending.items)}`,
    "———",
    `LineOA: ${lineName}`,
  ].join("\n");
}

/**
 * ข้อความแจ้งกลุ่มแอดมินเมื่อออเดอร์สมบูรณ์ขึ้นชีต (push จุดที่ 2)
 * 🔴 ยอด/สรุปรายการ มาจาก lib/core/pricing (ผู้เรียกส่งเข้ามา) — ไม่อ่านตัวเลขจาก AI
 */
export function buildNewOrderAdminText(
  summary: string,
  total: number,
  payment: string,
  name: string,
  phone: string,
): string {
  const icon = payment === "COD" ? "📦" : "💰";
  return `${icon} ออเดอร์ใหม่ (${payment})\n${summary}\n${total} บาท\n${name} ${sanitizePhone(phone)}`;
}

