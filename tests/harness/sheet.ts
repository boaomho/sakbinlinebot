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
 * แถวลำดับที่ i แปลงเป็น object ตาม ORDERS_HEADER
 * = พิสูจน์ว่า "ค่าลงตรงคอลัมน์ที่ header บอก" ไม่ใช่แค่ "ค่าถูก"
 */
export function orderRowAt(i: number): Record<string, string> {
  const row = appendedRows()[i] ?? [];
  const out: Record<string, string> = {};
  ORDERS_HEADER.forEach((h, idx) => {
    out[h] = row[idx] ?? "";
  });
  return out;
}

/** ตัวอักษรคอลัมน์ (A, B, ... X) ของ header ที่ระบุ — ใช้ assert ตำแหน่งจริงในชีต */
export function columnOf(header: string): string {
  const idx = ORDERS_HEADER.indexOf(header);
  if (idx < 0) throw new Error(`ไม่มี header "${header}" ใน ORDERS_HEADER`);
  return String.fromCharCode(65 + idx);
}

/**
 * assert ว่าทุก field ลงตรง "ตัวอักษรคอลัมน์จริง" ในชีต
 * เขียนเป็น A/B/C ตรง ๆ เพื่อให้เทียบกับชีตจริงด้วยตาได้ ไม่ต้องนับ index
 */
export function rowByColumn(i: number): Record<string, string> {
  const row = appendedRows()[i] ?? [];
  const out: Record<string, string> = {};
  for (let idx = 0; idx < ORDERS_HEADER.length; idx++) {
    out[String.fromCharCode(65 + idx)] = row[idx] ?? "";
  }
  return out;
}
