import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, lineCalls, sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { readCustomer } from "../harness/db";
import { runTrainTurn, runTrainCron, runTrainReset } from "@/lib/train/turn";
import { createSandbox, runInSandbox, trainUserId } from "@/lib/train/sandbox";
import { addDeliveredStep, loadTrainSession, saveTrainSession } from "@/lib/db";
import { ORDERS_HEADER } from "@/lib/orders";

/**
 * T-STUDIO เฟส ก — เทสบังคับ 2 ตัว (เคาะ 2026-07-23):
 * 1. Fidelity: เทิร์นเดียวกัน (scripted Gemini ชุดเดียวกัน) ผ่าน webhook จริง vs simulator
 *    → บอลลูน + state ต้องเหมือนกันทุกตัว (พิสูจน์ว่า sandbox = pipeline production 100%)
 * 2. เทสรั่ว: simulator เต็ม flow → mock LINE/ชีต/Blob ต้องเป็นศูนย์ call (ทุกอย่างอยู่ใน collector)
 */

const U_LINE = "Uharnesstraintest000000000000001";
const SESS_FID = "train-fid-00000001";
const SESS_COD = "train-cod-00000001";

const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ความรู้สึกลูกค้าตอนนี้", "ทำไมประตูนี้สำคัญ", "หลักการนำพา", "ห้ามทำ", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "คิดเอง"];
function r(step_id: string, funnel_stage: string, o: Partial<Record<string, string>> = {}): string[] {
  return STEP_H.map((h) => (h === "step_id" ? step_id : h === "funnel_stage" ? funnel_stage : o[h] ?? ""));
}
function stepSheet(): string[][] {
  return [
    STEP_H,
    r("S1", "lead", { ตัวอย่างคำตอบ: "สวัสดีจากชีตค่ะ", คิดเอง: "ปิด" }),
    r("S_TAKE", "quoted", { เข้าเมื่อ: "บอกจำนวน", ตัวอย่างคำตอบ: "รับออเดอร์แล้วค่ะ", ตัวอย่างประโยคปิดท้าย: "สะดวกโอนหรือเก็บปลายทางดีคะ", คิดเอง: "ปิด" }),
    r("S4B", "won", { เข้าเมื่อ: "ข้อมูลครบ", ตัวอย่างคำตอบ: "บันทึกออเดอร์เรียบร้อยค่ะ", ตัวอย่างประโยคปิดท้าย: "ขอบคุณค่ะ", คิดเอง: "ปิด" }),
  ];
}
const FULL_ADDRESS = { ชื่อ: "สมชาย ใจดี", ที่อยู่: "123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.ชลบุรี 20000", เบอร์: "0811122334" };

