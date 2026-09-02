import { NextRequest, NextResponse } from "next/server";
import { guardTrainRequest } from "@/lib/train/auth";
import { runTrainAssistant, type AssistantMessage, type AssistantTask } from "@/lib/train/assistant";
import { reviewProposal } from "@/lib/train/assistant-review";
import { buildAssistantKB, ASSISTANT_TABS } from "@/lib/train/assistant-kb";
import { tabKeyColumn } from "@/lib/train/sandbox";
import { loadRawSheets } from "@/lib/sheets/loader";
import { cleanHeader, cleanCell } from "@/lib/sheets/clean";
import { getConfig } from "@/lib/config";

export const maxDuration = 30;

/**
 * D-59 จ-1 · ผู้ช่วยเทรน — call Gemini แยก (ไม่ปน prompt ขาย) · คืน reply + proposals
 * 🔴 ไม่เขียนชีตที่นี่ — D-75: ปลายทางใบ = ฟอร์มเดิม (เพิ่มแถว D-72b / ✎ แก้ไข D-74) ที่ถูกเติมค่า
 *    เจ้าของแก้แล้วบันทึกเอง ผ่าน lint/dup/conflict/TRAIN_LOG เส้นเดิม — ห้ามมีเส้นเขียนที่สอง
 * D-75: task จากปุ่ม (add/edit) → สคริปต์สัมภาษณ์ · ทุกใบผ่านด่านตรวจ reviewProposal → warnings[]
 */
export async function POST(req: NextRequest) {
  const guard = guardTrainRequest(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { messages?: unknown; excludeKeys?: unknown; task?: unknown };
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: AssistantMessage[] = raw
    .filter((m): m is AssistantMessage => Boolean(m) && typeof m === "object" && typeof (m as AssistantMessage).text === "string")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.text.slice(0, 4000) }));
  if (messages.length === 0) return NextResponse.json({ error: "ต้องมีข้อความ" }, { status: 400 });
  const excludeKeys = Array.isArray(body.excludeKeys) ? body.excludeKeys.filter((k): k is string => typeof k === "string").slice(0, 200) : [];
  const task = sanitizeTask(body.task);

  try {
    const [kb, rawSheets, config] = await Promise.all([buildAssistantKB(), loadRawSheets(), getConfig()]);
    // โหมดแก้: ยัดค่าปัจจุบันทุกช่องของแถวเข้า task block — ผู้ช่วยเห็นของจริงก่อนเสนอ diff
    if (task?.kind === "edit" && task.key && rawSheets) task.rowContext = rowContextOf(rawSheets, task.tab, task.key);
    const result = await runTrainAssistant(messages, kb, config, { excludeKeys, task: task ?? undefined });
    // 🔴 D-75: ด่านตรวจ deterministic ทุกใบ (add-row และ edit-row) — เตือนตั้งแต่ตอนคุย ไม่รอ lint ตอนบันทึก
    const proposals = result.proposals.map((p) => ({
      ...p,
      warnings: rawSheets ? reviewProposal(rawSheets, p, config) : [],
    }));
    return NextResponse.json({ ...result, proposals });
  } catch (error) {
    console.error(JSON.stringify({ scope: "train-assistant", warning: "route failed", error: String(error).slice(0, 160) }));
    return NextResponse.json({ error: "ผู้ช่วยขัดข้อง" }, { status: 500 });
  }
}

/** task จาก client — รับเฉพาะรูปที่รู้จัก (kind add/edit · tab ในลิสต์) */
function sanitizeTask(raw: unknown): AssistantTask | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind === "add" || o.kind === "edit" ? o.kind : null;
  const tab = typeof o.tab === "string" && (ASSISTANT_TABS as readonly string[]).includes(o.tab) ? o.tab : null;
  if (!kind || !tab) return null;
  const key = typeof o.key === "string" ? o.key.slice(0, 200) : undefined;
  return { kind, tab, key };
}

/** "คอลัมน์: ค่า" ต่อบรรทัดของแถวดิบ (หา row ด้วย key column ตามชีต) — ป้อน task block โหมดแก้ */
function rowContextOf(rawSheets: NonNullable<Awaited<ReturnType<typeof loadRawSheets>>>, tab: string, key: string): string | undefined {
  const rows = (rawSheets as Record<string, string[][]>)[tab];
  const keyCol = tabKeyColumn(tab);
  if (!rows || rows.length < 2 || !keyCol) return undefined;
  const header = rows[0].map(cleanHeader);
  const keyIdx = header.indexOf(keyCol);
  if (keyIdx === -1) return undefined;
  const row = rows.find((r, i) => i > 0 && cleanCell(r[keyIdx] ?? "") === cleanCell(key));
  if (!row) return undefined;
  return header
    .map((h, i) => (h ? `${h}: ${(row[i] ?? "").slice(0, 500)}` : null))
    .filter(Boolean)
    .join("\n");
}
