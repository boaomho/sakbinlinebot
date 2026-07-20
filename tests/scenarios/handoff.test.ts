import { describe, it, expect } from "vitest";
import { checkHandoffKeywords, DEFAULT_HANDOFF_KEYWORDS } from "@/lib/handoff";

/**
 * KI-01 (Step 4): keyword ASCII ล้วน ("PR") ต้อง match แบบ word-boundary ไม่ใช่ substring
 * เดิม "PR" ชน promotion/express/price → คำถามกลางกรวยโดน handoff บอทเงียบ เสียยอด
 * คำไทย (ไม่มีช่องว่างระหว่างคำ) ยังใช้ substring
 */

describe("checkHandoffKeywords — ASCII word-boundary · ไทย substring (KI-01)", () => {
  it("🔴 'PR' ต้องไม่ชน promotion/express/price (คำถามกลางกรวย ตอบเองได้)", () => {
    for (const msg of ["มี promotion อะไรบ้าง", "ส่ง express ได้มั้ย", "price เท่าไหร่คะ", "prompt payment ได้ไหม"]) {
      expect(checkHandoffKeywords(msg, []).matched, msg).toBe(false);
    }
  });

  it("'PR' แบบยืนเดี่ยว (มี word-boundary) → ยัง handoff ได้", () => {
    expect(checkHandoffKeywords("ติดต่อ PR ค่ะ", []).matched).toBe(true);
    expect(checkHandoffKeywords("ขอฝาก PR หน่อย", []).matched).toBe(true);
  });

  it("keyword ASCII อื่น (wholesale/franchise) ยัง match เมื่อยืนเป็นคำ", () => {
    expect(checkHandoffKeywords("do you do wholesale?", []).keyword).toBe("wholesale");
    expect(checkHandoffKeywords("สนใจ franchise", []).matched).toBe(true);
    // แต่ไม่ชนคำที่มันเป็น substring ข้างใน (กันซ้ำรอย PR)
    expect(checkHandoffKeywords("wholesalery", []).matched).toBe(false);
  });

  it("คำไทย (ไม่มีช่องว่าง) ยังใช้ substring ตามเดิม", () => {
    expect(checkHandoffKeywords("อยากขอคุยกับแอดมินหน่อยค่ะ", []).matched).toBe(true);
    expect(checkHandoffKeywords("ของเสียมาเลยค่ะ", []).matched).toBe(true);
    expect(checkHandoffKeywords("สนใจขายส่งไหมคะ", []).matched).toBe(true);
  });

  it("ใช้ configuredKeywords จากชีตแทน default เมื่อมี", () => {
    const r = checkHandoffKeywords("อยากได้ใบกำกับภาษี", ["ใบกำกับภาษี"]);
    expect(r).toEqual({ matched: true, keyword: "ใบกำกับภาษี" });
    // ค่า default ไม่ถูกใช้เมื่อ config กำหนดเอง
    expect(checkHandoffKeywords("ขอคุยกับคน", ["ใบกำกับภาษี"]).matched).toBe(false);
  });

  it("ไม่มีคำตรง → ไม่ handoff", () => {
    expect(checkHandoffKeywords("น้ำพริก 3 ถ้วยเท่าไหร่คะ", []).matched).toBe(false);
    expect(DEFAULT_HANDOFF_KEYWORDS).toContain("PR");
  });
});
