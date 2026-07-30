import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { setCreatedAtAgo } from "../harness/db";
import { ensureCustomer, addMessage, setHumanMode, markOrderWritten, setLastOrder, dashboardSummaryCounts, dashboardCustomerRows, wonOrdersSince } from "@/lib/db";
import { orderAmountMap, __resetOrderAmountCache, ORDERS_HEADER } from "@/lib/orders";
import { channelOf, deriveStatus, formatOrderSummary } from "@/lib/train/dashboard";
import { bangkokDayStart } from "@/lib/core/time";

const LINE = "Udashtestcustomer000000000000line1";
const FB = "fb:999888:psid-dash-1";
const TRAIN = "TRAIN:dash-sess-1";

beforeAll(() => {
  process.env.TRAIN_PASSWORD = "test-train-pass";
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
});
beforeEach(() => { __resetOrderAmountCache(); seedBotLib(); });

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
  const row = ORDERS_HEADER.map(() => "");
  row[ORDERS_HEADER.indexOf("order_id")] = orderId;
  row[ORDERS_HEADER.indexOf("ยอดเงิน")] = amount;
  row[ORDERS_HEADER.indexOf("ยกเลิก")] = cancelled;
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
});