/* eslint-disable @typescript-eslint/no-explicit-any */
function stripOrderId(pending: any): any {
  if (!pending) return pending;
  const { order_id: _drop, ...rest } = pending;
  return rest;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeAll(() => {
  // dev/เทสใช้ branch test เดียวกับ harness (เคาะ: ระหว่างรอ ENV จริงใน Vercel) — userId คนละ space (TRAIN:)
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
  process.env.TRAIN_PASSWORD = "test-train-pass";
});

describe("T-STUDIO เฟส ก · fidelity — simulator ให้ผลตรง pipeline จริง", () => {
  it("🔴 เทิร์นเดียวกัน (scripted เดียวกัน): บอลลูน + stage + pending + ธง ต้องเหมือน webhook เป๊ะ", async () => {
    seedBotLib({ stepRows: stepSheet() });
    const script = () => [turn({ reply: "AI ไม่ควรถูกใช้ (verbatim)", stage: "S_TAKE", orderData: { items: [{ qty: 3 }] }, paymentMethod: "โอน" })];

    // ทาง 1: webhook จริง (POST + signature + handleEvent)
    scriptGemini(script());
    await sendText(U_LINE, "เอา 3 ถ้วย โอนค่ะ");
    const webhookBubbles = lineCalls.replies.flatMap((rr) => rr.messages);
    expect(webhookBubbles.length, "webhook ต้องส่งบอลลูน").toBeGreaterThan(0);
    const webhookCustomer = await readCustomer(U_LINE);
    const lineCallsAfterWebhook = lineCalls.replies.length + lineCalls.pushes.length;

    // ทาง 2: simulator (processMessage ตรง ใน sandbox)
    scriptGemini(script());
    const res = await runTrainTurn(SESS_FID, "เอา 3 ถ้วย โอนค่ะ");
    const simBubbles = res.bubbles.flatMap((b) => b.messages);

    expect(simBubbles, "บอลลูนตรง webhook ทุกตัว (verbatim+resolver เส้นเดียวกัน)").toEqual(webhookBubbles);
    const simCustomer = await readCustomer(trainUserId(SESS_FID));
    expect(simCustomer?.stage, "stage ตรง").toBe(webhookCustomer?.stage);
    expect(stripOrderId(simCustomer?.pending_order), "pending ตรง (ยกเว้น order_id สุ่ม)").toEqual(stripOrderId(webhookCustomer?.pending_order));
    expect(simCustomer?.delivered_steps, "ธง delivered_steps ตรง").toEqual(webhookCustomer?.delivered_steps);
    // simulator ไม่ยิง LINE เพิ่มแม้แต่ครั้งเดียว
    expect(lineCalls.replies.length + lineCalls.pushes.length, "LINE calls ไม่เพิ่มจาก simulator").toBe(lineCallsAfterWebhook);
  });
});

describe("T-STUDIO เฟส ก · เทสรั่ว — side effect จริงต้องเป็นศูนย์", () => {
  it("🔴 COD ครบเทิร์นเดียว: ออเดอร์ 'จะเขียน' อยู่ใน collector · LINE=0 · ชีตจริง=0", async () => {
    seedBotLib({ stepRows: stepSheet() });
    scriptGemini([turn({ reply: "AI", stage: "S4B", paymentMethod: "COD", orderData: { items: [{ qty: 3 }], ...FULL_ADDRESS } })]);

    const res = await runTrainTurn(SESS_COD, "เอา 3 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.ชลบุรี 20000 0811122334");

    expect(lineCalls.replies.length, "🔴 LINE reply จริง = 0").toBe(0);
    expect(lineCalls.pushes.length, "🔴 LINE push จริง = 0").toBe(0);
    expect(sheetsCalls.appends.length, "🔴 ชีต Orders จริงไม่ถูก append").toBe(0);
    expect(sheetsCalls.batchUpdates.length, "🔴 ชีต Orders จริงไม่ถูกแก้").toBe(0);

    expect(res.bubbles.length, "ลูกค้าจำลองได้บอลลูน").toBeGreaterThan(0);
    expect(res.orderRows.length, "แถว 'จะถูกเขียน' โชว์ใน X-ray").toBe(1);
    expect(res.orderRows[0]["การชำระเงิน"]).toBe("COD");
    expect(res.orderRows[0]["ยอดเงิน"], "ยอดจาก pricing จริง (3 ถ้วย = 275)").toBe("275");
    expect(JSON.stringify(res.adminPushes), "ข้อความ 'จะยิงกลุ่ม' อยู่ใน collector").toContain("ออเดอร์ใหม่");
    expect(res.xray.gate, "X-ray เห็นผล gate").toMatchObject({ complete: true });
  });

  it("blob guard: uploadSlip ใน sandbox คืน pathname จำลอง ไม่แตะ @vercel/blob (importActual ข้าม mock)", async () => {
    const blob = await vi.importActual<typeof import("@/lib/blob")>("@/lib/blob");
    const ctx = createSandbox("train-blob-0001");
    await runInSandbox(ctx, async () => {
      const up = await blob.uploadSlip("TRAIN:x", Buffer.from("fake"), "image/jpeg");
      expect(up?.pathname).toMatch(/^train\/slip-/);
      const signed = await blob.getSlipSignedUrl(up!.pathname, 3);
      expect(signed).toContain("train://signed/");
      expect(ctx.slipUploads.length).toBe(1);
    });
  });
});

describe("T-STUDIO เฟส ก · cron จำลอง — โค้ด cron จริงใน sandbox", () => {
  it("🔴 ติ๊ก M + cron: แจกเลขในชีตจำลอง · แจ้งกลุ่มเข้า collector · ล้างธง (เมื่อ R มีค่า) · ชีตจริง=0", async () => {
    seedBotLib({ stepRows: stepSheet() });
    scriptGemini([turn({ reply: "AI", stage: "S4B", paymentMethod: "COD", orderData: { items: [{ qty: 3 }], ...FULL_ADDRESS } })]);
    const sess = "train-cron-0001";
    await runTrainTurn(sess, "เอา 3 ถ้วย เก็บปลายทาง สมชาย ใจดี 123/45 หมู่ 6 ต.บางรัก อ.เมือง จ.ชลบุรี 20000 0811122334");

    // เตรียม: ธงมี step เก่าค้าง + เติม line_user_id (R) ในแถวจำลอง
    // (จำเป็นเพราะ appendOrderRow ปัจจุบันไม่เขียน R — gap ที่รายงานแยก · เทสนี้พิสูจน์เส้นทาง cron เมื่อ R มีค่า)
    const uid = trainUserId(sess);
    await runInSandbox(createSandbox(sess), async () => {
      await addDeliveredStep(uid, "S_OLD_FLAG");
      const saved = await loadTrainSession(sess);
      const rIdx = ORDERS_HEADER.indexOf("line_user_id");
      const row = saved!.orderRows[0];
      while (row.length <= rIdx) row.push("");
      row[rIdx] = uid;
      await saveTrainSession(sess, saved!);
    });

    const res = await runTrainCron(sess);

    expect(res.orderRows[0]["ลำดับ"], "cron แจกเลขแล้ว").toBeTruthy();
    expect(res.orderRows[0]["ส่งออเดอร์แล้ว"]).toBe("TRUE");
    expect(res.adminPushes.length, "ข้อความแจ้งกลุ่มเช็คยอดเข้า collector").toBeGreaterThan(0);
    expect(sheetsCalls.batchUpdates.length, "🔴 markOrderSent ไม่แตะชีตจริง").toBe(0);
    expect(sheetsCalls.appends.length).toBe(0);
    expect(lineCalls.pushes.length, "🔴 push กลุ่มจริง = 0").toBe(0);

    const c = await readCustomer(uid);
    expect(c?.delivered_steps, "ธงเก่าถูกล้าง (คงเฉพาะ step ปัจจุบัน) — D-45b hook ผ่าน cron จริง").not.toContain("S_OLD_FLAG");
  });

  it("reset: ล้างความจำ + fake grid ของ session", async () => {
    const sess = "train-reset-0001";
    seedBotLib({ stepRows: stepSheet() });
    scriptGemini([turn({ reply: "AI", stage: "S_TAKE", orderData: { items: [{ qty: 1 }] } })]);
    await runTrainTurn(sess, "เอา 1 ถ้วย");
    await runTrainReset(sess);
    const c = await readCustomer(trainUserId(sess));
    expect(c?.pending_order ?? null, "pending ล้าง").toBeNull();
    await runInSandbox(createSandbox(sess), async () => {
      expect(await loadTrainSession(sess), "grid ล้าง").toBeNull();
    });
  });
});

describe("T-STUDIO เฟส ก · auth — All-or-nothing + cookie", () => {
  it("ENV ไม่ครบ → 404 · รหัสผิด → 401 · รหัสถูก → cookie ใช้ผ่านทุก endpoint", async () => {
    const { POST: loginPOST } = await import("@/app/train/api/login/route");
    const { POST: turnPOST } = await import("@/app/train/api/turn/route");
    const mk = (body: unknown, cookie?: string) =>
      new NextRequest("https://train.invalid/train/api/x", {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });

    // All-or-nothing: ไม่มี TRAIN_PASSWORD = ปิดทั้งฟีเจอร์
    const savedPw = process.env.TRAIN_PASSWORD;
    delete process.env.TRAIN_PASSWORD;
    expect((await loginPOST(mk({ password: "x" }))).status, "ฟีเจอร์ปิด = 404").toBe(404);
    process.env.TRAIN_PASSWORD = savedPw;

    expect((await loginPOST(mk({ password: "ผิดแน่นอน" }))).status, "รหัสผิด = 401").toBe(401);

    const ok = await loginPOST(mk({ password: savedPw }));
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    const cookiePair = setCookie.split(";")[0]; // train_auth=<token>
    expect(cookiePair).toContain("train_auth=");

    expect((await turnPOST(mk({}))).status, "ไม่มี cookie = 401").toBe(401);
    expect((await turnPOST(mk({}, cookiePair))).status, "cookie ถูก → ผ่าน auth (ตกที่ validation 400)").toBe(400);
  });
});
