import { sanitizePhone, sanitizeAmount, sanitizeShortText } from "./core/orders";
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
 * โครงชีต Orders จริง (คอลัมน์ A–X · 24 ช่อง) — อ่านจากชีตจริงแล้ว
 *
 * 🔴 ลบ ตำบล/อำเภอ ออก → คอลัมน์ Q–X **เลื่อนซ้าย 2 ช่อง** จาก contract v1.2 เดิม (S–Z)
 *    order_id: S→Q · line_user_id: T→R · items_json: U→S · ค่าส่ง: V→T
 *    source_channel: W→U · ref_code: X→V · ยอดในสลิป: Y→W · bot_version: Z→X
 *
 * ที่อยู่เก็บเป็น "ก้อนเดียว" ตามที่ลูกค้าพิมพ์ · จังหวัด/รหัส = metadata ที่ AI หยิบได้ก็ใส่
 * (การจับคู่ตำบล-อำเภอ-รหัส เป็นหน้าที่ระบบขนส่ง+แอดมิน ไม่ใช่บอท)
 *
 * A: ลำดับ (cron แจกตอนคอนเฟิร์ม)  B: วันที่  C: ชื่อไลน์ลูกค้า  D: ชื่อ-นามสกุล
 * E: เบอร์โทร  F: ที่อยู่ (ก้อนดิบ)  G: จังหวัด  H: รหัสไปรษณีย์  I: สินค้า+จำนวน
 * J: ยอดเงิน  K: การชำระเงิน  L: รูปSlip (pathname · ไม่เก็บ signed URL เพราะหมดอายุ)
 * M: คอนเฟิร์ม (แอดมินติ๊ก)  N: ยกเลิก (แอดมินติ๊ก)  O: ส่งออเดอร์แล้ว (cron)  P: เลขTracking
 * Q: order_id  R: line_user_id  S: items_json  T: ค่าส่ง  U: source_channel
 * V: ref_code  W: ยอดในสลิป (แอดมินกรอก)  X: bot_version
 *
 * ⚠️ Q–X ยังไม่มีค่า (เขียนเป็นช่องว่าง) — Step 2/3 จะเติม ตอนนี้จองตำแหน่งไว้ให้ตรงชีตก่อน
 * ⚠️ index ตายตัวชั่วคราว — Step 1 (header-driven) จะรื้อถาวร
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
}

export async function appendOrderRow(input: NewOrderInput): Promise<void> {
  // ค่าที่จะเขียน keyed ด้วย "ชื่อ header" — โค้ดวางตามตำแหน่งจริงจาก resolveColumns
  // (Q–X เว้นว่างไว้ก่อน · Step 2/3 จะเติม)
  const values: Record<string, string> = {
    ลำดับ: "", // cron แจกตอนคอนเฟิร์ม
    วันที่: new Date().toISOString(),
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

/**
 * เงื่อนไข: คอนเฟิร์ม(O)=TRUE และ ส่งออเดอร์แล้ว(Q)≠TRUE และไม่ถูกยกเลิก
 * ถ้าติ๊กทั้ง คอนเฟิร์ม(O) และ ยกเลิก(P) พร้อมกัน → ถือว่ายกเลิก (ปลอดภัยไว้ก่อน จึงกรอง cancelled ออกก่อนเสมอ)
 */
export async function listPendingOrders(): Promise<OrderRow[]> {
  if (!process.env.SHEET_ORDERS_ID) return []; // env ไม่มี = ฟีเจอร์ปิด ข้ามเงียบ (พฤติกรรมเดิม)

  const cols = await getOrdersColumns(); // env ผิดรูป/ header ไม่ครบ = ดังทันที
  const lastCol = columnLetter(Math.max(...Object.values(cols)));
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: ordersSheetId(),
    range: `${SHEET_NAME}!A2:${lastCol}`,
  });
  const rows = (res.data.values as string[][] | undefined) ?? [];

  const parsed: OrderRow[] = rows.map((r, i) => ({
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
  }));

  return parsed.filter((o) => o.confirmed && !o.cancelled && !o.sent);
}

export async function markOrderSent(rowIndex: number, orderNumber: string): Promise<void> {
  if (!process.env.SHEET_ORDERS_ID) return; // env ไม่มี = ฟีเจอร์ปิด ข้ามเงียบ (พฤติกรรมเดิม)

  const cols = await getOrdersColumns();
  const numCol = columnLetter(cols["ลำดับ"]);
  const sentCol = columnLetter(cols["ส่งออเดอร์แล้ว"]); // หาโดยชื่อ ไม่ hardcode O
  await getSheets().spreadsheets.values.batchUpdate({
    spreadsheetId: ordersSheetId(),
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${SHEET_NAME}!${numCol}${rowIndex}:${numCol}${rowIndex}`, values: [[orderNumber]] },
        { range: `${SHEET_NAME}!${sentCol}${rowIndex}:${sentCol}${rowIndex}`, values: [["TRUE"]] },
      ],
    },
  });
}
