import { KNOWN_RUNTIME_VARS, loadLiveVars, findBannedClaims, parseClaimsList, findBadPrices } from "@/lib/agent/quote";
import { findAssuranceHits } from "@/lib/guards/assurance";
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
  kind: "unknown-var" | "var-collision" | "var-empty" | "claims" | "price" | "bubbles" | "image-last" | "health-h1" | "close-style";
  message: string;
  hits: string[];
}

/** D-60เกลา: ประโยคปิดแบบ "รับมั้ย/รับเลยนะคะ" — กฎเหล็กห้าม (ลูกค้ารู้สึกถูกกดดัน) · warn เตือน ไม่ block */
const BANNED_CLOSE = [/รับ(ไป)?(เลย)?(ไหม|มั้ย)/g, /รับ(ไป)?เลยนะคะ/g];

const VAR_TOKEN = /\{[^}]+\}/g;

/**
 * 🔴 H1 (พ.ร.บ.อาหาร · ความเสี่ยงอันดับ 1 · CLAUDE.md): คำที่แตะสุขภาพ/แพ้อาหาร/คนท้อง/ให้นม/เด็ก/ผู้ป่วย/ยา
 *    ใน trigger (สิ่งที่ลูกค้าพูด) หรือคำตอบ = แถวนี้เกี่ยวสุขภาพ → เข้าเกณฑ์ H1
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

/**
 * 🔴 H1 gate — D-72b เปลี่ยนเกณฑ์จาก v2 "ต้องมี handoff" → v3 **"ต้องไม่มีคำรับรอง"** (เจ้าของเคาะ ก/A)
 *    เส้นที่ไม่ขยับคือ "ห้ามคำรับรอง" ไม่ใช่ "ห้ามบอทตอบ" (CLAUDE.md H1) — v3 ให้บอทคุยเรื่องสุขภาพต่อได้
 *    ด้วยข้อเท็จจริงตามฉลาก · เกณฑ์เดิมจึง block แถวที่ถูกต้องตาม v3 (ข้อเท็จจริงล้วน ไม่มี "แอดมิน")
 * 🔴 ตัวจับคำรับรอง = `findAssuranceHits` import จาก `lib/guards/assurance.ts` **ตรง ๆ ห้ามลอกกติกามาเขียนใหม่**
 *    — แหล่งเดียวกับ guard ที่คุม output จริง (ถ้าตรงนี้เขียว = ตอนส่งจริง guard ไม่ตัด · guard เปลี่ยน lint เปลี่ยนตาม)
 * opts: exempt = ประตู Steps handoff/handoff_notify (คำตอบสุขภาพเป็นดีไซน์ที่เจ้าของคุม → ไม่ตรวจ)
 *       notify = ประตู handoff_notify → ยัง warn ถ้ามีคำรับรอง (D-58)
 *       assurancePhrases = list จาก Config `คำรับรอง_ต้องห้าม` (ตัวเดียวกับ guard) · ไม่ส่ง = default ในโค้ด
 */
export function lintHealthH1(triggerText: string, answerText: string, opts: { exempt?: boolean; notify?: boolean; assurancePhrases?: string[] } = {}): LintFinding[] {
  const out: LintFinding[] = [];
  if (!opts.exempt) {
    const hits = [...new Set(HEALTH_TERMS.filter((t) => `${triggerText} ${answerText}`.toLowerCase().includes(t)))];
    if (hits.length > 0) {
      const aHits = findAssuranceHits(answerText, opts.assurancePhrases);
      out.push(aHits.length > 0
        ? { level: "block", kind: "health-h1", hits: aHits, message: `🔴 แถวนี้เกี่ยวสุขภาพ/แพ้อาหาร (H1) และคำตอบมี "คำรับรอง" (${aHits.join(", ")}) — ห้ามทุกรูปประโยค (ลูกค้าแพ้แล้วเป็นคดี ไม่ใช่บั๊ก) · ตัดคำรับรองออก เหลือข้อเท็จจริงตามฉลาก หรือส่งต่อแอดมิน แล้วจะเขียนได้` }
        : { level: "warn", kind: "health-h1", hits, message: `⚠︎ แถวนี้เกี่ยวกับสุขภาพ/แพ้อาหาร (H1) — ใส่ได้เฉพาะข้อเท็จจริงตามฉลาก (ส่วนประกอบ/สารก่อภูมิแพ้/ไลน์ผลิต) ห้ามใส่หลักการตอบ (CLAUDE.md H1) · ไม่แน่ใจ = ให้คำตอบส่งต่อแอดมิน (คำที่พบ: ${hits.join(", ")})` });
    }
  }
  // D-58: ประตู notify — exempt จาก block (เป็นดีไซน์) แต่เตือนเหลืองถ้ามีคำรับรอง (ตัวจับเดียวกับ guard)
  if (opts.exempt && opts.notify) {
    const aHits = findAssuranceHits(answerText, opts.assurancePhrases);
    if (aHits.length > 0) {
      out.push({ level: "warn", kind: "health-h1", hits: aHits, message: `⚠︎ ประตู notify ไม่ควร "รับรอง" เรื่องสุขภาพ (${aHits.join(", ")}) — ให้ข้อมูลกลางๆ (ส่วนผสม/แนะนำปรึกษาแพทย์) + แจ้งว่าแอดมินจะช่วยดูแล` });
    }
  }
  return out;
}

