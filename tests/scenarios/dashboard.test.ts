import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { sheetsCalls, adminPushes } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { setCreatedAtAgo } from "../harness/db";
import { ensureCustomer, addMessage, setHumanMode, markOrderWritten, markShippingNotified, setLastOrder, getCustomer, isChannelEnabled, dashboardSummaryCounts, dashboardCustomerRows, wonOrdersSince } from "@/lib/db";
import { orderAmountMap, __resetOrderAmountCache, __resetOrdersDashboardCache, ORDERS_HEADER } from "@/lib/orders";
import { channelOf, deriveStatus, deriveOrderStatus, formatOrderSummary } from "@/lib/train/dashboard";
import { botModeMsg, channelSwitchMsg } from "@/lib/train/bot-switch";
import { bangkokDayStart } from "@/lib/core/time";

const LINE = "Udashtestcustomer000000000000line1";
const FB = "fb:999888:psid-dash-1";
const TRAIN = "TRAIN:dash-sess-1";

beforeAll(() => {
  process.env.TRAIN_PASSWORD = "test-train-pass";
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
  process.env.META_PAGE_ID = "999888"; // T2-ข: ให้มีช่อง fb ในรายการสวิตช์
});
beforeEach(() => { __resetOrderAmountCache(); __resetOrdersDashboardCache(); seedBotLib(); });

// ---------- pure helpers ----------
describe("T2-ก · helper pure", () => {
  it("channelOf", () => {
    expect(channelOf("fb:1:2")).toBe("fb");
    expect(channelOf("TRAIN:x")).toBe("train");
    expect(channelOf("U123")).toBe("line");
  });
  it("deriveStatus — won>handoff>stuck>active>idle", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const recent = new Date("2026-07-30T11:00:00Z");
    const old = new Date("2026-07-28T00:00:00Z");
    expect(deriveStatus({ hasOrder: true, humanMode: true, funnelStage: "lead", lastSeen: recent, now })).toBe("won");
    expect(deriveStatus({ hasOrder: false, humanMode: true, funnelStage: "quoted", lastSeen: recent, now })).toBe("handoff");
    expect(deriveStatus({ hasOrder: false, humanMode: false, funnelStage: "quoted", lastSeen: old, now }), "🟡 กลุ่มทอง").toBe("stuck");
    expect(deriveStatus({ hasOrder: false, humanMode: false, funnelStage: "lead", lastSeen: recent, now })).toBe("active");
    expect(deriveStatus({ hasOrder: false, humanMode: false, funnelStage: "lead", lastSeen: old, now })).toBe("idle");
  });
  it("formatOrderSummary — คนอ่าน ไม่ใช่ JSON", () => {
    const nameMap = new Map([["SKU1", "น้ำพริกปลาทู"]]);
    const out = formatOrderSummary({ items: [{ sku: "SKU1", qty: 3 }], total: 285, "การชำระเงิน": "COD" }, nameMap);
    expect(out).toContain("• น้ำพริกปลาทู × 3");
    expect(out.join(" ")).toContain("ยอดรวม: 285 บาท");
    expect(out.join(" ")).not.toContain("{");
  });
  it("bangkokDayStart — 7 วันเริ่มก่อนวันนี้ ~6 วัน", () => {
    const now = new Date("2026-07-30T12:00:00Z");
    const today = bangkokDayStart(now, 0);
    const week = bangkokDayStart(now, 6);
    const diffDays = Math.round((today.getTime() - week.getTime()) / 86400000);
    expect(diffDays).toBe(6);
    expect(today.getTime()).toBeLessThan(now.getTime());
  });
});

// ---------- DB reads (PROD · TRAIN excluded) ----------
describe("T2-ก · dashboard DB reads", () => {
  it("🔴 summary counts แยกช่อง + ไม่นับ TRAIN:", async () => {
    await ensureCustomer(LINE);
    await ensureCustomer(FB);
    await ensureCustomer(TRAIN);
    await setHumanMode(FB, true);
    const start = bangkokDayStart(new Date(), 0);
    const c = await dashboardSummaryCounts(start);
    expect(c.newLine, "line ใหม่ (ไม่รวม fb/train)").toBe(1);
    expect(c.newFb).toBe(1);
    expect(c.handoffPending, "fb human_mode").toBe(1);
  });

  it("returning = last_seen ในช่วง แต่ created ก่อนช่วง", async () => {
    await ensureCustomer(LINE);
    await setCreatedAtAgo(LINE, 10); // สร้าง 10 วันก่อน · last_seen = วันนี้
    const start = bangkokDayStart(new Date(), 0);
    const c = await dashboardSummaryCounts(start);
    expect(c.returning).toBe(1);
    expect(c.newLine, "ไม่ใช่ลูกค้าใหม่แล้ว").toBe(0);
  });

  it("🔴 customer rows: turn count (aggregate) + TRAIN ซ่อน default / โชว์เมื่อ includeTrain", async () => {
    await ensureCustomer(LINE);
    await addMessage(LINE, "user", "หนึ่ง");
    await addMessage(LINE, "assistant", "ตอบ");
    await addMessage(LINE, "user", "สอง");
    await ensureCustomer(TRAIN);
    const noTrain = await dashboardCustomerRows(false);
    expect(noTrain.some((r) => r.userId === TRAIN), "TRAIN ซ่อน").toBe(false);
    const line = noTrain.find((r) => r.userId === LINE)!;
    expect(line.turns, "นับเฉพาะ role=user").toBe(2);
    const withTrain = await dashboardCustomerRows(true);
    expect(withTrain.some((r) => r.userId === TRAIN), "โชว์ TRAIN").toBe(true);
  });
});

