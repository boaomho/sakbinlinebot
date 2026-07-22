/**
 * lib/core/time.ts — เวลาไทย (Asia/Bangkok · UTC+7) ที่เดียวของระบบ (D-37)
 *
 * 🔴 Vercel รันเป็น UTC · ทุกจุดที่ "แสดง/บันทึกวันเวลา" ต้อง shift +7 แล้วอ่านด้วย getUTC*
 *    (ไม่พึ่ง timezone ของเซิร์ฟเวอร์ · ไม่พึ่ง Intl ที่อาจไม่มี tz data บาง runtime)
 * 🔴 pure · inject now ได้ (เทส) · จุดใหม่ในอนาคตใช้ helper นี้ = ไม่เพี้ยนอีก
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Date ที่เลื่อน +7 ชม. — อ่านค่าปฏิทินไทยผ่าน getUTC* (ห้ามใช้เป็น instant ต่อ) */
export function bangkokShift(now: Date = new Date()): Date {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS);
}

function p2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD HH:MM" เวลาไทย — คอลัมน์ B (วันที่ออเดอร์) / Y (แก้ไขล่าสุด) */
export function bangkokDateTime(now: Date = new Date()): string {
  const b = bangkokShift(now);
  return `${b.getUTCFullYear()}-${p2(b.getUTCMonth() + 1)}-${p2(b.getUTCDate())} ${p2(b.getUTCHours())}:${p2(b.getUTCMinutes())}`;
}

/** "YYYY-MM-DD" เวลาไทย — ช่วงโปร (pricing) / วันตัดรอบ */
export function bangkokYMD(now: Date = new Date()): string {
  const b = bangkokShift(now);
  return `${b.getUTCFullYear()}-${p2(b.getUTCMonth() + 1)}-${p2(b.getUTCDate())}`;
}

/** "YYYYMMDD" เวลาไทย — order_id date */
export function bangkokYMDCompact(now: Date = new Date()): string {
  const b = bangkokShift(now);
  return `${b.getUTCFullYear()}${p2(b.getUTCMonth() + 1)}${p2(b.getUTCDate())}`;
}

/**
 * วันจัดส่ง (ส่งทุกวัน) จาก "เวลาตัดรอบออเดอร์" (HH:MM) — ก่อนตัดรอบ=วันนี้ · เท่า/หลัง=พรุ่งนี้ (D-39)
 * 🔴 cutoff อ่านไม่ได้ (ว่าง/รูปแบบผิด) → null (ผู้เรียกคง `{วันจัดส่ง}` ดิบ → var-guard จับ · ไม่เดาวัน)
 */
export function bangkokDeliveryDay(cutoff: string, now: Date = new Date()): "วันนี้" | "พรุ่งนี้" | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((cutoff ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const b = bangkokShift(now);
  const nowMin = b.getUTCHours() * 60 + b.getUTCMinutes();
  return nowMin < h * 60 + min ? "วันนี้" : "พรุ่งนี้";
}
