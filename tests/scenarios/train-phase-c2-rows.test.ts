import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sheetsCalls } from "../harness/state";
import { seedBotLib, v3StepRows, v3KnowRows, V3_STEP_HEADER_WITH_FUNNEL, TAB } from "../harness/botlib-fixture";
import { appendRow, setRowStatus, listTabRows, suggestNextKey, nextSequentialId } from "@/lib/train/write";
import { columnLetter } from "@/lib/sheets/columns";
import { lintPattern } from "@/lib/train/lint";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { getConfig } from "@/lib/config";
import { buildFaqInjection, VALID_FUNNEL_STAGES, statusColumnIndex } from "@/lib/agent/inject";
import { applyOverlayToTab } from "@/lib/train/sandbox";
import { normalizeBundle } from "@/lib/sheets/normalize-bundle";

/**
 * T2-ค — จัดการแถวคลังความรู้จากเว็บ (add-row draft-forced · status live↔draft · lint H1 · sandbox draft-preview)
 * 🔴 หัวใจความปลอดภัย: (1) แถวใหม่ = draft เสมอ (ไม่มีคอลัมน์สถานะ=ปฏิเสธ) (2) prod กรอง draft ทิ้ง ·
 *    ห้องซ้อมเห็น draft ผ่าน overlay สถานะ→live (3) คำสุขภาพ (H1) block เว้นคำตอบเป็นการส่งต่อ
 */

/** header ของ shape ภายใน (adapter คืนแบบนี้เสมอ) — ใช้อ่าน index ตอน assert */
const FAQ_H = ["คำถาม", "keywords", "action", "คำตอบ", "สถานะ"];
/** 🔴 D-68: seed แท็บ "ความรู้" (ชีตดิบ v3) → adapter → Knowledge · status ว่าง = draft (normalize ที่ adapter) */
function faq(rows: { say: string; keyword?: string; fact?: string; status?: string }[]): void {
  seedBotLib({ knowRows: v3KnowRows(rows) });
}

beforeAll(() => {
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
  process.env.TRAIN_PASSWORD = "test-train-pass";
});
beforeEach(() => seedBotLib());

// ---------- H1 lint (บล็อกคำสุขภาพ · ยกเว้นการส่งต่อ) ----------
describe("T2-ค · lint H1 สุขภาพ/แพ้อาหาร", () => {
  it("🔴 คำสุขภาพในคำตอบ (ไม่ส่งต่อ) → block", async () => {
    const lib = (await loadBotLibrary())!;
    const findings = lintPattern("ถ้าแพ้อาหารก็ทานได้เลยค่ะ ไม่ต้องห่วง", { config: await getConfig(), lib, payment: "", now: new Date() });
    const h1 = findings.find((f) => f.kind === "health-h1");
    expect(h1?.level, "แพ้อาหาร + ไม่ส่งต่อ = block").toBe("block");
  });
  it("คำสุขภาพ + ส่งต่อแอดมิน → warn (อนุญาต · เคสถูก FAQ แพ้อาหาร→handoff)", async () => {
    const lib = (await loadBotLibrary())!;
    const findings = lintPattern("เรื่องแพ้อาหารขอส่งต่อให้แอดมินดูแลให้นะคะ", { config: await getConfig(), lib, payment: "", now: new Date() });
    const h1 = findings.find((f) => f.kind === "health-h1");
    expect(h1?.level).toBe("warn");
    expect(findings.some((f) => f.level === "block"), "ไม่ block").toBe(false);
  });
  it("🔴 D-72b: ข้อเท็จจริงตามฉลาก (ไม่มีคำรับรอง) → warn ไม่ block — v3 ให้บอทคุยต่อได้", async () => {
    const lib = (await loadBotLibrary())!;
    // trigger เกี่ยวแพ้ แต่คำตอบคือข้อเท็จจริงตามฉลากล้วน — เกณฑ์ v2 เคย block (ไม่มีคำว่าแอดมิน) = ผิด
    const findings = lintPattern("ส่วนประกอบมีกุ้งจากกะปิค่ะ และมีปลาเป็นส่วนประกอบหลัก", { config: await getConfig(), lib, payment: "", now: new Date(), trigger: "แพ้กุ้งทานได้ไหม" });
    const h1 = findings.find((f) => f.kind === "health-h1");
    expect(h1?.level, "ข้อเท็จจริงตามฉลาก = เขียนได้ (แค่เตือน)").toBe("warn");
    expect(h1?.message, "warn ต้องบอกทางออก (กติกา CLAUDE.md H1)").toContain("ข้อเท็จจริงตามฉลาก");
    expect(findings.some((f) => f.level === "block")).toBe(false);
  });
  it("🔴 คำรับรองแบบมีเงื่อนไข ('ถ้าไม่แพ้ก็ทานได้') → ยัง block (ตัวจับเดียวกับ assurance guard)", async () => {
    const lib = (await loadBotLibrary())!;
    const findings = lintPattern("ถ้าไม่แพ้ก็ทานได้ค่ะ", { config: await getConfig(), lib, payment: "", now: new Date() });
    expect(findings.find((f) => f.kind === "health-h1")?.level).toBe("block");
  });
  it("ข้อความปกติ (ไม่มีคำสุขภาพ) → ไม่มี health-h1", async () => {
    const lib = (await loadBotLibrary())!;
    const findings = lintPattern("ส่ง 1-2 วันค่ะ", { config: await getConfig(), lib, payment: "", now: new Date() });
    expect(findings.some((f) => f.kind === "health-h1")).toBe(false);
  });
});

