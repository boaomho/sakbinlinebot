import { describe, it, expect } from "vitest";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";

/**
 * P0 — env ของชีตต้องแปลงเป็น spreadsheetId ให้ถูก ไม่งั้นออเดอร์หายเงียบ
 *
 * ที่มา: SHEET_ORDERS_ID บน Vercel เคยเป็น published CSV URL แต่โค้ดยัดค่าดิบเข้า
 * spreadsheetId → Sheets API ตอบ error → runOrderGate จับ error แล้ว return
 * → ลูกค้าได้ข้อความ "ขอบคุณค่ะ" แต่ไม่มีแถวขึ้นชีต ไม่มี push หาแอดมิน
 */

const REAL_ORDERS_ID = "1_TinrMFnxSA9tvIbH3gu0P1kAgBLNCGR1ss4vsRCFrQ";

describe("resolveSpreadsheetId", () => {
  it("ID ล้วน → ใช้ตรง ๆ (ค่าจริงของชีต Orders)", () => {
    expect(resolveSpreadsheetId(REAL_ORDERS_ID, "SHEET_ORDERS_ID")).toBe(REAL_ORDERS_ID);
  });

  it("URL หน้าแก้ไข → ดึง ID ออกมา", () => {
    expect(
      resolveSpreadsheetId(`https://docs.google.com/spreadsheets/d/${REAL_ORDERS_ID}/edit#gid=0`),
    ).toBe(REAL_ORDERS_ID);
  });

  it("🔴 published CSV URL (2PACX) → ต้อง throw + บอกวิธีแก้ ห้ามคืนค่ามั่ว", () => {
    const url =
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vQxHarnessTestPublishedIdAbc123/pub?output=csv";
    expect(() => resolveSpreadsheetId(url, "SHEET_ORDERS_ID")).toThrowError(/published CSV URL/);
    // ข้อความ error ต้องบอกทางออกให้ทำตามได้เลย ไม่ใช่แค่ด่าว่าผิด
    expect(() => resolveSpreadsheetId(url, "SHEET_ORDERS_ID")).toThrowError(/\/edit/);
    // ต้องอ้างชื่อ env ที่ผิด เพื่อให้รู้ว่าไปแก้ตัวไหน
    expect(() => resolveSpreadsheetId(url, "SHEET_ORDERS_ID")).toThrowError(/SHEET_ORDERS_ID/);
  });

  it("ค่าว่าง / undefined → throw", () => {
    expect(() => resolveSpreadsheetId(undefined, "SHEET_BOTLIB_ID")).toThrowError(/SHEET_BOTLIB_ID/);
    expect(() => resolveSpreadsheetId("   ", "SHEET_BOTLIB_ID")).toThrowError(/ไม่ได้ตั้งค่า/);
  });

  it("ขยะ → throw ไม่ปล่อยผ่านไปให้ Google ตอบ 404 ลอย ๆ", () => {
    expect(() => resolveSpreadsheetId("not-an-id", "SHEET_ORDERS_ID")).toThrowError(/รูปแบบไม่ถูกต้อง/);
    expect(() => resolveSpreadsheetId("https://example.com/foo", "SHEET_ORDERS_ID")).toThrowError();
  });
});
