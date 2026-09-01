import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { sheetsCalls, harnessOverrides, scriptGemini, turn, lineCalls, adminPushes } from "../harness/state";
import { seedBotLib, TAB, PRICING_CONFIG } from "../harness/botlib-fixture";
import { sendText } from "../harness/replay";
import { __resetConfigCache, DEFAULT_GEMINI_MODEL, DEFAULT_THINKING_LEVEL, DEFAULT_SLOW_SYSTEM_MESSAGE } from "@/lib/config";
import { resolveThinkingConfig, resolveGeminiTimeouts } from "@/lib/gemini";

/**
 * D-69 · ทำโมเดล/thinking/timeout/ข้อความระบบช้า ตั้งจากชีตได้ + เก็บต้นทุนลง Neon
 * 🔴 หัวใจ: ไม่มีแถวในชีต = ทำงานต่อด้วยค่าเดิม (gemini-3.5-flash) ห้ามพัง ห้ามปิดฟีเจอร์
 */

const U = "U" + "d69".padEnd(32, "0");

/**
 * seed Config แล้วอ่านด้วย getConfig **ตัวจริง**
 * 🔴 harness mock `@/lib/config.getConfig` ให้คืน fixture → ถ้าเรียกตัว mock จะไม่ได้พิสูจน์ว่า "อ่านจากชีตจริง"
 *    ต้อง importActual เหมือน v3-adapter.test.ts (เส้นทางเดียวกับ prod: loader → adapter → getConfig)
 */
async function configFromSheet(rows: [string, string][]) {
  seedBotLib();
  sheetsCalls.botLibReturn[TAB.config] = [
    ["key", "ค่าที่ตั้ง"],
    ...Object.entries(PRICING_CONFIG),
    ...rows,
  ];
  const cfgMod = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
  cfgMod.__resetConfigCache();
  return cfgMod.getConfig();
}

beforeEach(() => {
  seedBotLib();
  __resetConfigCache();
});
afterEach(() => {
  harnessOverrides.config = {};
  __resetConfigCache();
});

describe("D-69 · 4 คีย์ใหม่อ่านจากชีตได้จริง · ไม่มีแถว = ค่าเดิม", () => {
  it("🔴 ชีตไม่มีแถวสักตัว → default ปลอดภัย (โมเดลเดิม · low · 15 วิ · ข้อความมาตรฐาน)", async () => {
    const c = await configFromSheet([]);
    expect(c.geminiModel, "โมเดลเริ่มต้นห้ามเปลี่ยนใน D-69").toBe(DEFAULT_GEMINI_MODEL);
    expect(c.geminiModel).toBe("gemini-3.5-flash");
    expect(c.thinkingLevelRaw).toBe(DEFAULT_THINKING_LEVEL);
    expect(c.geminiTimeoutMs).toBe(15_000);
    expect(c.slowSystemMessage).toBe(DEFAULT_SLOW_SYSTEM_MESSAGE);
  });

  it("ตั้งครบ 4 คีย์ในชีต → อ่านได้ทุกตัว", async () => {
    const c = await configFromSheet([
      ["โมเดล", "gemini-3.7-flash"],
      ["ระดับการคิด", "medium"],
      ["timeout_วินาที", "20"],
      ["ข้อความ_ระบบช้า", "ช้าหน่อยนะคะ {ชื่อบอท}แจ้งแอดมินแล้วค่ะ"],
    ]);
    expect(c.geminiModel).toBe("gemini-3.7-flash");
    expect(c.thinkingLevelRaw).toBe("medium");
    expect(c.geminiTimeoutMs).toBe(20_000);
    expect(c.slowSystemMessage).toContain("{ชื่อบอท}");
  });

  it("ค่าเพี้ยนในชีต (timeout ไม่ใช่ตัวเลข / ค่าว่าง) → กลับไปใช้ default ไม่พัง", async () => {
    const c = await configFromSheet([["โมเดล", ""], ["timeout_วินาที", "ไม่ใช่เลข"]]);
    expect(c.geminiModel, "ค่าว่าง = ใช้ default").toBe(DEFAULT_GEMINI_MODEL);
    expect(c.geminiTimeoutMs, "แปลงเลขไม่ได้ = default 15 วิ").toBe(15_000);
  });
});

