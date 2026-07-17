/**
 * lib/core/sheet-id.ts — แปลงค่า env ของชีตให้เป็น spreadsheetId ที่ Sheets API ใช้ได้
 *
 * 🔴 ห้าม import อะไรที่เกี่ยวกับ LINE / Gemini (core rule · CONTRACTS §1) — pure ล้วน
 *
 * ทำไมต้องมี: Sheets API รับได้เฉพาะ "ID ล้วน" แต่ env เคยถูกตั้งเป็น CSV URL มาก่อน
 * โค้ดเดิมยัดค่า env เข้า spreadsheetId ตรง ๆ โดยไม่ตรวจ → ถ้าเป็น URL จะพังทุกครั้ง
 * และพังแบบเงียบ (runOrderGate จับ error แล้ว return) = ออเดอร์หายโดยไม่มีใครรู้
 * ตัวนี้ทำให้ "ผิดแล้วดังทันที พร้อมบอกวิธีแก้" แทนที่จะเงียบ
 */

/** ID ล้วน เช่น 1_TinrMFnxSA9tvIbH3gu0P1kAgBLNCGR1ss4vsRCFrQ */
const PLAIN_ID = /^[a-zA-Z0-9-_]{20,}$/;

/** URL หน้าแก้ไข/ดู: https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0 */
const EDIT_URL_ID = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/;

/**
 * URL แบบ publish-to-web: https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv
 * 🔴 "2PACX-..." คือ published ID — คนละตัวกับ spreadsheet ID จริง และ "แปลงกลับไม่ได้"
 *    ต้องไปเอา ID จริงจาก URL ตอนเปิดชีตแบบแก้ไข (/spreadsheets/d/<ID>/edit)
 */
const PUBLISHED_URL = /\/spreadsheets\/d\/e\/(2PACX-[a-zA-Z0-9-_]+)/;

/**
 * คืน spreadsheetId จากค่า env — รับได้ทั้ง ID ล้วน และ URL หน้าแก้ไข
 * (รองรับ 2 แบบเพื่อให้สลับ ENV ได้โดยไม่มีหน้าต่างที่พัง)
 *
 * @param label ชื่อ env ที่กำลังอ่าน — ใส่ในข้อความ error ให้แก้ได้ทันทีโดยไม่ต้องเดา
 * @throws ถ้าค่าว่าง / เป็น published URL (2PACX) / รูปแบบไม่รู้จัก
 */
export function resolveSpreadsheetId(value: string | undefined, label = "SHEET_*_ID"): string {
  const raw = (value ?? "").trim();

  if (!raw) {
    throw new Error(`${label} ไม่ได้ตั้งค่า — ต้องเป็น spreadsheet ID ล้วน`);
  }

  const published = raw.match(PUBLISHED_URL);
  if (published) {
    throw new Error(
      `${label} เป็น published CSV URL (${published[1].slice(0, 12)}...) ซึ่งใช้กับ Sheets API ไม่ได้ ` +
        `และแปลงกลับเป็น ID จริงไม่ได้ — ให้เปิดชีตแบบแก้ไขแล้วก๊อป ID จาก ` +
        `https://docs.google.com/spreadsheets/d/<ID>/edit มาใส่แทน`,
    );
  }

  const fromUrl = raw.match(EDIT_URL_ID);
  if (fromUrl) return fromUrl[1];

  if (PLAIN_ID.test(raw)) return raw;

  throw new Error(
    `${label} รูปแบบไม่ถูกต้อง (${raw.slice(0, 20)}...) — ต้องเป็น spreadsheet ID ล้วน ` +
      `หรือ URL แบบ https://docs.google.com/spreadsheets/d/<ID>/edit`,
  );
}
