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
 * โครงชีต Orders จริง (คอลัมน์ A-R):
 * A: ลำดับ (แจกตอนคอนเฟิร์ม, เว้นว่างตอนบันทึก)   B: วันที่   C: ชื่อไลน์ลูกค้า
 * D: ชื่อ-นามสกุล   E: เบอร์โทร(10หลัก)   F: ที่อยู่   G: ตำบล   H: อำเภอ   I: จังหวัด
 * J: รหัสไปรษณีย์   K: สินค้า+จำนวน (ช่องเดียว)   L: ยอดเงิน   M: การชำระเงิน(โอน/COD)
 * N: รูปSlip (pathname เท่านั้น ไม่เก็บ signed URL เพราะหมดอายุ)
 * O: คอนเฟิร์ม (แอดมินติ๊กเมื่อเช็คยอด/ยืนยันแล้ว)   P: ยกเลิก (แอดมินติ๊กเพื่อยกเลิก)
 * Q: ส่งออเดอร์แล้ว (cron ตั้งเอง)   R: เลขTracking (แอดมินกรอกเอง)
 */
export const ORDERS_HEADER = [
  "ลำดับ",
  "วันที่",
  "ชื่อไลน์ลูกค้า",
  "ชื่อ-นามสกุล",
  "เบอร์โทร",
  "ที่อยู่",
  "ตำบล",
  "อำเภอ",
  "จังหวัด",
  "รหัสไปรษณีย์",
  "สินค้า+จำนวน",
  "ยอดเงิน",
  "การชำระเงิน",
  "รูปSlip",
  "คอนเฟิร์ม",
  "ยกเลิก",
  "ส่งออเดอร์แล้ว",
  "เลขTracking",
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
  address?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  paymentMethod?: string;
  slipPathname?: string;
}

export async function appendOrderRow(input: NewOrderInput): Promise<void> {
  const sheetId = ordersSheetId();
  const sheets = getSheets();

  const row = [
    "", // A ลำดับ - เว้นว่าง ให้ cron แจกตอนคอนเฟิร์ม
    new Date().toISOString(), // B วันที่
    sanitizeShortText(input.lineDisplayName, 100), // C ชื่อไลน์ลูกค้า
    sanitizeShortText(input.customerName), // D ชื่อ-นามสกุล
    sanitizePhone(input.phone), // E เบอร์โทร
    sanitizeShortText(input.address, 300), // F ที่อยู่
    sanitizeShortText(input.subdistrict, 100), // G ตำบล
    sanitizeShortText(input.district, 100), // H อำเภอ
    sanitizeShortText(input.province, 100), // I จังหวัด
    sanitizeShortText(input.postalCode, 10), // J รหัสไปรษณีย์
    sanitizeShortText(input.productAndQty, 200), // K สินค้า+จำนวน
    sanitizeAmount(input.total), // L ยอดเงิน
    sanitizeShortText(input.paymentMethod, 20), // M การชำระเงิน
    input.slipPathname ?? "", // N รูปSlip (pathname)
    "FALSE", // O คอนเฟิร์ม
    "FALSE", // P ยกเลิก
    "FALSE", // Q ส่งออเดอร์แล้ว
    "", // R เลขTracking
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:R`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

export interface OrderRow {
  rowIndex: number;
  orderNumber: string;
  lineDisplayName: string;
  customerName: string;
  phone: string;
  address: string;
  subdistrict: string;
  district: string;
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
    range: `${SHEET_NAME}!A2:R`,
  });
  const rows = res.data.values ?? [];

  const parsed: OrderRow[] = rows.map((r, i) => ({
    rowIndex: i + 2,
    orderNumber: r[0] ?? "",
    lineDisplayName: r[2] ?? "",
    customerName: r[3] ?? "",
    phone: r[4] ?? "",
    address: r[5] ?? "",
    subdistrict: r[6] ?? "",
    district: r[7] ?? "",
    province: r[8] ?? "",
    postalCode: r[9] ?? "",
    productAndQty: r[10] ?? "",
    total: r[11] ?? "",
    paymentMethod: r[12] ?? "",
    slipPathname: r[13] ?? "",
    confirmed: isTrue(r[14]),
    cancelled: isTrue(r[15]),
    sent: isTrue(r[16]),
    trackingNumber: r[17] ?? "",
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
        { range: `${SHEET_NAME}!Q${rowIndex}:Q${rowIndex}`, values: [["TRUE"]] },
      ],
    },
  });
}
