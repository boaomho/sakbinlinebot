import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * 🔴 D-33 guard — "ปิดบอท (setHumanMode true) + แจ้งแอดมินแบบ handoff" ต้องมาจากประตูรวม handoff() เท่านั้น
 * ถ้าใครเขียน handoff ใหม่แล้ว push/setHumanMode เองนอกประตู (แบบ X2/damage เดิม) → เทสนี้แดง
 * (setHumanMode(false)=auto-return · setHumanMode(userId,close)=คำสั่งแอดมิน — คนละเรื่อง ไม่นับ)
 */
const src = readFileSync(resolve(process.cwd(), "app/api/line-webhook/route.ts"), "utf8");

describe("handoff guard — ปิดบอทผ่านประตูรวมที่เดียว (D-33)", () => {
  it("มี call จริง 'await setHumanMode(userId, true)' จุดเดียวในไฟล์", () => {
    const m = src.match(/await setHumanMode\(userId,\s*true\)/g) ?? [];
    expect(m.length, "ปิดบอทต้องมาจาก handoff() ที่เดียว · >1 = มีคนปิดบอทนอกประตู (handoff จะไม่มี footer)").toBe(1);
  });

  it("จุดนั้นอยู่ในฟังก์ชัน handoff()", () => {
    const fnStart = src.indexOf("async function handoff(");
    expect(fnStart, "ต้องมีประตูรวม handoff()").toBeGreaterThanOrEqual(0);
    const nextFn = src.indexOf("\nasync function ", fnStart + 1);
    const setIdx = src.indexOf("await setHumanMode(userId, true)");
    expect(setIdx).toBeGreaterThan(fnStart);
    expect(setIdx, "setHumanMode(true) ต้องอยู่ในบล็อก handoff()").toBeLessThan(nextFn);
  });

  it("handoff() แนบ footer มาตรฐานเสมอ", () => {
    expect(src).toContain("บอทปิดการทำงานกับลูกค้ารายนี้แล้ว");
  });
});
