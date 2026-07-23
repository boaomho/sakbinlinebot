import { AsyncLocalStorage } from "node:async_hooks";
import { resolveSpreadsheetId } from "@/lib/core/sheet-id";

/**
 * lib/train/sandbox.ts — T-STUDIO เฟส ก: sandbox context สำหรับห้องซ้อมเทรน (/train)
 *
 * หลักการ (เคาะแล้ว 2026-07-23):
 * - pipeline วิ่งโค้ด production เส้นเดิมทุกบรรทัด (processMessage/gate/verbatim/pre-check/extraction ไม่แตะ)
 * - เฉพาะฟังก์ชัน I/O ปลายทาง (LINE/Blob/ชีต Orders/Neon) มี guard เช็ค context นี้ → เบี่ยงเข้า collector
 * - 🔴 เงื่อนไข ก (เจ้าของ): guard ตัดสินจาก "ALS มีค่า" เท่านั้น — ไม่มี context = พฤติกรรม production
 *   เดิมทุกบรรทัด · ห้ามอิง ENV/flag อื่น (กัน guard เผลอทำงานบน prod)
 * - Neon: getSql() ใน lib/db.ts สลับไป DATABASE_URL_TRAIN (Neon branch แยก) เมื่ออยู่ใน sandbox
 * - ชีต Orders: proxy ใน getSheets() เบี่ยง get/append/batchUpdate ของ "ชีต Orders เท่านั้น" เข้า fake grid
 *   ใน context (BotLibrary batchGet + อ่าน header แถว 1 ผ่านของจริง — read-only · กัน cache คอลัมน์เพี้ยน)
 */

/** ข้อความที่ "ลูกค้าจำลอง" จะเห็น (จาก replyMessages/pushMessages) — เก็บหลัง parseReplyIntoMessages แล้ว */
export interface CollectedBubbles {
  via: "reply" | "push";
  /* messagingApi.Message[] — เก็บเป็น unknown กัน import @line/bot-sdk เข้าไฟล์นี้ (KI-04) */
  messages: unknown[];
}

/** push เข้ากลุ่มแอดมิน/กลุ่มเช็คยอด ที่ "จะถูกส่งจริง" — โชว์ใน X-ray */
export interface CollectedAdminPush {
  to: string;
  text?: string;
  messages?: unknown[];
}

export interface TrainSandbox {
  sessionId: string;
  /** ลูกค้าจำลอง — prefix TRAIN: กันชน LINE userId จริง (U + 32 hex) + ระบุ/ล้างได้ถ้ารั่ว */
  userId: string;
  replies: CollectedBubbles[];
  adminPushes: CollectedAdminPush[];
  loadingCalls: number;
  slipUploads: string[];
  slipCounter: number;
  /** fake grid ชีต Orders — เฉพาะแถวข้อมูล (แถว 2 ลงไป) · header ใช้ของจริง (อ่านผ่าน proxy) */
  orderRows: string[][];
  /** log JSON (มี scope) ที่ pipeline พ่นระหว่างเทิร์น — tee มาเป็นแหล่ง X-ray */
  logs: Record<string, unknown>[];
}

const store = new AsyncLocalStorage<TrainSandbox>();

export function createSandbox(sessionId: string): TrainSandbox {
  return {
    sessionId,
    userId: trainUserId(sessionId),
    replies: [],
    adminPushes: [],
    loadingCalls: 0,
    slipUploads: [],
    slipCounter: 0,
    orderRows: [],
    logs: [],
  };
}

export function trainUserId(sessionId: string): string {
  return `TRAIN:${sessionId}`;
}

/** guard ทุกตัวเรียกตัวนี้ — null = ไม่อยู่ใน sandbox = ทำงาน production เดิม */
export function getTrainSandbox(): TrainSandbox | null {
  return store.getStore() ?? null;
}

export function runInSandbox<T>(ctx: TrainSandbox, fn: () => Promise<T>): Promise<T> {
  installConsoleTee();
  return store.run(ctx, fn);
}