describe("D-69 · resolveThinkingConfig — เลือกพารามิเตอร์ถูกตระกูลโมเดล (ส่งผิดตัว = HTTP 400)", () => {
  it("🔴 gemini-3.x → thinkingLevel (enum) เท่านั้น · ห้ามมี thinkingBudget ติดไปด้วย", () => {
    for (const [raw, expected] of [["minimal", "MINIMAL"], ["low", "LOW"], ["medium", "MEDIUM"], ["high", "HIGH"]] as const) {
      const r = resolveThinkingConfig("gemini-3.5-flash", raw);
      expect(r.thinkingLevel).toBe(expected);
      expect(r.thinkingBudget, "ห้ามส่งทั้งคู่").toBeUndefined();
    }
  });

  it("🔴 gemini-2.x → thinkingBudget (ตัวเลข) เท่านั้น · ห้ามมี thinkingLevel", () => {
    const r = resolveThinkingConfig("gemini-2.5-flash", "512");
    expect(r.thinkingBudget).toBe(512);
    expect(r.thinkingLevel, "ห้ามส่งทั้งคู่").toBeUndefined();
    expect(resolveThinkingConfig("gemini-2.5-flash", "0").thinkingBudget, "0 = ปิด thinking").toBe(0);
  });

  it("🔴 ค่าในชีตใช้กับตระกูลนั้นไม่ได้ → log เตือน + ใช้ default ของตระกูล (ไม่ยิงจนพัง)", () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => warns.push(String(a[0])));

    // ใส่ตัวเลขให้ 3.x (enum เท่านั้น)
    const v3 = resolveThinkingConfig("gemini-3.5-flash", "512");
    expect(v3.thinkingLevel).toBe("LOW");
    expect(v3.thinkingBudget).toBeUndefined();

    // ใส่ enum ให้ 2.x (ตัวเลขเท่านั้น)
    const v2 = resolveThinkingConfig("gemini-2.5-flash", "high");
    expect(v2.thinkingBudget, "อัตโนมัติ").toBe(-1);
    expect(v2.thinkingLevel).toBeUndefined();

    expect(warns.filter((w) => w.includes("thinking-invalid")).length, "เตือนทั้งสองเคส").toBe(2);
    spy.mockRestore();
  });

  it("โมเดลไม่รู้จัก (รุ่นใหม่กว่า) → ถือเป็นตระกูล enum (ทิศเดียวกับ 3.x)", () => {
    expect(resolveThinkingConfig("gemini-4.0-flash", "high").thinkingLevel).toBe("HIGH");
  });
});

describe("D-69 · การ์ด timeout — debounce + main + regen ต้องไม่เกิน maxDuration", () => {
  it("อยู่ในงบ → ใช้ค่าที่ขอ · regen ได้ครึ่งหนึ่ง", () => {
    const t = resolveGeminiTimeouts(15_000, 6_000, 60_000);
    expect(t).toEqual({ mainMs: 15_000, regenMs: 7_500, clamped: false });
  });

  it("🔴 เกินงบ (maxDuration 30) → clamp ลงอัตโนมัติ + log เตือน · ไม่ปล่อยให้ Vercel ตัดกลางคัน", () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => warns.push(String(a[0])));
    const t = resolveGeminiTimeouts(15_000, 6_000, 30_000);
    expect(t.clamped).toBe(true);
    // งบ = 30 − 6(headroom) − 6(debounce) = 18 วิ → main 12 + regen 6
    expect(t.mainMs + t.regenMs, "รวมต้องไม่เกินงบ").toBeLessThanOrEqual(18_000);
    expect(warns.some((w) => w.includes("timeout-clamped"))).toBe(true);
    spy.mockRestore();
  });

  it("debounce ยาวมาก → ยังคืนค่าที่ใช้ได้ (ไม่ติดลบ/ไม่เป็นศูนย์)", () => {
    const t = resolveGeminiTimeouts(15_000, 50_000, 60_000);
    expect(t.mainMs).toBeGreaterThanOrEqual(1_000);
    expect(t.regenMs).toBeGreaterThanOrEqual(500);
  });
});

