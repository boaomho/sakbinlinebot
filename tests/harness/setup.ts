import { beforeAll, beforeEach, vi } from "vitest";

/**
 * Mock ขา external ทั้งหมด — vi.mock ถูก hoist ขึ้นบนสุดของไฟล์ factory จึงอ้าง
 * ตัวแปร top-level ไม่ได้ ต้อง await import("./state") ข้างในแทน
 *
 * หลักการเลือกชั้นที่ mock:
 * - LINE  → mock ที่ "SDK client" ชั้นล่างสุด ไม่ใช่ lib/line → lib/line ทำงานจริง
 *           (parseReplyIntoMessages + enforceTextLast ได้ถูกเทสของจริง)
 * - Sheets/Blob/Gemini → mock ที่ lib (ไม่มี logic ที่ต้องพิสูจน์ในก้อนนี้)
 * - orders → mock เฉพาะ appendOrderRow · sanitizePhone ฯลฯ ใช้ของจริง (route.ts พึ่งมัน)
 * - db (Neon) → ของจริงทั้งหมด (state ข้ามเทิร์นคือหัวใจของบท 1/7/9)
 */

vi.mock("@line/bot-sdk", async () => {
  const actual = await vi.importActual<typeof import("@line/bot-sdk")>("@line/bot-sdk");
  const { Readable } = await import("node:stream");
  const { lineCalls, LINE_DISPLAY_NAME } = await import("./state");

  class FakeMessagingApiClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async replyMessage(req: any) {
      lineCalls.replies.push({ to: req.replyToken, messages: req.messages });
      return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async pushMessage(req: any) {
      lineCalls.pushes.push({ to: req.to, messages: req.messages });
      return {};
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async showLoadingAnimation(req: any) {
      lineCalls.loadingIndicators.push(req.chatId);
      return {};
    }
    async getProfile(userId: string) {
      return { displayName: LINE_DISPLAY_NAME, userId };
    }
  }

  class FakeMessagingApiBlobClient {
    async getMessageContent(_messageId: string) {
      return Readable.from([Buffer.from("fake-image-bytes")]);
    }
  }

  return {
    ...actual,
    messagingApi: {
      ...actual.messagingApi,
      MessagingApiClient: FakeMessagingApiClient,
      MessagingApiBlobClient: FakeMessagingApiBlobClient,
    },
  };
});

vi.mock("@/lib/config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
  const { testConfig } = await import("./fixtures");
  const { harnessOverrides } = await import("./state");
  // resolveFeatureSwitches / formatConfigForPrompt / DEFAULT_REPLY = ของจริง
  return { ...actual, getConfig: async () => testConfig(harnessOverrides.config) };
});

// Step 1: route อ่าน Step/FAQ ผ่าน loadBotLibrary (googleapis batchGet ถูก mock) แล้ว
// ไม่ต้อง mock @/lib/sheets อีก · scenario ใช้ scripted Gemini → เนื้อ Step/FAQ ไม่กระทบผล
// (ต้องการทดสอบ Step/FAQ จริง → ป้อนผ่าน sheetsCalls.botLibReturn)

/**
 * mock ที่ชั้น googleapis (ต่ำสุด) ไม่ใช่ที่ lib/orders
 * → appendOrderRow / listPendingOrders / markOrderSent ตัวจริงทำงานเต็ม:
 *   sanitize ค่า · จัดคอลัมน์ A–P · resolveSpreadsheetId
 * 🔴 บั๊ก P0 (SHEET_ORDERS_ID เป็น CSV URL) รอดมาได้เพราะเมื่อก่อน mock lib/orders ทิ้ง
 */
vi.mock("googleapis", async () => {
  const { sheetsCalls } = await import("./state");
  class FakeJWT {
    constructor(_opts: unknown) {}
  }
  const values = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    append: async (p: any) => {
      sheetsCalls.appends.push({ range: p.range, values: p.requestBody.values });
      return { data: {} };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: async (p: any) => {
      // ขอ header (!1:1) → คืน ordersHeader · ขอแถวข้อมูล → คืน getReturn
      if (typeof p.range === "string" && p.range.includes("!1:1")) {
        return { data: { values: [sheetsCalls.ordersHeader] } };
      }
      return { data: { values: sheetsCalls.getReturn } };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batchUpdate: async (p: any) => {
      for (const d of p.requestBody.data) sheetsCalls.batchUpdates.push({ range: d.range, values: d.values });
      return { data: {} };
    },
    // batchGet: คืน valueRanges เรียงตามลำดับ ranges ที่ขอ (ตาม types จริง)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batchGet: async (p: any) => {
      sheetsCalls.lastBatchGetRanges = p.ranges;
      const valueRanges = (p.ranges as string[]).map((range) => ({
        range,
        values: sheetsCalls.botLibReturn[range.split("!")[0]] ?? [],
      }));
      return { data: { valueRanges } };
    },
  };
  return {
    google: {
      auth: { JWT: FakeJWT },
      sheets: () => ({ spreadsheets: { values } }),
    },
    sheets_v4: {},
  };
});

vi.mock("@/lib/blob", async () => {
  const actual = await vi.importActual<typeof import("@/lib/blob")>("@/lib/blob");
  const { blobState } = await import("./state");
  return {
    ...actual,
    uploadSlip: async (userId: string) => {
      blobState.seq += 1;
      const pathname = `slips/harness/${userId}_${String(blobState.seq).padStart(3, "0")}.jpg`;
      blobState.uploaded.push(pathname);
      return { pathname, url: `https://blob.invalid/${pathname}` };
    },
    getSlipSignedUrl: async (pathname: string) => `https://blob.invalid/signed/${pathname}`,
  };
});

vi.mock("@/lib/gemini", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gemini")>("@/lib/gemini");
  const { geminiState, turn } = await import("./state");
  return {
    ...actual,
    runSalesTurn: async (input: Parameters<typeof actual.runSalesTurn>[0]) => {
      // ยิง Gemini จริงเฉพาะตอนรันมือ: HARNESS_REAL_GEMINI=1 npm test
      if (process.env.HARNESS_REAL_GEMINI === "1") return actual.runSalesTurn(input);
      const scripted = geminiState.script[geminiState.cursor];
      if (!scripted) {
        geminiState.overflowCalls += 1;
        return turn({ reply: "(script หมด)" });
      }
      geminiState.cursor += 1;
      return scripted;
    },
  };
});

beforeAll(async () => {
  const { initHarnessDb } = await import("./db");
  await initHarnessDb();
});

beforeEach(async () => {
  const { resetState, sheetsCalls } = await import("./state");
  const { resetDb } = await import("./db");
  const { __resetBotLibraryCache } = await import("@/lib/sheets/loader");
  const { ORDERS_HEADER, __resetOrdersColumnsCache } = await import("@/lib/orders");
  resetState();
  __resetBotLibraryCache(); // กัน bundle ค้างข้ามเทส
  __resetOrdersColumnsCache(); // กัน header cache ค้างข้ามเทส
  sheetsCalls.ordersHeader = [...ORDERS_HEADER]; // default = layout ปกติ (เทสสลับคอลัมน์ override เอง)
  await resetDb();
});