// ---------- appendRow: บังคับ draft · guards ----------
describe("T2-ค · appendRow (บังคับ draft + guards)", () => {
  it("🔴 แถวใหม่บังคับ สถานะ=draft (ไม่ว่าจะส่ง status อะไรมา)", async () => {
    faq([{ say: "ส่งกี่วัน", keyword: "ส่งกี่วัน", fact: "1-2 วันค่ะ" }]);
    sheetsCalls.appends.length = 0;
    // 🔴 D-72b: cols = ชื่อคอลัมน์จริงตามชีต · แถวใหม่เรียงตาม header ดิบ · สถานะถูกทับเป็น draft เสมอ
    const res = await appendRow("Knowledge", { "ลูกค้าพูดยังไง": "ส่งเสาร์อาทิตย์ไหม", keyword: "เสาร์", "ข้อเท็จจริง/สิ่งที่อยากให้รู้": "ส่งทุกวันค่ะ", "สถานะ": "live" });
    expect(res.status).toBe("ok");
    const added = sheetsCalls.appends.filter((a) => a.range.startsWith("Knowledge"));
    expect(added).toHaveLength(1);
    // V3_KNOW_HEADER: ลูกค้าพูดยังไง | keyword | ความกังวลจริง | ข้อเท็จจริง | แนวตอบ | สถานะ
    expect(added[0].values[0], "เรียงตาม header ดิบ + สถานะถูกบังคับ draft แม้ส่ง live มา").toEqual(
      ["ส่งเสาร์อาทิตย์ไหม", "เสาร์", "", "ส่งทุกวันค่ะ", "", "draft"]);
  });

  it("🔴 D-72b: ชีตดิบขาดคอลัมน์สถานะ → Studio เห็นความจริง (ไม่มี) + appendRow ปฏิเสธ · ฝั่งบอทยังกัน draft ให้", async () => {
    // เดิม (D-68) listTabRows อ่าน bundle ที่ normalize แล้ว → โกหกว่ามีคอลัมน์สถานะทั้งที่ชีตจริงไม่มี
    // D-72b อ่านแถวดิบ → เห็นโครงชีตจริง → safety #1 (no_status_col) กลับมาทำงานได้จริง
    seedBotLib();
    sheetsCalls.botLibReturn[TAB.knowledge] = [["ลูกค้าพูดยังไง", "keyword", "ข้อเท็จจริง/สิ่งที่อยากให้รู้"], ["ส่งกี่วัน", "ส่ง", "1-2 วันค่ะ"]];
    const out = await listTabRows("Knowledge");
    expect(out.hasStatusCol, "แถวดิบไม่มีคอลัมน์สถานะ = Studio ต้องเห็นความจริง (ไม่ใช่ header ที่ normalize ประกอบให้)").toBe(false);
    const res = await appendRow("Knowledge", { "ลูกค้าพูดยังไง": "ใหม่", keyword: "ใหม่" });
    expect(res.status, "safety #1: ไม่มีคอลัมน์สถานะ = ปฏิเสธเพิ่มแถว").toBe("no_status_col");
    // 🔴 ฝั่งบอท (normalizeBundle) ยังกันให้: ไม่มีสถานะ → แถวเป็น draft (ไม่เด้งขึ้นหน้าร้าน)
    const lib = (await loadBotLibrary())!;
    const kRows = lib.Knowledge;
    expect(kRows[1][kRows[0].indexOf("สถานะ")], "normalize เติมสถานะ draft ให้เสมอ").toBe("draft");
  });

  it("key ซ้ำ → dup (ไม่ append)", async () => {
    faq([{ say: "ส่งกี่วัน", keyword: "ส่ง", fact: "1-2 วันค่ะ" }]);
    const before = sheetsCalls.appends.length;
    const res = await appendRow("Knowledge", { "ลูกค้าพูดยังไง": "ส่งกี่วัน", keyword: "ส่ง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้": "ซ้ำ", สถานะ: "" });
    expect(res.status).toBe("dup");
    expect(sheetsCalls.appends.length).toBe(before);
  });

  it("🔴 H1 คำสุขภาพในคำตอบ → lint (ไม่ append) · แต่ถ้าส่งต่อ → ok", async () => {
    faq([{ say: "x", keyword: "x", fact: "y" }]);
    // 🔴 D-72b เกณฑ์ใหม่: block เพราะ "คำรับรอง" (ทานได้/ไม่เป็นไร) — ตัวจับเดียวกับ assurance guard ฝั่ง output
    const blocked = await appendRow("Knowledge", { "ลูกค้าพูดยังไง": "แพ้กุ้งทานได้ไหม", keyword: "แพ้กุ้ง", แนวตอบ: "ทานได้ค่ะ ไม่เป็นไร" });
    expect(blocked.status).toBe("lint");
    // คำตอบส่งต่อ (ไม่มีคำรับรอง) = เขียนได้จริง (D-72b ปลดล็อกแล้ว)
    const ok = await appendRow("Knowledge", { "ลูกค้าพูดยังไง": "แพ้กุ้งทานได้ไหม", keyword: "แพ้กุ้ง", แนวตอบ: "เรื่องแพ้อาหารขอส่งต่อให้แอดมินดูแลนะคะ" });
    expect(ok.status).toBe("ok");
  });

  it("Vars key ไม่มีปีกกา → key_invalid", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn.Vars = [["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"], ["{มีอยู่}", "x", "", "live"]];
    const res = await appendRow("Vars", { ตัวแปร: "ไม่มีปีกกา", ค่า: "abc", สถานะ: "" });
    expect(res.status).toBe("key_invalid");
  });

  it("🔴 Step funnel_stage ผิด enum → funnel (ไม่ append) · ถูก enum → ok", async () => {
    seedBotLib({ stepRows: v3StepRows([{ step_id: "S1", funnel: VALID_FUNNEL_STAGES[0], guide: "สวัสดีค่ะ" }]) });
    const bad = await appendRow("Steps", { step_id: "S9", funnel_stage: "ไม่ใช่สเตจ", ชื่อประตู: "x", แนวตอบ: "hi", สถานะ: "" });
    expect(bad.status, "enum ผิด = กันไว้ก่อนถึง guard เขียน").toBe("funnel");
    seedBotLib({ stepRows: v3StepRows([{ step_id: "S1", funnel: VALID_FUNNEL_STAGES[0], guide: "สวัสดีค่ะ" }]) });
    // enum ถูก → ผ่าน guard ทุกตัว → เขียนได้จริง (D-72b) · สถานะบังคับ draft
    sheetsCalls.appends.length = 0;
    const good = await appendRow("Steps", { step_id: "S9", funnel_stage: VALID_FUNNEL_STAGES[1], ชื่อประตู: "x", แนวตอบ: "สวัสดีจ้า", สถานะ: "" });
    expect(good.status).toBe("ok");
    const added = sheetsCalls.appends.find((a) => a.range.startsWith("Steps"));
    expect(added, "append ลงแท็บ Steps จริง").toBeTruthy();
    expect(added!.values[0][V3_STEP_HEADER_WITH_FUNNEL.indexOf("สถานะ")], "บังคับ draft (fixture 10 คอลัมน์เพราะเทสนี้ใช้ funnel)").toBe("draft");
  });
});

