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
    maxOutputTokens: 2048,
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

/** ที่อยู่ครบตามกติกา: ชื่อ-นามสกุล + ที่อยู่เต็ม + เบอร์ 10 หลัก */
export const FULL_ADDRESS = {
  ชื่อ: "สมชาย ใจดี",
  เบอร์: "0811122334",
  ที่อยู่: "123/45 หมู่ 6",
  ตำบล: "บางรัก",
  อำเภอ: "เมือง",
  จังหวัด: "ชลบุรี",
  รหัสไปรษณีย์: "20000",
};
