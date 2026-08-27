import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { scriptGemini, turn, lineCalls } from "../harness/state";
import { seedBotLib, v3StepRows } from "../harness/botlib-fixture";
import { ensureCustomer, getCustomer } from "@/lib/db";
import { verifyMetaSignature } from "@/lib/channel/meta";
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
  return JSON.stringify({ object: "page", entry: [{ id: PAGE_ID, messaging: [{ sender: { id: PSID }, message: { mid: "mid1", text, ...extra } }] }] });
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

describe("M-2 · echo (5.4)", () => {
  it("🔴 echo app_id = ของเรา → ทิ้ง (กันลูป · ไม่ human_mode)", async () => {
    await ensureCustomer(metaUserId(PAGE_ID, PSID));
    const body = textEvent("บอทเราส่งเอง", { is_echo: true, app_id: APP_ID });
    await processMetaWebhook(body, sign(body));
    expect(graphCalls.length).toBe(0);
    expect((await getCustomer(metaUserId(PAGE_ID, PSID)))?.humanMode).toBe(false);
  });
  it("🔴 echo app_id อื่น (แอดมินพิมพ์) → human_mode · ไม่ตอบ", async () => {
    await ensureCustomer(metaUserId(PAGE_ID, PSID));
    const body = textEvent("แอดมินตอบเอง", { is_echo: true, app_id: "555000" });
    await processMetaWebhook(body, sign(body));
    expect(graphCalls.length).toBe(0);
    expect((await getCustomer(metaUserId(PAGE_ID, PSID)))?.humanMode, "เข้า human_mode").toBe(true);
  });
});
