import { loadBotLibrary, BotLibrary } from "@/lib/sheets/loader";
import { getConfig } from "@/lib/config";
import { cleanHeader, cleanCell } from "@/lib/sheets/clean";
import { tabKeyColumn } from "./sandbox";
import { statusColumnIndex, isActiveStatus } from "@/lib/agent/inject";

/**
 * lib/train/assistant-kb.ts — D-59 จ-1: ฐานความรู้สด ป้อน system prompt ของผู้ช่วยเทรน (read-only)
 * header จริงทุกแท็บ + key/keywords ที่มีอยู่ (กันซ้ำ/ชน) + claims blocklist + ข้อมูลสินค้า
 */

export const ASSISTANT_TABS = ["CSV_FAQ", "CSV_Objections", "CSV_Step", "CSV_Vars"] as const;

/** คอลัมน์ "คีย์เวิร์ด/สิ่งที่ลูกค้าพูด" ต่อแท็บ — โชว์ให้ AI กันชน substring */
const KW_COL: Record<string, string> = { CSV_FAQ: "keywords", CSV_Objections: "ลูกค้าพูดแบบไหนบ้าง" };

function tabSummary(tab: string, rows: string[][]): string {
  if (rows.length < 1) return `${tab}: (โหลดไม่ได้)`;
  const header = rows[0].map(cleanHeader);
  const keyCol = tabKeyColumn(tab);
  const keyIdx = keyCol ? header.indexOf(keyCol) : -1;
  const statusIdx = statusColumnIndex(header);
  const kwIdx = KW_COL[tab] ? header.indexOf(cleanHeader(KW_COL[tab])) : -1;
  const funnelIdx = header.indexOf("funnel_stage");
  const lines: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const key = keyIdx >= 0 ? cleanCell(rows[i][keyIdx] ?? "") : "";
    if (!key) continue;
    const draft = statusIdx >= 0 && !isActiveStatus(rows[i][statusIdx]) ? " (draft)" : "";
    const kw = kwIdx >= 0 && rows[i][kwIdx] ? ` [kw: ${cleanCell(rows[i][kwIdx])}]` : "";
    const funnel = funnelIdx >= 0 && rows[i][funnelIdx] ? ` [funnel: ${cleanCell(rows[i][funnelIdx])}]` : "";
    lines.push(`- ${key}${funnel}${kw}${draft}`);
  }
  const statusName = statusIdx >= 0 ? header[statusIdx] : "(ไม่มี!)";
  return `### ${tab}\nคอลัมน์: ${header.filter(Boolean).join(" | ")}\nคอลัมน์สถานะ: ${statusName} · key column: ${keyCol ?? "?"}\nแถวที่มีอยู่ (ห้ามเสนอ key ซ้ำ):\n${lines.join("\n") || "(ยังไม่มีแถว)"}`;
}

function productFacts(lib: BotLibrary): string {
  const rows = lib.CSV_Products ?? [];
  if (rows.length < 2) return "(ไม่มีข้อมูลสินค้า)";
  const h = rows[0].map(cleanHeader);
  const idx = (name: string) => h.indexOf(name);
  const out: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const sku = cleanCell(rows[i][idx("sku")] ?? "");
    if (!sku) continue;
    const g = (n: string) => cleanCell(rows[i][idx(n)] ?? "");
    out.push(`- ${sku}: ${g("ชื่อสินค้า")} · ${g("ราคาปกติ_ต่อหน่วย")} บาท/${g("หน่วย")} · ส่วนประกอบ: ${g("ส่วนประกอบตามฉลาก")} · สารก่อภูมิแพ้: ${g("สารก่อภูมิแพ้")} · อย.: ${g("เลข อย.")} · วิธีทาน: ${g("วิธีรับประทาน")} · เก็บ: ${g("วิธีเก็บรักษา")} ${g("อายุการเก็บ")} · สถานะ: ${g("สถานะ")}`);
  }
  return out.join("\n") || "(ไม่มีข้อมูลสินค้า)";
}

function varsFacts(lib: BotLibrary): string {
  const rows = lib.CSV_Vars ?? [];
  if (rows.length < 2) return "(ไม่มีตัวแปร)";
  const h = rows[0].map(cleanHeader);
  const nIdx = h.indexOf("ตัวแปร");
  const vIdx = h.indexOf("ค่า");
  const sIdx = statusColumnIndex(h);
  const out: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const name = nIdx >= 0 ? cleanCell(rows[i][nIdx] ?? "") : "";
    if (!name || !name.startsWith("{")) continue;
    if (sIdx >= 0 && !isActiveStatus(rows[i][sIdx])) continue; // live เท่านั้น
    out.push(`- ${name} = ${vIdx >= 0 ? cleanCell(rows[i][vIdx] ?? "") : ""}`);
  }
  return out.join("\n") || "(ไม่มีตัวแปร live)";
}

/** สร้างฐานความรู้สดทั้งก้อน (read-only) — โหลดใหม่ทุกเทิร์น (loader cache 60วิ · fresh หลังเขียน) */
export async function buildAssistantKB(): Promise<string> {
  const [lib, config] = await Promise.all([loadBotLibrary(), getConfig()]);
  const parts: string[] = [];

  parts.push(
    "=== วิธีใช้ระบบ ===\n" +
      "คลังความรู้ = 4 แท็บ · ทุกแถวมีคอลัมน์สถานะ (status/สถานะ): live=ลูกค้าเห็น · draft=ซ่อน (ทดสอบในห้องซ้อมได้)\n" +
      "วงจรบังคับ: เพิ่ม/แก้เป็น draft → เจ้าของทดสอบในห้องซ้อม → พอใจค่อยกดเผยแพร่ (live)",
  );

  if (lib) {
    parts.push("=== โครงสร้าง 4 แท็บ (header จริง + key/keywords ที่มีอยู่) ===");
    for (const tab of ASSISTANT_TABS) parts.push(tabSummary(tab, (lib as Record<string, string[][]>)[tab] ?? []));
    parts.push("=== ข้อมูลสินค้า (read-only · ใช้อ้างอิงข้อเท็จจริง ห้ามแต่ง) ===\n" + productFacts(lib));
    parts.push("=== ตัวแปรข้อความ live (ใช้ {ชื่อ} ในคำตอบได้) ===\n" + varsFacts(lib));
  }

  const banned = config.raw.get("คำต้องห้าม_โฆษณา");
  parts.push("=== คำโฆษณาต้องห้าม (พ.ร.บ.อาหาร · ห้ามใช้ในคำตอบ) ===\n" + (banned || "(ไม่ได้ตั้งใน Config — ยังต้องเลี่ยง รักษา/หายขาด/ลดน้ำหนัก ฯลฯ)"));

  return parts.join("\n\n");
}
