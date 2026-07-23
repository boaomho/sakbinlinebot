import { processMessage } from "@/app/api/line-webhook/handler";
import { GET as cronOrdersGET } from "@/app/api/cron/orders/route";
import type { NextRequest } from "next/server";
import { getConfig, resolveFeatureSwitches } from "@/lib/config";
import { getCustomer, resetCustomerMemory, loadTrainSession, saveTrainSession, deleteTrainSession, CustomerState } from "@/lib/db";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { funnelStageOf, stepNameOf } from "@/lib/agent/inject";
import { getSheets } from "@/lib/sheets/client";
import { createSandbox, runInSandbox, trainUserId, TrainSandbox } from "./sandbox";
import type { DownloadedContent } from "@/lib/line";

/**
 * lib/train/turn.ts — orchestration ของห้องซ้อม: 1 เทิร์น = สร้าง sandbox → โหลด session state
 * (fake grid ออเดอร์) → รัน pipeline production จริง (processMessage) → เก็บผล + X-ray
 * 🔴 ทุกอย่างใน runInSandbox → db ทั้งหมดลง train branch · LINE/Blob/ชีต Orders เข้า collector
 */

export interface TrainXray {
  stage: string | null;
  stageName: string | null;
  funnel: string | null;
  pendingOrder: Record<string, unknown>;
  deliveredSteps: string[];
  tags: string[];
  humanMode: boolean;
  lastOrder: Record<string, unknown> | null;
  lastOrderLocked: boolean;
  /** log JSON จาก pipeline เทิร์นนี้ (scope: gate/verbatim/payment-precheck/extraction/degraded/redact/...) */
  gate: Record<string, unknown> | null;
  verbatim: Record<string, unknown>[];
  precheck: Record<string, unknown>[];
  extraction: Record<string, unknown>[];
  blocked: Record<string, unknown>[];
  degraded: Record<string, unknown>[];
  redact: Record<string, unknown> | null;
}

export interface TrainTurnResult {
  bubbles: { via: string; messages: unknown[] }[];
  adminPushes: { to: string; text?: string; messages?: unknown[] }[];
  /** แถวชีต Orders ที่ "จะถูกเขียน" — zip กับ header จริง (ไม่เขียนจริง) */
  orderRows: Record<string, string>[];
  xray: TrainXray;
}

function pickLogs(ctx: TrainSandbox) {
  const logs = ctx.logs;
  const byScope = (s: string) => logs.filter((l) => l.scope === s);
  const gates = logs.filter((l) => l.scope === "orders" && l.event === "gate");
  return {
    gate: gates.length > 0 ? gates[gates.length - 1] : null,
    verbatim: byScope("verbatim"),
    precheck: byScope("payment-precheck"),
    extraction: byScope("extraction"),
    blocked: logs.filter((l) => l.scope === "gemini" && typeof l.warning === "string" && (l.warning as string).includes("no text")),
    degraded: byScope("degraded"),
    redact: byScope("redact")[0] ?? null,
  };
}

async function buildXray(ctx: TrainSandbox, customer: CustomerState | null): Promise<TrainXray> {
  const lib = await loadBotLibrary(); // cache 60 วิเดิม
  const stage = customer?.stage ?? null;
  return {
    stage,
    stageName: stage && lib ? stepNameOf(lib.CSV_Step, stage) : null,
    funnel: stage && lib ? funnelStageOf(lib.CSV_Step, stage) : null,
    pendingOrder: (customer?.pendingOrder ?? {}) as Record<string, unknown>,
    deliveredSteps: customer?.deliveredSteps ?? [],
    tags: customer?.tags ?? [],
    humanMode: customer?.humanMode ?? false,
    lastOrder: (customer?.lastOrder ?? null) as Record<string, unknown> | null,
    lastOrderLocked: customer?.lastOrderLocked ?? false,
    ...pickLogs(ctx),
  };
}

