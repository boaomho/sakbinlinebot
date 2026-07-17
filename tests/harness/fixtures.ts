import type { AppConfig } from "@/lib/config";
import { DEFAULT_HANDOFF_KEYWORDS } from "@/lib/handoff";

export const STEP_CSV = `ประตู,เป้าหมาย,หลักการ
1,ทักทาย+จับความสนใจ,ถามว่าสนใจตัวไหน
2,นำเสนอ+ปิดการขาย,สรุปยอดแล้วชวนตัดสินใจ
3,รับชำระ,เสนอโอน/COD
4a,รับสลิป,รับทราบอบอุ่น
4b,รับที่อยู่,ขอเฉพาะที่ยังขาด แล้วแจ้งวันจัดส่ง
`;

export const FAQ_CSV = `คำถาม,คำตอบ
ส่งกี่วัน,ส่งภายใน 1-2 วันทำการค่ะ
เก็บได้นานมั้ย,เก็บในตู้เย็นได้ 1 เดือนค่ะ
`;

/**
 * Config คงที่สำหรับ harness — mock ที่ getConfig() (resolveFeatureSwitches ยังเป็นของจริง
 * และอ่าน process.env จาก .env.test)
 *
 * debounceWaitMs สั้น (80ms) เพื่อให้บท 9 รันไว · quotaSaver=false เพื่อให้ [[เว้น]] แตก
 * เป็นหลายบับเบิลจริง → assertion "บอลลูนสุดท้ายเป็นข้อความ" ได้ทดสอบของจริง
 */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const raw = new Map<string, string>([
    ["ชื่อบอท", "ปลาทู"],
    ["ชื่อร้าน", "สากบิน"],
    ["เวลาตัดรอบออเดอร์", "12:00"],
  ]);

  return {
    botName: "ปลาทู",
    shopName: "สากบิน",
    personaGender: "หญิง",
    useEmoji: false,
    temperature: 1.0,
    maxOutputTokens: 4096,
    showTyping: false,
    debounceWaitMs: 80,
    delayBetweenBubblesMs: 0,
    slipUrlExpiryDays: 7,
    orderCutoffTime: "12:00",
    orderNumberResetDaily: true,
    handoffKeywords: [...DEFAULT_HANDOFF_KEYWORDS],
    adminSilenceReturnMinutes: 45,
    botResumeMessage: "ปลาทูมาดูแลต่อเองนะคะ",
    testCommandsEnabled: true,
    quotaSaver: false,
    rawSwitches: {
      tagging: true,
      handoff: true,
      orders: true,
      follow: false,
      flexCards: false,
      timing: true,
    },
    raw,
    loadFailed: false,
    ...overrides,
  };
}

/**
 * ข้อมูลครบตามกติกาใหม่: ชื่อ + เบอร์ + ที่อยู่(ก้อนไม่ว่าง)
 * ที่อยู่เป็น "ก้อนเดียว" ตามที่ลูกค้าพิมพ์ — ไม่มีช่อง ตำบล/อำเภอ แล้ว
 * จังหวัด/รหัส = metadata (หยิบได้ก็ใส่ ไม่กระทบการปิดออเดอร์)
 */
export const FULL_ADDRESS = {
  ชื่อ: "สมชาย ใจดี",
  เบอร์: "0811122334",
  ที่อยู่: "123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.ชลบุรี 20000",
  จังหวัด: "ชลบุรี",
  รหัสไปรษณีย์: "20000",
};

/**
 * 🔴 เคสจริงที่พังในโปรดักชัน: ลูกค้าพิมพ์ที่อยู่ก้อนเดียว ไม่มี ต./อ./จ. นำ
 * AI จึงส่งมาแค่ ชื่อ/ที่อยู่/รหัส/เบอร์ → addressComplete เดิมบังคับ ต./อ./จ. → complete=false ตลอด
 * → ออเดอร์ที่ลูกค้าตกลงแล้วหายเงียบ
 */
export const REAL_BROKEN_CASE = {
  ชื่อ: "สมหญิง ใจดี",
  เบอร์: "081-112 2334", // มีขีด+เว้นวรรค — sanitizePhone ต้องจับได้
  ที่อยู่: "123/45 ม.6 บางพลีใหญ่ บางพลี สมุทรปราการ 10540",
  รหัสไปรษณีย์: "10540",
};
