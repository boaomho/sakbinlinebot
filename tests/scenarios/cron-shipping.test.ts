import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { sheetsCalls, lineCalls, adminPushes, harnessOverrides } from "../harness/state";
import { ensureCustomer, setHumanMode } from "@/lib/db";
import { setLastSeenAgo } from "../harness/db";
import { ORDERS_HEADER } from "@/lib/orders";
import { DEFAULT_CARRIER, formatShippingMessage, withinMessengerWindow } from "@/lib/shipping";

const FB_PAGE = "999888";
const FB_USER = `fb:${FB_PAGE}:psid-1`;
const graphSends: { url: string; body: Record<string, unknown> }[] = [];
let realFetch: typeof fetch;
beforeAll(() => {
  realFetch = global.fetch;
  process.env.META_PAGE_ID = FB_PAGE;
  process.env.META_PAGE_ACCESS_TOKEN = "tok";
  process.env.META_APP_SECRET = "sec";
  process.env.META_VERIFY_TOKEN = "vt";
});
beforeEach(() => {
  graphSends.length = 0;
  vi.stubGlobal("fetch", async (url: unknown, opts?: { method?: string; body?: string }) => {
    const u = String(url);
    if (u.includes("graph.facebook.com")) {
      if (opts?.method === "POST" && opts.body) graphSends.push({ url: u, body: JSON.parse(opts.body) });
      return new Response(JSON.stringify({ message_id: "m" }), { status: 200 });
    }
    return realFetch(url as string, opts as RequestInit);
  });
});
afterEach(() => vi.unstubAllGlobals());
const fbTextSends = (): string[] => graphSends.map((c) => (c.body.message as { text?: string })?.text ?? "").filter(Boolean);

/**
 * D-50 แจ้งเลขพัสดุ — cron push ลูกค้าเมื่อทีมแพ็คกรอก P (Tracking)
 * 🔴 dedup Neon shipping_notified · human_mode→แจ้งแอดมิน · R ว่าง/P ว่าง→ข้าม · greeting D-51
 */

const USER = "Utrainshiptest0000000000000000001";
const ORDER_ID = "SKB-20260724-abc123";

function buildRow(over: Record<string, string> = {}): string[] {
  const row = ORDERS_HEADER.map(() => "");
  const base: Record<string, string> = {
    "ลำดับ": "0724-1", "ชื่อ-นามสกุล": "สมชาย ใจดี", "เบอร์โทร": "0811122334",
    "สินค้า+จำนวน": "น้ำพริกปลาทู x3", "การชำระเงิน": "COD",
    "คอนเฟิร์ม": "TRUE", "ส่งออเดอร์แล้ว": "TRUE", "เลขTracking": "TH999",
    "order_id": ORDER_ID, "line_user_id": USER, ...over,
  };
  for (const [k, v] of Object.entries(base)) row[ORDERS_HEADER.indexOf(k)] = v;
  return row;
}
async function runCron(): Promise<Response> {
  const { GET } = await import("@/app/api/cron/orders/route");
  return GET(new Request("https://h.invalid/api/cron/orders", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }) as unknown as import("next/server").NextRequest);
}
const custPushes = (): string[] =>
  lineCalls.pushes.filter((p) => p.to === USER).flatMap((p) => p.messages.map((m) => (m.type === "text" ? m.text : "")));

describe("D-50 · formatShippingMessage (pure)", () => {
  it("แทน {ขนส่ง}/{เลขพัสดุ}", () => {
    expect(formatShippingMessage("ขนส่ง {ขนส่ง} เลข {เลขพัสดุ}", "Shopee Express", "TH1")).toBe("ขนส่ง Shopee Express เลข TH1");
  });
});

describe("M-4 · withinMessengerWindow (pure · 24 ชม.)", () => {
  it("ใน 24 ชม. → true · เกิน → false", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    expect(withinMessengerWindow(new Date("2026-07-30T00:00:00Z"), now), "12 ชม.").toBe(true);
    expect(withinMessengerWindow(new Date("2026-07-29T11:00:00Z"), now), "25 ชม.").toBe(false);
  });
});

