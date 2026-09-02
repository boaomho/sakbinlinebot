import { describe, it, expect } from "vitest";
import { summarizeAiUsage, rowCostThb, thaiDaysBack, COST_APPROX_NOTE } from "@/lib/train/ai-cost";
import { bangkokDayStart, bangkokYMD } from "@/lib/core/time";
import type { AiUsageDailyRow } from "@/lib/db";

/**
 * D-70 · หน้าต้นทุนบอท — สรุปจาก ai_usage (pure · ไม่ต้องมี DB)
 * 🔴 กติกาความจริง: unknown-model-price นับแยก ห้ามเป็น 0 · ขอบวันเวลาไทย · เงิน = ประมาณ
 */

const MODEL = "gemini-3.5-flash"; // in 1.5 / out 9.0 / cached 0.15 USD ต่อ 1M · USD_TO_THB = 35

function row(over: Partial<AiUsageDailyRow> = {}): AiUsageDailyRow {
  return {
    day: "2026-09-03", callKind: "main", model: MODEL, calls: 1,
    promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, cachedTokens: 0, ...over,
  };
}

describe("D-70 · rowCostThb — คิดเงินจาก token (แหล่งราคาเดียวกับ log)", () => {
  it("1M token เข้า (ไม่มี cached) = 1.5 USD × 35 = 52.5 บาท", () => {
    expect(rowCostThb(row({ promptTokens: 1_000_000 }))).toBeCloseTo(52.5, 4);
  });
  it("output คิดรวม candidates + thoughts (ตรงกับสูตรตอน log ต่อ call · D-69)", () => {
    // 1M out = 9 USD × 35 = 315 บาท · แบ่งเป็น candidates 400k + thoughts 600k ต้องได้เท่ากัน
    expect(rowCostThb(row({ candidatesTokens: 400_000, thoughtsTokens: 600_000 }))).toBeCloseTo(315, 4);
  });
  it("cached token คิดถูกกว่า + หักออกจาก prompt (ไม่คิดซ้ำ)", () => {
    // prompt 1M โดย 1M เป็น cached → 0.15 USD × 35 = 5.25 บาท (ไม่ใช่ 52.5)
    expect(rowCostThb(row({ promptTokens: 1_000_000, cachedTokens: 1_000_000 }))).toBeCloseTo(5.25, 4);
  });
  it("🔴 โมเดลไม่อยู่ในตารางราคา → null (ไม่เดา ไม่คืน 0)", () => {
    expect(rowCostThb(row({ model: "gemini-9.9-unknown", promptTokens: 1_000_000 }))).toBeNull();
  });
});

describe("D-70 · summarizeAiUsage — รวม/แยก call_kind", () => {
  const now = new Date("2026-09-03T05:00:00.000Z"); // = 12:00 เวลาไทย 3 ก.ย.
  const TODAY = "2026-09-03";

  it("แยกยอดตาม call_kind ครบ 4 ชนิด + รวมถูก + เรียง main→regen→extraction→assistant", () => {
    const rows = [
      row({ callKind: "main", calls: 10, promptTokens: 1_000_000 }),
      row({ callKind: "assistant", calls: 2, promptTokens: 1_000_000 }),
      row({ callKind: "regen", calls: 1, promptTokens: 1_000_000 }),
      row({ callKind: "extraction", calls: 5, promptTokens: 1_000_000 }),
    ];
    const s = summarizeAiUsage({ rows, customerRows: [{ day: TODAY, customers: 4 }], now, seriesDays: 7, orders: 2 });
    expect(s.byKind.map((k) => k.callKind), "เรียงตามลำดับที่เจ้าของอ่าน").toEqual(["main", "regen", "extraction", "assistant"]);
    expect(s.costThb, "รวม 4 แถว × 52.5").toBeCloseTo(210, 4);
    expect(s.byKind.find((k) => k.callKind === "assistant")!.costThb, "ต้นทุนผู้ช่วยเทรนแยกเห็นได้").toBeCloseTo(52.5, 4);
    expect(s.mainCalls).toBe(10);
    expect(s.regenCalls).toBe(1);
    expect(s.regenPct, "regen 1 ครั้งจาก main 10 = 10%").toBeCloseTo(10, 6);
  });

  it("ต้นทุนต่อลูกค้า / ต่อออเดอร์ · ไม่มีลูกค้า/ออเดอร์ = null (ไม่หารศูนย์)", () => {
    const rows = [row({ callKind: "main", calls: 4, promptTokens: 1_000_000 })]; // 52.5 บาท
    const s = summarizeAiUsage({ rows, customerRows: [{ day: TODAY, customers: 5 }], now, seriesDays: 7, orders: 2 });
    expect(s.costPerCustomer).toBeCloseTo(10.5, 4);
    expect(s.costPerOrder).toBeCloseTo(26.25, 4);
    const empty = summarizeAiUsage({ rows, customerRows: [], now, seriesDays: 7, orders: 0 });
    expect(empty.costPerCustomer).toBeNull();
    expect(empty.costPerOrder).toBeNull();
  });

  it("🔴 แถวราคาไม่ทราบ → นับแยก unknownCalls · ห้ามรวมเป็น 0 ในยอดเงิน (ต้นทุนห้ามดูถูกกว่าจริง)", () => {
    const rows = [
      row({ callKind: "main", calls: 3, promptTokens: 1_000_000 }),
      row({ callKind: "main", calls: 7, model: "gemini-9.9-unknown", promptTokens: 5_000_000 }),
    ];
    const s = summarizeAiUsage({ rows, customerRows: [{ day: TODAY, customers: 1 }], now, seriesDays: 7, orders: 1 });
    expect(s.costThb, "เฉพาะแถวที่รู้ราคา").toBeCloseTo(52.5, 4);
    expect(s.unknownCalls, "7 ครั้งที่ไม่รู้ราคา นับแยก").toBe(7);
    expect(s.byKind.find((k) => k.callKind === "main")!.unknownCalls).toBe(7);
    expect(s.byKind.find((k) => k.callKind === "main")!.calls, "จำนวนครั้งยังนับครบ 10").toBe(10);
  });

  it("กราฟเติมวันที่ไม่มีข้อมูลเป็น 0 (แท่งไม่ขาด) · เรียงเก่า→ใหม่ · ยาวตาม seriesDays", () => {
    const rows = [row({ day: "2026-09-01", callKind: "main", promptTokens: 1_000_000 })];
    const s = summarizeAiUsage({ rows, customerRows: [], now, seriesDays: 7, orders: 0 });
    expect(s.series).toHaveLength(7);
    expect(s.series[0].day).toBe("2026-08-28");
    expect(s.series[6].day).toBe(TODAY);
    expect(s.series.find((d) => d.day === "2026-09-01")!.costThb).toBeCloseTo(52.5, 4);
    expect(s.series.find((d) => d.day === "2026-09-02")!.costThb, "วันไม่มีข้อมูล = 0").toBe(0);
    expect(summarizeAiUsage({ rows, customerRows: [], now, seriesDays: 30, orders: 0 }).series).toHaveLength(30);
  });

  it("เลือกดูวันย้อนหลัง (targetDay) → ตัวเลขละเอียดเป็นของวันนั้น ไม่ใช่วันนี้", () => {
    const rows = [
      row({ day: TODAY, callKind: "main", calls: 99, promptTokens: 1_000_000 }),
      row({ day: "2026-09-01", callKind: "main", calls: 3, promptTokens: 2_000_000 }),
    ];
    const s = summarizeAiUsage({ rows, customerRows: [{ day: "2026-09-01", customers: 2 }], now, seriesDays: 7, targetDay: "2026-09-01", orders: 1 });
    expect(s.day).toBe("2026-09-01");
    expect(s.mainCalls).toBe(3);
    expect(s.costThb).toBeCloseTo(105, 4);
    expect(s.customers).toBe(2);
  });
});

