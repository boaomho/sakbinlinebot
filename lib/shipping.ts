/**
 * lib/shipping.ts — D-50 แจ้งเลขพัสดุ (pure helper · ไม่มี I/O)
 * template แก้ได้จาก CSV_Config key "ข้อความแจ้งพัสดุ" · carrier default จาก "ขนส่ง_เริ่มต้น"
 */

/** ค่าเริ่มถ้าชีตไม่มี key "ข้อความแจ้งพัสดุ" (เจ้าของเกลาสำนวนในชีตทีหลัง) */
export const DEFAULT_SHIPPING_TEMPLATE =
  "ส่งของเรียบร้อยค่ะ 📦[[แยก]]ขนส่ง {ขนส่ง}\nเลขพัสดุ {เลขพัสดุ}\nของถึงภายใน 2-3 วันนะคะ ขอบพระคุณมากค่ะ";

/** ค่าเริ่มถ้าชีตไม่มี key "ขนส่ง_เริ่มต้น" */
export const DEFAULT_CARRIER = "Shopee Express";

/** แทน {ขนส่ง}/{เลขพัสดุ} ในเทมเพลต (per-order carrier = เฟสหน้า · ตอนนี้ carrier มาจาก config อย่างเดียว) */
export function formatShippingMessage(template: string, carrier: string, tracking: string): string {
  return template.split("{ขนส่ง}").join(carrier).split("{เลขพัสดุ}").join(tracking);
}
