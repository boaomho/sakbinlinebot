import { describe, it, expect } from "vitest";
import { checkHandoffKeywords, DEFAULT_HANDOFF_KEYWORDS } from "@/lib/handoff";

/**
 * KI-01 (Step 4): keyword ASCII ล้วน ต้อง match แบบ word-boundary ไม่ใช่ substring
 * (เดิม "PR" ชน promotion/express/price → คำถามกลางกรวยโดน handoff บอทเงียบ เสียยอด)
 * คำไทย (ไม่มีช่องว่างระหว่างคำ) ยังใช้ substring
 *
 * D-44: default หดเหลือ H1 สุขภาพ/แพ้ + ขอคุยกับคน + ฟ้อง (ตรงชีต v2.0 คำต่อคำ)
 * ตัด ร้องเรียน/ของเสีย/ขายส่ง/แฟรนไชส์/สื่อ/PR → เข้า H2-H4 (intake · บอทถามก่อนส่งคน)
 */

describe("checkHandoffKeywords — D-44 default หด + KI-01 word-boundary", () => {
  it("🔴 H1 สุขภาพ/แพ้ → handoff ทันทีเสมอ (เส้นตาย พ.ร.บ.อาหาร)", () => {
    for (const msg of [
      "แพ้กุ้งกินได้มั้ยคะ",
      "เป็นภูมิแพ้อาหารทะเลค่ะ",
      "ตอนนี้ท้องอยู่ กินได้ไหม",
      "ตั้งครรภ์ 5 เดือนค่ะ",
      "แม่ให้นมลูกอยู่ค่ะ",
      "เป็นเบาหวานกับความดันค่ะ",
      "เป็นโรคไตทานได้มั้ย",
      "กินยาละลายลิ่มเลือดอยู่ค่ะ",
    ]) {
      expect(checkHandoffKeywords(msg, []).matched, msg).toBe(true);
    }
  });

  it("ขอคุยกับคน/แอดมิน/เจ้าของ + ฟ้อง → handoff ทันที", () => {
    expect(checkHandoffKeywords("อยากขอคุยกับแอดมินหน่อยค่ะ", []).matched).toBe(true);
    expect(checkHandoffKeywords("ขอแอดมินมาตอบหน่อย", []).matched).toBe(true);
    expect(checkHandoffKeywords("ขอเบอร์เจ้าของร้าน", []).matched).toBe(true);
    expect(checkHandoffKeywords("เดี๋ยวเจอกันในศาล จะฟ้องให้ดู", []).matched).toBe(true);
  });

  it("🔴 D-44: คำที่ตัดออก (เคลม/ขายส่ง/สื่อ) → ไม่ pre-check แล้ว (เข้า H2-H4 intake)", () => {
    for (const msg of ["ของเสียมาเลยค่ะ", "สนใจขายส่งไหมคะ", "อยากร้องเรียนพนักงาน", "สนใจ franchise", "ติดต่อ PR ค่ะ"]) {
      expect(checkHandoffKeywords(msg, []).matched, msg).toBe(false);
    }
  });

  it("🔴 KI-01: keyword ASCII จากชีต ยัง match แบบ word-boundary (ไม่ชน substring)", () => {
    expect(checkHandoffKeywords("มี promotion อะไรบ้าง", ["PR"]).matched).toBe(false);
    expect(checkHandoffKeywords("price เท่าไหร่คะ", ["PR"]).matched).toBe(false);
    expect(checkHandoffKeywords("ติดต่อ PR ค่ะ", ["PR"]).matched).toBe(true);
    expect(checkHandoffKeywords("wholesalery", ["wholesale"]).matched).toBe(false);
    expect(checkHandoffKeywords("do you do wholesale?", ["wholesale"]).keyword).toBe("wholesale");
  });

  it("ใช้ configuredKeywords จากชีตแทน default เมื่อมี", () => {
    const r = checkHandoffKeywords("อยากได้ใบกำกับภาษี", ["ใบกำกับภาษี"]);
    expect(r).toEqual({ matched: true, keyword: "ใบกำกับภาษี" });
    // ค่า default ไม่ถูกใช้เมื่อ config กำหนดเอง
    expect(checkHandoffKeywords("คุยกับคน", ["ใบกำกับภาษี"]).matched).toBe(false);
  });

  it("คำถามกลางกรวยปกติ → ไม่ handoff · default ตรงชีต v2.0 (19 คำ · ไม่มี ASCII)", () => {
    expect(checkHandoffKeywords("น้ำพริก 3 ถ้วยเท่าไหร่คะ", []).matched).toBe(false);
    expect(checkHandoffKeywords("มีโปรโมชั่นอะไรบ้างคะ", []).matched).toBe(false);
    expect(DEFAULT_HANDOFF_KEYWORDS).toHaveLength(19);
    expect(DEFAULT_HANDOFF_KEYWORDS).toContain("แพ้");
    expect(DEFAULT_HANDOFF_KEYWORDS).not.toContain("ของเสีย");
    expect(DEFAULT_HANDOFF_KEYWORDS).not.toContain("PR");
  });
});
