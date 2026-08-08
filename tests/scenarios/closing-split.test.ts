import { describe, it, expect } from "vitest";
import { splitClosingQuestion, isClosingQuestion, parseReplyIntoMessages } from "@/lib/line";

/**
 * 🔴 D-61.C6 · ดันคำถามพาไปต่อเป็นบอลลูนสุดท้ายเดี่ยว (deterministic ที่ delivery layer)
 * เหตุผล: LINE มือถือโชว์ preview/noti จากข้อความสุดท้าย — คำถามต้องอยู่ลำพังให้ลูกค้าเห็นเต็มประโยค
 * จุดตัด = ขอบบรรทัด (ไม่ใช่ regex หาประโยค) · ตัวตรวจคำถามใช้ร่วมกับ invariant ชั้น G
 */
const bubblesOf = (s: string) => s.split(/\[\[(?:เว้น|แยก)\]\]/);
const IMG = "[[รูป:https://blob.example/a.jpg]]";

describe("D-61.C6 · splitClosingQuestion", () => {
  it("หลายบรรทัด + บรรทัดสุดท้ายเป็นคำถาม → ตัดออกเป็นบอลลูนใหม่", () => {
    const r = splitClosingQuestion("โปรโมชั่นค่ะ\n- 1 ถ้วย: 125 บาท\n- 3 ถ้วย: 275 บาท\nลูกค้ารับเป็นโปรโมชั่นไหนดีคะ");
    expect(r.changed).toBe(true);
    const bs = bubblesOf(r.text);
    expect(bs).toHaveLength(2);
    expect(bs[1]).toBe("ลูกค้ารับเป็นโปรโมชั่นไหนดีคะ");
    expect(bs[0], "เนื้อเดิมต้องอยู่ครบ").toContain("- 3 ถ้วย: 275 บาท");
    expect(bs[0], "คำถามต้องไม่ค้างในบอลลูนเดิม").not.toContain("ไหนดีคะ");
  });

  it("คำถามเป็นบอลลูนเดี่ยวอยู่แล้ว → ไม่ทำอะไร", () => {
    const src = "โปรโมชั่นค่ะ\n- 1 ถ้วย: 125 บาท[[เว้น]]ลูกค้ารับเป็นโปรโมชั่นไหนดีคะ";
    const r = splitClosingQuestion(src);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(src);
  });

  it("บอลลูนสุดท้ายมีบรรทัดเดียว → ไม่ทำอะไร (ไม่สร้างบอลลูนว่าง)", () => {
    const src = "สวัสดีค่ะ[[เว้น]]สนใจแบบไหนดีคะ";
    expect(splitClosingQuestion(src).changed).toBe(false);
  });

  it("บรรทัดสุดท้ายไม่ใช่คำถาม → ไม่ตัด", () => {
    const src = "สรุปยอดค่ะ\nยอดโอน 275 บาทค่ะ\nทีมแอดมินกำลังแพ็คของเตรียมส่งพอดีเลยค่ะ";
    expect(splitClosingQuestion(src).changed).toBe(false);
  });

  it("บรรทัดสุดท้ายเป็น [[รูป]] → ไม่นับเป็นคำถาม ไม่ตัด", () => {
    const src = `ลูกค้าสนใจแบบไหนดีคะ\n${IMG}`;
    expect(splitClosingQuestion(src).changed).toBe(false);
  });

  it("บรรทัดว่างท้ายบอลลูน → ยังหาบรรทัดคำถามจริงเจอ", () => {
    const r = splitClosingQuestion("โปรค่ะ\n- 1 ถ้วย 125 บาท\nรับเป็นโปรไหนดีคะ\n\n");
    expect(r.changed).toBe(true);
    expect(bubblesOf(r.text)[1]).toBe("รับเป็นโปรไหนดีคะ");
  });

  it("🔴 ชนเพดาน 5 → รวมสองบอลลูนแรก ไม่ทิ้งคำถาม", () => {
    const src = ["บ1", "บ2", "บ3", "บ4", "เนื้อท้าย\nรับเป็นโปรไหนดีคะ"].join("[[เว้น]]");
    expect(parseReplyIntoMessages(src)).toHaveLength(5); // เต็มเพดานอยู่แล้ว
    const r = splitClosingQuestion(src);
    expect(r.changed).toBe(true);
    expect(r.mergedHead).toBe(1);
    const msgs = parseReplyIntoMessages(r.text);
    expect(msgs, "ต้องไม่เกินเพดาน").toHaveLength(5);
    const lastMsg = msgs[msgs.length - 1] as { type: string; text: string };
    expect(lastMsg.type).toBe("text");
    expect(lastMsg.text, "คำถามต้องรอด ไม่ถูกตัดทิ้ง").toBe("รับเป็นโปรไหนดีคะ");
    expect(r.text, "หัวสองบอลลูนแรกถูกรวม").toContain("บ1\nบ2");
  });

  it("🔴 เพดานเต็มเพราะมีรูป (บอลลูนเดียวแตกหลาย message) → ยังคุมเพดานถูก", () => {
    const src = ["บ1", `บ2${IMG}`, "บ3", "เนื้อท้าย\nสนใจแบบไหนดีคะ"].join("[[เว้น]]");
    expect(parseReplyIntoMessages(src), "รูปทำให้เป็น 5 message").toHaveLength(5);
    const r = splitClosingQuestion(src);
    expect(r.changed).toBe(true);
    const msgs = parseReplyIntoMessages(r.text);
    expect(msgs).toHaveLength(5);
    const lastMsg = msgs[msgs.length - 1] as { type: string; text: string };
    expect(lastMsg.text).toBe("สนใจแบบไหนดีคะ");
  });

  it("ตัดแล้วบอลลูนเดิมว่าง (คำถามล้วน มีบรรทัดว่างนำ) → ไม่ตัด", () => {
    expect(splitClosingQuestion("\n\nรับเป็นโปรไหนดีคะ").changed).toBe(false);
  });

  it("ข้อความว่าง → ไม่ล้ม", () => {
    expect(splitClosingQuestion("").changed).toBe(false);
  });

  it("ตัวตรวจคำถามใช้ร่วมกับ invariant ชั้น G (แหล่งเดียว)", () => {
    expect(isClosingQuestion("รับเป็นโปรโมชั่นไหนดีคะ")).toBe(true);
    expect(isClosingQuestion("สะดวกโอนเลยมั้ยคะ")).toBe(true);
    expect(isClosingQuestion("ทีมแอดมินกำลังแพ็คของเตรียมส่งพอดีเลยค่ะ")).toBe(false);
  });
});
