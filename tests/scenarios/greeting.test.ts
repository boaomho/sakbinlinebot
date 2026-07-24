import { describe, it, expect } from "vitest";
import { isFirstMessageOfDay, prependToFirstTextBubble, DEFAULT_DAILY_GREETING } from "@/lib/greeting";

/** D-51 ทักทายรายวัน — unit ของ helper (pure · เวลาไทย D-37) */

describe("isFirstMessageOfDay (เวลาไทย)", () => {
  it("ไม่มีประวัติ (ลูกค้าใหม่/หลัง reset) → true เสมอ", () => {
    expect(isFirstMessageOfDay(0, new Date("2026-07-24T05:00:00Z"), new Date("2026-07-24T05:01:00Z"))).toBe(true);
  });
  it("มีประวัติ + วันไทยเดียวกัน → false (เทิร์นสองของวัน)", () => {
    // 2026-07-24 03:00 ไทย และ 06:00 ไทย = วันเดียวกัน
    expect(isFirstMessageOfDay(4, new Date("2026-07-23T20:00:00Z"), new Date("2026-07-23T23:00:00Z"))).toBe(false);
  });
  it("🔴 ข้ามเที่ยงคืนไทย (แม้ UTC วันเดียวกัน) → true", () => {
    // lastSeen 16:00Z = ไทย 23:00 (07-23) · now 18:00Z = ไทย 01:00 (07-24) → คนละวันไทย
    expect(isFirstMessageOfDay(4, new Date("2026-07-23T16:00:00Z"), new Date("2026-07-23T18:00:00Z"))).toBe(true);
  });
});

describe("prependToFirstTextBubble", () => {
  const G = "สวัสดีค่ะ ";
  it("บอลลูนข้อความล้วน → เติมหน้า", () => {
    expect(prependToFirstTextBubble("สนใจโปรไหนดีคะ", G)).toBe("สวัสดีค่ะ สนใจโปรไหนดีคะ");
  });
  it("หลายบอลลูน → เติมเฉพาะบอลลูนแรก (ไม่เพิ่มบอลลูน)", () => {
    expect(prependToFirstTextBubble("บรรทัดแรก[[แยก]]บรรทัดสอง", G)).toBe("สวัสดีค่ะ บรรทัดแรก[[แยก]]บรรทัดสอง");
  });
  it("🔴 บอลลูนแรกเป็นรูป → เติมที่บอลลูนข้อความถัดไป", () => {
    expect(prependToFirstTextBubble("[[รูป:http://x/a.jpg]][[เว้น]]ข้อความ", G)).toBe("[[รูป:http://x/a.jpg]][[เว้น]]สวัสดีค่ะ ข้อความ");
  });
  it("รูป+ข้อความในบอลลูนเดียว → เติมก่อนข้อความ (หลังรูป)", () => {
    expect(prependToFirstTextBubble("[[รูป:http://x/a.jpg]]ข้อความ", G)).toBe("[[รูป:http://x/a.jpg]]สวัสดีค่ะ ข้อความ");
  });
  it("มี space นำ → คงไว้ เติมก่อนอักขระจริง", () => {
    expect(prependToFirstTextBubble("  ข้อความ", G)).toBe("  สวัสดีค่ะ ข้อความ");
  });
  it("prefix ว่าง → ไม่แตะ · รูปล้วน → ไม่แตะ", () => {
    expect(prependToFirstTextBubble("ข้อความ", "")).toBe("ข้อความ");
    expect(prependToFirstTextBubble("[[รูป:http://x/a.jpg]]", G)).toBe("[[รูป:http://x/a.jpg]]");
  });
  it("ค่าเริ่มมี space ท้าย (กลืนกับข้อความ)", () => {
    expect(DEFAULT_DAILY_GREETING).toBe("สวัสดีค่ะ ");
  });
});