// ---------- status live↔draft (soft delete) ----------
describe("T2-ค · setRowStatus (soft delete · TRAIN_LOG action)", () => {
  it("draft → live: เขียนเซลล์สถานะ + TRAIN_LOG action=status-change", async () => {
    faq([{ say: "ส่งกี่วัน", keyword: "ส่ง", fact: "1-2 วันค่ะ", status: "draft" }]);
    sheetsCalls.batchUpdates.length = 0;
    sheetsCalls.appends.length = 0;
    // 🔴 D-72b: เขียนได้จริง — สถานะ = คอลัมน์ F ของชีตดิบ Knowledge (แถว 2)
    const res = await setRowStatus("Knowledge", "ส่งกี่วัน", "live");
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.range).toBe("Knowledge!F2");
    expect(sheetsCalls.batchUpdates).toEqual([{ range: "Knowledge!F2", values: [["live"]] }]);
    expect(sheetsCalls.appends.some((a) => a.range.startsWith("TRAIN_LOG")), "TRAIN_LOG action=status-change").toBe(true);
  });
});

// ---------- list + suggest ----------
describe("T2-ค · listTabRows + suggestNextKey", () => {
  it("list ข้ามแถว key ว่าง (หมายเหตุ) · active flag ตรง", async () => {
    faq([
      { say: "ส่งกี่วัน", keyword: "ส่ง", fact: "1-2 วันค่ะ" },
      { say: "โปรวันนี้", keyword: "โปร", fact: "มีโปรค่ะ", status: "draft" },
      { say: "", fact: "หมายเหตุ" }, // แถว key ว่าง — adapter กรองทิ้งตั้งแต่ต้นทาง
    ]);
    const out = await listTabRows("Knowledge");
    expect(out.rows.length, "ข้ามแถว key ว่าง").toBe(2);
    expect(out.hasStatusCol).toBe(true);
    expect(out.rows.find((r) => r.key === "ส่งกี่วัน")!.active).toBe(true);
    expect(out.rows.find((r) => r.key === "โปรวันนี้")!.active, "draft = ไม่ active").toBe(false);
  });
  it("suggestNextKey: Steps id ต่อเลข · Knowledge/Vars = null (คนพิมพ์ key เอง)", () => {
    // 🔴 D-72a: แท็บ Objections ถูกลบ (v3 ยุบเข้า Knowledge) — แท็บที่ key เป็น id เหลือ Steps ตัวเดียว
    expect(suggestNextKey("Steps", ["S1", "S2", "S3"])).toBe("S4");
    expect(suggestNextKey("Knowledge", ["ส่งกี่วัน"])).toBeNull();
    expect(suggestNextKey("Vars", ["{สัดส่วนปลาทู}"])).toBeNull();
  });
});

