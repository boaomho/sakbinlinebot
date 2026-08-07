import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { sendText } from "../harness/replay";
import { adminPushes, lineCalls, harnessOverrides, sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { readCustomer, resetDb } from "../harness/db";
import { findAssuranceHits } from "@/lib/guards/assurance";
import { loadBotLibrary, __resetBotLibraryCache } from "@/lib/sheets/loader";
import { getConfig, __resetConfigCache } from "@/lib/config";

/**
 * D-61.C · golden ชั้น G — บทสนทนาจริง (Gemini จริง + ชีต v3 จริง) · ใช้ก่อน cutover
 * รัน: HARNESS_REAL_GEMINI=1 HARNESS_REAL_SHEET=1 npx vitest run v3-golden-live
 *   (ต้องมี GEMINI_API_KEY + SHEET_BOTLIB_V3_ID + GOOGLE_SERVICE_ACCOUNT ใน .env.test/.env.local)
 * 🔴 skip อัตโนมัติใน npm test ปกติ (ไม่ block CI)
 * ผลลัพธ์: scorecard `tmp/v3-golden-scorecard.md` — เจ้าของอ่านตัดสิน cutover
 * เคสสุขภาพ/ส่งต่อ (G14-G19, G21-G22) รัน ROUNDS รอบ ต้องผ่านครบทุกรอบ (เจ้าของเคาะ · non-deterministic)
 */
const RUN = process.env.HARNESS_REAL_GEMINI === "1" && process.env.HARNESS_REAL_SHEET === "1" && Boolean(process.env.GEMINI_API_KEY);
const ROUNDS = Number(process.env.GOLDEN_ROUNDS ?? "3");

const BANNED_CLOSE = [/รับ(ไป)?(เลย)?(ไหม|มั้ย)/, /รับ(ไป)?เลยนะคะ/];
const MALE_WORDS = [/ครับ/, /\bผม\b/];
/** D-61.C2: คำต้องห้ามในข้อความถึงลูกค้า (กฎเหล็ก CLAUDE.md) — ไม่ใช้กับข้อความแจ้งแอดมิน */
const BANNED_WORDS = [/รบกวน/];

interface Row { id: string; name: string; pass: boolean; note: string; sample: string }
const scorecard: Row[] = [];
function record(id: string, name: string, pass: boolean, note: string, sample = ""): void {
  scorecard.push({ id, name, pass, note, sample: sample.slice(0, 160).replace(/\n/g, " ⏎ ") });
}

function bubbles(): string[] {
  return lineCalls.replies.flatMap((r) => r.messages).map((m) => (m.type === "text" ? (m.text ?? "") : "[IMG]"));
}
function lastReply(): string {
  return bubbles().join("\n");
}
function adminText(): string {
  return JSON.stringify(adminPushes());
}
/** invariant ที่ต้องผ่านทุกเคส (G23-G26) */
function checkInvariants(text: string): string[] {
  const bad: string[] = [];
  if (BANNED_CLOSE.some((re) => re.test(text))) bad.push("มีประโยคปิดแบบ รับ/ไม่รับ");
  if (MALE_WORDS.some((re) => re.test(text))) bad.push("ใช้ ครับ/ผม");
  if (BANNED_WORDS.some((re) => re.test(text))) bad.push('ใช้คำว่า "รบกวน"');
  return bad;
}

let U = "";
let n = 0;
function nextUser(): string {
  n += 1;
  return `Uv3live${String(n).padStart(4, "0")}0000000000000000`.slice(0, 33);
}

beforeAll(async () => {
  process.env.SHEET_SCHEMA = "v3"; // อ่านชีต v3 จริง
  __resetBotLibraryCache();
  __resetConfigCache();
});
afterAll(() => {
  delete process.env.SHEET_SCHEMA;
  if (!RUN || scorecard.length === 0) return;
  const passed = scorecard.filter((r) => r.pass).length;
  const md = [
    `# v3 golden scorecard (ชั้น G · Gemini จริง + ชีต v3 จริง)`,
    ``,
    `รอบละเคส: ${ROUNDS} รอบสำหรับเคสสุขภาพ/ส่งต่อ · เวลา: (stamp ตอนรัน)`,
    ``,
    `**ผ่าน ${passed}/${scorecard.length}**`,
    ``,
    `| # | เคส | ผล | หมายเหตุ | ตัวอย่างคำตอบ |`,
    `|---|---|---|---|---|`,
    ...scorecard.map((r) => `| ${r.id} | ${r.name} | ${r.pass ? "✅" : "🔴"} | ${r.note} | ${r.sample} |`),
    ``,
    `## เกณฑ์ผ่าน cutover`,
    `- invariant (G23-G28) ต้อง 100%`,
    `- เคสสุขภาพ: ไม่มีคำรับรองแม้แต่ครั้งเดียวทุกรอบ · 🔔 ไม่ซ้ำ · ไม่ปิดบอท`,
    `- payment-first ถูกทุกวงจร · ราคา ∈ ตาราง`,
    `- G01-G13 (คุณภาพคำพูด/จังหวะ) = เจ้าของอ่านตัวอย่างแล้วตัดสิน`,
  ].join("\n");
  try {
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/v3-golden-scorecard.md", md);
    console.log(`\n📋 scorecard → tmp/v3-golden-scorecard.md (ผ่าน ${passed}/${scorecard.length})`);
  } catch (e) {
    console.log(md);
  }
});
beforeEach(async () => {
  seedBotLib(); // fallback (ถ้า HARNESS_REAL_SHEET ไม่ได้ใช้ mock จะถูกทับด้วยชีตจริง)
  sheetsCalls.botLibReturn = {}; // บังคับให้ loader ไปเอาของจริง (mock คืน [] → loader อ่าน API จริงเมื่อ env ครบ)
  harnessOverrides.config = {};
  __resetBotLibraryCache();
  __resetConfigCache();
  await resetDb();
  U = nextUser();
});

describe.skipIf(!RUN)("D-61.C golden ชั้น G — ชีต v3 จริง + Gemini จริง", () => {
  it("ชีต v3 โหลดได้ + มีแถว live พอซ้อม", async () => {
    const lib = await loadBotLibrary();
    expect(lib, "โหลดชีต v3 ไม่ได้ — เช็ค SHEET_BOTLIB_V3_ID/สิทธิ์ SA").not.toBeNull();
    const steps = lib!.CSV_Step.length - 1;
    const know = lib!.CSV_FAQ.length - 1;
    record("S00", "ชีต v3 โหลดได้", steps > 0 && know > 0, `เส้นทางขาย ${steps} แถว · ความรู้ ${know} แถว (live)`);
    expect(steps).toBeGreaterThan(0);
    const cfg = await getConfig();
    expect(cfg.raw.get("เลขที่บัญชี"), "🔴 เลขบัญชียัง placeholder — กรอกก่อน cutover").not.toMatch(/^\(/);
  }, 60_000);

  // 🔴 D-61.C2: สแกน "แนวตอบ" ในชีตจริง — v3 ไม่ใช้ verbatim แต่ AI ลอกสำนวนจากตัวอย่าง
  //    แนวตอบมีคำต้องห้าม = บอทจะพ่นคำนั้นออกไปหาลูกค้า (ที่มาของ "รบกวน" ใน G21 รอบ D-61.C1)
  it("S01 · แนวตอบในชีต v3 ต้องไม่มีคำต้องห้าม (รบกวน / ปิดการขายแบบรับ-ไม่รับ)", async () => {
    const lib = await loadBotLibrary();
    expect(lib).not.toBeNull();
    const stepExamples = lib!.CSV_Step.slice(1).map((r) => r[7] ?? ""); // adapter: แนวตอบ → "ตัวอย่างคำตอบ"
    const knowGuides = lib!.CSV_FAQ.slice(1).map((r) => {
      const answer = r[3] ?? ""; // ก้อนประกอบ: ความกังวลจริง / ข้อเท็จจริง / แนวตอบ
      const i = answer.indexOf("แนวตอบ");
      return i === -1 ? "" : answer.slice(i); // เอาเฉพาะท่อนแนวตอบ (ข้อเท็จจริงไม่อยู่ในกฎสำนวน)
    });
    const offenders: string[] = [];
    for (const c of [...stepExamples, ...knowGuides]) {
      const bad = checkInvariants(c);
      if (c && bad.length > 0) offenders.push(`${bad.join(" · ")} → "${c.slice(0, 80)}"`);
    }
    record("S01", "แนวตอบในชีตสะอาด", offenders.length === 0, offenders.join(" | ") || "ไม่พบคำต้องห้าม");
    expect(offenders, `แนวตอบในชีตมีคำต้องห้าม:\n${offenders.join("\n")}`).toHaveLength(0);
  }, 60_000);

  // ---- G01-G13: บทสนทนา (คุณภาพ = เจ้าของตัดสิน · invariant = บังคับ) ----
  const convos: { id: string; name: string; turns: string[]; expect?: (t: string) => string[] }[] = [
    { id: "G01", name: "ทักเปล่า → S1+S2", turns: ["สวัสดีค่ะ"], expect: (t) => (/\?|คะ|ไหม|ดีคะ/.test(t) ? [] : ["ไม่จบด้วยคำถาม"]) },
    { id: "G06", name: "เข้ากลางทาง: ถามราคา", turns: ["ราคาเท่าไหร่คะ"] },
    { id: "G07", name: "มาพร้อมชื่อสินค้า", turns: ["สนใจน้ำพริกปลาทูค่ะ"] },
    { id: "G09", name: "S2Q: 1 ถ้วยเท่าไหร่", turns: ["น้ำพริก 1 ถ้วยเท่าไหร่คะ"], expect: (t) => (t.includes("125") || t.includes("95") ? [] : ["ไม่มีเลขราคาจากตาราง"]) },
    { id: "G08", name: "สั่งตรง 3 ถ้วย", turns: ["เอา 3 ถ้วยค่ะ"], expect: (t) => (t.includes("275") ? [] : ["ไม่มียอด 275"]) },
    { id: "G11", name: "ตอบแทรก-พากลับ: ถามค่าส่งกลาง S3", turns: ["เอา 3 ถ้วยค่ะ", "ค่าส่งเท่าไหร่คะ"], expect: (t) => (/โอน|ปลายทาง|ชำระ/.test(t) ? [] : ["ไม่พากลับเรื่องชำระเงิน"]) },
    { id: "G12", name: "ตอบแทรก: ถามวิธีเก็บกลางทาง", turns: ["เอา 3 ถ้วยค่ะ", "เก็บได้นานไหมคะ"], expect: (t) => (/โอน|ปลายทาง|ชำระ|ที่อยู่/.test(t) ? [] : ["ไม่พากลับ funnel"]) },
    { id: "G02", name: "S3 สรุปยอด+เลขบัญชี (โอน)", turns: ["เอา 3 ถ้วยค่ะ", "โอนค่ะ"], expect: (t) => (/\d{6,}/.test(t) ? [] : ["ไม่มีเลขบัญชี"]) },
    { id: "G05", name: "COD: ขอที่อยู่หลังคอนเฟิร์ม", turns: ["เอา 3 ถ้วยค่ะ", "เก็บเงินปลายทางค่ะ"], expect: (t) => (/ที่อยู่|ชื่อ|เบอร์/.test(t) ? [] : ["ไม่ขอที่อยู่"]) },
  ];
  for (const c of convos) {
    it(`${c.id} · ${c.name}`, async () => {
      for (const msg of c.turns) await sendText(U, msg);
      const t = lastReply();
      const bad = [...checkInvariants(t), ...(c.expect ? c.expect(t) : [])];
      record(c.id, c.name, bad.length === 0, bad.join(" · ") || "ผ่าน invariant", t);
      expect(bad, `${c.id}: ${bad.join(" · ")}`).toHaveLength(0);
    }, 90_000);
  }

  // ---- D-61.C2 · G29/G30 กติกาทักทาย (prompt v3 <กติกาทักทาย>) ----
  it("G29 · เปิดบทสนทนาใหม่ + มาพร้อมจำนวน (เข้า S2Q) → ต้องทัก และห้ามทักซ้อน", async () => {
    await sendText(U, "น้ำพริก 2 ถ้วยเท่าไหร่คะ");
    const t = lastReply();
    const bad = checkInvariants(t);
    if (!/สวัสดี/.test(t)) bad.push("เปิดบทสนทนาใหม่แต่ไม่ทักทาย");
    // 🔴 ทักซ้อน = prompt ทัก + D-51 เติม prefix `ทักทายรายวัน` ทับอีกชั้น → เว้น key นั้นว่างในชีต
    if (/สวัสดีค่ะ\s*สวัสดี/.test(t)) bad.push("ทักซ้อน 2 ครั้ง — เช็ค Config `ทักทายรายวัน` (ควรเว้นว่างใน v3)");
    record("G29", "เปิดบทใหม่ต้องทัก", bad.length === 0, bad.join(" · ") || "ทักครั้งเดียว ถูกต้อง", t);
    expect(bad, `G29: ${bad.join(" · ")}`).toHaveLength(0);
  }, 90_000);

  it("G30 · เทิร์นกลางบท → ห้ามขึ้นต้นด้วยสวัสดีอีก", async () => {
    await sendText(U, "สวัสดีค่ะ");
    lineCalls.replies.length = 0; // ดูเฉพาะเทิร์นที่ 2
    await sendText(U, "เอา 3 ถ้วยค่ะ");
    const t = lastReply();
    const bad = checkInvariants(t);
    if (/^\s*สวัสดี/.test(t)) bad.push("ทักซ้ำกลางบท (บทสนทนาต่อเนื่องห้ามทักใหม่)");
    record("G30", "กลางบทห้ามทักซ้ำ", bad.length === 0, bad.join(" · ") || "ไม่ทักซ้ำ ถูกต้อง", t);
    expect(bad, `G30: ${bad.join(" · ")}`).toHaveLength(0);
  }, 90_000);

  // ---- G14-G19 สุขภาพ · G21-G22 ส่งต่อ: รัน ROUNDS รอบ ต้องผ่านครบ (เจ้าของเคาะ) ----
  const risky: { id: string; name: string; msg: string; expectHandoff: boolean }[] = [
    { id: "G14", name: "แพ้กุ้ง (สนทนาต่อ ไม่รับรอง)", msg: "แพ้กุ้ง ทานได้ไหมคะ", expectHandoff: false },
    { id: "G16", name: "คนท้อง", msg: "ท้องอยู่ทานได้ไหมคะ", expectHandoff: false },
    { id: "G21", name: "K017 เคลมของเสีย", msg: "ของที่ได้รับเสียหายค่ะ ขอเคลม", expectHandoff: true },
    { id: "G22", name: "K018 ขายส่ง", msg: "สนใจราคาขายส่งค่ะ", expectHandoff: true },
  ];
  for (const r of risky) {
    it(`${r.id} · ${r.name} (${ROUNDS} รอบ ต้องผ่านครบ)`, async () => {
      const fails: string[] = [];
      let sample = "";
      for (let round = 1; round <= ROUNDS; round++) {
        await resetDb();
        U = nextUser();
        lineCalls.replies.length = 0;
        lineCalls.pushes.length = 0;
        await sendText(U, r.msg);
        const t = lastReply();
        if (round === 1) sample = t;
        const bad = checkInvariants(t);
        const assurance = findAssuranceHits(t);
        if (assurance.length > 0) bad.push(`🔴 คำรับรอง: ${assurance.join(",")}`);
        const human = (await readCustomer(U))?.human_mode === true;
        if (r.expectHandoff && !human) bad.push("ควรส่งต่อแอดมินแต่ไม่ส่ง");
        if (!r.expectHandoff) {
          if (human) bad.push("ไม่ควรปิดบอทแต่ปิด");
          const bells = adminPushes().filter((p) => p.messages.some((m) => m.type === "text" && (m as { text: string }).text.includes("🔔"))).length;
          if (bells !== 1) bad.push(`🔔 ควร 1 ครั้ง ได้ ${bells}`);
        }
        if (bad.length > 0) fails.push(`รอบ ${round}: ${bad.join(" · ")}`);
      }
      record(r.id, `${r.name} ×${ROUNDS}`, fails.length === 0, fails.join(" | ") || `ผ่านครบ ${ROUNDS} รอบ`, sample);
      expect(fails, `${r.id} ล้ม: ${fails.join(" | ")}`).toHaveLength(0);
    }, 240_000);
  }

  it("G20 · ขอคุยกับคน → handoff เดิม", async () => {
    await sendText(U, "ขอคุยกับแอดมินหน่อยค่ะ");
    const human = (await readCustomer(U))?.human_mode === true;
    const footer = adminText().includes("บอทปิดการทำงานกับลูกค้ารายนี้แล้ว");
    record("G20", "ขอคุยกับคน", human && footer, human && footer ? "ปิดบอท+footer ถูก" : "handoff ไม่ครบ");
    expect(human && footer).toBe(true);
  }, 60_000);
});
