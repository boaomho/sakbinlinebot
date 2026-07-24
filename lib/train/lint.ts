import { KNOWN_RUNTIME_VARS, loadLiveVars, findBannedClaims, parseClaimsList, findBadPrices } from "@/lib/agent/quote";
import { buildAllowedPriceStrings } from "@/lib/core/pricing";
import type { AppConfig } from "@/lib/config";
import type { BotLibrary } from "@/lib/sheets/loader";

/**
 * lib/train/lint.ts — เฟส ข: lint pattern สด (reuse ฟังก์ชัน production ตรงๆ)
 * 🔴 ไม่มี logic ใหม่ — เรียกตัวเดียวกับที่ handler ใช้ตอนส่งจริง (ถ้าตรงนี้เขียว = ตอนส่งจริงเขียว)
 */

export interface LintFinding {
  /** block = 🔴 ปิดปุ่มเขียน (เฟส ค) · warn = เตือน */
  level: "block" | "warn";
  kind: "unknown-var" | "claims" | "price" | "bubbles" | "image-last";
  message: string;
  hits: string[];
}

const VAR_TOKEN = /\{[^}]+\}/g;

/** lint pattern ดิบ (ก่อน resolve) — จับตัวแปรผิด/claims/ราคานอกระบบ/บอลลูนเกิน */
export function lintPattern(
  pattern: string,
  opts: { config: AppConfig; lib: BotLibrary; payment: string; now: Date },
): LintFinding[] {
  const { config, lib, payment, now } = opts;
  const findings: LintFinding[] = [];

  // 1) ตัวแปร "ไม่รู้จัก" (typo / ยังไม่มี resolver) — จะหลุดดิบหรือโดนทิ้งบอลลูน
  const known = new Set<string>([...KNOWN_RUNTIME_VARS, ...loadLiveVars(lib.CSV_Vars).map((v) => v.name)]);
  const tokens = pattern.match(VAR_TOKEN) ?? [];
  const unknown = [...new Set(tokens.filter((t) => !known.has(t)))];
  if (unknown.length > 0) {
    findings.push({ level: "block", kind: "unknown-var", hits: unknown, message: `ตัวแปรไม่รู้จัก (พิมพ์ผิด/ไม่มี resolver) — จะหลุดดิบหรือบอลลูนถูกทิ้ง: ${unknown.join(" ")}` });
  }

  // 2) claims พ.ร.บ.อาหาร (คำจาก Config จริง)
  const banned = findBannedClaims(pattern, parseClaimsList(config.raw.get("คำต้องห้าม_โฆษณา")), parseClaimsList(config.raw.get("คำยกเว้น_โฆษณา")));
  if (banned.length > 0) {
    findings.push({ level: "block", kind: "claims", hits: banned, message: `คำโฆษณาต้องห้าม (พ.ร.บ.อาหาร): ${banned.join(", ")}` });
  }

  // 3) ราคานอกระบบ (เลข "X บาท" ที่ hardcode ในแพตเทิร์น — ไม่ใช่ตัวแปรที่ resolve จาก Core)
  const allowed = buildAllowedPriceStrings(lib.CSV_Products, lib.CSV_Promo, Object.fromEntries(config.raw), payment, now);
  const badPrices = findBadPrices(pattern, allowed);
  if (badPrices.length > 0) {
    findings.push({ level: "block", kind: "price", hits: badPrices, message: `ราคานอกระบบ (ต้องมาจาก Products/Promo/Config หรือใช้ตัวแปร): ${badPrices.join(", ")} บาท` });
  }

  // 4) บอลลูนเกิน 5 / ลงท้ายด้วยรูป (นับจากแพตเทิร์นดิบ · โค้ดจริงจะตัด/สลับให้ แต่เตือนไว้)
  const segs = pattern.split(/\[\[(?:เว้น|แยก)\]\]/).map((s) => s.trim()).filter(Boolean);
  if (segs.length > 5) {
    findings.push({ level: "warn", kind: "bubbles", hits: [], message: `แพตเทิร์นมี ${segs.length} บอลลูน — เกิน 5 โค้ดจะตัดเหลือ 5 บอลลูนแรก` });
  }
  const last = segs[segs.length - 1] ?? "";
  if (/\[\[รูป:[^\]]+\]\]\s*$/.test(last) && !/[^\]]$/.test(last.replace(/\[\[รูป:[^\]]+\]\]\s*$/, "").trim())) {
    findings.push({ level: "warn", kind: "image-last", hits: [], message: "บอลลูนสุดท้ายเป็นรูป — โค้ดจะสลับ/เติมข้อความปิดท้ายให้ (กฎเหล็ก: ห้ามจบด้วยรูป)" });
  }

  return findings;
}