// ---------- D-57 bugfix · resolve คอลัมน์สถานะ (Knowledge="status" อังกฤษ · แท็บอื่น="สถานะ") ----------
describe("D-57 bugfix · statusColumnIndex — รองรับทั้ง 'status' (อังกฤษ) และ 'สถานะ' (ไทย)", () => {
  // 🔴 D-68: เส้นทาง end-to-end ของ header 'status' อังกฤษ **เข้าไม่ถึงแล้วใน v3**
  //    (adaptKnowledge ประกอบ header เองเสมอ → Knowledge ได้ "สถานะ" ไทยทุกครั้ง)
  //    การันตีเดิมจึงพิสูจน์ที่ตัวฟังก์ชันแทน — ยังคุ้มเพราะ statusColumnIndex ใช้กับชีตดิบทุกแท็บ
  it("🔴 header 'status' (อังกฤษ) → เจอ · 'สถานะ' (ไทย) → เจอ · ไม่มีเลย → -1", () => {
    expect(statusColumnIndex(["คำถาม", "keywords", "action", "คำตอบ", "status"])).toBe(4);
    expect(statusColumnIndex(["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"])).toBe(3);
    expect(statusColumnIndex(["คำถาม", "คำตอบ"]), "ไม่มีคอลัมน์สถานะ = -1 (ผู้เรียกปฏิเสธการเขียน)").toBe(-1);
  });
  it("แท็บ Vars (ชีตดิบ · header 'สถานะ') → listTabRows เห็นคอลัมน์สถานะ", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn[TAB.vars] = [["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"], ["{a}", "1", "", "live"]];
    const out = await listTabRows("Vars");
    expect(out.statusCol).toBe("สถานะ");
    expect(out.hasStatusCol).toBe(true);
  });
});

