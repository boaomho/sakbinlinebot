import { expect } from "vitest";
import type { messagingApi } from "@line/bot-sdk";
import { customerMessages } from "./state";

/**
 * Assertion กลาง (บรีฟ v1.5 Step 9) — ทุก scenario ต้องผ่าน
 * บทที่ยังไม่มีฟีเจอร์รองรับ ให้ mark expect-fail ที่ตัว scenario ไม่ใช่ยกเว้นตรงนี้
 */

/** stage ที่ v1.2 ใช้จริง — Step 6 จะเปลี่ยนเป็น enum เข้ม S1..H4 แล้วค่อยอัปเดตลิสต์นี้ */
export const V1_2_STAGES = ["1", "2", "3", "4a", "4b", "4c"];

const VAR_LEAK = /\{[^}\n]{1,40}\}/;

function textOf(m: messagingApi.Message): string {
  return m.type === "text" ? (m as messagingApi.TextMessage).text : "";
}

/** ✅ บอลลูนสุดท้ายต้องเป็นข้อความเสมอ ห้ามจบด้วยรูป (กฎเหล็กข้อ 9) */
export function assertLastBubbleIsText(messages: messagingApi.Message[]): void {
  if (messages.length === 0) return;
  const last = messages[messages.length - 1];
  expect(last.type, `บอลลูนสุดท้ายต้องเป็นข้อความ แต่เป็น "${last.type}"`).toBe("text");
}

/** ✅ ห้ามมี {ตัวแปร} หลุดไปหาลูกค้า */
export function assertNoVariableLeak(messages: messagingApi.Message[]): void {
  for (const m of messages) {
    const t = textOf(m);
    if (!t) continue;
    const hit = t.match(VAR_LEAK);
    expect(hit, `เจอ {ตัวแปร} หลุดไปหาลูกค้า: ${hit?.[0]}`).toBeNull();
  }
}

/** ✅ ห้ามส่งบอลลูนว่าง */
export function assertNoEmptyBubble(messages: messagingApi.Message[]): void {
  for (const m of messages) {
    if (m.type !== "text") continue;
    expect(textOf(m).trim().length, "เจอบอลลูนข้อความว่าง").toBeGreaterThan(0);
  }
}

/** รวม assertion กลางทุกข้อ กับทุกข้อความที่ส่งถึงลูกค้าในบทนั้น */
export function assertCentral(userId: string): void {
  const batches = customerMessages(userId);
  for (const messages of batches) {
    assertLastBubbleIsText(messages);
    assertNoVariableLeak(messages);
    assertNoEmptyBubble(messages);
  }
}

/** ✅ stage ที่ "เก็บลง DB จริง" ต้องอยู่ในเซ็ตที่รู้จัก */
export function assertStageInEnum(stage: unknown): void {
  if (stage === null || stage === undefined) return;
  expect(V1_2_STAGES, `stage "${String(stage)}" ไม่อยู่ใน enum`).toContain(String(stage));
}

// ---- assertion ที่ยังไม่มีฟีเจอร์รองรับใน v1.2 (โครงไว้ ใช้จริงตอน Step 3/4/5) ----

/** ❌ Step 4 — ห้ามมีคำใน `คำต้องห้าม_โฆษณา` */
export function assertNoForbiddenClaims(userId: string, forbidden: string[]): void {
  for (const messages of customerMessages(userId)) {
    for (const m of messages) {
      const t = textOf(m);
      for (const word of forbidden) {
        expect(t.includes(word), `เจอคำต้องห้ามโฆษณา "${word}"`).toBe(false);
      }
    }
  }
}

/** ❌ Step 3 — ห้ามมีตัวเลขราคาที่ไม่มีใน catalog */
export function assertNoPriceOutsideCatalog(userId: string, allowedPrices: string[]): void {
  for (const messages of customerMessages(userId)) {
    for (const m of messages) {
      const t = textOf(m);
      const nums = t.match(/\d{2,5}(?=\s*(บาท|฿))/g) ?? [];
      for (const n of nums) {
        expect(allowedPrices, `ราคา ${n} ไม่มีใน CSV_Products/CSV_Promo`).toContain(n);
      }
    }
  }
}
