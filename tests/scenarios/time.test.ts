import { describe, it, expect } from "vitest";
import { bangkokShift, bangkokDateTime, bangkokYMD, bangkokYMDCompact } from "@/lib/core/time";

/**
 * D-37 · เวลาไทย ฐานเดียว — ทุกจุด (B/Y/order_id/promo/cron/prompt) shift +7 อ่าน getUTC*
 * เทสข้ามวัน (UTC เย็น → ไทยข้ามไปวันถัดไป) = จุดที่เคยพลาด
 */
describe("lib/core/time — Bangkok (UTC+7) ฐานเดียว (D-37)", () => {
  // UTC 2026-07-19 20:00Z → ไทย 2026-07-20 03:00 (ข้ามวัน)
  const CROSS = new Date("2026-07-19T20:00:00Z");
  // UTC 2026-07-18 03:00Z → ไทย 2026-07-18 10:00 (วันเดียวกัน)
  const SAME = new Date("2026-07-18T03:00:00Z");

  it("bangkokDateTime = 'YYYY-MM-DD HH:MM' ไทย (ไม่มี T/Z)", () => {
    expect(bangkokDateTime(CROSS)).toBe("2026-07-20 03:00");
    expect(bangkokDateTime(SAME)).toBe("2026-07-18 10:00");
    expect(bangkokDateTime(CROSS)).not.toMatch(/[TZ]/);
  });

  it("bangkokYMD = 'YYYY-MM-DD' ไทย (ข้ามวันถูก)", () => {
    expect(bangkokYMD(CROSS)).toBe("2026-07-20");
    expect(bangkokYMD(SAME)).toBe("2026-07-18");
  });

  it("bangkokYMDCompact = 'YYYYMMDD' ไทย (order_id date)", () => {
    expect(bangkokYMDCompact(CROSS)).toBe("20260720");
    expect(bangkokYMDCompact(SAME)).toBe("20260718");
  });

  it("bangkokShift +7 ชม.", () => {
    expect(bangkokShift(CROSS).getUTCHours()).toBe(3); // 20+7=27→3 (วันถัดไป)
    expect(bangkokShift(SAME).getUTCHours()).toBe(10);
  });
});
