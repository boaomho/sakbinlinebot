import { sanitizePhone, sanitizeAmount, sanitizeShortText } from "./core/orders";
import { bangkokDateTime } from "./core/time";
import { resolveSpreadsheetId } from "./core/sheet-id";
import { getSheets } from "./sheets/client";
import { resolveColumns, cell, columnLetter, rowFromValues, ColumnMap } from "./sheets/columns";

// sanitizers ย้ายไปอยู่ lib/core/orders.ts (โดเมนล้วน) — re-export ไว้เพื่อไม่ให้ import เดิมพัง
export { sanitizePhone, sanitizeAmount, sanitizeShortText };

/**
 * spreadsheetId ของชีต Orders — รับได้ทั้ง ID ล้วนและ URL หน้าแก้ไข
 * ผิดรูป (เช่น published CSV URL) = throw ทันทีพร้อมบอกวิธีแก้ ไม่ปล่อยให้ Google ตอบ 404 ลอย ๆ
 */
function ordersSheetId(): string {
  return resolveSpreadsheetId(process.env.SHEET_ORDERS_ID, "SHEET_ORDERS_ID");
}

const SHEET_NAME = "Orders";
/**
 * โครงชีต Orders จริง (คอลัมน์ A–AA · 27 ช่อง) — 🔴 อัปเดต D-64
 *
 * D-64: แทรกคอลัมน์ **Q "กล่องส่งออเดอร์"** (สูตรในชีตให้คน copy เข้ากลุ่มแพ็ค) ต่อจาก P
 *   → order_id และคอลัมน์หลังจากนั้น **เลื่อนขวา 1 ช่อง** (Q–Z เดิม → R–AA)
 *
 * ที่อยู่เก็บเป็น "ก้อนเดียว" ตามที่ลูกค้าพิมพ์ · จังหวัด/รหัส = metadata ที่ AI หยิบได้ก็ใส่
 * (การจับคู่ตำบล-อำเภอ-รหัส เป็นหน้าที่ระบบขนส่ง+แอดมิน ไม่ใช่บอท)
 *
 * A: ลำดับ (🔴 Apps Script เขียนตอนติ๊ก M · รูปแบบ MMDD_n เช่น 0819_1 — โค้ดไม่เขียนแล้ว)
 * B: วันที่  C: ชื่อไลน์ลูกค้า  D: ชื่อ-นามสกุล  E: เบอร์โทร  F: ที่อยู่ (ก้อนดิบ)
 * G: จังหวัด  H: รหัสไปรษณีย์  I: สินค้า+จำนวน  J: ยอดเงิน  K: การชำระเงิน
 * L: รูปSlip (pathname · ไม่เก็บ signed URL เพราะหมดอายุ)
 * M: คอนเฟิร์ม (แอดมินติ๊ก → trigger Apps Script)  N: ยกเลิก (แอดมินติ๊ก)
 * O: ส่งออเดอร์แล้ว (🔴 คนติ๊กเองหลัง copy เข้ากลุ่ม — โค้ดไม่เขียน/ไม่อ่านตัดสินใจแล้ว)
 * P: เลขTracking (ทีมแพ็คกรอก)  Q: กล่องส่งออเดอร์ (สูตรในชีต · D-64)
 * R: order_id  S: line_user_id  T: items_json  U: ค่าส่ง  V: source_channel
 * W: ref_code  X: ยอดในสลิป (แอดมินกรอก)  Y: bot_version
 * Z: แก้ไขล่าสุด (D-31)  AA: แก้ไขกี่ครั้ง (D-31)
 *
 * 🔴 ตัวอักษรข้างบนเป็น "แผนที่ให้คนอ่าน" เท่านั้น — โค้ดหาคอลัมน์จาก **ชื่อ header** ผ่าน
 *    `resolveColumns(header, ORDERS_HEADER)` เสมอ · แทรก/สลับคอลัมน์แล้วยังหาถูก
 * ⚠️ ห้ามเพิ่ม "กล่องส่งออเดอร์" เข้า ORDERS_HEADER — จะกลายเป็น required แล้วพังถ้าชีตไหนยังไม่มี
 */