// ---------- sales (won ∩ ยอดชีต) ----------
function orderRow(orderId: string, amount: string, cancelled = ""): string[] {
  // 🔴 D-64: อิง header จริงของ mock (มีคอลัมน์แทรก) ไม่ใช่ ORDERS_HEADER
  const header = sheetsCalls.ordersHeader.length > 0 ? sheetsCalls.ordersHeader : [...ORDERS_HEADER];
  const row = header.map(() => "");
  row[header.indexOf("order_id")] = orderId;
  row[header.indexOf("ยอดเงิน")] = amount;
  row[header.indexOf("ยกเลิก")] = cancelled;
  return row;
}

describe("T2-ก · ยอดขาย (wonOrdersSince ∩ orderAmountMap)", () => {
  it("รวมยอดตาม order_id · ข้ามที่ยกเลิก", async () => {
    await ensureCustomer(LINE);
    await markOrderWritten("ORD-1", LINE);
    await markOrderWritten("ORD-2", LINE);
    sheetsCalls.getReturn = [orderRow("ORD-1", "250"), orderRow("ORD-2", "300", "TRUE")];
    const start = bangkokDayStart(new Date(), 0);
    const won = await wonOrdersSince(start);
    const amounts = await orderAmountMap();
    let lineTotal = 0;
    for (const w of won) {
      const a = amounts.get(w.orderId);
      if (a && !a.cancelled && channelOf(w.userId) === "line") lineTotal += a.total;
    }
    expect(lineTotal, "ORD-1 250 นับ · ORD-2 ยกเลิก ข้าม").toBe(250);
  });
});

