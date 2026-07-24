import { bangkokYMD } from "./core/time";

/**
 * lib/greeting.ts — D-51 ทักทายรายวัน (delivery ล้วน · ไม่แตะ AI/prompt/engine)
 * เติม prefix หน้าบอลลูนข้อความแรกของคำตอบ เมื่อเป็นเทิร์นแรกของลูกค้าในวันนั้น (เวลาไทย D-37)
 */

/** ค่าเริ่มถ้าชีตไม่มี key "ทักทายรายวัน" · มี space ท้าย (กลืนกับข้อความแรก) · ค่าว่าง = ปิดฟีเจอร์ */
export const DEFAULT_DAILY_GREETING = "สวัสดีค่ะ ";

/** เทิร์นแรกของวัน: ไม่มีประวัติ (ลูกค้าใหม่/หลัง /reset) หรือกิจกรรมล่าสุดเป็นคนละวันไทย */
export function isFirstMessageOfDay(historyLen: number, lastSeen: Date, now: Date): boolean {
  if (historyLen === 0) return true;
  return bangkokYMD(lastSeen) !== bangkokYMD(now);
}

/**
 * เติม prefix หน้า "บอลลูนข้อความแรก" — กลืนในบอลลูนเดิม (ไม่เพิ่มบอลลูน ไม่ชน cap 5)
 * 🔴 บอลลูนแรกเป็นรูป ([[รูป:...]]) → ข้ามไปเติมที่ข้อความแรกถัดไป · ทั้งหมดเป็นรูป → ไม่เติม
 */
export function prependToFirstTextBubble(reply: string, prefix: string): string {
  if (!prefix) return reply;
  // split เก็บตัวคั่นบอลลูน + image token ไว้ → หา text chunk แรกที่มีอักขระจริง
  const parts = reply.split(/(\[\[(?:เว้น|แยก)\]\]|\[\[รูป:[^\]]+\]\])/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (/^\[\[(?:เว้น|แยก)\]\]$/.test(p)) continue; // ตัวคั่นบอลลูน
    if (/^\[\[รูป:[^\]]+\]\]$/.test(p)) continue; // บอลลูนรูป → ข้าม
    const idx = p.search(/\S/);
    if (idx === -1) continue; // ช่องว่างล้วน
    parts[i] = p.slice(0, idx) + prefix + p.slice(idx);
    return parts.join("");
  }
  return reply; // ไม่มีบอลลูนข้อความเลย → ไม่เติม
}
