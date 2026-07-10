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

/**
 * เช็คคำที่บ่งชี้ handoff ชัดเจนแบบ keyword match ก่อนเรียก Gemini (เร็ว, ประหยัด token)
 * เป็นชั้นแรกของ 2 ชั้น — ชั้นที่สองคือ AI ตัดสิน semantic ผ่าน field handoff ใน JSON output
 */
export function checkHandoffKeywords(text: string, configuredKeywords: string[]): HandoffPreCheckResult {
  const keywords = configuredKeywords.length > 0 ? configuredKeywords : DEFAULT_HANDOFF_KEYWORDS;
  const normalized = text.toLowerCase();

  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (!trimmed) continue;
    if (normalized.includes(trimmed.toLowerCase())) {
      return { matched: true, keyword: trimmed };
    }
  }

  return { matched: false };
}
