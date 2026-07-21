import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/diag/steps/route";
import { sheetsCalls } from "../harness/state";
import { __resetBotLibraryCache } from "@/lib/sheets/loader";

/**
 * Step 6 · diag endpoint /api/diag/steps — เช็ค typo funnel_stage instant · read-only · auth CRON_SECRET
 */
const STEP_HEADER = ["step_id", "funnel_stage", "ชื่อประตู", "กรณี", "เข้าเมื่อ", "ความรู้สึกลูกค้าตอนนี้", "ทำไมประตูนี้สำคัญ", "หลักการนำพา", "ห้ามทำ", "ต้องเก็บข้อมูล", "ตัวอย่างคำตอบ (บอลลูน)", "ตัวอย่างประโยคปิดท้าย", "ติดแท็ก", "ไปประตูถัดไปเมื่อ", "funnel_label", "สถานะ"];
const pad = (id: string, funnel: string) => STEP_HEADER.map((h) => (h === "step_id" ? id : h === "funnel_stage" ? funnel : ""));

function seedSteps(rows: string[][]): void {
  sheetsCalls.botLibReturn = { CSV_Step: rows } as Record<string, string[][]>;
}
function req(auth?: string): NextRequest {
  return new NextRequest("http://x/api/diag/steps", { headers: auth ? { authorization: auth } : {} });
}

beforeEach(() => {
  __resetBotLibraryCache();
  process.env.CRON_SECRET = process.env.CRON_SECRET || "harness-cron-secret";
});

describe("GET /api/diag/steps (Step 6)", () => {
  it("🔴 ไม่มี auth → 401 (กันคนนอก)", async () => {
    seedSteps([STEP_HEADER, pad("S1", "lead")]);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("auth ถูก + มี typo → คืนแถวผิด (value/stepId/severity/allowed)", async () => {
    seedSteps([STEP_HEADER, pad("S1", "lead"), pad("H5", "handof"), pad("X9", "quotedd")]);
    const res = await GET(req(`Bearer ${process.env.CRON_SECRET}`));
    const body = await res.json();
    expect(body.status).toBe("invalid");
    expect(body.badCount).toBe(2);
    expect(body.bad.map((b: { stepId: string }) => b.stepId).sort()).toEqual(["H5", "X9"]);
    expect(body.bad.find((b: { stepId: string }) => b.stepId === "H5").severity).toBe("high");
    expect(body.allowed).toContain("handoff_after_intake");
  });

  it("stage ถูกทุกตัว → ok", async () => {
    seedSteps([STEP_HEADER, pad("S1", "lead"), pad("H1", "handoff")]);
    const res = await GET(req(`Bearer ${process.env.CRON_SECRET}`));
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.badCount).toBe(0);
  });
});
