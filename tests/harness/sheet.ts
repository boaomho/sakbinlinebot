import { ORDERS_HEADER } from "@/lib/orders";
import { sheetsCalls } from "./state";

/**
 * helper อ่านแถวที่ถูกเขียนลงชีตจริง
 *
 * 🔴 แยกจาก state.ts เพราะไฟล์นี้ import @/lib/orders (→ googleapis) ซึ่ง state.ts ห้ามทำ
 *    (mock factory ของ googleapis import state.ts → ถ้า state.ts import lib/orders = circular → เทสค้าง)
 */

/** แถวดิบทั้งหมดที่ append เข้าชีต */
export function appendedRows(): string[][] {
  return sheetsCalls.appends.flatMap((a) => a.values);
}

/** จำนวนออเดอร์ที่เขียนลงชีตจริง */
export function orderCount(): number {
  return appendedRows().length;
}

/**
 * 🔴 D-64: helper ทุกตัวอิง "header ที่ mock ตอบให้" (`sheetsCalls.ordersHeader`) ไม่ใช่ `ORDERS_HEADER`
 * เพราะชีตจริงมีคอลัมน์ที่โค้ดไม่ได้ขอ (เช่น Q "กล่องส่งออเดอร์") → index เลื่อน
 * ถ้าอิง ORDERS_HEADER จะ assert ผิดช่องตั้งแต่คอลัมน์ที่แทรกเป็นต้นไป
 */
export function activeOrdersHeader(): string[] {
  return sheetsCalls.ordersHeader.length > 0 ? sheetsCalls.ordersHeader : [...ORDERS_HEADER];
}

/**
 * แถวลำดับที่ i แปลงเป็น object ตาม header จริงของชีต (mock)
 * = พิสูจน์ว่า "ค่าลงตรงคอลัมน์ที่ header บอก" ไม่ใช่แค่ "ค่าถูก"
 */
export function orderRowAt(i: number): Record<string, string> {
  const row = appendedRows()[i] ?? [];
  const out: Record<string, string> = {};
  activeOrdersHeader().forEach((h, idx) => {
    out[h] = row[idx] ?? "";
  });
  return out;
}

/** ตัวอักษรคอลัมน์ (A, B, … AA) ของ header ที่ระบุ — ใช้ assert ตำแหน่งจริงในชีต */
export function columnOf(header: string): string {
  const idx = activeOrdersHeader().indexOf(header);
  if (idx < 0) throw new Error(`ไม่มี header "${header}" ใน header ของชีต (mock)`);
  return colLetter(idx);
}

/** index 0-based → ตัวอักษรคอลัมน์ (รองรับเกิน Z → AA) */
function colLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * assert ว่าทุก field ลงตรง "ตัวอักษรคอลัมน์จริง" ในชีต
 * เขียนเป็น A/B/C ตรง ๆ เพื่อให้เทียบกับชีตจริงด้วยตาได้ ไม่ต้องนับ index
 */
export function rowByColumn(i: number): Record<string, string> {
  const row = appendedRows()[i] ?? [];
  const out: Record<string, string> = {};
  const header = activeOrdersHeader();
  for (let idx = 0; idx < header.length; idx++) {
    out[colLetter(idx)] = row[idx] ?? "";
  }
  return out;
}
