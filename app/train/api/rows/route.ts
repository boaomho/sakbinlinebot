import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { listTabRows } from "@/lib/train/write";

export const maxDuration = 20;

const MANAGED_TABS = ["Steps", "Knowledge", "Vars"]; // D-72a: ตรงกับชื่อแท็บในชีต

/** T2-ค · list แถวของแท็บความรู้ (read-only · fresh) — ป้อน list view + ฟอร์มเพิ่มแถว (header-driven) */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { tab?: string };
  if (!body.tab || !MANAGED_TABS.includes(body.tab)) {
    return NextResponse.json({ error: `tab ต้องเป็นหนึ่งใน: ${MANAGED_TABS.join(" / ")}` }, { status: 400 });
  }

  try {
    return NextResponse.json(await listTabRows(body.tab));
  } catch (error) {
    console.error(JSON.stringify({ scope: "train", warning: "list rows failed", tab: body.tab, error: String(error).slice(0, 160) }));
    return NextResponse.json({ error: "โหลดแถวไม่ได้" }, { status: 500 });
  }
}
