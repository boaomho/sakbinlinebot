/**
 * lib/schema-mode.ts — D-61 · สวิตช์ schema v2/v3 (จุดเดียวทั้งระบบ)
 * 🔴 env-only ถาวร (เจ้าของเคาะ): สลับ schema ต้องเป็น deliberate act ใน Vercel — ไม่มี Config key
 * default = "v2" เสมอ (ไม่ตั้ง/ตั้งค่าอื่น = v2) → deploy เดิมพฤติกรรมเดิม 100%
 * v3 = สมองใหม่ D-61 (เรียบเรียงสด + ธงสุขภาพ + assurance guard) — เปิดเมื่อชีต v3 พร้อม (เฟส C cutover)
 */
import { getTrainSandbox } from "@/lib/train/sandbox";

export type SheetSchema = "v2" | "v3";

/**
 * โหมด schema ปัจจุบัน
 * 🔴 D-61.C: ห้องซ้อม (ALS sandbox) override ได้ต่อ session — เจ้าของกดปุ่ม v2/v3 ใน /train ซ้อมได้โดยไม่ต้อง deploy
 *    prod ไม่มี sandbox context → อ่าน env เสมอ (pattern เดียวกับ guard อื่นทั้งระบบ: "ตัดสินจาก ALS มีค่าเท่านั้น")
 *    ปุ่มนี้อยู่ถาวรหลัง cutover ด้วย (เจ้าของเคาะ) — ซ้อมชีตเก่า/ใหม่สลับไปมาได้ตลอด
 */
export function sheetSchema(): SheetSchema {
  const override = getTrainSandbox()?.schema;
  if (override) return override;
  return process.env.SHEET_SCHEMA === "v3" ? "v3" : "v2";
}

/** ทางลัดสำหรับ branch point — ทุกจุดในโค้ดเช็คผ่านตัวนี้ (ห้ามอ่าน env ตรง) */
export function isSchemaV3(): boolean {
  return sheetSchema() === "v3";
}
