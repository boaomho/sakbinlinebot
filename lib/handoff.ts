export interface HandoffPreCheckResult {
  matched: boolean;
  keyword?: string;
}

/** ใช้เมื่อใน Config ไม่ได้ตั้งค่า `คำ_handoff` ไว้เอง */
export const DEFAULT_HANDOFF_KEYWORDS = [
  "ขอคุยกับคน",
  "ขอคุยกับแอดมิน",
  "ขอคุยกับเจ้าของ",
  "ร้องเรียน",
  "ของเสีย",
  "ของไม่ตรงปก",
  "ขายส่ง",
  "รับจำนวนมาก",
  "wholesale",
  "แฟรนไชส์",
  "franchise",
  "ติดต่อสื่อ",
  "สัมภาษณ์",
  "PR",
];

/** keyword ที่เป็น ASCII ล้วน (ไม่มีช่องว่าง) เช่น "PR"/"wholesale" — ต้อง match แบบ word-boundary */
function isAsciiWord(s: string): boolean {
  return /^[\x21-\x7e]+$/.test(s);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * เช็คคำที่บ่งชี้ handoff ชัดเจนแบบ keyword match ก่อนเรียก Gemini (เร็ว, ประหยัด token)
 * เป็นชั้นแรกของ 2 ชั้น — ชั้นที่สองคือ AI ตัดสิน semantic ผ่าน field handoff ใน JSON output
 *
 * 🔴 KI-01 (Step 4): keyword ASCII ล้วน (เช่น "PR") ต้อง match แบบ **word-boundary** ไม่ใช่ substring
 *    เดิม substring → "PR" ชน "promotion"/"express"/"price" → คำถามกลางกรวยโดน handoff บอทเงียบ เสียยอด
 *    คำไทยไม่มีช่องว่างระหว่างคำ (\b ใช้ไม่ได้) → คงใช้ substring ต่อไป
 */
export function checkHandoffKeywords(text: string, configuredKeywords: string[]): HandoffPreCheckResult {
  const keywords = configuredKeywords.length > 0 ? configuredKeywords : DEFAULT_HANDOFF_KEYWORDS;
  const normalized = text.toLowerCase();

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;
    const kw = trimmed.toLowerCase();
    const matched = isAsciiWord(kw)
      ? new RegExp(`\\b${escapeRegex(kw)}\\b`, "i").test(normalized)
      : normalized.includes(kw);
    if (matched) {
      return { matched: true, keyword: trimmed };
    }
  }

  return { matched: false };
}