describe("D-50 · cron แจ้งเลขพัสดุ", () => {
  it("🔴 O=TRUE + P มีเลข → push ลูกค้า (ขนส่ง+เลขพัสดุ) + แจ้งกลุ่มแอดมิน ✓", async () => {
    await ensureCustomer(USER);
    sheetsCalls.getReturn = [buildRow()];
    const res = await runCron();
    expect((await res.json()).shipped).toBe(1);
    const t = custPushes().join(" ");
    expect(t, "มีเลขพัสดุ").toContain("TH999");
    expect(t, "มีขนส่ง default").toContain(DEFAULT_CARRIER);
    const admin = JSON.stringify(adminPushes());
    expect(admin).toContain("แจ้งพัสดุลูกค้าแล้ว ✓");
    expect(admin, "โชว์เลขออเดอร์วิ่ง (ลำดับ) ให้ทีมแพ็คเห็น").toContain("0724-1");
  });

  it("🔴 idempotent — cron รอบสองไม่ push ซ้ำ (shipping_notified)", async () => {
    await ensureCustomer(USER);
    sheetsCalls.getReturn = [buildRow()];
    await runCron();
    const after1 = lineCalls.pushes.filter((p) => p.to === USER).length;
    await runCron();
    expect(lineCalls.pushes.filter((p) => p.to === USER).length, "ไม่ push ซ้ำ").toBe(after1);
  });

  it("P ว่าง = ยังไม่ส่ง → ไม่แจ้ง (ข้ามเงียบ)", async () => {
    await ensureCustomer(USER);
    sheetsCalls.getReturn = [buildRow({ "เลขTracking": "" })];
    expect((await (await runCron()).json()).shipped).toBe(0);
    expect(custPushes().length).toBe(0);
  });

  it("R (line_user_id) ว่าง (แถวเก่า) → ข้าม ไม่ push ลูกค้า", async () => {
    sheetsCalls.getReturn = [buildRow({ "line_user_id": "" })];
    expect((await (await runCron()).json()).shipped).toBe(0);
    expect(custPushes().length).toBe(0);
  });

  it("🔴 M-4: R เป็น fb: + ลูกค้า active ใน 24 ชม. → push ผ่าน Messenger (ไม่ใช่ LINE) + แจ้งกลุ่ม ✓ [FB]", async () => {
    await ensureCustomer(FB_USER); // lastSeen = now → ใน 24 ชม.
    sheetsCalls.getReturn = [buildRow({ "line_user_id": FB_USER })];
    const res = await runCron();
    expect((await res.json()).shipped).toBe(1);
    expect(fbTextSends().join(" "), "ยิงผ่าน Send API").toContain("TH999");
    expect(lineCalls.pushes.filter((p) => p.to === FB_USER).length, "ไม่ push ทาง LINE").toBe(0);
    expect(JSON.stringify(adminPushes())).toContain("แจ้งพัสดุลูกค้าแล้ว ✓ [FB]");
  });

  it("🔴 M-4: R เป็น fb: + เกิน 24 ชม. → ไม่ยิง Messenger · แจ้งกลุ่มแอดมิน [FB] โปรดแจ้งเอง", async () => {
    await ensureCustomer(FB_USER);
    await setLastSeenAgo(FB_USER, 25 * 60); // 25 ชม.
    sheetsCalls.getReturn = [buildRow({ "line_user_id": FB_USER })];
    expect((await (await runCron()).json()).shipped).toBe(0);
    expect(graphSends.length, "ไม่ยิง Send API").toBe(0);
    const admin = JSON.stringify(adminPushes());
    expect(admin).toContain("[FB]");
    expect(admin).toContain("เกินหน้าต่าง 24 ชม.");
  });

  it("🔴 human_mode → ไม่ push ลูกค้า · แจ้งกลุ่มแอดมินให้แจ้งเอง", async () => {
    await ensureCustomer(USER);
    await setHumanMode(USER, true);
    sheetsCalls.getReturn = [buildRow()];
    await runCron();
    expect(custPushes().length, "ไม่ push ลูกค้า").toBe(0);
    expect(JSON.stringify(adminPushes())).toContain("โปรดแจ้งเลขพัสดุเอง");
  });

  it("greeting D-51: push แรกของวัน (ลูกค้าใหม่) ได้ 'สวัสดีค่ะ ' นำหน้า", async () => {
    harnessOverrides.config = { raw: new Map([["ทักทายรายวัน", "สวัสดีค่ะ "]]) };
    await ensureCustomer(USER);
    sheetsCalls.getReturn = [buildRow()];
    await runCron();
    expect(custPushes()[0]).toMatch(/^สวัสดีค่ะ /);
  });

  it("template ค่าว่าง (config) → ปิดฟีเจอร์ ไม่แจ้ง", async () => {
    harnessOverrides.config = { raw: new Map([["ข้อความแจ้งพัสดุ", ""]]) };
    await ensureCustomer(USER);
    sheetsCalls.getReturn = [buildRow()];
    expect((await (await runCron()).json()).shipped).toBe(0);
    expect(custPushes().length).toBe(0);
  });

  // 🔴 D-61.C: cron ต้องทำงานเหมือนกันทั้งสองโหมด (ยืนยันข้อ 4 ของเจ้าของ)
  //    cron แตะ schema ทางเดียว = getConfig (CSV_Config) · ไฟล์ Orders คนละไฟล์ (SHEET_ORDERS_ID) ไม่เกี่ยว
  it("🔴 โหมด v3: แจกเลข + แจ้งพัสดุ + greeting ทำงานครบเหมือน v2", async () => {
    process.env.SHEET_SCHEMA = "v3";
    try {
      harnessOverrides.config = { raw: new Map([["ทักทายรายวัน", "สวัสดีค่ะ "]]) };
      await ensureCustomer(USER);
      sheetsCalls.getReturn = [buildRow()];
      const res = await runCron();
      expect((await res.json()).shipped, "v3 ก็แจ้งพัสดุได้").toBe(1);
      const t = custPushes().join(" ");
      expect(t).toContain("TH999");
      expect(t).toContain(DEFAULT_CARRIER);
      expect(custPushes()[0], "greeting D-51 ยังทำงาน").toMatch(/^สวัสดีค่ะ /);
      expect(JSON.stringify(adminPushes())).toContain("แจ้งพัสดุลูกค้าแล้ว ✓");
    } finally {
      delete process.env.SHEET_SCHEMA;
    }
  });
});
