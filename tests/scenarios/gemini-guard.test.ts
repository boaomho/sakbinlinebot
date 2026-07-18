import { describe, it, expect, vi } from "vitest";
import { getConfig } from "@/lib/config";

/**
 * 🔴 MAX_TOKENS — gemini-3.x นับ thinking+output รวมกันในเพดาน maxOutputTokens
 * ชนเพดาน = JSON ขาดกลางคัน → ห้าม parse (จะได้ค่าครึ่ง ๆ หรือ throw)
 *
 * ของจริง: เทิร์นสรุปออเดอร์ชน 2032/2048 → fallback → ลูกค้าเห็น "ปลาทูขัดข้อง"
 * ตอนกำลังจะจ่ายเงิน = เทิร์นที่แพงที่สุดของ funnel
 */

describe("maxOutputTokens — พื้นต้องสูงพอสำหรับเทิร์นสรุปออเดอร์", () => {
  it("โค้ดบังคับพื้น 4096 แม้ชีตตั้งต่ำกว่า", async () => {
    // getConfig ถูก mock ใน setup → เอา config ตัวจริงมาเช็ค logic พื้น
    const actual = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
    expect(typeof actual.resolveFeatureSwitches).toBe("function");

    // fixture (ที่ harness ใช้) ต้องสะท้อนพื้นจริง ไม่งั้นเทสจะไม่ตรงกับ prod
    const cfg = await getConfig();
    expect(cfg.maxOutputTokens, "เพดานต้อง >= 4096 (2048 เคยชนจริง)").toBeGreaterThanOrEqual(4096);
  });
});

describe("MAX_TOKENS guard — ห้าม parse JSON ที่ขาดกลางคัน", () => {
  it("finishReason=MAX_TOKENS → fallback + degraded (ไม่ throw ไม่ parse ครึ่ง ๆ)", async () => {
    // จำลอง response ที่ชนเพดาน: JSON ขาดกลางคัน (ปิดวงเล็บไม่ครบ)
    const truncated = '{"reply":"สรุปที่อยู่จัดส่งนะคะ\\nสมหญิง ใจดี\\n123/45 ม.6 บางพลี","stage":"4b"';
    expect(() => JSON.parse(truncated), "ยืนยันว่า JSON แบบนี้ parse ไม่ได้จริง").toThrow();

    vi.resetModules();
    vi.doMock("@google/genai", async () => {
      const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
      return {
        ...actual,
        GoogleGenAI: class {
          models = {
            generateContent: async () => ({
              candidates: [{ finishReason: "MAX_TOKENS" }],
              usageMetadata: { thoughtsTokenCount: 1900, candidatesTokenCount: 132, totalTokenCount: 2032 },
              text: truncated, // มี text อยู่ แต่ขาดกลางคัน — guard ต้องไม่แตะ
            }),
          };
        },
      };
    });

    // ⚠️ setup.ts mock @/lib/gemini เป็น scripted output อยู่ → ต้อง importActual
    //    ไม่งั้นจะไปเทส mock ของ harness เอง ไม่ใช่ guard ตัวจริง
    const { runSalesTurn } = await vi.importActual<typeof import("@/lib/gemini")>("@/lib/gemini");
    const { testConfig } = await import("../harness/fixtures");

    const out = await runSalesTurn({
      config: testConfig(),
      configText: "",
      stepText: "",
      faqText: "",
      catalogText: "",
      stateText: "",
      historyText: "",
      userMessage: "สมหญิง ใจดี 123/45 ม.6 บางพลี สมุทรปราการ 10540 0811122334",
      currentStage: "4b",
    });

    expect(out.degraded, "ต้อง mark degraded ให้โค้ดปลายทางรู้ว่าเชื่อไม่ได้").toBe(true);
    expect(out.stage, "คง stage เดิม ไม่ให้ลูกค้าถอยหลัง").toBe("4b");
    expect(out.orderData, "ห้ามหยิบ order_data จาก JSON ที่ขาด").toEqual({});
    expect(out.paymentMethod).toBe("");
    vi.doUnmock("@google/genai");
    vi.resetModules();
  });
});
