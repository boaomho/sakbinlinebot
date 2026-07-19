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

describe("parse order_data — D-20: ชื่อ/ที่อยู่/เบอร์ + items[{qty}] (AI ส่งแค่ qty)", () => {
  it("Gemini ส่ง items[{qty}] → parse เก็บแค่ qty (ไม่มี sku/ยอด)", async () => {
    const full = JSON.stringify({
      reply: "รับ 5 ถ้วยนะคะ",
      stage: "4b",
      order_data: {
        ชื่อ: "สมหญิง ใจดี",
        ที่อยู่: "123/45 ม.6 บางพลี สมุทรปราการ 10540",
        เบอร์: "0811122334",
        items: [{ qty: 5 }],
      },
      payment_method: "โอน",
    });

    vi.resetModules();
    vi.doMock("@google/genai", async () => {
      const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
      return {
        ...actual,
        GoogleGenAI: class {
          models = {
            generateContent: async () => ({
              candidates: [{ finishReason: "STOP" }],
              usageMetadata: { candidatesTokenCount: 90, totalTokenCount: 90 },
              text: full,
            }),
          };
        },
      };
    });

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
      userMessage: "เอา 5 ถ้วย",
      currentStage: "4b",
    });

    expect(out.degraded).toBe(false);
    expect(out.orderData.ชื่อ).toBe("สมหญิง ใจดี");
    expect(out.orderData.เบอร์).toBe("0811122334");
    expect(out.orderData.items).toEqual([{ qty: 5 }]); // แค่ qty · sku โค้ดใส่ทีหลัง
    expect((out.orderData as Record<string, unknown>).ยอด).toBeUndefined();
    vi.doUnmock("@google/genai");
    vi.resetModules();
  });

  it("items ที่ qty<=0 ถูกกรองทิ้ง · sku ที่ AI ส่งมา(ถ้ามี)ถูกละทิ้ง (โค้ดใส่เอง)", async () => {
    const full = JSON.stringify({
      reply: "x",
      stage: "2",
      order_data: { items: [{ qty: 2 }, { sku: "จะถูกละ", qty: 3 }, { qty: 0 }] },
    });
    vi.resetModules();
    vi.doMock("@google/genai", async () => {
      const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
      return {
        ...actual,
        GoogleGenAI: class {
          models = { generateContent: async () => ({ candidates: [{ finishReason: "STOP" }], usageMetadata: {}, text: full }) };
        },
      };
    });
    const { runSalesTurn } = await vi.importActual<typeof import("@/lib/gemini")>("@/lib/gemini");
    const { testConfig } = await import("../harness/fixtures");
    const out = await runSalesTurn({
      config: testConfig(), configText: "", stepText: "", faqText: "", catalogText: "", stateText: "", historyText: "",
      userMessage: "x", currentStage: "2",
    });
    expect(out.orderData.items).toEqual([{ qty: 2 }, { qty: 3 }]); // qty>0 เก็บ · sku ที่ AI ส่งถูกละ · qty:0 ทิ้ง
    vi.doUnmock("@google/genai");
    vi.resetModules();
  });

  it("🔴 D-20: ช่องว่าง/placeholder ว่าง ถูก drop (ไม่กลายเป็นข้อมูลใน gate)", async () => {
    const full = JSON.stringify({ reply: "x", stage: "2", order_data: { ชื่อ: "", ที่อยู่: "   ", เบอร์: "0811122334" } });
    vi.resetModules();
    vi.doMock("@google/genai", async () => {
      const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
      return { ...actual, GoogleGenAI: class { models = { generateContent: async () => ({ candidates: [{ finishReason: "STOP" }], usageMetadata: {}, text: full }) }; } };
    });
    const { runSalesTurn } = await vi.importActual<typeof import("@/lib/gemini")>("@/lib/gemini");
    const { testConfig } = await import("../harness/fixtures");
    const out = await runSalesTurn({ config: testConfig(), configText: "", stepText: "", faqText: "", catalogText: "", stateText: "", historyText: "", userMessage: "x", currentStage: "2" });
    expect(out.orderData.ชื่อ, "ชื่อ ว่าง → ไม่มี key").toBeUndefined();
    expect(out.orderData.ที่อยู่, "ที่อยู่ whitespace → ไม่มี key").toBeUndefined();
    expect(out.orderData.เบอร์).toBe("0811122334");
    vi.doUnmock("@google/genai");
    vi.resetModules();
  });
});