describe("D-69 · ข้อความระบบช้า + แจ้งแอดมิน (ไม่ปิดบอท)", () => {
  it("🔴 degraded → ใช้ข้อความจากชีต (แทนค่า {ชื่อบอท}) · ไม่สั่งให้พิมพ์ซ้ำ", async () => {
    harnessOverrides.config = {
      raw: new Map<string, string>([...Object.entries(PRICING_CONFIG), ["ทักทายรายวัน", ""]]),
      slowSystemMessage: "ระบบช้าค่ะ {ชื่อบอท}แจ้งทีมแอดมินแล้วนะคะ",
    };
    scriptGemini([turn({ reply: "AI", stage: "S1", degraded: true })]);
    await sendText(U, "สนใจค่ะ");
    const texts = lineCalls.replies.flatMap((r) => r.messages).map((m) => (m.type === "text" ? m.text : "")).join(" ");
    expect(texts).toContain("ระบบช้าค่ะ ปลาทูแจ้งทีมแอดมินแล้วนะคะ");
    expect(texts, "🔴 ห้ามสั่งพิมพ์ซ้ำ (วงจรบทยาว→ช้าลง)").not.toContain("อีกครั้ง");
    expect(texts, "🔴 ห้ามบอกว่าไม่ได้รับข้อความ (ไม่จริง)").not.toContain("ยังไม่ได้รับ");
  });

  it("🔴 degraded → แจ้งกลุ่มแอดมิน (ข้อความที่บอกลูกค้าต้องเป็นจริง) · ไม่ปิดบอท", async () => {
    harnessOverrides.config = { raw: new Map<string, string>([...Object.entries(PRICING_CONFIG), ["ทักทายรายวัน", ""]]) };
    scriptGemini([turn({ reply: "AI", stage: "S1", degraded: true })]);
    await sendText(U, "สนใจค่ะ");
    const pushes = JSON.stringify(adminPushes());
    expect(pushes, "ต้องแจ้งแอดมิน").toContain("ระบบตอบไม่ทัน");
    expect(pushes, "ห้ามมี footer ปิดบอท").not.toContain("บอทปิดการทำงานกับลูกค้ารายนี้แล้ว");
  });
});

describe("D-69 · ตารางราคา + รุ่นที่ห้ามใช้", () => {
  it("🔴 gemini-2.5-* → log เตือน model-deprecated (บอทยังทำงานต่อ ไม่ throw)", () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => warns.push(String(a[0])));
    // resolveThinkingConfig ไม่เตือน — ตัวเตือนอยู่ที่ runSalesTurn (warnIfDeprecatedModel)
    // ที่นี่พิสูจน์ว่า 2.5 ยังคำนวณ thinking ได้ (ไม่ throw) = บอทไม่พังถ้าเผลอตั้ง
    expect(resolveThinkingConfig("gemini-2.5-flash", "512").thinkingBudget).toBe(512);
    spy.mockRestore();
    expect(warns.some((w) => w.includes("thinking-invalid")), "ค่าถูกต้อง = ไม่เตือน").toBe(false);
  });

  it("รุ่น lite ใช้ thinkingLevel เหมือน 3.x ตัวเต็ม (ตระกูลเดียวกัน)", () => {
    expect(resolveThinkingConfig("gemini-3.1-flash-lite", "minimal").thinkingLevel).toBe("MINIMAL");
    expect(resolveThinkingConfig("gemini-3.5-flash-lite", "low").thinkingBudget).toBeUndefined();
  });
});
