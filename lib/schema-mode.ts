/**
 * lib/schema-mode.ts — D-61 · สวิตช์ schema v2/v3 (จุดเดียวทั้งระบบ)
 * 🔴 env-only ถาวร (เจ้าของเคาะ): สลับ schema ต้องเป็น deliberate act ใน Vercel — ไม่มี Config key
 * default = "v2" เสมอ (ไม่ตั้ง/ตั้งค่าอื่น = v2) → deploy เดิมพฤติกรรมเดิม 100%
 * v3 = สมองใหม่ D-61 (เรียบเรียงสด + ธงสุขภาพ + assurance guard) — เปิดเมื่อชีต v3 พร้อม (เฟส C cutover)
 */
export type SheetSchema = "v2" | "v3";

export function sheetSchema(): SheetSchema {
  return process.env.SHEET_SCHEMA === "v3" ? "v3" : "v2";
}

/** ทางลัดสำหรับ branch point — ทุกจุดในโค้ดเช็คผ่านตัวนี้ (ห้ามอ่าน env ตรง) */
export function isSchemaV3(): boolean {
  return sheetSchema() === "v3";
}
