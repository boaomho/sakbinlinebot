import { CustomerBrief } from "./db";

export const PENDING_CHOICES_TTL_MS = 60_000; // รายการตัวเลือกมีอายุ 1 นาที

export type AdminCommandKind = "close" | "open" | "close_all" | "open_all" | "list" | "none";

export interface ParsedAdminCommand {
  kind: AdminCommandKind;
  /** ส่วนที่เหลือหลังคำสั่ง (ชื่อ/เลข/userId) — เฉพาะ close/open */
  arg: string;
  /** คำกริยาที่แอดมินพิมพ์จริง เพื่อสะท้อนกลับในรายการเลือก ("ปิดบอท"/"เปิดบอท") */
  verb: string;
}

/** คำสั่ง + คำสำรอง (กันพิมพ์ติดมือ) — ตรวจตัวที่เจาะจงกว่าก่อน (ทั้งหมด/ล่าสุด) */
const COMMAND_RULES: Array<{ kind: AdminCommandKind; prefixes: string[]; verb: string }> = [
  { kind: "close_all", prefixes: ["ปิดบอททั้งหมด", "หยุดบอททั้งหมด"], verb: "ปิดบอท" },
  { kind: "open_all", prefixes: ["เปิดบอททั้งหมด", "คืนบอททั้งหมด"], verb: "เปิดบอท" },
  { kind: "list", prefixes: ["รายชื่อล่าสุด", "รายชื่อ"], verb: "" },
  { kind: "close", prefixes: ["ปิดบอท", "หยุดบอท"], verb: "ปิดบอท" },
  { kind: "open", prefixes: ["เปิดบอท", "คืนบอท"], verb: "เปิดบอท" },
];

export function parseAdminCommand(raw: string): ParsedAdminCommand {
  const text = raw.trim();
  for (const rule of COMMAND_RULES) {
    for (const prefix of rule.prefixes) {
      if (text === prefix || text.startsWith(prefix)) {
        return { kind: rule.kind, arg: text.slice(prefix.length).trim(), verb: rule.verb };
      }
    }
  }
  return { kind: "none", arg: "", verb: "" };
}

/** normalize ชื่อสำหรับเทียบ: lowercase, ตัด emoji/อักขระพิเศษ, ยุบช่องว่าง */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "") // เก็บเฉพาะตัวอักษร/ตัวเลข/ช่องว่าง (ตัด emoji + สัญลักษณ์)
    .replace(/\s+/g, " ")
    .trim();
}

export function isUserId(s: string): boolean {
  return /^U[0-9a-f]{32}$/i.test(s.trim());
}

export function isChoiceNumber(s: string): boolean {
  return /^\d+$/.test(s.trim());
}

/**
 * ค้นหาแบบยืดหยุ่น: (1) ตรงเป๊ะหลัง normalize (ครอบ trim/ตัวพิมพ์/emoji) → ถ้าเจอคืนเลย
 * (2) ถ้าไม่เจอ ใช้ partial match (ชื่อมีคำค้นอยู่ข้างใน) · candidates เรียงคุยล่าสุดมาก่อนแล้ว
 */
export function matchCustomersByName(candidates: CustomerBrief[], query: string): CustomerBrief[] {
  const q = normalizeName(query);
  if (!q) return [];
  const exact = candidates.filter((c) => c.displayName && normalizeName(c.displayName) === q);
  if (exact.length > 0) return exact;
  return candidates.filter((c) => c.displayName && normalizeName(c.displayName).includes(q));
}

export function formatThaiRelative(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "เมื่อสักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  const day = Math.floor(hr / 24);
  return `${day} วันที่แล้ว`;
}