// ---------- route (assembly + auth) ----------
function cookie(): string {
  return crypto.createHmac("sha256", process.env.TRAIN_PASSWORD ?? "").update("sakbin-train-session-v1").digest("hex");
}
function req(body: unknown, authed = true): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authed) headers.cookie = `train_auth=${cookie()}`;
  return new NextRequest("https://t.invalid/train/api/dashboard", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("T2-ก · dashboard route (auth + assembly)", () => {
  it("ไม่มี cookie → 401", async () => {
    const { POST } = await import("@/app/train/api/dashboard/route");
    expect((await POST(req({ range: "today" }, false))).status).toBe(401);
  });

  it("🔴 assemble: counts + sales + customers (TRAIN ตัดออก)", async () => {
    await ensureCustomer(LINE);
    await setLastOrder(LINE, { order_id: "ORD-1", items: [{ sku: "SKU1", qty: 2 }] } as never); // has last_order → won
    await markOrderWritten("ORD-1", LINE);
    await ensureCustomer(TRAIN);
    sheetsCalls.getReturn = [orderRow("ORD-1", "285")];
    const { POST } = await import("@/app/train/api/dashboard/route");
    const res = await POST(req({ range: "today", includeTrain: false }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.counts.newLine).toBe(1);
    expect(d.sales.lineTotal).toBe(285);
    expect(d.customers.some((c: { userId: string }) => c.userId === LINE)).toBe(true);
    expect(d.customers.some((c: { userId: string }) => c.userId === TRAIN), "TRAIN ตัดออก").toBe(false);
    expect(d.customers.find((c: { userId: string }) => c.userId === LINE).status).toBe("won");
  });

  it("main route คืน channels (มี line + fb)", async () => {
    const { POST } = await import("@/app/train/api/dashboard/route");
    const res = await POST(req({ range: "today" }));
    const d = await res.json();
    expect(d.channels.some((c: { key: string }) => c.key === "line")).toBe(true);
    expect(d.channels.some((c: { key: string }) => c.key === "fb:999888")).toBe(true);
    expect(d.channels.find((c: { key: string }) => c.key === "line").enabled, "default เปิด").toBe(true);
  });
});

// ---------- T2-ข · สวิตช์เปิด-ปิดบอทใน UI ----------
describe("T2-ข · message builders (ตรงกับคำสั่งพิมพ์)", () => {
  it("botModeMsg — ปิด/เปิด", () => {
    expect(botModeMsg("บี", true, 45)).toContain('🔴 ปิดบอทให้ "บี" แล้ว');
    expect(botModeMsg("บี", true, 45)).toContain("45 นาที");
    expect(botModeMsg("บี", false, 45)).toBe('🟢 เปิดบอทให้ "บี" แล้ว');
  });
  it("channelSwitchMsg — ปิด/เปิด + ป้ายช่อง", () => {
    expect(channelSwitchMsg("line", true, "[LINE] ปิด")).toContain("🔴 ปิดบอทช่อง [LINE] แล้ว");
    expect(channelSwitchMsg("fb:999888", false, "[FB] เปิด")).toContain("🟢 เปิดบอทช่อง [FB] แล้ว");
  });
});

describe("T2-ข · /switch route", () => {
  async function switchReq(body: unknown, authed = true) {
    const { POST } = await import("@/app/train/api/dashboard/switch/route");
    return POST(req(body, authed));
  }

  it("ไม่มี cookie → 401", async () => {
    expect((await switchReq({ target: "channel", key: "line", enabled: false }, false)).status).toBe(401);
  });

  it("🔴 channel: ปิด [LINE] → เขียนถูก key + แจ้งกลุ่ม (จาก Dashboard)", async () => {
    const res = await switchReq({ target: "channel", key: "line", enabled: false });
    expect(res.status).toBe(200);
    expect(await isChannelEnabled("line"), "เขียนผ่าน setChannelEnabled").toBe(false);
    const pushes = adminPushes();
    const text = pushes.map((p) => (p.messages[0] as { text?: string }).text ?? "").join("\n");
    expect(text).toContain("🔴 ปิดบอทช่อง [LINE] แล้ว");
    expect(text, "ระบุที่มา UI").toContain("(จาก Dashboard)");
  });

  it("channel: key เพี้ยน → 400 (ไม่เขียน)", async () => {
    expect((await switchReq({ target: "channel", key: "line-typo", enabled: false })).status).toBe(400);
  });

  it("🔴 customer: ปิดบอทรายคน → setHumanMode + แจ้งกลุ่มมีชื่อ + (จาก Dashboard)", async () => {
    await ensureCustomer(LINE);
    const res = await switchReq({ target: "customer", userId: LINE, close: true });
    expect(res.status).toBe(200);
    expect((await getCustomer(LINE))!.humanMode, "human_mode เดิม").toBe(true);
    const text = adminPushes().map((p) => (p.messages[0] as { text?: string }).text ?? "").join("\n");
    expect(text).toContain("🔴 ปิดบอทให้");
    expect(text).toContain("(จาก Dashboard)");
  });

  it("customer: เปิดบอทคืน → human_mode=false", async () => {
    await ensureCustomer(LINE);
    await setHumanMode(LINE, true);
    await switchReq({ target: "customer", userId: LINE, close: false });
    expect((await getCustomer(LINE))!.humanMode).toBe(false);
  });
});

// ---------- T2-ฉ · แท็บออเดอร์ (read-only · derive จากคอลัมน์จริง) ----------
function fullRow(o: { orderId: string; userId: string; name?: string; orderNumber?: string; product?: string; total?: string; confirmed?: boolean; sent?: boolean; tracking?: string; cancelled?: boolean }): string[] {
  // 🔴 D-64: อิง header จริงของ mock (มีคอลัมน์ "กล่องส่งออเดอร์" แทรก) ไม่ใช่ ORDERS_HEADER
  const header = sheetsCalls.ordersHeader.length > 0 ? sheetsCalls.ordersHeader : [...ORDERS_HEADER];
  const row = header.map(() => "");
  const set = (h: string, v: string) => { row[header.indexOf(h)] = v; };
  set("order_id", o.orderId);
  set("line_user_id", o.userId);
  set("ชื่อ-นามสกุล", o.name ?? "");
  set("ลำดับ", o.orderNumber ?? "");
  set("สินค้า+จำนวน", o.product ?? "");
  set("ยอดเงิน", o.total ?? "");
  set("คอนเฟิร์ม", o.confirmed ? "TRUE" : "FALSE");
  set("ส่งออเดอร์แล้ว", o.sent ? "TRUE" : "FALSE");
  set("เลขTracking", o.tracking ?? "");
  set("ยกเลิก", o.cancelled ? "TRUE" : "FALSE");
  return row;
}

describe("T2-ฉ · deriveOrderStatus (🔴 D-64: อิง A/N/P + notified · ไม่พึ่ง O อีกแล้ว)", () => {
  const base = { cancelled: false, hasOrderNumber: false, hasTracking: false, notified: false };
  it("N=TRUE → cancelled (precedence สูงสุด แม้คอลัมน์อื่นครบ)", () => {
    expect(deriveOrderStatus({ cancelled: true, hasOrderNumber: true, hasTracking: true, notified: true })).toBe("cancelled");
  });
  it("A(ลำดับ) ว่าง → awaiting_confirm (Apps Script ยังไม่แจกเลข = ยังไม่ติ๊ก M)", () => {
    expect(deriveOrderStatus({ ...base })).toBe("awaiting_confirm");
  });
  it("A มีเลข · P ว่าง → awaiting_pack (งานแพ็ค/เลขแทรค)", () => {
    expect(deriveOrderStatus({ ...base, hasOrderNumber: true })).toBe("awaiting_pack");
  });
  it("P มี · ยังไม่ notified → shipped_pending_notify", () => {
    expect(deriveOrderStatus({ ...base, hasOrderNumber: true, hasTracking: true, notified: false })).toBe("shipped_pending_notify");
  });
  it("P มี · notified → shipped_notified", () => {
    expect(deriveOrderStatus({ ...base, hasOrderNumber: true, hasTracking: true, notified: true })).toBe("shipped_notified");
  });
  it("🔴 O(ส่งออเดอร์แล้ว) ไม่มีผลต่อสถานะเลย — คนติ๊กเอง ลืมได้", () => {
    // เดิม O=false จะค้างที่ awaiting_number ตลอดกาล · ตอนนี้ดูแค่ A/P
    expect(deriveOrderStatus({ ...base, hasOrderNumber: true })).toBe("awaiting_pack");
  });
});

describe("T2-ฉ · /orders route", () => {
  async function ordReq(body: unknown, authed = true) {
    const { POST } = await import("@/app/train/api/dashboard/orders/route");
    return POST(req(body, authed));
  }

  it("ไม่มี cookie → 401", async () => {
    expect((await ordReq({}, false)).status).toBe(401);
  });

  it("🔴 assemble: สถานะถูกทุกแถว + TRAIN กรอง default + sort ใหม่สุดก่อน + counts", async () => {
    // A(idx2) LINE รอคอนเฟิร์ม · B(idx3) LINE ส่งแล้วแจ้งแล้ว · C(idx4) FB รอแพ็ค · D(idx5) TRAIN (กรองออก)
    sheetsCalls.getReturn = [
      fullRow({ orderId: "A", userId: LINE, name: "เอ", confirmed: false }),
      fullRow({ orderId: "B", userId: LINE, name: "บี", orderNumber: "0724-1", confirmed: true, sent: true, tracking: "TH123" }),
      fullRow({ orderId: "C", userId: FB, name: "ซี", orderNumber: "0724-2", confirmed: true, sent: true, tracking: "" }),
      fullRow({ orderId: "D", userId: TRAIN, name: "ดี", confirmed: false }),
    ];
    await markShippingNotified("B"); // B แจ้งแล้ว → shipped_notified

    const res = await ordReq({ includeTrain: false });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.orders.map((o: { orderId: string }) => o.orderId), "TRAIN ตัด + sort desc").toEqual(["C", "B", "A"]);
    const byId = Object.fromEntries(d.orders.map((o: { orderId: string; status: string; channel: string }) => [o.orderId, o]));
    expect(byId.A.status).toBe("awaiting_confirm");
    expect(byId.B.status, "tracking + notified").toBe("shipped_notified");
    expect(byId.C.status, "มีเลขลำดับ ไม่มี tracking").toBe("awaiting_pack");
    expect(byId.C.channel).toBe("fb");
    expect(d.counts.awaiting_confirm).toBe(1);
    expect(d.counts.awaiting_pack).toBe(1);
    expect(d.counts.shipped_notified).toBe(1);
  });

  it("shipped_pending_notify เมื่อมี tracking แต่ยังไม่ mark", async () => {
    sheetsCalls.getReturn = [fullRow({ orderId: "E", userId: LINE, orderNumber: "0724-3", confirmed: true, sent: true, tracking: "TH999" })];
    const d = await (await ordReq({})).json();
    expect(d.orders[0].status).toBe("shipped_pending_notify");
  });

  it("includeTrain=true → เห็น TRAIN", async () => {
    sheetsCalls.getReturn = [fullRow({ orderId: "D", userId: TRAIN, confirmed: false })];
    const d = await (await ordReq({ includeTrain: true })).json();
    expect(d.orders.some((o: { orderId: string }) => o.orderId === "D")).toBe(true);
  });
});