/** header จริงของชีต Orders (proxy ส่งอ่านแถว 1 ผ่านของจริง) — ใช้ zip แถว fake grid เป็น object โชว์ */
async function readOrdersHeader(): Promise<string[]> {
  try {
    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: (await import("@/lib/core/sheet-id")).resolveSpreadsheetId(process.env.SHEET_ORDERS_ID, "SHEET_ORDERS_ID"),
      range: "Orders!1:1",
    });
    return ((res.data.values?.[0] as string[] | undefined) ?? []).map(String);
  } catch {
    return [];
  }
}

async function rowsAsObjects(ctx: TrainSandbox): Promise<Record<string, string>[]> {
  if (ctx.orderRows.length === 0) return [];
  const header = await readOrdersHeader();
  return ctx.orderRows.map((row) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h) obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

async function withSession<T>(sessionId: string, fn: (ctx: TrainSandbox) => Promise<T>): Promise<T> {
  const ctx = createSandbox(sessionId);
  return runInSandbox(ctx, async () => {
    const saved = await loadTrainSession(sessionId); // train DB (อยู่ใน sandbox แล้ว)
    if (saved) {
      ctx.orderRows = saved.orderRows ?? [];
      ctx.slipCounter = saved.slipCounter ?? 0;
    }
    const result = await fn(ctx);
    await saveTrainSession(sessionId, { orderRows: ctx.orderRows, slipCounter: ctx.slipCounter });
    return result;
  });
}

/** 1 เทิร์นสนทนา — pipeline production เต็มสาย (Gemini จริง) ใน sandbox */
export async function runTrainTurn(
  sessionId: string,
  text: string,
  image?: DownloadedContent,
): Promise<TrainTurnResult> {
  return withSession(sessionId, async (ctx) => {
    const config = await getConfig();
    const switches = resolveFeatureSwitches(config);
    await processMessage(ctx.userId, text, "TRAIN-REPLY-TOKEN", config, switches, image);
    const customer = await getCustomer(ctx.userId);
    return {
      bubbles: ctx.replies,
      adminPushes: ctx.adminPushes,
      orderRows: await rowsAsObjects(ctx),
      xray: await buildXray(ctx, customer),
    };
  });
}

/** ปุ่ม "ติ๊ก M + cron แจกเลข" — ติ๊กคอนเฟิร์มทุกแถวค้าง แล้วเรียก handler cron จริงใน sandbox */
export async function runTrainCron(sessionId: string): Promise<TrainTurnResult> {
  return withSession(sessionId, async (ctx) => {
    // ติ๊ก M (คอนเฟิร์ม) แถวที่ยังไม่ส่ง — จำลองมือแอดมิน · ตำแหน่งคอลัมน์จาก header จริง
    const header = await readOrdersHeader();
    const mIdx = header.indexOf("คอนเฟิร์ม");
    const sentIdx = header.indexOf("ส่งออเดอร์แล้ว");
    if (mIdx >= 0 && sentIdx >= 0) {
      for (const row of ctx.orderRows) {
        if ((row[sentIdx] ?? "").toUpperCase() !== "TRUE") {
          while (row.length <= mIdx) row.push("");
          row[mIdx] = "TRUE";
        }
      }
    }
    // เรียก cron จริง (โค้ดเส้นเดียวกับ production เป๊ะ) — listPendingOrders/markOrderSent ผ่าน fake grid
    // nextOrderNumber/clearDeliveredSteps ลง train DB · push กลุ่มเข้า collector
    const req = new Request("https://train.invalid/api/cron/orders", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    await cronOrdersGET(req as unknown as NextRequest);
    const customer = await getCustomer(ctx.userId);
    return {
      bubbles: ctx.replies,
      adminPushes: ctx.adminPushes,
      orderRows: await rowsAsObjects(ctx),
      xray: await buildXray(ctx, customer),
    };
  });
}

/** ปุ่ม /reset — ล้างความจำลูกค้าจำลอง (พฤติกรรมเดียวกับคำสั่ง /reset จริง) + ล้าง fake grid */
export async function runTrainReset(sessionId: string): Promise<{ ok: true }> {
  const ctx = createSandbox(sessionId);
  return runInSandbox(ctx, async () => {
    await resetCustomerMemory(trainUserId(sessionId));
    await deleteTrainSession(sessionId);
    return { ok: true as const };
  });
}
