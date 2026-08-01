/**
 * lib/guards/assurance.ts — D-61.A · assurance guard (ยามใหม่ตัวเดียวของ v3)
 * เทิร์นที่ติดธงสุขภาพ + คำตอบ AI มี "ประโยครับรองแทนลูกค้า" (ทานได้ค่ะ/ปลอดภัย/ไม่เป็นไร...)
 * → บล็อกเฉพาะส่วนนั้น (regenerate 1 ครั้งที่ handler → ยังหลุด = ตัดประโยคทิ้ง) · ห้ามล้มทั้งเทิร์น
 * pure ล้วน — list มาจาก Config `คำรับรอง_ต้องห้าม` (default ด้านล่าง) · unit-test ตรงได้
 */

/** default ในโค้ด — Config `คำรับรอง_ต้องห้าม` ตั้งทับได้ (คั่น ,) */
export const DEFAULT_ASSURANCE_PHRASES = [
  "ทานได้",
  "กินได้",
  "ปลอดภัย",
  "ไม่เป็นไร",
  "ไม่อันตราย",
  "หายห่วง",
  "ไม่มีปัญหา",
];

/** วรรคตามหลังที่บ่งว่าเป็น "คำถาม" ไม่ใช่คำรับรอง — "ทานได้ไหมคะ" (บอทถาม/ทวนคำถามลูกค้า) ไม่นับผิด */
const QUESTION_TAIL = /^(ไหม|มั้ย|หรือ|รึ|\?)/;

/** หา "คำรับรอง" ในข้อความ (ข้ามรูปคำถาม) — คืนวลีที่ชน (ไม่ซ้ำ) */
export function findAssuranceHits(text: string, phrases: string[] = DEFAULT_ASSURANCE_PHRASES): string[] {
  const hits = new Set<string>();
  for (const raw of phrases) {
    const p = raw.trim();
    if (!p) continue;
    let from = 0;
    while (true) {
      const i = text.indexOf(p, from);
      if (i === -1) break;
      const tail = text.slice(i + p.length, i + p.length + 6);
      if (!QUESTION_TAIL.test(tail)) {
        hits.add(p);
        break;
      }
      from = i + p.length; // รูปคำถาม — ข้ามไปหาตัวถัดไป
    }
  }
  return [...hits];
}

export interface AssuranceCutResult {
  /** ข้อความหลังตัด (บอลลูนว่างถูกทิ้งแล้ว) — "" = ทุกบอลลูนหาย (caller ต้องใช้ fallback ห้ามเงียบ) */
  text: string;
  /** จำนวนบรรทัดที่ถูกตัด */
  cutLines: number;
  /** จำนวนบอลลูนที่ถูกทิ้งทั้งใบ */
  droppedBubbles: number;
}

/**
 * ตัด "ประโยคที่มีคำรับรอง" ทิ้ง — หน่วยประโยค = บรรทัด (ไทยไม่มีจุด · ขึ้นบรรทัด/บอลลูนคือขอบเขตธรรมชาติ)
 * ตัดแล้วบอลลูนว่าง → ทิ้งบอลลูน · เหลือ "" = caller ส่ง fallback สุภาพ (ห้ามบอทเงียบใส่ลูกค้าทุกกรณี — เจ้าของเคาะ)
 */
export function cutAssuranceLines(reply: string, phrases: string[] = DEFAULT_ASSURANCE_PHRASES): AssuranceCutResult {
  let cutLines = 0;
  let droppedBubbles = 0;
  const bubbles = reply.split(/\[\[(?:เว้น|แยก)\]\]/);
  const kept: string[] = [];
  for (const bubble of bubbles) {
    const lines = bubble.split("\n").filter((line) => {
      if (findAssuranceHits(line, phrases).length === 0) return true;
      cutLines += 1;
      return false;
    });
    const rebuilt = lines.join("\n").trim();
    if (rebuilt === "") {
      if (bubble.trim() !== "") droppedBubbles += 1; // บอลลูนที่เคยมีเนื้อแล้วโดนตัดหมด
      continue;
    }
    kept.push(rebuilt);
  }
  return { text: kept.join("[[เว้น]]"), cutLines, droppedBubbles };
}
