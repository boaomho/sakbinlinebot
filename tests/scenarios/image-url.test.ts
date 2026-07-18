import { describe, it, expect } from "vitest";
import { parseReplyIntoMessages } from "@/lib/line";

/**
 * 🟢 จุด 3: กันรูปมั่ว — [[รูป:URL]] ต้องเป็น http(s) จริงเท่านั้น
 * บอทเคยแต่ง URL รูป (บร็อคโคลี่มั่ว) หลุดถึงลูกค้า → code guard ข้ามถ้าไม่ใช่ http(s)
 */
describe("parseReplyIntoMessages — [[รูป:URL]] เฉพาะ http(s)", () => {
  it("URL http(s) จริง → ส่งรูป", () => {
    const msgs = parseReplyIntoMessages("ดูรูปนะคะ[[รูป:https://blob.example/npt.jpg]]สนใจมั้ยคะ");
    const img = msgs.find((m) => m.type === "image");
    expect(img, "ต้องมีรูป").toBeTruthy();
  });

  it("🔴 URL ไม่ใช่ http (placeholder/มั่ว) → ข้าม ไม่ส่งรูป", () => {
    const msgs = parseReplyIntoMessages("ดูรูปนะคะ[[รูป:broccoli-image]]สนใจมั้ยคะ");
    expect(msgs.some((m) => m.type === "image"), "URL มั่วต้องถูกข้าม").toBe(false);
    // ข้อความยังอยู่ครบ (บอลลูนสุดท้ายเป็นข้อความ)
    expect(msgs[msgs.length - 1].type).toBe("text");
  });

  it("URL ว่าง → ข้าม", () => {
    const msgs = parseReplyIntoMessages("สวัสดีค่ะ[[รูป:]]");
    expect(msgs.some((m) => m.type === "image")).toBe(false);
  });
});