// ---------- D-58 · lint H1 exempt สำหรับประตู Steps handoff/handoff_notify ----------
describe("D-58/D-72b · lint H1 กับประตู Steps (เนื้อที่เข้า prompt = `สาระที่ต้องสื่อ`)", () => {
  function seedStep(): void {
    seedBotLib({ stepRows: v3StepRows([{ step_id: "S1", funnel: "lead", name: "ทัก", guide: "สวัสดีค่ะ" }]) });
  }
  it("ประตู handoff_notify: คำสุขภาพในสาระ → exempt ไม่ตรวจ (เขียนได้ · เป็นดีไซน์ที่เจ้าของคุม)", async () => {
    seedStep();
    const res = await appendRow("Steps", { step_id: "H1", funnel_stage: "handoff_notify", ชื่อประตู: "สุขภาพ", สาระที่ต้องสื่อ: "สินค้ามีส่วนผสมปลาค่ะ หากแพ้อาหารแนะนำปรึกษาแพทย์", สถานะ: "" });
    expect(res.status).toBe("ok");
  });
  it("ประตู handoff_notify: วลีรับรอง 'ทานได้' → warn (D-58 · ไม่ block ยังเขียนได้)", async () => {
    seedStep();
    const res = await appendRow("Steps", { step_id: "H1", funnel_stage: "handoff_notify", ชื่อประตู: "สุขภาพ", สาระที่ต้องสื่อ: "แพ้กุ้งก็ทานได้ค่ะ", สถานะ: "" });
    expect(res.status).toBe("ok");
  });
  it("🔴 ประตูปกติ (lead): คำสุขภาพ + คำรับรอง ในสาระ → block (เกณฑ์ D-72b: ห้ามคำรับรอง)", async () => {
    seedStep();
    const res = await appendRow("Steps", { step_id: "S9", funnel_stage: "lead", ชื่อประตู: "x", สาระที่ต้องสื่อ: "แพ้กุ้งทานได้เลยค่ะ", สถานะ: "" });
    expect(res.status).toBe("lint");
  });
  it("🔴 D-72b: ธง handoff แบบคอลัมน์ `handoff` (ชีตจริงวันนี้ ไม่มี funnel_stage) → exempt เหมือนกัน", async () => {
    seedStep();
    const res = await appendRow("Steps", { step_id: "H2", ชื่อประตู: "สุขภาพ", สาระที่ต้องสื่อ: "หากแพ้อาหารแนะนำปรึกษาแพทย์ก่อนนะคะ", handoff: "ใช่", funnel_stage: "handoff", สถานะ: "" });
    expect(res.status).toBe("ok");
  });
});

