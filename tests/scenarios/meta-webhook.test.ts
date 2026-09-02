import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { scriptGemini, turn, lineCalls } from "../harness/state";
import { seedBotLib, v3StepRows } from "../harness/botlib-fixture";
import { ensureCustomer, getCustomer } from "@/lib/db";
import { setLastSeenAgo } from "../harness/db";
import { verifyMetaSignature, BOT_ECHO_MARK } from "@/lib/channel/meta";
import { metaVerifyChallenge, processMetaWebhook, metaUserId } from "@/lib/channel/meta-webhook";
import { resolvePageContext } from "@/lib/channel/pages";
import { MessengerTransport } from "@/lib/channel/transport";
import { slipPathname } from "@/lib/blob";
import type { PageContext } from "@/lib/channel/pages";
import type { AppConfig } from "@/lib/config";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";
const APP_ID = "111222333";
const PAGE_ID = "999888777";
const PSID = "psid-abc-001";

/** S1 (v3) — v3 เรียบเรียงสดเสมอ ใช้ reply ของ AI (scripted) */
function stepSheet(): string[][] {
  return v3StepRows([{ step_id: "S1", essence: "ทักทาย" }]);
}

const graphCalls: { url: string; body: Record<string, unknown> }[] = [];
let realFetch: typeof fetch;

beforeAll(() => {
  realFetch = global.fetch;
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.META_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.META_APP_ID = APP_ID;
  process.env.META_PAGE_ID = PAGE_ID;
  process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
});

beforeEach(() => {
  graphCalls.length = 0;
  vi.stubGlobal("fetch", async (url: unknown, opts?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.includes("graph.facebook.com")) {
      if (opts?.method === "POST" && opts.body) graphCalls.push({ url: u, body: JSON.parse(opts.body) });
      if (u.includes("fields=name")) return new Response(JSON.stringify({ name: "ลูกค้าเมสเซนเจอร์" }), { status: 200 });
      return new Response(JSON.stringify({ recipient_id: PSID, message_id: "m1" }), { status: 200 });
    }
    if (u.includes("cdn.test")) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    return realFetch(url as string, opts as RequestInit);
  });
});
afterEach(() => vi.unstubAllGlobals());

function sign(rawBody: string): string {
  return "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(rawBody, "utf8").digest("hex");
}
function textEvent(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ object: "page", entry: [{ id: PAGE_ID, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE_ID }, message: { mid: "mid1", text, ...extra } }] }] });
}
/**
 * 🔴 D-76: echo event ของ Meta **กลับด้าน** — sender = เพจ · recipient = ลูกค้า (PSID)
 * fixture เดิมใส่ sender=PSID (ไม่ใช่ของจริง) → เทสผ่านทั้งที่โปรดักชันเซ็ต human_mode ผิด id มาตลอด
 */
function echoEvent(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    object: "page",
    entry: [{ id: PAGE_ID, messaging: [{ sender: { id: PAGE_ID }, recipient: { id: PSID }, message: { mid: "mid-echo", is_echo: true, text, ...extra } }] }],
  });
}
const textSends = (): string[] => graphCalls.filter((c) => (c.body.message as { text?: string })?.text).map((c) => (c.body.message as { text: string }).text);