export const ORDERS_HEADER = [
  "ลำดับ", // A  0
  "วันที่", // B  1
  "ชื่อไลน์ลูกค้า", // C  2
  "ชื่อ-นามสกุล", // D  3
  "เบอร์โทร", // E  4
  "ที่อยู่", // F  5
  "จังหวัด", // G  6
  "รหัสไปรษณีย์", // H  7
  "สินค้า+จำนวน", // I  8
  "ยอดเงิน", // J  9
  "การชำระเงิน", // K 10
  "รูปSlip", // L 11
  "คอนเฟิร์ม", // M 12
  "ยกเลิก", // N 13
  "ส่งออเดอร์แล้ว", // O 14
  "เลขTracking", // P 15
  "order_id", // Q 16  ← idempotency key (Step 2)
  "line_user_id", // R 17
  "items_json", // S 18
  "ค่าส่ง", // T 19
  "source_channel", // U 20
  "ref_code", // V 21
  "ยอดในสลิป", // W 22
  "bot_version", // X 23
  "แก้ไขล่าสุด", // Y 24 ← ประวัติการแก้ (timestamp + สรุป · ต่อท้าย) · D-31
  "แก้ไขกี่ครั้ง", // Z 25 ← ตัวนับการแก้
];

// getSheets() ย้ายไป lib/sheets/client.ts (client เดียวใช้ทั้งอ่าน BotLibrary + อ่าน/เขียน Orders)

// ---- header-driven: หาคอลัมน์จากชื่อ header ไม่ใช่ index ตายตัว (CONTRACTS C1) ----
// cache header 60 วิ (เดียวกับ loader) — append เกิดทุกออเดอร์ อ่าน header ทุกครั้ง = +1 read เปล่า
// safety: ถ้า field ไม่ครบ/ผิดรูปจาก cache เก่า → invalidate + อ่านใหม่ 1 รอบ (กันแก้ header กลางคัน)

const HEADER_TTL_MS = 60_000;
let ordersColsCache: { cols: ColumnMap; at: number } | null = null;

async function getOrdersColumns(force = false): Promise<ColumnMap> {
  const now = Date.now();
  if (!force && ordersColsCache && now - ordersColsCache.at < HEADER_TTL_MS) {
    return ordersColsCache.cols;
  }
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: ordersSheetId(),
    range: `${SHEET_NAME}!1:1`,
  });
  const header = ((res.data.values?.[0] as string[] | undefined) ?? []).map((c) => String(c));
  const cols = resolveColumns(header, ORDERS_HEADER, SHEET_NAME);
  if (!cols) {
    ordersColsCache = null;
    throw new Error("Orders header ไม่ครบตาม ORDERS_HEADER — ไม่เขียนกันลงผิดช่อง (all-or-nothing)");
  }
  ordersColsCache = { cols, at: now };
  return cols;
}

/** ลอง fn ด้วย cache · ถ้า field ไม่ครบ (throw) → invalidate + อ่าน header ใหม่ 1 รอบแล้วลองอีกที */
async function withOrdersColumns<T>(fn: (cols: ColumnMap) => T | Promise<T>): Promise<T> {
  const cols = await getOrdersColumns();
  try {
    return await fn(cols);
  } catch (error) {
    console.warn(JSON.stringify({ scope: "orders", warning: "header cache น่าจะเก่า อ่านใหม่ 1 รอบ", error: String(error) }));
    const fresh = await getOrdersColumns(true);
    return await fn(fresh);
  }
}

/** เฉพาะเทส — ล้าง cache header */
export function __resetOrdersColumnsCache(): void {
  ordersColsCache = null;
}

