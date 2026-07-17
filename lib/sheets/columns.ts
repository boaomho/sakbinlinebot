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