/** lint pattern ดิบ (ก่อน resolve) — จับตัวแปรผิด/claims/ราคานอกระบบ/บอลลูนเกิน */
export function lintPattern(
  pattern: string,
  opts: { config: AppConfig; lib: BotLibrary; payment: string; now: Date; trigger?: string; h1Exempt?: boolean; h1Notify?: boolean; varName?: string },
): LintFinding[] {
  const { config, lib, payment, now } = opts;
  const findings: LintFinding[] = [];
  const systemVars = KNOWN_RUNTIME_VARS as readonly string[];

  // 1) ตัวแปร "ไม่รู้จัก" (typo / ยังไม่มี resolver) — จะหลุดดิบหรือโดนทิ้งบอลลูน
  const csvVars = new Map(loadLiveVars(lib.Vars).map((v) => [v.name, v.value]));
  const known = new Set<string>([...systemVars, ...csvVars.keys()]);
  const tokens = pattern.match(VAR_TOKEN) ?? [];
  const unknown = [...new Set(tokens.filter((t) => !known.has(t)))];
  if (unknown.length > 0) {
    findings.push({ level: "block", kind: "unknown-var", hits: unknown, message: `ตัวแปรไม่รู้จัก (พิมพ์ผิด/ไม่มี resolver) — จะหลุดดิบหรือบอลลูนถูกทิ้ง: ${unknown.join(" ")}` });
  }

  // 1ข) 🔴 D-67: ชื่อ Vars ชนตัวแปรระบบ — runtime ระบบชนะเสมอ (resolveCsvVars ข้าม+log) = ค่าที่เจ้าของตั้งไม่ถูกใช้เลย
  //     ตรวจทั้ง token ที่ใช้ในแพตเทิร์น และชื่อแถว Vars เองตอนแก้ (opts.varName)
  const collided = [...new Set(tokens.filter((t) => csvVars.has(t) && systemVars.includes(t)))];
  if (opts.varName && systemVars.includes(opts.varName) && !collided.includes(opts.varName)) collided.push(opts.varName);
  if (collided.length > 0) {
    findings.push({ level: "warn", kind: "var-collision", hits: collided, message: `⚠︎ ชื่อชนตัวแปรระบบ — ค่าจากชีตจะไม่ถูกใช้ (ระบบชนะเสมอ) ให้เปลี่ยนชื่อ: ${collided.join(" ")}` });
  }

  // 1ค) 🔴 D-67: แถว Vars live แต่ช่อง "ค่า" ว่าง — runtime ไม่แทนค่า (quote.ts) → ตัวแปรค้างดิบถึงลูกค้า / รูปหายเงียบ
  //     เดิม lint นับว่า "รู้จัก" แค่ชื่อมีในชีต = เขียวทั้งที่ของจริงพัง
  const emptyVal = [...new Set(tokens.filter((t) => csvVars.has(t) && !systemVars.includes(t) && (csvVars.get(t) ?? "").trim() === ""))];
  if (emptyVal.length > 0) {
    findings.push({ level: "warn", kind: "var-empty", hits: emptyVal, message: `⚠︎ ตัวแปรมีแถวในชีตแต่ช่อง "ค่า" ว่าง — จะค้างดิบถึงลูกค้า (รูป = หายเงียบ): ${emptyVal.join(" ")}` });
  }

  // 2) claims พ.ร.บ.อาหาร (คำจาก Config จริง)
  const banned = findBannedClaims(pattern, parseClaimsList(config.raw.get("คำต้องห้าม_โฆษณา")), parseClaimsList(config.raw.get("คำยกเว้น_โฆษณา")));
  if (banned.length > 0) {
    findings.push({ level: "block", kind: "claims", hits: banned, message: `คำโฆษณาต้องห้าม (พ.ร.บ.อาหาร): ${banned.join(", ")}` });
  }

  // 3) ราคานอกระบบ (เลข "X บาท" ที่ hardcode ในแพตเทิร์น — ไม่ใช่ตัวแปรที่ resolve จาก Core)
  const allowed = buildAllowedPriceStrings(lib.Products, lib.Promo, Object.fromEntries(config.raw), payment, now);
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
  // 🔴 D-72b: list คำรับรองจาก config ตัวเดียวกับ assurance guard ฝั่ง output (ชีตตั้งทับได้ · แหล่งเดียว)
  findings.push(...lintHealthH1(opts.trigger ?? "", pattern, { exempt: opts.h1Exempt, notify: opts.h1Notify, assurancePhrases: config.assuranceBannedPhrases }));

  // 6) 🔴 D-60เกลา: ประโยคปิดแบบ "รับมั้ยคะ/รับเลยนะคะ" — กฎเหล็กห้าม · ใช้ choice close แทน (warn ไม่ block)
  const closeHits: string[] = [];
  for (const re of BANNED_CLOSE) for (const m of pattern.matchAll(re)) closeHits.push(m[0]);
  if (closeHits.length > 0) {
    findings.push({ level: "warn", kind: "close-style", hits: [...new Set(closeHits)], message: `⚠︎ ประโยคปิดแบบ "รับมั้ย/รับเลยนะคะ" (${[...new Set(closeHits)].join(", ")}) — กฎเหล็กห้าม (ลูกค้ารู้สึกถูกกดดัน) · ใช้ choice close แทน เช่น "สะดวกให้จัดส่งวันไหนดีคะ" หรือ "รับตามที่เลือก หรือแพ็คที่แนะนำดีคะ"` });
  }

  return findings;
}