export interface NewOrderInput {
  lineDisplayName: string;
  /** I = สรุปรายการคนอ่าน "น้ำพริกปลาทู x4 | ..." (จาก lib/core/pricing formatLinesForSheet) */
  productAndQty?: string;
  /** J = total จาก lib/core/pricing (ตัวเลขล้วน) — ไม่เคยอ่านจาก AI */
  total?: string;
  customerName?: string;
  phone?: string;
  /** ที่อยู่ก้อนดิบตามที่ลูกค้าพิมพ์ (ไม่แยก ตำบล/อำเภอ แล้ว) */
  address?: string;
  province?: string;
  postalCode?: string;
  paymentMethod?: string;
  slipPathname?: string;
  /** S = items_json = JSON.stringify(items) (D-15) */
  itemsJson?: string;
  /** T = ค่าส่ง จาก lib/core/pricing (ตัวเลขล้วน) */
  shippingFee?: string;
  /** Q = order_id (idempotency key · Step 2 · D-29) */
  orderId?: string;
  /** R = line_user_id — join key กับ Neon (KI-06: cron ใช้ล้างธง delivered_steps ตอนแจกเลข ·
   *  เดิมไม่เคยเขียน = ธงไม่ถูกล้างบน prod · ยืนยันแล้วชีตจริง R ว่าง ไม่มีสูตร) ·
   *  M-2: generalize เป็น channel_user_id (LINE=raw U · Messenger=fb:<pageId>:<psid>) */
  lineUserId?: string;
  /** U = source_channel (M-2) — "messenger" / "" (LINE คงว่างเปล่าเดิม) */
  sourceChannel?: string;
}

