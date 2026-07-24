import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { diffCell, writeCell } from "@/lib/train/write";

export const maxDuration = 20;

export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    mode?: "diff" | "commit";
    tab?: string;
    key?: string;
    column?: string;
    newValue?: string;
    expectedOld?: string;
  };
  const { tab, key, column } = body;
  if (!tab || !key || !column) return NextResponse.json({ error: "ต้องมี tab + key + column" }, { status: 400 });

  try {
    if (body.mode === "diff") {
      return NextResponse.json(await diffCell(tab, key, column));
    }
    if (body.mode === "commit") {
      const result = await writeCell(tab, key, column, body.newValue ?? "", body.expectedOld ?? "");
      const httpStatus = result.status === "ok" ? 200 : result.status === "conflict" ? 409 : result.status === "lint" ? 422 : 404;
      return NextResponse.json(result, { status: httpStatus });
    }
    return NextResponse.json({ error: "mode ต้องเป็น diff หรือ commit" }, { status: 400 });
  } catch (error) {
    // assertEditable / hard guard Orders → 403
    console.error(JSON.stringify({ scope: "train", warning: "write refused/failed", tab, error: String(error).slice(0, 160) }));
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 403 });
  }
}
