import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { diffCell, writeCell, appendRow, setRowStatus } from "@/lib/train/write";

export const maxDuration = 20;

export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    mode?: "diff" | "commit" | "add-row" | "status";
    tab?: string;
    key?: string;
    column?: string;
    newValue?: string;
    expectedOld?: string;
    cols?: Record<string, string>; // add-row
    toStatus?: "live" | "draft"; // status
    origin?: "ui" | "ai"; // D-59: ที่มา → TRAIN_LOG ai-draft/ai-edit
  };
  const { tab } = body;
  if (!tab) return NextResponse.json({ error: "ต้องมี tab" }, { status: 400 });
  const origin = body.origin === "ai" ? "ai" : "ui";

  try {
    // T2-ค: เพิ่มแถวใหม่ (บังคับ draft) — status codes สื่อความหมายให้ UI แสดงข้อความถูก
    if (body.mode === "add-row") {
      if (!body.cols || typeof body.cols !== "object") return NextResponse.json({ error: "ต้องมี cols" }, { status: 400 });
      const result = await appendRow(tab, body.cols, origin);
      const httpStatus = result.status === "ok" ? 200 : result.status === "lint" ? 422 : result.status === "not_found" ? 404 : 400;
      return NextResponse.json(result, { status: httpStatus });
    }
    // T2-ค: สลับสถานะ live↔draft (soft delete)
    if (body.mode === "status") {
      if (!body.key || (body.toStatus !== "live" && body.toStatus !== "draft")) return NextResponse.json({ error: "ต้องมี key + toStatus (live|draft)" }, { status: 400 });
      const result = await setRowStatus(tab, body.key, body.toStatus);
      const httpStatus = result.status === "ok" ? 200 : result.status === "conflict" ? 409 : 404;
      return NextResponse.json(result, { status: httpStatus });
    }

    const { key, column } = body;
    if (!key || !column) return NextResponse.json({ error: "ต้องมี tab + key + column" }, { status: 400 });
    if (body.mode === "diff") {
      return NextResponse.json(await diffCell(tab, key, column));
    }
    if (body.mode === "commit") {
      const result = await writeCell(tab, key, column, body.newValue ?? "", body.expectedOld ?? "", origin);
      const httpStatus = result.status === "ok" ? 200 : result.status === "conflict" ? 409 : result.status === "lint" ? 422 : 404;
      return NextResponse.json(result, { status: httpStatus });
    }
    return NextResponse.json({ error: "mode ต้องเป็น diff / commit / add-row / status" }, { status: 400 });
  } catch (error) {
    // assertEditable / hard guard Orders → 403
    console.error(JSON.stringify({ scope: "train", warning: "write refused/failed", tab, error: String(error).slice(0, 160) }));
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 403 });
  }
}
