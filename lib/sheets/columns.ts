import { cleanHeader } from "./clean";

/**
 * lib/sheets/columns.ts — header-driven column resolution (CONTRACTS C1)
 * ใช้กับ "ทุกแท็บ" BotLibrary + Orders — หาคอลัมน์จาก "ชื่อ header" ไม่ใช่ตำแหน่ง
 *
 * 🔴 pure ล้วน · all-or-nothing: ขาด header ที่ต้องใช้แม้แค่ตัวเดียว → คืน null + log
 *    ห้าม fallback เป็น index เงียบ ๆ (บั๊ก column offset ห้ามซ้ำ — เอา "ห้ามทำ" มาเป็น "หลักการนำพา")
 */

export type ColumnMap = Record<string, number>;

/**
 * map ชื่อคอลัมน์ที่ต้องใช้ → index จริงในแถว โดยดูจาก header row
 *   - สลับตำแหน่งคอลัมน์ → ยังหาถูก (หาโดยชื่อ)
 *   - แทรก/เพิ่มคอลัมน์ใหม่ → ไม่กระทบ (คอลัมน์ที่ไม่ได้ขอถูกเมิน)
 *   - ขาดคอลัมน์ที่ required → คืน null (ผู้เรียกปิดฟีเจอร์ทั้งก้อน)
 *
 * @param headerRow แถวหัวตารางดิบจากชีต
 * @param required  ชื่อคอลัมน์ที่โค้ดต้องใช้ (ชื่อสะอาดแล้ว ตรงกับที่อยู่ในชีตหลัง cleanHeader)
 * @param label     ชื่อแท็บ/ตาราง สำหรับใส่ใน log ให้รู้ว่าพังที่ไหน
 */
export function resolveColumns(headerRow: string[], required: string[], label = "sheet"): ColumnMap | null {
  const cleaned = headerRow.map(cleanHeader);
  const map: ColumnMap = {};
  const missing: string[] = [];

  for (const name of required) {
    const idx = cleaned.indexOf(name);
    if (idx === -1) {
      missing.push(name);
      continue;
    }
    map[name] = idx;
  }

  if (missing.length > 0) {
    console.error(
      JSON.stringify({ scope: "sheets", label, warning: "header ไม่เจอ ปิดฟีเจอร์ทั้งก้อน", missing, available: cleaned }),
    );
    return null;
  }
  return map;
}

/** อ่านค่าจากแถวตาม ColumnMap (คืน "" ถ้าเซลล์ว่าง/เกินความยาวแถว) */
export function cell(row: string[], cols: ColumnMap, name: string): string {
  const idx = cols[name];
  if (idx === undefined) return "";
  return (row[idx] ?? "").toString();
}

/** index 0-based → ตัวอักษรคอลัมน์ (0→A, 23→X, 25→Z, 26→AA) — ใช้สร้าง A1 range */
export function columnLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * วางค่า (keyed ด้วยชื่อ header) ลง array ตามตำแหน่งจริงใน ColumnMap
 * @throws ถ้ามีชื่อที่ต้องเขียนแต่ไม่มีใน cols (header ไม่ครบ) — ผู้เรียกไป invalidate cache + อ่านใหม่
 */
export function rowFromValues(values: Record<string, string>, cols: ColumnMap): string[] {
  const maxIdx = Math.max(...Object.values(cols));
  const row = new Array<string>(maxIdx + 1).fill("");
  for (const [name, value] of Object.entries(values)) {
    const idx = cols[name];
    if (idx === undefined) {
      throw new Error(`rowFromValues: ไม่มีคอลัมน์ "${name}" ใน header (ต้อง invalidate cache + อ่านใหม่)`);
    }
    row[idx] = value;
  }
  return row;
}
