import { google, sheets_v4 } from "googleapis";
import { getTrainSandbox, wrapSheetsForSandbox } from "@/lib/train/sandbox";

/**
 * lib/sheets/client.ts — Google Sheets API client (service account JWT)
 * ย้ายมาจาก lib/orders.ts เพื่อให้ทั้งฝั่ง "อ่าน BotLibrary" และ "อ่าน/เขียน Orders" ใช้ client เดียว
 * scope spreadsheets ครอบทั้งอ่านและเขียน
 */

function getCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch (error) {
    console.error(JSON.stringify({ scope: "sheets", warning: "GOOGLE_SERVICE_ACCOUNT parse failed", error: String(error) }));
    return null;
  }
}

let sheetsClient: sheets_v4.Sheets | null = null;

export function getSheets(): sheets_v4.Sheets {
  // T-STUDIO guard (ALS เท่านั้น — เงื่อนไข ก): sandbox → ครอบ client จริงด้วย proxy
  // เบี่ยงเฉพาะชีต Orders เข้า fake grid (BotLibrary + header Orders แถว 1 อ่านของจริง read-only)
  const train = getTrainSandbox();
  if (train) return wrapSheetsForSandbox(getRealSheets(), train) as sheets_v4.Sheets;
  return getRealSheets();
}

function getRealSheets(): sheets_v4.Sheets {
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

/** เฉพาะเทส — ล้าง singleton client (กัน mock ค้างข้ามไฟล์เทส) */
export function __resetSheetsClient(): void {
  sheetsClient = null;
}
