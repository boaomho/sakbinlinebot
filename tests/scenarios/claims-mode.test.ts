import { describe, it, expect, beforeEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, adminPushes, lineCalls, harnessOverrides } from "../harness/state";
import { seedBotLib, PRICING_CONFIG } from "../harness/botlib-fixture";
import { messagingApi } from "@line/bot-sdk";

/**
 * D-26 claims guard (พ.ร.บ.อาหาร) — โหมด เตือน(default)=ส่ง+push · บล็อก=ไม่ส่ง+พักสาย+push
 * คำต้องห้าม/คำยกเว้น/โหมด อ่านจาก CSV_Config (เจ้าของสลับโหมดในชีตเองได้ ไม่ deploy)
 */

const U = "Uharnesstestcustomer0000000000009";

function configWithClaims(mode: string): Map<string, string> {
  return new Map<string, string>([
    ...Object.entries(PRICING_CONFIG),
    ["คำต้องห้าม_โฆษณา", "ช่วยรักษา,รักษาโรค,ลดน้ำหนัก"],
    ["คำยกเว้น_โฆษณา", "เก็บรักษา,วิธีเก็บรักษา,ลดราคา"],
    ["โหมดคำต้องห้าม", mode],
  ]);
}

function customerText(): string {
  return lineCalls.replies
    .flatMap((r) => r.messages)
    .filter((m): m is messagingApi.TextMessage => m.type === "text")
    .map((m) => m.text)
    .join(" ");
}

beforeEach(() => seedBotLib());

describe("claims guard โหมด 'เตือน' (default) — ส่งข้อความปกติ + push แอดมิน", () => {
  it("บอทพูดคำต้องห้าม → ลูกค้ายังได้รับข้อความ · แอดมินถูกเตือน", async () => {
    harnessOverrides.config = { raw: configWithClaims("เตือน") };
    scriptGemini([turn({ reply: "น้ำพริกนี้ช่วยรักษาโรคกระเพาะได้ค่ะ", stage: "2" })]);

    await sendText(U, "กินแล้วดีต่อสุขภาพไหม");

    expect(customerText(), "โหมดเตือน = ส่งของจริงออก").toContain("ช่วยรักษา");
    const admin = JSON.stringify(adminPushes());
    expect(admin).toContain("คำโฆษณาต้องห้าม");
    expect(admin, "ต้องบอกวลีที่ชน").toContain("ช่วยรักษา");
  });
});

describe("claims guard โหมด 'บล็อก' — ไม่ส่งของจริง + พักสาย + push แอดมิน", () => {
  it("บอทพูดคำต้องห้าม → ลูกค้าได้ข้อความพักสาย (ไม่มีคำต้องห้าม) · แอดมินถูกเตือน", async () => {
    harnessOverrides.config = { raw: configWithClaims("บล็อก") };
    scriptGemini([turn({ reply: "น้ำพริกนี้ช่วยรักษาโรคกระเพาะได้ค่ะ", stage: "2" })]);

    await sendText(U, "กินแล้วดีต่อสุขภาพไหม");

    const text = customerText();
    expect(text, "โหมดบล็อก = ไม่ส่งคำต้องห้าม").not.toContain("ช่วยรักษา");
    expect(text, "ส่งข้อความพักสายแทน").toContain("เช็คข้อมูล");
    expect(JSON.stringify(adminPushes())).toContain("คำโฆษณาต้องห้าม");
  });
});

describe("claims guard — คำยกเว้นไม่ถูกบล็อก (วิธีเก็บรักษา)", () => {
  it("บอทพูด 'วิธีเก็บรักษา' → ไม่ถูกจับ ส่งปกติ ไม่ push", async () => {
    harnessOverrides.config = { raw: configWithClaims("บล็อก") };
    scriptGemini([turn({ reply: "วิธีเก็บรักษาน้ำพริกให้อยู่ได้นาน เก็บในตู้เย็นนะคะ", stage: "2" })]);

    await sendText(U, "เก็บยังไงดี");

    expect(customerText()).toContain("วิธีเก็บรักษา");
    expect(JSON.stringify(adminPushes()), "คำยกเว้น ไม่ต้องเตือนแอดมิน").not.toContain("คำโฆษณาต้องห้าม");
  });
});
