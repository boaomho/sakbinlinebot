import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sendText, sendAdminGroupText } from "../harness/replay";
import { scriptGemini, turn, lineCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { isChannelEnabled, setHumanMode, ensureCustomer } from "@/lib/db";

/**
 * D-53 · สวิตช์บอทราย channel — คำสั่งกลุ่มแอดมิน "ปิด/เปิดบอท line|fb"
 * เช็คต้นทาง: ช่องปิด → บอทเงียบ · รายคนปิด+ช่องเปิด=ยังปิด · "ปิดบอท"เฉยๆ ไม่เปลี่ยน
 */
const U = "Uharnesstestcustomer0000000000053";
const FB_PAGE = "999888777";

beforeAll(() => { process.env.META_PAGE_ID = FB_PAGE; });
beforeEach(() => seedBotLib());

const lastReply = (): string => JSON.stringify(lineCalls.replies[lineCalls.replies.length - 1] ?? {});

describe("D-53 · คำสั่งเปิด/ปิดราย channel + ข้อความยืนยัน", () => {
  it("🔴 ปิดบอท line → line ปิด (fb ยังเปิด) + ตอบยืนยันสถานะทุกช่อง", async () => {
    await sendAdminGroupText("ปิดบอท line");
    expect(await isChannelEnabled("line")).toBe(false);
    expect(await isChannelEnabled(`fb:${FB_PAGE}`), "ช่อง fb ไม่โดน").toBe(true);
    const r = lastReply();
    expect(r).toContain("ปิดบอทช่อง [LINE] แล้ว");
    expect(r, "รายงานครบทุกช่อง").toContain("[LINE] ปิด");
    expect(r).toContain("[FB] เปิด");
  });

  it("🔴 ปิดบอท fb → key fb:<pageId> (ผ่าน messengerPageIds) · เปิดบอท fb → คืน", async () => {
    await sendAdminGroupText("ปิดบอท fb");
    expect(await isChannelEnabled(`fb:${FB_PAGE}`)).toBe(false);
    expect(lastReply()).toContain("ปิดบอทช่อง [FB] แล้ว");
    await sendAdminGroupText("เปิดบอท fb");
    expect(await isChannelEnabled(`fb:${FB_PAGE}`)).toBe(true);
    expect(lastReply()).toContain("เปิดบอทช่อง [FB] แล้ว");
  });

  it("ระบุเพจตรง fb:<pageId> ก็ได้", async () => {
    await sendAdminGroupText(`ปิดบอท fb:${FB_PAGE}`);
    expect(await isChannelEnabled(`fb:${FB_PAGE}`)).toBe(false);
  });
});

describe("D-53 · เช็คต้นทาง + จุดห้ามเปลี่ยน", () => {
  it("🔴 ช่อง LINE ปิด → ลูกค้า LINE ทัก บอทเงียบ (ไม่ตอบ)", async () => {
    await sendAdminGroupText("ปิดบอท line");
    const before = lineCalls.replies.length;
    scriptGemini([turn({ reply: "สวัสดีค่ะ", stage: "S1" })]);
    await sendText(U, "สวัสดี");
    expect(lineCalls.replies.length, "ช่องปิด → ไม่มีคำตอบใหม่").toBe(before);
  });

  it("ช่อง LINE เปิด (default) → ลูกค้าได้คำตอบปกติ", async () => {
    scriptGemini([turn({ reply: "สวัสดีค่ะ รับอะไรดีคะ", stage: "S1" })]);
    await sendText(U, "สวัสดี");
    expect(JSON.stringify(lineCalls.replies)).toContain("สวัสดีค่ะ รับอะไรดีคะ");
  });

  it("🔴 รายคนปิด (human_mode) + ช่องเปิด = ยังปิด (รายคนทับรายช่อง)", async () => {
    await ensureCustomer(U);
    await setHumanMode(U, true); // ปิดรายคน · ช่อง line เปิดอยู่ (default)
    const before = lineCalls.replies.length;
    scriptGemini([turn({ reply: "สวัสดีค่ะ", stage: "S1" })]);
    await sendText(U, "สวัสดี");
    expect(lineCalls.replies.length, "รายคนปิด → ยังเงียบแม้ช่องเปิด").toBe(before);
  });

  it('🔴 "ปิดบอท" เฉยๆ (ไม่มี arg) → ไม่แตะ channel_switches (พฤติกรรมเดิม)', async () => {
    await sendAdminGroupText("ปิดบอท");
    expect(await isChannelEnabled("line"), "ช่อง line ไม่ถูกปิด").toBe(true);
    expect(await isChannelEnabled(`fb:${FB_PAGE}`)).toBe(true);
  });

  it("คำสั่งกลุ่มแอดมินยังทำงานแม้ช่อง LINE ปิด (เปิดคืนได้)", async () => {
    await sendAdminGroupText("ปิดบอท line");
    expect(await isChannelEnabled("line")).toBe(false);
    await sendAdminGroupText("เปิดบอท line"); // สั่งจากกลุ่ม (source=group) ไม่โดน gate
    expect(await isChannelEnabled("line"), "เปิดคืนได้").toBe(true);
  });
});
