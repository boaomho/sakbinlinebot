import { google, sheets_v4 } from "googleapis";
import { sanitizePhone, sanitizeAmount, sanitizeShortText } from "./core/orders";
import { resolveSpreadsheetId } from "./core/sheet-id";

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

function getCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch (error) {
    console.error(JSON.stringify({ scope: "orders", warning: "GOOGLE_SERVICE_ACCOUNT parse failed", error: String(error) }));
    return null;
  }
}

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheets(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;
  const creds = getCredentials();
  if (!creds) throw new Error("GOOGLE_SERVICE_ACCOUNT missing or invalid");
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

export interface NewOrderInput {
  lineDisplayName: string;
  productAndQty?: string;
  total?: string;
  customerName?: string;
  phone?: string;
  /** ที่อยู่ก้อนดิบตามที่ลูกค้าพิมพ์ (ไม่แยก ตำบล/อำเภอ แล้ว) */
  address?: string;
  province?: string;
  postalCode?: string;
  paymentMethod?: string;
  slipPathname?: string;
}

export async function appendOrderRow(input: NewOrderInput): Promise<void> {
  const sheetId = ordersSheetId();
  const sheets = getSheets();

  // ⚠️ ลำดับต้องตรงกับ ORDERS_HEADER เป๊ะ — ค่าลงผิดช่อง = ออเดอร์เพี้ยนทั้งแถวแบบเงียบ ๆ
  const row = [
    "", // A ลำดับ - เว้นว่าง ให้ cron แจกตอนคอนเฟิร์ม
    new Date().toISOString(), // B วันที่
    sanitizeShortText(input.lineDisplayName, 100), // C ชื่อไลน์ลูกค้า
    sanitizeShortText(input.customerName), // D ชื่อ-นามสกุล
    sanitizePhone(input.phone), // E เบอร์โทร
    sanitizeShortText(input.address, 300), // F ที่อยู่ (ก้อนดิบ)
    sanitizeShortText(input.province, 100), // G จังหวัด
    sanitizeShortText(input.postalCode, 10), // H รหัสไปรษณีย์
    sanitizeShortText(input.productAndQty, 200), // I สินค้า+จำนวน
    sanitizeAmount(input.total), // J ยอดเงิน
    sanitizeShortText(input.paymentMethod, 20), // K การชำระเงิน
    input.slipPathname ?? "", // L รูปSlip (pathname)
    "FALSE", // M คอนเฟิร์ม
    "FALSE", // N ยกเลิก
    "FALSE", // O ส่งออเดอร์แล้ว
    "", // P เลขTracking
    // ---- Q–X: จองตำแหน่งให้ตรงชีตจริง · ยังไม่มีค่าจน Step 2/3 ----
    "", // Q order_id      (Step 2 — idempotency key)
    "", // R line_user_id  (Step 2)
    "", // S items_json    (Step 2)
    "", // T ค่าส่ง         (Step 3)
    "", // U source_channel(Step 2)
    "", // V ref_code      (Step 2)
    "", // W ยอดในสลิป      (แอดมินกรอกเอง)
    "", // X bot_version   (Step 2)
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:X`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
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
  const sheetId = ordersSheetId(); // env มีแต่ผิดรูป = ดังทันที
  const sheets = getSheets();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A2:X`,
  });
  const rows = res.data.values ?? [];

  const parsed: OrderRow[] = rows.map((r, i) => ({
    rowIndex: i + 2,
    orderNumber: r[0] ?? "", // A
    lineDisplayName: r[2] ?? "", // C
    customerName: r[3] ?? "", // D
    phone: r[4] ?? "", // E
    address: r[5] ?? "", // F
    province: r[6] ?? "", // G
    postalCode: r[7] ?? "", // H
    productAndQty: r[8] ?? "", // I
    total: r[9] ?? "", // J
    paymentMethod: r[10] ?? "", // K
    slipPathname: r[11] ?? "", // L
    confirmed: isTrue(r[12]), // M
    cancelled: isTrue(r[13]), // N
    sent: isTrue(r[14]), // O
    trackingNumber: r[15] ?? "", // P
    orderId: r[16] ?? "", // Q ← idempotency key (เลื่อนจาก S เพราะลบ ตำบล/อำเภอ)
  }));

  return parsed.filter((o) => o.confirmed && !o.cancelled && !o.sent);
}

export async function markOrderSent(rowIndex: number, orderNumber: string): Promise<void> {
  if (!process.env.SHEET_ORDERS_ID) return; // env ไม่มี = ฟีเจอร์ปิด ข้ามเงียบ (พฤติกรรมเดิม)
  const sheetId = ordersSheetId(); // env มีแต่ผิดรูป = ดังทันที
  const sheets = getSheets();

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${SHEET_NAME}!A${rowIndex}:A${rowIndex}`, values: [[orderNumber]] },
        // O = ส่งออเดอร์แล้ว (ย้ายจาก Q เพราะลบคอลัมน์ ตำบล/อำเภอ ออก 2 ช่อง)
        { range: `${SHEET_NAME}!O${rowIndex}:O${rowIndex}`, values: [["TRUE"]] },
      ],
    },
  });
}