// ---------- 🔴 prod กรอง draft · ห้องซ้อมเห็น draft ผ่าน overlay (ใช้ matcher prod จริง) ----------
describe("T2-ค · draft: prod ทิ้ง · sandbox เห็น (overlay สถานะ→live)", () => {
  /**
   * 🔴 D-72a: overlay ของจริงทับที่ชั้น batchGet = "แถวดิบตามชีต" (wrapSheetsForSandbox)
   * เทสจึงต้อง seed แถวดิบ → overlay → normalize → matcher (กติกา D-68 ข้อ 2)
   * (ของเดิมทับลง "shape ภายใน" ที่ prod ไม่มีวันไหนเดินผ่าน)
   */
  const Q = "โปรวันนี้มีไหม";
  const A = "วันนี้มีโปรพิเศษค่ะ";
  const raw = v3KnowRows([{ say: Q, keyword: Q, fact: A, status: "draft" }]);
  const know = (rows: string[][]) => normalizeBundle({ [TAB.knowledge]: rows }).Knowledge;

  it("🔴 prod: buildFaqInjection ไม่เสิร์ฟแถว draft", () => {
    expect(buildFaqInjection(know(raw), Q).verbatim, "draft ถูกกรองทิ้งฝั่ง prod").toBeNull();
  });
  it("🔴 sandbox: overlay สถานะ→live บนแถวดิบ → matcher เดียวกันเสิร์ฟแถวนั้น", () => {
    const flipped = applyOverlayToTab(TAB.knowledge, raw, [{ tab: TAB.knowledge, key: Q, column: "สถานะ", value: "live" }]);
    expect(buildFaqInjection(know(flipped), Q).verbatim?.answer).toContain(A);
  });
});

// ═══════════ D-74 · Studio UX: id ต้องหาเจอ · id ใหม่ไม่ต้องคิดเอง ═══════════

/** แถวดิบ Knowledge แบบมีคอลัมน์ id (K001…) — ตรงกับชีตจริง (fixture v3KnowRows ไม่มี id) */
function knowWithId(rows: { id: string; say: string; keyword?: string; fact?: string; status?: string }[]): string[][] {
  return [
    ["id", "ลูกค้าพูดยังไง", "keyword", "ความกังวลจริง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "แนวตอบ", "สถานะ"],
    ...rows.map((r) => [r.id, r.say, r.keyword ?? "", "", r.fact ?? "", "", r.status ?? "live"]),
  ];
}

describe("D-74 · nextSequentialId (pure) — เสนอ id ถัดไป", () => {
  it("K020 สูงสุด → K021 · คงจำนวนหลัก", () => {
    expect(nextSequentialId(["K001", "K017", "K020"])).toBe("K021");
  });
  it("เลขไม่เรียง/ข้ามเลข → อิงตัวสูงสุด ไม่ใช่จำนวนแถว", () => {
    expect(nextSequentialId(["K001", "K009", "K003"])).toBe("K010");
  });
  it("prefix ปนกัน → ใช้ prefix ที่พบบ่อยสุด (แถวแปลกปลอมไม่ลากเลขผิดกลุ่ม)", () => {
    expect(nextSequentialId(["K001", "K002", "K003", "X99"])).toBe("K004");
  });
  it("ไม่มีตัวไหนเข้า pattern (S1/S2Q/H_CLAIM แบบ Steps) → null (คนพิมพ์เอง)", () => {
    expect(nextSequentialId(["H_CLAIM", "H_BULK"])).toBeNull();
    expect(nextSequentialId([])).toBeNull();
  });
  it("🔴 id ที่มีเลขนำหน้าเป็น 0 (K007) → K008 ไม่ใช่ K8", () => {
    expect(nextSequentialId(["K007"])).toBe("K008");
  });
});

describe("D-74 · listTabRows โชว์ id + เสนอ id ถัดไป", () => {
  it("🔴 ทุกแถวมี id ตามชีต + idCol + suggestedId = ถัดจากสูงสุด", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn[TAB.knowledge] = knowWithId([
      { id: "K005", say: "ส่งกี่วัน", fact: "1-2 วันค่ะ" },
      { id: "K017", say: "ของเสีย/ของไม่ถึง", fact: "รับเคลม" },
    ]);
    const out = await listTabRows("Knowledge");
    expect(out.idCol).toBe("id");
    expect(out.rows.map((r) => r.id), "id ต้องมาถึง UI (เดิมหาย → หา K017 ไม่เจอ)").toEqual(["K005", "K017"]);
    expect(out.suggestedId, "เสนอ id ถัดไปให้เอง").toBe("K018");
  });

  it("แท็บที่ไม่มีคอลัมน์ id (Vars) → idCol/suggestedId = null · id ต่อแถว = \"\" (ไม่พัง)", async () => {
    seedBotLib();
    const out = await listTabRows("Vars");
    expect(out.idCol).toBeNull();
    expect(out.suggestedId).toBeNull();
    expect(out.rows.every((r) => r.id === "")).toBe(true);
  });
});