describe("🔴 D-70 · ขอบวัน = เวลาไทย (ai_usage เก็บ UTC — ตัดด้วย UTC จะเพี้ยน 7 ชม.)", () => {
  it("23:30 ไทย (16:30Z) ยังเป็นวันเดิม · 00:30 ไทย (17:30Z ของเมื่อวาน UTC) = วันใหม่แล้ว", () => {
    expect(bangkokYMD(new Date("2026-09-03T16:29:59.000Z")), "23:29 ไทย 3 ก.ย.").toBe("2026-09-03");
    // 17:30Z ของ 3 ก.ย. = 00:30 ไทยของ 4 ก.ย. — ถ้าตัดด้วย UTC จะยังนับเป็น 3 ก.ย. (ผิด)
    expect(bangkokYMD(new Date("2026-09-03T17:30:00.000Z")), "00:30 ไทย 4 ก.ย.").toBe("2026-09-04");
  });

  it("bangkokDayStart(วันนี้) = 17:00Z ของเมื่อวาน (เที่ยงคืนไทย) — ใช้กรองช่วง ai_usage", () => {
    const start = bangkokDayStart(new Date("2026-09-03T05:00:00.000Z"), 0);
    expect(start.toISOString()).toBe("2026-09-02T17:00:00.000Z");
  });

  it("🔴 เทิร์นเวลา 00:30 ไทย ต้องเข้ายอด 'วันนี้' ไม่ใช่เมื่อวาน (เคสที่ UTC ทำพัง)", () => {
    // now = 01:00 ไทยของ 4 ก.ย. · แถวถูก SQL shift +7 มาแล้วเป็น "2026-09-04"
    const now = new Date("2026-09-03T18:00:00.000Z");
    const s = summarizeAiUsage({
      rows: [row({ day: "2026-09-04", callKind: "main", calls: 1, promptTokens: 1_000_000 })],
      customerRows: [{ day: "2026-09-04", customers: 1 }],
      now, seriesDays: 7, orders: 0,
    });
    expect(s.day, "วันนี้ (ไทย) = 4 ก.ย. แม้ UTC ยังเป็น 3 ก.ย.").toBe("2026-09-04");
    expect(s.mainCalls, "เทิร์นหลังเที่ยงคืนไทยต้องเข้ายอดวันนี้").toBe(1);
    expect(s.costThb).toBeCloseTo(52.5, 4);
  });

  it("thaiDaysBack คืนวันไทยเรียงเก่า→ใหม่ รวมวันนี้", () => {
    expect(thaiDaysBack(new Date("2026-09-03T18:00:00.000Z"), 3)).toEqual(["2026-09-02", "2026-09-03", "2026-09-04"]);
  });
});

describe("D-70 · ป้าย 'ประมาณ' ต้องมีติดทุกที่ที่โชว์เงิน (D-69)", () => {
  it("ข้อความป้ายบอกให้ไปดู cost log ของ Google", () => {
    expect(COST_APPROX_NOTE).toContain("ประมาณ");
    expect(COST_APPROX_NOTE).toContain("cost log ของ Google");
  });
});
