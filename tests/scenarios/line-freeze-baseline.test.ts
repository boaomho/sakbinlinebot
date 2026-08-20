import { describe, it, expect, beforeEach } from "vitest";
import { parseReplyIntoMessages } from "@/lib/line";
import { seedBotLib } from "../harness/botlib-fixture";

/**
 * D-67 ข้อ 6 — ตัวพิสูจน์ v2 freeze (D-66): parseReplyIntoMessages ต้องให้ message ชุดเดิมเป๊ะ
 * 🔴 BASELINE ข้างล่างจับจากโค้ด *ก่อนแก้ D-67* (main fd6923c) ด้วย tmp/capture-line-baseline.ts
 *    — ห้ามอัปเดต fixture ตามโค้ดใหม่โดยไม่มีเหตุ: ถ้าเทสนี้แดง แปลว่าพฤติกรรม delivery เปลี่ยน
 *    ซึ่งกระทบ v2 ที่ frozen อยู่ · การแก้ shared infra ได้เฉพาะแบบที่เทสนี้ยังเขียว (เกณฑ์ D-67)
 */
const BASELINE: { name: string; reply: string; collapse: boolean; messages: unknown[] }[] = [
  {
    "name": "text เดียว",
    "reply": "สวัสดีค่ะ",
    "collapse": false,
    "messages": [
      {
        "type": "text",
        "text": "สวัสดีค่ะ"
      }
    ]
  },
  {
    "name": "หลายบอลลูน [[เว้น]]",
    "reply": "ก[[เว้น]]ข[[เว้น]]ค",
    "collapse": false,
    "messages": [
      {
        "type": "text",
        "text": "ก"
      },
      {
        "type": "text",
        "text": "ข"
      },
      {
        "type": "text",
        "text": "ค"
      }
    ]
  },
  {
    "name": "alias [[แยก]]",
    "reply": "ก[[แยก]]ข",
    "collapse": false,
    "messages": [
      {
        "type": "text",
        "text": "ก"
      },
      {
        "type": "text",
        "text": "ข"
      }
    ]
  },
  {
    "name": "รูป URL จริง กลางข้อความ",
    "reply": "ดูรูปนะคะ[[รูป:https://x.test/a.jpg]]สนใจมั้ยคะ",
    "collapse": false,
    "messages": [
      {
        "type": "text",
        "text": "ดูรูปนะคะ"
      },
      {
        "type": "image",
        "originalContentUrl": "https://x.test/a.jpg",
        "previewImageUrl": "https://x.test/a.jpg"
      },
      {
        "type": "text",
        "text": "สนใจมั้ยคะ"
      }
    ]
  },
  {
    "name": "รูป URL มั่ว → ข้าม",
    "reply": "ดูรูปนะคะ[[รูป:broccoli]]สนใจมั้ยคะ",
    "collapse": false,
    "messages": [
      {
        "type": "text",
        "text": "ดูรูปนะคะ"
      },
      {
        "type": "text",
        "text": "สนใจมั้ยคะ"
      }
    ]
  },
  {
    "name": "รูปตัวแปรค้าง → ข้าม",
    "reply": "ก[[เว้น]][[รูป:{รูปโปรโมชั่น}]][[เว้น]]ข",
    "collapse": false,
    "messages": [
      {
        "type": "text",
        "text": "ก"
      },
      {
        "type": "text",
        "text": "ข"
      }
    ]
  },
  {
    "name": "จบด้วยรูป → สลับ",
    "reply": "ข้อความ[[เว้น]][[รูป:https://x.test/a.jpg]]",
    "collapse": false,
    "messages": [
      {
        "type": "image",
        "originalContentUrl": "https://x.test/a.jpg",
        "previewImageUrl": "https://x.test/a.jpg"
      },
      {
        "type": "text",
        "text": "ข้อความ"
      }
    ]
  },
  {
    "name": "รูปล้วน → เติมปิดท้าย",
    "reply": "[[รูป:https://x.test/a.jpg]]",
    "collapse": false,
    "messages": [
      {
        "type": "image",
        "originalContentUrl": "https://x.test/a.jpg",
        "previewImageUrl": "https://x.test/a.jpg"
      },
      {
        "type": "text",
        "text": "สอบถามเพิ่มเติมได้เลยนะคะ"
      }
    ]
  },
  {
    "name": "เกิน 5 → ตัด",
    "reply": "1[[เว้น]]2[[เว้น]]3[[เว้น]]4[[เว้น]]5[[เว้น]]6",
    "collapse": false,
    "messages": [
      {
        "type": "text",
        "text": "1"
      },
      {
        "type": "text",
        "text": "2"
      },
      {
        "type": "text",
        "text": "3"
      },
      {
        "type": "text",
        "text": "4"
      },
      {
        "type": "text",
        "text": "5"
      }
    ]
  },
  {
    "name": "quota-saver ยุบ",
    "reply": "ก[[เว้น]]ข[[เว้น]]ค",
    "collapse": true,
    "messages": [
      {
        "type": "text",
        "text": "ก\n\nข\n\nค"
      }
    ]
  },
  {
    "name": "quota-saver + รูป",
    "reply": "ก[[เว้น]][[รูป:https://x.test/a.jpg]][[เว้น]]ข",
    "collapse": true,
    "messages": [
      {
        "type": "text",
        "text": "ก"
      },
      {
        "type": "image",
        "originalContentUrl": "https://x.test/a.jpg",
        "previewImageUrl": "https://x.test/a.jpg"
      },
      {
        "type": "text",
        "text": "ข"
      }
    ]
  },
  {
    "name": "quota-saver + รูปมั่ว",
    "reply": "ก[[เว้น]][[รูป:{ตัวแปรค้าง}]][[เว้น]]ข",
    "collapse": true,
    "messages": [
      {
        "type": "text",
        "text": "ก"
      },
      {
        "type": "text",
        "text": "ข"
      }
    ]
  },
  {
    "name": "\\n ในบอลลูน",
    "reply": "บรรทัด1\nบรรทัด2[[เว้น]]ท้าย",
    "collapse": false,
    "messages": [
      {
        "type": "text",
        "text": "บรรทัด1\nบรรทัด2"
      },
      {
        "type": "text",
        "text": "ท้าย"
      }
    ]
  }
];

describe("D-67 · v2-freeze proof — message ชุดเดิมเป๊ะหลังแตะ line.ts", () => {
  beforeEach(() => seedBotLib());
  for (const c of BASELINE) {
    it(c.name, () => {
      expect(parseReplyIntoMessages(c.reply, c.collapse)).toEqual(c.messages);
    });
  }
});
