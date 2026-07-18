import { describe, it, expect, vi } from "vitest";
import { sheetsCalls } from "../harness/state";

/**
 * (ข) config-parse unit test — พิสูจน์ว่า getConfig อ่าน CSV_Config จาก loadBotLibrary จริง
 * (scenario tests ยัง mock getConfig คืน testConfig — ข้อ (ก) — จึงต้องเทส parse แยกที่นี่)
 *
 * ⚠️ setup.ts mock getConfig ไว้ → ต้อง importActual เพื่อเรียก getConfig ตัวจริง
 */

async function realGetConfig() {
  const cfg = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
  cfg.__resetConfigCache();
  return cfg.getConfig();
}

describe("getConfig — parse CSV_Config จาก BotLibrary (header-driven key/value)", () => {
  it("อ่าน key/value + สวิตช์ไทย 'เปิด' + วงเล็บกำกับท้ายคีย์", async () => {
    // header จริง: A=หมวด B=ค่า(key) C=ค่าที่ตั้ง
    sheetsCalls.botLibReturn = {
      CSV_Config: [
        ["หมวด", "ค่า", "ค่าที่ตั้ง"],
        ["ทั่วไป", "ชื่อบอท", "ปลาทู"],
        ["ระบบ", "เปิด_ระบบออเดอร์ (Orders)", "เปิด"], // วงเล็บกำกับ + ค่าไทย
        ["ระบบ", "เปิด_ติดแท็ก", "ปิด"],
        ["ค่า", "maxOutputTokens", "8000"],
      ],
    };

    const cfg = await realGetConfig();
    expect(cfg.botName).toBe("ปลาทู");
    expect(cfg.rawSwitches.orders, "'เปิด' + วงเล็บ (Orders) → true").toBe(true);
    expect(cfg.rawSwitches.tagging, "'ปิด' → false").toBe(false);
    expect(cfg.maxOutputTokens, "8000 > พื้น 4096 → ใช้ 8000").toBe(8000);
    expect(cfg.loadFailed).toBe(false);
  });

  it("CSV_Config ว่าง → loadFailed=true + ใช้ค่า default", async () => {
    sheetsCalls.botLibReturn = { CSV_Config: [] };
    const cfg = await realGetConfig();
    expect(cfg.loadFailed).toBe(true);
    expect(cfg.botName, "default").toBe("ปลาทู");
    expect(cfg.maxOutputTokens, "พื้นบังคับ 4096").toBe(4096);
  });
});

describe("resolveFeatureSwitches — salesCore เช็ค SHEET_BOTLIB_ID (Step 1)", () => {
  it("มี SHEET_BOTLIB_ID → salesCore=true", async () => {
    const cfg = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
    sheetsCalls.botLibReturn = { CSV_Config: [["หมวด", "ค่า", "ค่าที่ตั้ง"], ["", "ชื่อบอท", "ปลาทู"]] };
    cfg.__resetConfigCache();
    const config = await cfg.getConfig();
    const switches = cfg.resolveFeatureSwitches(config);
    // .env.test มี SHEET_BOTLIB_ID (dummy) → salesCore ต้อง true
    expect(switches.salesCore).toBe(true);
  });
});
