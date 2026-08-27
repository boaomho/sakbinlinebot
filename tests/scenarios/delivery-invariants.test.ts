import { describe, it, expect, beforeEach } from "vitest";
import { parseReplyIntoMessages } from "@/lib/line";
import { seedBotLib } from "../harness/botlib-fixture";

/**
 * D-68 · delivery invariants — ล็อกพฤติกรรม `parseReplyIntoMessages` (ชั้นส่งจริงถึงลูกค้า)
 * เดิมชื่อ line-freeze-baseline (D-67 · พิสูจน์ v2 freeze) — v2 ถูกถอดแล้ว แต่ fixture ชุดนี้
 * ยังคุ้ม เพราะมันคุมเคสที่**ไม่มีไฟล์อื่นคุม**: จบด้วยรูป→สลับ · รูปล้วน→เติมข้อความปิด ·
 * เกิน 5→ตัด · quota-saver ยุบ+รูป · [[รูป:{ตัวแปรค้าง}] — กฎเหล็กที่ v3 ใช้เต็ม ๆ
 * 🔴 BASELINE จับจากโค้ด fd6923c (ก่อน D-67) — เทสนี้แดง = พฤติกรรมที่ลูกค้าได้รับเปลี่ยน
 *    ห้ามอัปเดต fixture ตามโค้ดใหม่โดยไม่มีเหตุที่เจ้าของเคาะ
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

describe("D-68 · delivery invariants — message ที่ลูกค้าได้รับต้องคงเดิม", () => {
  beforeEach(() => seedBotLib());
  for (const c of BASELINE) {
    it(c.name, () => {
      expect(parseReplyIntoMessages(c.reply, c.collapse)).toEqual(c.messages);
    });
  }
});