describe("D-74 · id/key ซ้ำ → ปฏิเสธพร้อมบอกว่าซ้ำกับแถวไหน", () => {
  it("🔴 id ซ้ำ → dup + ข้อความระบุแถวที่ชน (id · key · เลขแถวในชีต)", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn[TAB.knowledge] = knowWithId([
      { id: "K005", say: "ส่งกี่วัน", fact: "1-2 วันค่ะ" },
      { id: "K017", say: "ของเสีย/ของไม่ถึง", fact: "รับเคลม" },
    ]);
    sheetsCalls.appends.length = 0;
    const res = await appendRow("Knowledge", { id: "K017", "ลูกค้าพูดยังไง": "คำถามใหม่", keyword: "ใหม่" });
    expect(res.status).toBe("dup");
    if (res.status === "dup") {
      expect(res.message).toContain("K017");
      expect(res.message, "บอกว่าชนกับแถวไหน").toContain("ของเสีย/ของไม่ถึง");
      expect(res.message, "บอกเลขแถวในชีตให้ไปดูได้").toContain("แถว 3");
    }
    expect(sheetsCalls.appends.filter((a) => a.range.startsWith("Knowledge")), "ซ้ำ = ไม่เขียน").toHaveLength(0);
  });

  it("key ซ้ำ (Steps · id คือ step_id เอง) → dup + ระบุแถว (เตือนแทนการเดา pattern)", async () => {
    seedBotLib({ stepRows: v3StepRows([{ step_id: "H_CLAIM", intake: true, name: "เคลม" }]) });
    const res = await appendRow("Steps", { step_id: "H_CLAIM", ชื่อประตู: "เคลมซ้ำ", สถานะ: "" });
    expect(res.status).toBe("dup");
    if (res.status === "dup") expect(res.message).toContain("H_CLAIM");
  });

  it("id ไม่ซ้ำ → เขียนได้ปกติ (แถวใหม่ยังบังคับ draft)", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn[TAB.knowledge] = knowWithId([{ id: "K005", say: "ส่งกี่วัน", fact: "1-2 วันค่ะ" }]);
    sheetsCalls.appends.length = 0;
    const res = await appendRow("Knowledge", { id: "K006", "ลูกค้าพูดยังไง": "ส่งเสาร์ไหม", keyword: "เสาร์" });
    expect(res.status).toBe("ok");
    const added = sheetsCalls.appends.find((a) => a.range.startsWith("Knowledge"));
    expect(added?.values[0][0], "id ลงคอลัมน์แรกตาม header ดิบ").toBe("K006");
    expect(added?.values[0][6], "สถานะบังคับ draft").toBe("draft");
  });
});