// ---- console tee: ดัก log JSON ที่ pipeline พ่นอยู่แล้ว (scope: gate/verbatim/extraction/...) เข้า ctx ----
// patch ครั้งเดียวต่อ process · ไม่มี sandbox context = ส่งผ่านเฉยๆ (prod ไม่เปลี่ยนพฤติกรรม)
let teeInstalled = false;
function installConsoleTee(): void {
  if (teeInstalled) return;
  teeInstalled = true;
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const ctx = store.getStore();
      if (ctx && typeof args[0] === "string") {
        try {
          const parsed = JSON.parse(args[0]);
          if (parsed && typeof parsed === "object" && "scope" in parsed) ctx.logs.push(parsed);
        } catch {
          /* ไม่ใช่ JSON log — ข้าม */
        }
      }
      original(...args);
    };
  }
}

// ---- fake grid ชีต Orders (เบี่ยงเฉพาะ spreadsheetId ของ Orders · BotLibrary ผ่านของจริง) ----

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** parse "Orders!C5:C5" / "Orders!A2:X" → {col,row} ของจุดเริ่ม (พอสำหรับ batchUpdate รายเซลล์) */
function parseRangeStart(range: string): { col: number; row: number } | null {
  const m = /!([A-Z]+)(\d+)/.exec(range);
  if (!m) return null;
  return { col: colLetterToIndex(m[1]), row: parseInt(m[2], 10) };
}

function ordersSpreadsheetId(): string | null {
  try {
    return resolveSpreadsheetId(process.env.SHEET_ORDERS_ID, "SHEET_ORDERS_ID");
  } catch {
    return null; // env ไม่มี/ผิดรูป = ฟีเจอร์ orders ปิดอยู่แล้ว → proxy ผ่านของจริง (พฤติกรรมเดิม)
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ครอบ sheets client จริงด้วย proxy ที่เบี่ยงเฉพาะ "ชีต Orders" เข้า fake grid ของ sandbox
 * - อ่าน header (!1:1) → ผ่านของจริง (read-only) — ให้ resolveColumns เห็นตำแหน่งคอลัมน์ตรงชีตจริงเป๊ะ
 *   (กัน cache คอลัมน์ใน lib/orders เพี้ยนข้ามโหมด = กันเขียนผิดช่องบน prod)
 * - อ่านแถวข้อมูล (A2:...) → คืน ctx.orderRows · append → push แถว · batchUpdate → แก้เซลล์ใน grid
 * - ชีตอื่น (BotLibrary) + batchGet → ผ่านของจริงทั้งหมด
 */
export function wrapSheetsForSandbox(real: any, ctx: TrainSandbox): any {
  const ordersId = ordersSpreadsheetId();
  if (!ordersId) return real;
  const realValues = real.spreadsheets.values;
  const values = {
    get: async (p: any) => {
      if (p.spreadsheetId === ordersId && typeof p.range === "string" && !p.range.includes("!1:1")) {
        return { data: { values: ctx.orderRows.map((r) => [...r]) } };
      }
      return realValues.get(p);
    },
    append: async (p: any) => {
      if (p.spreadsheetId === ordersId) {
        for (const row of p.requestBody.values as string[][]) ctx.orderRows.push([...row]);
        return { data: {} };
      }
      return realValues.append(p);
    },
    batchUpdate: async (p: any) => {
      if (p.spreadsheetId === ordersId) {
        for (const d of p.requestBody.data as { range: string; values: string[][] }[]) {
          const start = parseRangeStart(d.range);
          if (!start || start.row < 2) continue; // แถว header ห้ามแตะ
          const row = ctx.orderRows[start.row - 2];
          if (!row) continue;
          while (row.length <= start.col) row.push("");
          row[start.col] = d.values?.[0]?.[0] ?? "";
        }
        return { data: {} };
      }
      return realValues.batchUpdate(p);
    },
    batchGet: async (p: any) => realValues.batchGet(p), // BotLibrary เท่านั้น — ผ่านของจริงเสมอ
  };
  return { spreadsheets: { values } };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
