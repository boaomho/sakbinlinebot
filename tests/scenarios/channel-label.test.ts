import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, adminPushes } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { channelLabel } from "@/lib/channel/label";

/** D-52 · ป้ายช่องทางหน้าชื่อลูกค้าในข้อความฝั่งแอดมิน */

const U = "Uharnesstestcustomer0000000000052";

describe("D-52 · channelLabel (helper)", () => {
  it("ต่อ prefix ทั้ง 3 แบบ", () => {
    expect(channelLabel("fb:999888:psid-1")).toBe("[FB]");
    expect(channelLabel("TRAIN:sess-001")).toBe("[ซ้อม]");
    expect(channelLabel("U1234567890abcdef")).toBe("[LINE]");
  });
  it("โครงรองรับหลายเพจ: มีชื่อเพจ → [FB·<ชื่อ>]", () => {
    expect(channelLabel("fb:999888:psid-1", "สากบิน")).toBe("[FB·สากบิน]");
    // pageName ใช้เฉพาะ fb: (LINE/ซ้อม ไม่สน)
    expect(channelLabel("U123", "สากบิน")).toBe("[LINE]");
  });
});

describe("D-52 · ป้ายโผล่ในแจ้งกลุ่มแอดมิน", () => {
  beforeEach(() => seedBotLib());

  it("🔴 handoff → กลุ่มแอดมินเห็น 'ลูกค้า: [LINE] <ชื่อ>' (ป้ายหน้าชื่อ)", async () => {
    scriptGemini([turn({ reply: "ขอตามแอดมินนะคะ", stage: "2", handoff: true, handoffReason: "ขอส่วนลด" })]);
    await sendText(U, "ขอลดหน่อยได้ไหม");
    expect(JSON.stringify(adminPushes()), "ป้าย [LINE] อยู่หน้าชื่อลูกค้า").toContain("ลูกค้า: [LINE]");
  });
});
