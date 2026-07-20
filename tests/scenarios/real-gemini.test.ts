import { describe, it, expect } from "vitest";
import { runSalesTurn } from "@/lib/gemini";
import { buildCatalogInjection } from "@/lib/agent/inject";
import { productsRows, promoRows, PRICING_CONFIG } from "../harness/botlib-fixture";
import { testConfig } from "../harness/fixtures";

/**
 * 🔴 D-20: จับบั๊กที่ scripted Gemini จับไม่ได้ — "AI ส่ง items จริงไหม"
 * scripted mock ใส่ items ให้เอง = เขียวลวงตา · บทนี้ยิง Gemini จริง
 * รัน: HARNESS_REAL_GEMINI=1 GEMINI_API_KEY=... npx vitest run real-gemini
 * (ข้ามอัตโนมัติในชุดปกติ — ไม่มี key/ไม่ตั้ง flag)
 */
const RUN = process.env.HARNESS_REAL_GEMINI === "1" && Boolean(process.env.GEMINI_API_KEY);

describe.skipIf(!RUN)("real Gemini — AI ต้องส่ง items[{qty}] เมื่อลูกค้าบอกจำนวน (D-20)", () => {
  const catalog = buildCatalogInjection(productsRows(), promoRows(), { config: PRICING_CONFIG, payment: "", now: new Date("2026-07-18T03:00:00Z") });

  it('"เอา 3 ถ้วยครับ" → rawItems ไม่ว่าง + qty=3 · ไม่ degraded', async () => {
    const out = await runSalesTurn({
      config: testConfig(),
      configText: "",
      stepText: "(ลูกค้าเลือกจำนวนแล้ว สรุปยอด)",
      faqText: "",
      catalogText: catalog,
      objectionText: "",
      exampleText: "",
      stateText: "ประตูปัจจุบัน: 2 · ยังไม่มีออเดอร์",
      historyText: "(เริ่มบทสนทนา)",
      userMessage: "เอา 3 ถ้วยครับ",
      currentStage: "2",
    });

    expect(out.degraded, "ต้องไม่ล้ม (ถ้า degraded = MAX_TOKENS/thinking วน กลับมา)").toBe(false);
    expect(out.orderData.items, "🔴 AI ต้องส่ง items (นี่คือบั๊ก production)").toBeDefined();
    expect((out.orderData.items ?? []).length, "items ไม่ว่าง").toBeGreaterThan(0);
    expect(out.orderData.items?.[0].qty, "qty=3").toBe(3);
    // 🔴 ห้ามเดา/ลอกตัวอย่าง: ลูกค้ายังไม่ให้ชื่อ/ที่อยู่/เบอร์ → ต้องไม่มี key เลย
    expect(out.orderData.ชื่อ, "ยังไม่ให้ชื่อ = ไม่มี key").toBeUndefined();
    expect(out.orderData.ที่อยู่, "ยังไม่ให้ที่อยู่ = ไม่มี key").toBeUndefined();
    expect(out.orderData.เบอร์, "ยังไม่ให้เบอร์ = ไม่มี key").toBeUndefined();
    // จับการลอกค่าปลอมจากตัวอย่างใน prompt โดยตรง (ถ้าเจอ = ลอก)
    const raw = JSON.stringify(out.orderData);
    expect(raw, "ห้ามลอก 0000000000 จากตัวอย่าง B").not.toContain("0000000000");
    expect(raw, "ห้ามลอก 0912345678 (ตัวอย่างเก่า)").not.toContain("0912345678");
  }, 20_000);
});
