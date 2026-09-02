import { estimateCostThb } from "@/lib/gemini";
import { bangkokYMD } from "@/lib/core/time";
import type { AiUsageDailyRow } from "@/lib/db";

/**
 * lib/train/ai-cost.ts — D-70: สรุปต้นทุนบอทจาก ai_usage (pure · เทสได้โดยไม่ต้องมี DB)
 * 🔴 เงินทุกตัวเป็น **ประมาณ** — คำนวณซ้ำจาก token ด้วยตารางราคาแหล่งเดียวใน gemini.ts
 *    ตัวเลขจริงต้องดู cost log ของ Google (กติกา D-69)
 * 🔴 แถวที่ไม่รู้ราคาโมเดล (`estimateCostThb` = null) → **นับแยกเป็น unknownCalls**
 *    ห้ามนับเป็น 0 ห้ามถัวเฉลี่ย (ไม่งั้นต้นทุนจะดูถูกกว่าจริงแบบเงียบ ๆ)
 * 🔴 ขอบวัน = เวลาไทย — `day` ที่รับมาถูก shift +7 มาแล้วจาก SQL (`at + interval '7 hours'`)
 */

/** ป้ายกำกับที่ต้องติดทุกที่ที่โชว์เงิน (D-69) */
export const COST_APPROX_NOTE = "ประมาณ — ตัวเลขจริงดู cost log ของ Google";

export interface KindBreakdown {
  callKind: string;
  calls: number;
  costThb: number;
  /** แถวที่ไม่รู้ราคาโมเดล (ไม่ถูกรวมใน costThb) */
  unknownCalls: number;
}

export interface DayCost {
  day: string;
  costThb: number;
  unknownCalls: number;
  customers: number;
}

export interface AiCostSummary {
  /** วันไทยของ "วันนี้" (หรือวันที่เลือก) */
  day: string;
  customers: number;
  /** เทิร์นทั้งหมด = จำนวน call_kind main */
  mainCalls: number;
  regenCalls: number;
  /** regen คิดเป็น % ของ main (null = ยังไม่มี main ให้หาร) */
  regenPct: number | null;
  promptTokens: number;
  outputTokens: number;
  costThb: number;
  unknownCalls: number;
  byKind: KindBreakdown[];
  /** ต้นทุน ÷ ลูกค้า (null = ยังไม่มีลูกค้า) */
  costPerCustomer: number | null;
  /** ต้นทุน ÷ ออเดอร์ของวันนั้น (null = ยังไม่มีออเดอร์) */
  costPerOrder: number | null;
  orders: number;
  /** ซีรีส์ต่อวัน (เรียงเก่า→ใหม่ · เติมวันที่ไม่มีข้อมูลเป็น 0 ให้กราฟไม่ขาด) */
  series: DayCost[];
}

/** ค่าใช้จ่าย (บาท) ของแถว aggregate 1 แถว — null = ไม่รู้ราคาโมเดลนี้ */
export function rowCostThb(r: AiUsageDailyRow): number | null {
  // output ที่คิดเงิน = candidates + thoughts (ตรงกับสูตรตอน log ต่อ call · D-69)
  return estimateCostThb(r.model, r.promptTokens, r.candidatesTokens + r.thoughtsTokens, r.cachedTokens);
}

/** รายชื่อวันไทยย้อนหลัง n วัน (เก่า→ใหม่) รวมวันนี้ — เติมช่องว่างในกราฟ */
export function thaiDaysBack(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(bangkokYMD(new Date(now.getTime() - i * 86_400_000)));
  return out;
}

/**
 * สรุปทั้งหน้า — `rows`/`customerRows` มาจาก aiUsageDaily/aiUsageDailyCustomers (วันไทยแล้ว)
 * `targetDay` = วันที่ต้องการดูตัวเลขละเอียด (default = วันนี้เวลาไทย) · `orders` = ออเดอร์ของวันนั้น
 */
export function summarizeAiUsage(opts: {
  rows: AiUsageDailyRow[];
  customerRows: { day: string; customers: number }[];
  now: Date;
  seriesDays: number;
  targetDay?: string;
  orders: number;
}): AiCostSummary {
  const { rows, customerRows, now, seriesDays, orders } = opts;
  const day = opts.targetDay ?? bangkokYMD(now);
  const customersByDay = new Map(customerRows.map((c) => [c.day, c.customers]));

  // ---- ซีรีส์ต่อวัน (เติมวันที่ไม่มีข้อมูล = 0) ----
  const costByDay = new Map<string, { costThb: number; unknownCalls: number }>();
  for (const r of rows) {
    const cur = costByDay.get(r.day) ?? { costThb: 0, unknownCalls: 0 };
    const c = rowCostThb(r);
    if (c === null) cur.unknownCalls += r.calls;
    else cur.costThb += c;
    costByDay.set(r.day, cur);
  }
  const series: DayCost[] = thaiDaysBack(now, seriesDays).map((d) => ({
    day: d,
    costThb: costByDay.get(d)?.costThb ?? 0,
    unknownCalls: costByDay.get(d)?.unknownCalls ?? 0,
    customers: customersByDay.get(d) ?? 0,
  }));

  // ---- ตัวเลขละเอียดของวันเป้าหมาย ----
  const dayRows = rows.filter((r) => r.day === day);
  const byKindMap = new Map<string, KindBreakdown>();
  let promptTokens = 0;
  let outputTokens = 0;
  let costThb = 0;
  let unknownCalls = 0;
  for (const r of dayRows) {
    promptTokens += r.promptTokens;
    outputTokens += r.candidatesTokens + r.thoughtsTokens;
    const k = byKindMap.get(r.callKind) ?? { callKind: r.callKind, calls: 0, costThb: 0, unknownCalls: 0 };
    k.calls += r.calls;
    const c = rowCostThb(r);
    if (c === null) { k.unknownCalls += r.calls; unknownCalls += r.calls; }
    else { k.costThb += c; costThb += c; }
    byKindMap.set(r.callKind, k);
  }
  // เรียงตามลำดับที่เจ้าของอ่าน (main → regen → extraction → assistant) แล้วค่อยตัวแปลกปลอม
  const ORDER = ["main", "regen", "extraction", "assistant"];
  const byKind = [...byKindMap.values()].sort((a, b) => {
    const ia = ORDER.indexOf(a.callKind);
    const ib = ORDER.indexOf(b.callKind);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.callKind.localeCompare(b.callKind);
  });

  const mainCalls = byKindMap.get("main")?.calls ?? 0;
  const regenCalls = byKindMap.get("regen")?.calls ?? 0;
  const customers = customersByDay.get(day) ?? 0;

  return {
    day, customers, mainCalls, regenCalls,
    regenPct: mainCalls > 0 ? (regenCalls / mainCalls) * 100 : null,
    promptTokens, outputTokens, costThb, unknownCalls, byKind,
    costPerCustomer: customers > 0 ? costThb / customers : null,
    costPerOrder: orders > 0 ? costThb / orders : null,
    orders,
    series,
  };
}
