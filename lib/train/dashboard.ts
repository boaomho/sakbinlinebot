/**
 * lib/train/dashboard.ts — T2-ก · helper pure สำหรับ Dashboard (ร้านจริง · อ่านอย่างเดียว)
 * ไม่มี I/O — เทสได้ตรงๆ · reuse โดย API route + client
 */

export type Channel = "line" | "fb" | "train";
export type CustomerStatus = "won" | "handoff" | "stuck" | "active" | "idle";

/** ช่องทางจาก user_id (ทะเบียน id REPO-MAP §5) */
export function channelOf(userId: string): Channel {
  if (userId.startsWith("fb:")) return "fb";
  if (userId.startsWith("TRAIN:")) return "train";
  return "line";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * สถานะลูกค้าสำหรับตาราง (เรียงความสำคัญ):
 *  won (มีออเดอร์) > handoff (human_mode) > stuck (qualified/quoted เงียบ >24ชม.) > active (คุยใน 24ชม.) > idle
 */
export function deriveStatus(input: {
  hasOrder: boolean;
  humanMode: boolean;
  funnelStage: string | null;
  lastSeen: Date;
  now: Date;
}): CustomerStatus {
  if (input.hasOrder) return "won";
  if (input.humanMode) return "handoff";
  const activeWithin24h = input.now.getTime() - input.lastSeen.getTime() < DAY_MS;
  const midFunnel = input.funnelStage === "qualified" || input.funnelStage === "quoted";
  if (midFunnel && !activeWithin24h) return "stuck"; // 🟡 กลุ่มทองสำหรับ follow
  return activeWithin24h ? "active" : "idle";
}

export const STATUS_META: Record<CustomerStatus, { icon: string; label: string }> = {
  active: { icon: "🟢", label: "กำลังคุย" },
  stuck: { icon: "🟡", label: "ค้างกลางทาง" },
  handoff: { icon: "🔴", label: "รอแอดมิน" },
  won: { icon: "✅", label: "ปิดการขาย" },
  idle: { icon: "⚪", label: "เงียบ" },
};

interface OrderItem { sku?: string; qty?: number }
interface OrderLike {
  items?: OrderItem[];
  ["ชื่อ"]?: string;
  ["ที่อยู่"]?: string;
  ["เบอร์"]?: string;
  ["การชำระเงิน"]?: string;
  total?: number | string;
}

/** format ออเดอร์ให้คนอ่าน (ไม่โชว์ JSON ดิบ · จุดที่ 3 ที่เจ้าของสั่ง) */
export function formatOrderSummary(order: OrderLike | null | undefined, nameMap: Map<string, string>): string[] {
  if (!order || typeof order !== "object") return [];
  const lines: string[] = [];
  const items = Array.isArray(order.items) ? order.items : [];
  for (const it of items) {
    const name = it.sku ? nameMap.get(it.sku) ?? it.sku : "(สินค้า)";
    lines.push(`• ${name} × ${it.qty ?? "?"}`);
  }
  if (order.total != null && order.total !== "") lines.push(`ยอดรวม: ${order.total} บาท`);
  if (order["การชำระเงิน"]) lines.push(`ชำระ: ${order["การชำระเงิน"]}`);
  if (order["ชื่อ"]) lines.push(`ชื่อ: ${order["ชื่อ"]}`);
  if (order["ที่อยู่"]) lines.push(`ที่อยู่: ${order["ที่อยู่"]}`);
  if (order["เบอร์"]) lines.push(`เบอร์: ${order["เบอร์"]}`);
  return lines;
}
