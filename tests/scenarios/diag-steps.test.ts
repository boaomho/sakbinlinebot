import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/diag/steps/route";
import { sheetsCalls } from "../harness/state";
import { __resetBotLibraryCache } from "@/lib/sheets/loader";
import { TAB, v3StepRows } from "../harness/botlib-fixture";

/**
 * Step 6 · diag endpoint /api/diag/steps — เช็ค typo funnel_stage instant · read-only · auth CRON_SECRET
 */
/** 🔴 D-68: seed "ชีตดิบ v3" ผ่านเส้นทางเดียวกับ prod (loader → adapter) — typo funnel ใส่ผ่านคอลัมน์ funnel_stage */
const pad = (id: string, funnel: string) => ({ step_id: id, funnel, entry: "x" });

function seedSteps(steps: { step_id: string; funnel: string }[]): void {
  sheetsCalls.botLibReturn = { [TAB.steps]: v3StepRows(steps) } as Record<string, string[][]>;
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
    seedSteps([pad("S1", "lead")]);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("auth ถูก + มี typo → คืนแถวผิด (value/stepId/severity/allowed)", async () => {
    seedSteps([pad("S1", "lead"), pad("H5", "handof"), pad("X9", "quotedd")]);
    const res = await GET(req(`Bearer ${process.env.CRON_SECRET}`));
    const body = await res.json();
    expect(body.status).toBe("invalid");
    expect(body.badCount).toBe(2);
    expect(body.bad.map((b: { stepId: string }) => b.stepId).sort()).toEqual(["H5", "X9"]);
    expect(body.bad.find((b: { stepId: string }) => b.stepId === "H5").severity).toBe("high");
    expect(body.allowed).toContain("handoff_after_intake");
  });

  it("stage ถูกทุกตัว → ok", async () => {
    seedSteps([pad("S1", "lead"), pad("H1", "handoff")]);
    const res = await GET(req(`Bearer ${process.env.CRON_SECRET}`));
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.badCount).toBe(0);
  });
});
