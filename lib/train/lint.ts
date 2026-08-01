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
  kind: "unknown-var" | "claims" | "price" | "bubbles" | "image-last" | "health-h1" | "close-style";
  message: string;
  hits: string[];
}

/** D-60เกลา: ประโยคปิดแบบ "รับมั้ย/รับเลยนะคะ" — กฎเหล็กห้าม (ลูกค้ารู้สึกถูกกดดัน) · warn เตือน ไม่ block */
const BANNED_CLOSE = [/รับ(ไป)?(เลย)?(ไหม|มั้ย)/g, /รับ(ไป)?เลยนะคะ/g];

const VAR_TOKEN = /\{[^}]+\}/g;

/**
 * 🔴 H1 (พ.ร.บ.อาหาร · ความเสี่ยงอันดับ 1 · CLAUDE.md): คำที่แตะสุขภาพ/แพ้อาหาร/คนท้อง/ให้นม/เด็ก/ผู้ป่วย/ยา
 *    ในเนื้อ "คำตอบที่บอทจะพูด" = ห้ามให้บอทตอบเอง · ยกเว้นถ้าคำตอบเป็นการส่งต่อแอดมิน (เคสถูก: FAQ แพ้อาหาร→handoff)
 */
const HEALTH_TERMS = [
  "แพ้อาหาร", "แพ้ยา", "ภูมิแพ้", "แพ้",
  "คนท้อง", "ตั้งครรภ์", "ครรภ์", "ท้อง",
  "ให้นมบุตร", "ให้นม", "น้ำนม",
  "ทารก", "เด็กทารก", "เด็กเล็ก",
  "โรคประจำตัว", "ผู้ป่วย", "เบาหวาน", "ความดัน", "โรคไต", "มะเร็ง", "ป่วย",
  "กินคู่ยา", "คู่ยา", "กินยา", "ทานยา", "ยารักษา",
  "allergy", "allergic", "pregnan", "breastfeed", "diabet",
];
/** คำที่บ่งว่าคำตอบ "ส่งต่อคน" (ไม่ใช่บอทตอบสุขภาพเอง) — เจอคู่กับคำสุขภาพ → เตือนเหลือง ไม่ block */
const HANDOFF_TERMS = ["ส่งต่อ", "แอดมิน", "ทีมงาน", "เจ้าหน้าที่", "ผู้เชี่ยวชาญ", "ติดต่อกลับ", "admin"];
/** D-58: วลี "รับรอง" สุขภาพ — ห้ามใช้แม้ในประตู notify (ให้ข้อมูลกลางๆ + ส่งต่อ ไม่ใช่รับประกันว่าปลอดภัย) */
const H1_ASSURANCE_TERMS = ["ทานได้", "กินได้", "ปลอดภัย", "ไม่เป็นไร", "ไม่อันตราย", "หายห่วง"];

/**
 * 🔴 H1 gate: ถ้า "แถวนี้เกี่ยวสุขภาพ/แพ้อาหาร" (คำสุขภาพอยู่ใน trigger=คำถาม/สิ่งที่ลูกค้าพูด หรือในคำตอบ)
 *    → คำตอบ "ต้องเป็นการส่งต่อแอดมิน" · ไม่งั้น block (เคส "แพ้กุ้งทานได้ไหม" → "ทานได้ค่ะ" = คดี)
 *    trigger สำคัญ: คำตอบอาจดูไม่มีคำสุขภาพ ("ทานได้ค่ะ") แต่ถ้า "คำถาม" เกี่ยวแพ้ = อันตราย
 * opts (D-58): exempt = ประตู CSV_Step funnel=handoff/handoff_notify (คำตอบสุขภาพเป็นดีไซน์ที่เจ้าของคุม → ไม่ block)
 *              notify = ประตู handoff_notify → เพิ่ม warn เหลืองถ้าใช้วลี "รับรอง" สุขภาพ (ควรให้ข้อมูลกลางๆ)
 */