describe("M-2 · verifyMetaSignature", () => {
  it("ลายเซ็นถูก → true · ถูกแก้ → false · ไม่มี header → false", () => {
    const body = textEvent("hi");
    expect(verifyMetaSignature(body, sign(body), APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(body, sign(body + "x"), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, null, APP_SECRET)).toBe(false);
  });
});

describe("M-2 · GET verify challenge", () => {
  it("token ตรง → คืน challenge · ผิด → null", () => {
    expect(metaVerifyChallenge("subscribe", VERIFY_TOKEN, "CH123")).toBe("CH123");
    expect(metaVerifyChallenge("subscribe", "wrong", "CH123")).toBeNull();
  });
});

describe("M-2 · resolvePageContext", () => {
  it("pageId ตรง env → context · ไม่ตรง → null", async () => {
    expect(await resolvePageContext(PAGE_ID)).toMatchObject({ channel: "messenger", pageId: PAGE_ID });
    expect(await resolvePageContext("other-page")).toBeNull();
  });
});

describe("M-2 · slipPathname (scope ต่อ channel)", () => {
  it("fb: → meta/<pageId>/ · LINE → slips/YYYY-MM/", () => {
    const now = new Date("2026-07-30T00:00:00Z");
    expect(slipPathname(`fb:${PAGE_ID}:${PSID}`, now)).toMatch(new RegExp(`^meta/${PAGE_ID}/`));
    expect(slipPathname("U1234567890", now)).toMatch(/^slips\/2026-0[78]\//);
  });
});

describe("M-2 · MessengerTransport → Send API (reuse invariant)", () => {
  const page = { channel: "messenger", pageId: PAGE_ID, pageAccessToken: "tok", config: {} as AppConfig } as PageContext;
  it("หลายบอลลูน → หลาย text send · รูป → image send", async () => {
    await new MessengerTransport(page, PSID).reply("บรรทัดแรก[[เว้น]]บรรทัดสอง");
    expect(textSends()).toEqual(["บรรทัดแรก", "บรรทัดสอง"]);
    graphCalls.length = 0;
    await new MessengerTransport(page, PSID).reply("[[รูป:http://x/a.jpg]][[เว้น]]ข้อความ");
    const att = graphCalls.find((c) => (c.body.message as { attachment?: unknown }).attachment);
    expect((att!.body.message as { attachment: { payload: { url: string } } }).attachment.payload.url).toBe("http://x/a.jpg");
    expect(textSends()).toContain("ข้อความ");
  });
  it("🔴 cap 5 บอลลูน (invariant เดียวกับ LINE)", async () => {
    await new MessengerTransport(page, PSID).reply("a[[เว้น]]b[[เว้น]]c[[เว้น]]d[[เว้น]]e[[เว้น]]f[[เว้น]]g");
    expect(graphCalls.length).toBe(5);
  });
});

describe("M-2 · processMetaWebhook (webhook → pipeline → Send API)", () => {
  it("🔴 ข้อความเข้า → ตอบผ่าน Send API (PSID) + สร้าง customer fb: · ไม่แตะ LINE", async () => {
    seedBotLib({ stepRows: stepSheet() });
    scriptGemini([turn({ reply: "สวัสดีค่ะ รับน้ำพริกกี่ถ้วยดีคะ", stage: "S1" })]);
    const body = textEvent("สวัสดีครับ");
    const res = await processMetaWebhook(body, sign(body));
    expect(res.status).toBe(200);
    expect(textSends().join(" "), "ตอบถึง PSID ผ่าน Send API").toContain("รับน้ำพริกกี่ถ้วย");
    expect(graphCalls.every((c) => (c.body.recipient as { id: string }).id === PSID)).toBe(true);
    expect(await getCustomer(metaUserId(PAGE_ID, PSID)), "customer fb: ถูกสร้าง").toBeTruthy();
    expect(lineCalls.replies.length, "🔴 ไม่แตะ LINE").toBe(0);
  });

  it("ลายเซ็นผิด → 401 (ไม่ประมวลผล)", async () => {
    const body = textEvent("hi");
    expect((await processMetaWebhook(body, "sha256=deadbeef")).status).toBe(401);
    expect(graphCalls.length).toBe(0);
  });

  it("page_id ไม่รู้จัก → 200 แต่ไม่ตอบ", async () => {
    const body = JSON.stringify({ object: "page", entry: [{ id: "unknown-page", messaging: [{ sender: { id: PSID }, message: { text: "hi" } }] }] });
    expect((await processMetaWebhook(body, sign(body))).status).toBe(200);
    expect(graphCalls.length).toBe(0);
  });
});

describe("M-2/D-76 · echo — แอดมินพิมพ์แทรกแล้วบอทหยุด (เทียบเท่า LINE)", () => {
  it("🔴 D-76 บั๊กหลัก: echo แอดมิน → human_mode ลง id ของ **ลูกค้า** (recipient) ไม่ใช่ id เพจ", async () => {
    const customer = metaUserId(PAGE_ID, PSID);
    const phantom = metaUserId(PAGE_ID, PAGE_ID); // id ที่โค้ดเดิม (อ่าน sender) เผลอไปปิดบอทให้
    await ensureCustomer(customer);
    const body = echoEvent("แอดมินตอบเองค่ะ"); // กล่องเพจ: ไม่มี app_id ไม่มี metadata
    await processMetaWebhook(body, sign(body));
    expect(graphCalls.length, "echo ห้ามทำให้บอทตอบ").toBe(0);
    expect((await getCustomer(customer))?.humanMode, "ลูกค้าตัวจริงต้องถูกปิดบอท").toBe(true);
    expect(await getCustomer(phantom), "ห้ามสร้าง/ปิดบอทให้ id ผี fb:<page>:<page>").toBeNull();
  });

  it("🔴 echo ของบอทเอง (metadata ลายเซ็น) → ไม่ปิดบอท — แยกได้แน่นอนแม้ไม่มี app_id", async () => {
    const customer = metaUserId(PAGE_ID, PSID);
    await ensureCustomer(customer);
    const body = echoEvent("บอทเราส่งเอง", { metadata: BOT_ECHO_MARK });
    await processMetaWebhook(body, sign(body));
    expect((await getCustomer(customer))?.humanMode).toBe(false);
  });

  it("echo ของบอทเอง (app_id ตรง META_APP_ID · ข้อความที่ส่งก่อน D-76 ยังไม่มี metadata) → ไม่ปิดบอท", async () => {
    const customer = metaUserId(PAGE_ID, PSID);
    await ensureCustomer(customer);
    const body = echoEvent("บอทเราส่งก่อน deploy", { app_id: APP_ID });
    await processMetaWebhook(body, sign(body));
    expect((await getCustomer(customer))?.humanMode).toBe(false);
  });

  it("echo จากแอปอื่น (app_id ไม่ตรง) → ปิดบอท (มีคน/ระบบอื่นกำลังตอบ)", async () => {
    const customer = metaUserId(PAGE_ID, PSID);
    await ensureCustomer(customer);
    const body = echoEvent("แอปอื่นตอบ", { app_id: "555000" });
    await processMetaWebhook(body, sign(body));
    expect((await getCustomer(customer))?.humanMode).toBe(true);
  });

  it("🔴 ทุกข้อความที่บอทส่งออกต้องแปะลายเซ็น metadata (ไม่งั้น echo ตัวเองจะปิดบอทตัวเอง)", async () => {
    seedBotLib({ stepRows: stepSheet() });
    scriptGemini([turn({ reply: "สวัสดีค่ะ", stage: "S1" })]);
    const body = textEvent("สวัสดี");
    await processMetaWebhook(body, sign(body));
    const sends = graphCalls.filter((c) => c.body.message);
    expect(sends.length, "ต้องมีการส่งจริง").toBeGreaterThan(0);
    for (const c of sends) {
      expect((c.body.message as { metadata?: string }).metadata, "ทุก message ต้องมีลายเซ็น").toBe(BOT_ECHO_MARK);
    }
  });
});

describe("D-76 · กติกาคืนสิทธิ์บอทฝั่ง FB = เส้นเดียวกับ LINE (ไม่มีกติกาใหม่)", () => {
  it("🔴 แอดมินพิมพ์ (echo) → ลูกค้าทักต่อ = บอทเงียบ · พอเงียบครบเกณฑ์ Config แล้วทักใหม่ = บอทกลับมา", async () => {
    const customer = metaUserId(PAGE_ID, PSID);
    seedBotLib({ stepRows: stepSheet() });
    await ensureCustomer(customer);

    const echo = echoEvent("แอดมินขอดูแลต่อนะคะ");
    await processMetaWebhook(echo, sign(echo));
    expect((await getCustomer(customer))?.humanMode).toBe(true);

    // ลูกค้าทักทันที → บอทต้องเงียบ (แอดมินยังคุยอยู่)
    graphCalls.length = 0;
    scriptGemini([turn({ reply: "ไม่ควรถูกส่ง", stage: "S1" })]);
    const soon = textEvent("ยังอยู่ไหมคะ");
    await processMetaWebhook(soon, sign(soon));
    expect(textSends(), "อยู่ human_mode = บอทห้ามพิมพ์ชน").toHaveLength(0);

    // เงียบเกิน `คืนสิทธิ์บอท_หลังแชทเงียบ` (45 นาที · ค่าเดียวกับ LINE) → lazy return ตอนลูกค้าทัก
    await setLastSeenAgo(customer, 60);
    graphCalls.length = 0;
    scriptGemini([turn({ reply: "ปลาทูกลับมาดูแลต่อค่ะ", stage: "S1" })]);
    const later = textEvent("สนใจสินค้าค่ะ");
    await processMetaWebhook(later, sign(later));
    expect(textSends().join(" "), "พ้นเกณฑ์ → บอทกลับมาตอบ").toContain("ปลาทูกลับมาดูแลต่อค่ะ");
    expect((await getCustomer(customer))?.humanMode, "human_mode ถูกปลด").toBe(false);
  });
});