export async function appendOrderRow(input: NewOrderInput): Promise<void> {
  // ค่าที่จะเขียน keyed ด้วย "ชื่อ header" — โค้ดวางตามตำแหน่งจริงจาก resolveColumns
  // (Q–X เว้นว่างไว้ก่อน · Step 2/3 จะเติม)
  const values: Record<string, string> = {
    ลำดับ: "", // cron แจกตอนคอนเฟิร์ม
    วันที่: bangkokDateTime(), // B = เวลาไทย (D-37) — เดิม toISOString() เป็น UTC "Z"
    ชื่อไลน์ลูกค้า: sanitizeShortText(input.lineDisplayName, 100),
    "ชื่อ-นามสกุล": sanitizeShortText(input.customerName),
    เบอร์โทร: sanitizePhone(input.phone),
    ที่อยู่: sanitizeShortText(input.address, 300),
    จังหวัด: sanitizeShortText(input.province, 100),
    รหัสไปรษณีย์: sanitizeShortText(input.postalCode, 10),
    "สินค้า+จำนวน": sanitizeShortText(input.productAndQty, 200),
    ยอดเงิน: sanitizeAmount(input.total),
    การชำระเงิน: sanitizeShortText(input.paymentMethod, 20),
    รูปSlip: input.slipPathname ?? "",
    คอนเฟิร์ม: "FALSE",
    ยกเลิก: "FALSE",
    ส่งออเดอร์แล้ว: "FALSE",
    เลขTracking: "",
    items_json: sanitizeShortText(input.itemsJson, 1000),
    ค่าส่ง: sanitizeAmount(input.shippingFee),
    order_id: sanitizeShortText(input.orderId, 40), // Q = idempotency key (D-29)
    line_user_id: sanitizeShortText(input.lineUserId, 80), // R = join key ล้างธง (KI-06) · M-2 รองรับ fb:<pageId>:<psid>
    source_channel: sanitizeShortText(input.sourceChannel ?? "", 20), // U = ช่องทาง (M-2 · LINE ว่างเปล่าเดิม)
  };

  await withOrdersColumns(async (cols) => {
    const row = rowFromValues(values, cols); // throw ถ้า header ไม่ครบ → withOrdersColumns อ่านใหม่
    const lastCol = columnLetter(Math.max(...Object.values(cols)));
    await getSheets().spreadsheets.values.append({
      spreadsheetId: ordersSheetId(),
      range: `${SHEET_NAME}!A:${lastCol}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
  });
}

export interface OrderRow {
  rowIndex: number;
  orderNumber: string;
  /** order_id (คอลัมน์ Q) — idempotency key · ยังว่างจน Step 2 */
  orderId: string;
  /** line_user_id (คอลัมน์ R) — join key กับ Neon (D-45b: cron ใช้ล้างธง delivered_steps ตอนแจกเลข) */
  lineUserId: string;
  lineDisplayName: string;
  customerName: string;
  phone: string;
  /** ที่อยู่ก้อนดิบ (ไม่แยก ตำบล/อำเภอ แล้ว) */
  address: string;
  province: string;
  postalCode: string;
  productAndQty: string;
  total: string;
  paymentMethod: string;
  slipPathname: string;
  confirmed: boolean;
  cancelled: boolean;
  sent: boolean;
  trackingNumber: string;
}

function isTrue(value: string | undefined): boolean {
  return (value ?? "").trim().toUpperCase() === "TRUE";
}

/** อ่านทุกแถวออเดอร์ (header-driven) — ผู้เรียกกรองเอง (แจ้งพัสดุ / dashboard) */
async function readAllOrderRows(): Promise<OrderRow[]> {
  if (!process.env.SHEET_ORDERS_ID) return []; // env ไม่มี = ฟีเจอร์ปิด ข้ามเงียบ (พฤติกรรมเดิม)

  const cols = await getOrdersColumns(); // env ผิดรูป/ header ไม่ครบ = ดังทันที
  const lastCol = columnLetter(Math.max(...Object.values(cols)));
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: ordersSheetId(),
    range: `${SHEET_NAME}!A2:${lastCol}`,
  });
  const rows = (res.data.values as string[][] | undefined) ?? [];

  return rows.map((r, i) => ({
    rowIndex: i + 2,
    orderNumber: cell(r, cols, "ลำดับ"),
    lineDisplayName: cell(r, cols, "ชื่อไลน์ลูกค้า"),
    customerName: cell(r, cols, "ชื่อ-นามสกุล"),
    phone: cell(r, cols, "เบอร์โทร"),
    address: cell(r, cols, "ที่อยู่"),
    province: cell(r, cols, "จังหวัด"),
    postalCode: cell(r, cols, "รหัสไปรษณีย์"),
    productAndQty: cell(r, cols, "สินค้า+จำนวน"),
    total: cell(r, cols, "ยอดเงิน"),
    paymentMethod: cell(r, cols, "การชำระเงิน"),
    slipPathname: cell(r, cols, "รูปSlip"),
    confirmed: isTrue(cell(r, cols, "คอนเฟิร์ม")),
    cancelled: isTrue(cell(r, cols, "ยกเลิก")),
    sent: isTrue(cell(r, cols, "ส่งออเดอร์แล้ว")),
    trackingNumber: cell(r, cols, "เลขTracking"),
    orderId: cell(r, cols, "order_id"), // หาโดยชื่อ ไม่ใช่ r[16]
    lineUserId: cell(r, cols, "line_user_id"), // D-45b/KI-06: cron ล้างธง + D-50 แจ้งพัสดุ (join key)
  }));
}

/**
 * D-50 ออเดอร์รอแจ้งพัสดุ · 🔴 เงื่อนไขใหม่ D-64: **ลำดับ(A) ไม่ว่าง** + เลขพัสดุ(P) ไม่ว่าง + ไม่ยกเลิก(N)
 * ห้ามพึ่ง "ส่งออเดอร์แล้ว"(O) เด็ดขาด — หลัง D-64 O เปลี่ยนเป็น "คนติ๊กเอง" (ลืมได้) ไม่มีโค้ดไหนเขียน
 * A มีเลข = Apps Script เขียนตอนแอดมินติ๊ก M → สัญญาณ "คอนเฟิร์มแล้ว" ที่เชื่อถือได้แทน O
 * dedup จริงอยู่ที่ Neon `shipping_notified` (atomic claim) ไม่ใช่คอลัมน์ในชีต
 */
export async function listOrdersToNotifyShipping(): Promise<OrderRow[]> {
  return (await readAllOrderRows()).filter(
    (o) => o.orderNumber.trim() !== "" && !o.cancelled && o.trackingNumber.trim() !== "",
  );
}

// ---- T2-ก: ยอดขาย dashboard — map order_id → ยอด (อ่านชีต · cache 60วิ · read-only) ----
let amountCache: { map: Map<string, { total: number; cancelled: boolean }>; at: number } | null = null;
const AMOUNT_TTL_MS = 60_000;

/** map order_id → { ยอดเงิน(J), ยกเลิก(N) } จากชีต Orders (join กับ wonOrdersSince เพื่อรวมยอดตามช่วง/ช่องทาง) */
export async function orderAmountMap(): Promise<Map<string, { total: number; cancelled: boolean }>> {
  if (amountCache && Date.now() - amountCache.at < AMOUNT_TTL_MS) return amountCache.map;
  const map = new Map<string, { total: number; cancelled: boolean }>();
  for (const o of await readAllOrderRows()) {
    if (!o.orderId) continue;
    const total = Number(String(o.total).replace(/[^\d.]/g, "")) || 0;
    map.set(o.orderId, { total, cancelled: o.cancelled });
  }
  amountCache = { map, at: Date.now() };
  return map;
}

/** เทสเท่านั้น — ล้าง cache ยอด (กัน stale ข้ามเคส) */
export function __resetOrderAmountCache(): void {
  amountCache = null;
}

// ---- T2-ฉ: แท็บออเดอร์ dashboard — คืนทุกแถว (read-only · cache 60วิ · ไม่เขียน/ไม่เพิ่มคอลัมน์) ----
let ordersDashCache: { rows: OrderRow[]; at: number } | null = null;

/** ทุกแถวออเดอร์จากชีต (read-only · cache 60วิ) — ให้แท็บออเดอร์ derive สถานะจากคอลัมน์จริง */
export async function listOrdersForDashboard(): Promise<OrderRow[]> {
  if (ordersDashCache && Date.now() - ordersDashCache.at < AMOUNT_TTL_MS) return ordersDashCache.rows;
  const rows = await readAllOrderRows();
  ordersDashCache = { rows, at: Date.now() };
  return rows;
}

/** เทสเท่านั้น — ล้าง cache แท็บออเดอร์ (กัน stale ข้ามเคส) */
export function __resetOrdersDashboardCache(): void {
  ordersDashCache = null;
}

// ---- แก้ออเดอร์ที่เขียนแล้ว (D-31 · Plan B) — แก้แถวเดิมด้วย order_id ห้ามเขียนแถวใหม่ ----

export interface OrderEditResult {
  /**
   * updated=แก้แล้ว · confirmed=M=TRUE ห้ามแก้ · not_found=หา order_id ไม่เจอ · no_change=ไม่มีค่าใหม่ต่างจริง
   * 🔴 D-77: money_locked = การแก้ที่แตะเงิน/ยกเลิก ติด guard "เงินเคลื่อนแล้ว/ของกำลังเดินทาง = คน"
   *   (โอนแล้ว · มี tracking · แถวถูกยกเลิกไปแล้ว) — ผู้เรียกต้อง handoff ห้ามเขียน
   * cancelled = ติ๊ก N สำเร็จ (เส้นยกเลิก D-77)
   */
  status: "updated" | "confirmed" | "not_found" | "no_change" | "money_locked" | "cancelled";
  changed?: { label: string; from: string; to: string }[];
  /** field ที่ "ไม่ทับ" เพราะค่าใหม่ผิดปกติ (เช่น ที่อยู่สั้นเกินไปมาก) → ผู้เรียกให้บอทถามยืนยัน (D-32) */
  suspect?: string[];
  /** money_locked: เหตุที่ล็อก (โชว์ใน log/🔔) */
  lockReason?: string;
  /** cancelled/money_locked: ค่าปัจจุบันของแถว (รายการ+ยอด) — ประกอบข้อความแจ้งแอดมิน */
  row?: { items: string; total: string; payment: string };
}

/** คอลัมน์ที่ "แตะเงิน" — แก้พวกนี้ต้องผ่าน money guard (D-77) */
const MONEY_COLS = new Set(["สินค้า+จำนวน", "ยอดเงิน", "ค่าส่ง", "items_json"]);

/**
 * 🔴 D-77 money guard — อ่านจาก "แถวชีตจริง" ไม่ใช่ state ในแชท (ความจริงอยู่ที่ชีต):
 * แก้เงิน/ยกเลิก อัตโนมัติได้เฉพาะ **COD ที่ยังไม่มี tracking และยังไม่ถูกยกเลิก**
 * นอกนั้น = เงินเคลื่อนแล้ว (โอน = เก็บเพิ่ม/คืนเงิน) หรือของกำลังเดินทาง → งานคน (handoff)
 */
function moneyGuardReason(row: string[], cols: Record<string, number>): string | null {
  const payment = cell(row, cols, "การชำระเงิน").trim();
  if (payment !== "COD") return `การชำระเงินเป็น "${payment || "(ว่าง)"}" ไม่ใช่ COD — เงินอาจเคลื่อนแล้ว (เก็บเพิ่ม/คืนเงิน = งานคน)`;
  if (cell(row, cols, "เลขTracking").trim() !== "") return "มีเลข Tracking แล้ว — ของกำลังเดินทาง";
  if (isTrue(cell(row, cols, "ยกเลิก"))) return "แถวนี้ถูกยกเลิกไปแล้ว";
  return null;
}

/** สรุปค่าปัจจุบันของแถว (ประกอบข้อความ 🔔 เดิม → ใหม่) */
function rowSnapshot(row: string[], cols: Record<string, number>): { items: string; total: string; payment: string } {
  return {
    items: cell(row, cols, "สินค้า+จำนวน").trim(),
    total: cell(row, cols, "ยอดเงิน").trim(),
    payment: cell(row, cols, "การชำระเงิน").trim(),
  };
}

/** label ที่โชว์ใน Y/แจ้งแอดมิน (คอลัมน์ที่ไม่มีใน map = internal เช่น items_json — อัปเดตเงียบ ไม่โชว์) */
const EDIT_LABELS: Record<string, string> = {
  "ชื่อ-นามสกุล": "ชื่อ",
  เบอร์โทร: "เบอร์",
  ที่อยู่: "ที่อยู่",
  "สินค้า+จำนวน": "รายการ",
  ยอดเงิน: "ยอด",
  ค่าส่ง: "ค่าส่ง",
};

/**
 * แก้แถวออเดอร์เดิม (หาโดย order_id คอลัมน์ Q) — header-driven ทุกช่อง
 * 🔴 M(คอนเฟิร์ม)=TRUE → คืน "confirmed" (ไม่แก้ · ผู้เรียก handoff) · หา order_id ไม่เจอ → "not_found" (ไม่เขียนแถวใหม่)
 * แก้เฉพาะ field ที่ "มีค่าใหม่ต่างจากเดิมจริง" · Y ต่อท้ายประวัติ (ไม่ทับ) · Z +1
 * @param changes ค่าใหม่ที่อยากได้ keyed ด้วยชื่อคอลัมน์ (เฉพาะที่ลูกค้าแก้เทิร์นนี้)
 */
export async function updateOrderRow(orderId: string, changes: Record<string, string>, now: Date): Promise<OrderEditResult> {
  if (!process.env.SHEET_ORDERS_ID || !orderId) return { status: "not_found" };

  return withOrdersColumns(async (cols) => {
    const lastCol = columnLetter(Math.max(...Object.values(cols)));
    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: ordersSheetId(),
      range: `${SHEET_NAME}!A2:${lastCol}`,
    });
    const rows = (res.data.values as string[][] | undefined) ?? [];
    const qIdx = cols["order_id"];
    const rowNum = rows.findIndex((r) => (r[qIdx] ?? "").trim() === orderId);
    if (rowNum === -1) return { status: "not_found" };

    const row = rows[rowNum];
    const rowIndex = rowNum + 2; // +2: header อยู่แถว 1, data เริ่มแถว 2
    if (isTrue(cell(row, cols, "คอนเฟิร์ม"))) return { status: "confirmed" };

    // 🔴 D-77: การแก้ที่แตะเงิน → ต้องผ่าน money guard จากแถวจริง (ชื่อ/ที่อยู่/เบอร์ ไม่เกี่ยว — พฤติกรรมเดิม)
    if (Object.keys(changes).some((c) => MONEY_COLS.has(c))) {
      const reason = moneyGuardReason(row, cols);
      if (reason) return { status: "money_locked", lockReason: reason, row: rowSnapshot(row, cols) };
    }

    // diff เฉพาะที่ "มีค่าใหม่ต่างจริง" (ค่าว่าง/เท่าเดิม = ไม่นับแก้ · กัน "ถูกต้องครับ" เพิ่ม Y/Z)
    const changed: { label: string; from: string; to: string; col: number }[] = [];
    const suspect: string[] = [];
    for (const [colName, newVal] of Object.entries(changes)) {
      const idx = cols[colName];
      if (idx === undefined) continue;
      const old = (row[idx] ?? "").trim();
      const nv = (newVal ?? "").trim();
      if (nv === "" || nv === old) continue;
      // 🔴 กันที่อยู่ผิด: ที่อยู่ใหม่สั้นผิดปกติเทียบของเดิม (AI ส่งเศษ ไม่ใช่ก้อนเต็ม) → ไม่ทับ ให้บอทถามยืนยัน
      if (colName === "ที่อยู่" && old.length >= 15 && nv.length < old.length * 0.4) {
        suspect.push(EDIT_LABELS[colName] ?? colName);
        console.warn(JSON.stringify({ scope: "orders", event: "edit-address-suspect", orderId, oldLen: old.length, newLen: nv.length }));
        continue;
      }
      changed.push({ label: EDIT_LABELS[colName] ?? "", from: old, to: nv, col: idx });
    }
    if (changed.length === 0) return { status: "no_change", suspect };

    const data: { range: string; values: string[][] }[] = changed.map((c) => ({
      range: `${SHEET_NAME}!${columnLetter(c.col)}${rowIndex}:${columnLetter(c.col)}${rowIndex}`,
      values: [[c.to]],
    }));

    // Y (แก้ไขล่าสุด) — ต่อท้ายประวัติ · summary เฉพาะ field ที่มี label (ซ่อน items_json)
    const summary = changed.filter((c) => c.label).map((c) => `${c.label}: ${c.from || "-"} → ${c.to}`).join(" · ");
    const entry = `${bangkokDateTime(now)} · ${summary}`;
    const yIdx = cols["แก้ไขล่าสุด"];
    const zIdx = cols["แก้ไขกี่ครั้ง"];
    const oldY = (row[yIdx] ?? "").trim();
    data.push({ range: `${SHEET_NAME}!${columnLetter(yIdx)}${rowIndex}:${columnLetter(yIdx)}${rowIndex}`, values: [[oldY ? `${oldY}\n${entry}` : entry]] });
    const oldZ = Number((row[zIdx] ?? "").trim()) || 0;
    data.push({ range: `${SHEET_NAME}!${columnLetter(zIdx)}${rowIndex}:${columnLetter(zIdx)}${rowIndex}`, values: [[String(oldZ + 1)]] });

    await getSheets().spreadsheets.values.batchUpdate({
      spreadsheetId: ordersSheetId(),
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
    // D-77: แนบค่า "ก่อนแก้" ของแถว — ผู้เรียกใช้ประกอบข้อความ 🔔 เดิม → ใหม่
    return { status: "updated", changed: changed.map((c) => ({ label: c.label || "รายการ", from: c.from, to: c.to })), suspect, row: rowSnapshot(row, cols) };
  });
}

/**
 * 🔴 D-77 · ยกเลิกออเดอร์ (COD ก่อนส่งเท่านั้น) — ติ๊กคอลัมน์ "ยกเลิก" = TRUE · **ห้ามลบแถว**
 * guard เดียวกับแก้เงิน (อ่านจากแถวจริง): M=TRUE → confirmed · โอน/มี tracking/ยกเลิกแล้ว → money_locked
 * สำเร็จ → ต่อประวัติ Y + นับ Z เหมือนการแก้อื่น (รอยเท้าครบ)
 */
export async function cancelOrderRow(orderId: string, now: Date): Promise<OrderEditResult> {
  if (!process.env.SHEET_ORDERS_ID || !orderId) return { status: "not_found" };

  return withOrdersColumns(async (cols) => {
    const lastCol = columnLetter(Math.max(...Object.values(cols)));
    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: ordersSheetId(),
      range: `${SHEET_NAME}!A2:${lastCol}`,
    });
    const rows = (res.data.values as string[][] | undefined) ?? [];
    const qIdx = cols["order_id"];
    const rowNum = rows.findIndex((r) => (r[qIdx] ?? "").trim() === orderId);
    if (rowNum === -1) return { status: "not_found" };

    const row = rows[rowNum];
    const rowIndex = rowNum + 2;
    if (isTrue(cell(row, cols, "คอนเฟิร์ม"))) return { status: "confirmed" };
    const reason = moneyGuardReason(row, cols);
    if (reason) return { status: "money_locked", lockReason: reason, row: rowSnapshot(row, cols) };

    const entry = `${bangkokDateTime(now)} · ยกเลิกออเดอร์ (ลูกค้ายืนยันผ่านบอท)`;
    const yIdx = cols["แก้ไขล่าสุด"];
    const zIdx = cols["แก้ไขกี่ครั้ง"];
    const oldY = (row[yIdx] ?? "").trim();
    const oldZ = Number((row[zIdx] ?? "").trim()) || 0;
    await getSheets().spreadsheets.values.batchUpdate({
      spreadsheetId: ordersSheetId(),
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          { range: `${SHEET_NAME}!${columnLetter(cols["ยกเลิก"])}${rowIndex}:${columnLetter(cols["ยกเลิก"])}${rowIndex}`, values: [["TRUE"]] },
          { range: `${SHEET_NAME}!${columnLetter(yIdx)}${rowIndex}:${columnLetter(yIdx)}${rowIndex}`, values: [[oldY ? `${oldY}\n${entry}` : entry]] },
          { range: `${SHEET_NAME}!${columnLetter(zIdx)}${rowIndex}:${columnLetter(zIdx)}${rowIndex}`, values: [[String(oldZ + 1)]] },
        ],
      },
    });
    return { status: "cancelled", row: rowSnapshot(row, cols) };
  });
}

// 🔴 D-64: ลบ `markOrderSent` และ `listPendingOrders` — cron ไม่แจกเลข/ไม่ติ๊ก O อีกแล้ว
//    เลขลำดับ(A) เขียนโดย Apps Script บนชีต · "ส่งออเดอร์แล้ว"(O) คนติ๊กเองหลัง copy เข้ากลุ่ม
//    → ไม่มีโค้ดใดในระบบเขียนคอลัมน์ A หรือ O อีกต่อไป