export function lintHealthH1(triggerText: string, answerText: string, opts: { exempt?: boolean; notify?: boolean } = {}): LintFinding[] {
  const out: LintFinding[] = [];
  const answerLower = answerText.toLowerCase();
  if (!opts.exempt) {
    const hits = [...new Set(HEALTH_TERMS.filter((t) => `${triggerText} ${answerText}`.toLowerCase().includes(t)))];
    if (hits.length > 0) {
      const answerIsHandoff = HANDOFF_TERMS.some((t) => answerLower.includes(t));
      out.push(answerIsHandoff
        ? { level: "warn", kind: "health-h1", hits, message: `⚠︎ แถวนี้เกี่ยวสุขภาพ/แพ้อาหาร (H1) — คำตอบเป็นการส่งต่อแอดมิน อนุญาตได้ แต่ตรวจให้แน่ใจว่าบอทไม่ได้ให้คำแนะนำสุขภาพเอง (คำที่พบ: ${hits.join(", ")})` }
        : { level: "block", kind: "health-h1", hits, message: `🔴 แถวนี้เกี่ยวสุขภาพ/แพ้อาหาร (H1) — บอทห้ามตอบเอง เสี่ยง พ.ร.บ.อาหาร/คดี · คำตอบ "ต้องเป็นการส่งต่อแอดมิน" (เช่น "ขอส่งต่อให้แอดมินดูแลเรื่องนี้ให้นะคะ") แล้วจะเขียนได้ (คำที่พบ: ${hits.join(", ")})` });
    }
  }
  // D-58: ประตู notify — ไม่ block คำสุขภาพ (เป็นดีไซน์) แต่เตือนเหลืองถ้า "รับรอง" ว่าปลอดภัย/ทานได้
  if (opts.notify) {
    const aHits = [...new Set(H1_ASSURANCE_TERMS.filter((t) => answerLower.includes(t)))];
    if (aHits.length > 0) {
      out.push({ level: "warn", kind: "health-h1", hits: aHits, message: `⚠︎ ประตู notify ไม่ควร "รับรอง" เรื่องสุขภาพ (${aHits.join(", ")}) — ให้ข้อมูลกลางๆ (ส่วนผสม/แนะนำปรึกษาแพทย์) + แจ้งว่าแอดมินจะช่วยดูแล` });
    }
  }
  return out;
}

/** lint pattern ดิบ (ก่อน resolve) — จับตัวแปรผิด/claims/ราคานอกระบบ/บอลลูนเกิน */
export function lintPattern(
  pattern: string,
  opts: { config: AppConfig; lib: BotLibrary; payment: string; now: Date; trigger?: string; h1Exempt?: boolean; h1Notify?: boolean },
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

  // 5) 🔴 H1 สุขภาพ/แพ้อาหาร (พ.ร.บ.อาหาร) — trigger-aware · gate: คำตอบต้องเป็น handoff (ยกเว้นประตู handoff/notify · D-58)
  findings.push(...lintHealthH1(opts.trigger ?? "", pattern, { exempt: opts.h1Exempt, notify: opts.h1Notify }));

  // 6) 🔴 D-60เกลา: ประโยคปิดแบบ "รับมั้ยคะ/รับเลยนะคะ" — กฎเหล็กห้าม · ใช้ choice close แทน (warn ไม่ block)
  const closeHits: string[] = [];
  for (const re of BANNED_CLOSE) for (const m of pattern.matchAll(re)) closeHits.push(m[0]);
  if (closeHits.length > 0) {
    findings.push({ level: "warn", kind: "close-style", hits: [...new Set(closeHits)], message: `⚠︎ ประโยคปิดแบบ "รับมั้ย/รับเลยนะคะ" (${[...new Set(closeHits)].join(", ")}) — กฎเหล็กห้าม (ลูกค้ารู้สึกถูกกดดัน) · ใช้ choice close แทน เช่น "สะดวกให้จัดส่งวันไหนดีคะ" หรือ "รับตามที่เลือก หรือแพ็คที่แนะนำดีคะ"` });
  }

  return findings;
}
