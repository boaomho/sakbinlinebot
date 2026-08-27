import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sheetsCalls } from "../harness/state";
import { seedBotLib, v3StepRows, v3KnowRows, TAB } from "../harness/botlib-fixture";
import { appendRow, setRowStatus, listTabRows, suggestNextKey } from "@/lib/train/write";
import { columnLetter } from "@/lib/sheets/columns";
import { lintPattern } from "@/lib/train/lint";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { getConfig } from "@/lib/config";
import { buildFaqInjection, VALID_FUNNEL_STAGES, statusColumnIndex } from "@/lib/agent/inject";
import { applyOverlayToTab } from "@/lib/train/sandbox";

/**
 * T2-ค — จัดการแถวคลังความรู้จากเว็บ (add-row draft-forced · status live↔draft · lint H1 · sandbox draft-preview)
 * 🔴 หัวใจความปลอดภัย: (1) แถวใหม่ = draft เสมอ (ไม่มีคอลัมน์สถานะ=ปฏิเสธ) (2) prod กรอง draft ทิ้ง ·
 *    ห้องซ้อมเห็น draft ผ่าน overlay สถานะ→live (3) คำสุขภาพ (H1) block เว้นคำตอบเป็นการส่งต่อ
 */

/** header ของ shape ภายใน (adapter คืนแบบนี้เสมอ) — ใช้อ่าน index ตอน assert */
const FAQ_H = ["คำถาม", "keywords", "action", "คำตอบ", "สถานะ"];
/** 🔴 D-68: seed แท็บ "ความรู้" (ชีตดิบ v3) → adapter → CSV_FAQ · status ว่าง = draft (normalize ที่ adapter) */
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
    // 🔴 D-68: guard ทุกตัวยังทำงานเหมือนเดิม — แต่ทางที่ผ่านครบแล้วจะ throw ก่อนแตะ Google (เขียนชีต v3 ยังไม่รองรับ)
    await expect(appendRow("CSV_FAQ", { คำถาม: "ส่งเสาร์อาทิตย์ไหม", keywords: "เสาร์", action: "answer", คำตอบ: "ส่งทุกวันค่ะ", สถานะ: "live" }))
      .rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
    expect(sheetsCalls.appends.filter((a) => a.range.startsWith("CSV_FAQ")), "ห้ามแตะชีต").toHaveLength(0);
  });

  it("🔴 ชีตดิบขาดคอลัมน์สถานะ → adapter ยังใส่ `สถานะ` ให้เสมอ + default draft (แถวไม่ live เอง)", async () => {
    // 🔴 D-68: การันตี "แถวใหม่ห้าม live ทันที" ย้ายชั้นมาที่ adapter — เดิมพึ่ง no_status_col ใน appendRow
    //    v3 adaptKnowledge ประกอบ header เองเสมอ → เคส "แท็บไม่มีคอลัมน์สถานะ" เกิดกับ CSV_FAQ ไม่ได้อีก
    //    (ดู DECISIONS D-68: no_status_col กลายเป็น branch ที่ v3 เข้าไม่ถึง)
    seedBotLib();
    sheetsCalls.botLibReturn[TAB.knowledge] = [["ลูกค้าพูดยังไง", "keyword", "ข้อเท็จจริง/สิ่งที่อยากให้รู้"], ["ส่งกี่วัน", "ส่ง", "1-2 วันค่ะ"]];
    const out = await listTabRows("CSV_FAQ");
    expect(out.hasStatusCol, "adapter ใส่คอลัมน์สถานะให้").toBe(true);
    expect(out.rows.find((r) => r.key === "ส่งกี่วัน")!.active, "ชีตไม่ระบุสถานะ = draft ไม่ active").toBe(false);
  });

  it("key ซ้ำ → dup (ไม่ append)", async () => {
    faq([{ say: "ส่งกี่วัน", keyword: "ส่ง", fact: "1-2 วันค่ะ" }]);
    const before = sheetsCalls.appends.length;
    const res = await appendRow("CSV_FAQ", { คำถาม: "ส่งกี่วัน", keywords: "ส่ง", action: "answer", คำตอบ: "ซ้ำ", สถานะ: "" });
    expect(res.status).toBe("dup");
    expect(sheetsCalls.appends.length).toBe(before);
  });

  it("🔴 H1 คำสุขภาพในคำตอบ → lint (ไม่ append) · แต่ถ้าส่งต่อ → ok", async () => {
    faq([{ say: "x", keyword: "x", fact: "y" }]);
    const blocked = await appendRow("CSV_FAQ", { คำถาม: "แพ้กุ้งทานได้ไหม", keywords: "แพ้กุ้ง", action: "answer", คำตอบ: "ทานได้ค่ะ ไม่เป็นไร" });
    expect(blocked.status).toBe("lint");
    // ตอบด้วยการส่งต่อ = lint ผ่าน → ไปถึง guard เขียน (throw) แทนที่จะ block ด้วย lint
    await expect(appendRow("CSV_FAQ", { คำถาม: "แพ้กุ้งทานได้ไหม", keywords: "แพ้กุ้ง", action: "answer", คำตอบ: "เรื่องแพ้อาหารขอส่งต่อให้แอดมินดูแลนะคะ" }))
      .rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
  });

  it("Vars key ไม่มีปีกกา → key_invalid", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn.CSV_Vars = [["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"], ["{มีอยู่}", "x", "", "live"]];
    const res = await appendRow("CSV_Vars", { ตัวแปร: "ไม่มีปีกกา", ค่า: "abc", สถานะ: "" });
    expect(res.status).toBe("key_invalid");
  });

  it("🔴 Step funnel_stage ผิด enum → funnel (ไม่ append) · ถูก enum → ok", async () => {
    seedBotLib({ stepRows: v3StepRows([{ step_id: "S1", funnel: VALID_FUNNEL_STAGES[0], guide: "สวัสดีค่ะ" }]) });
    const bad = await appendRow("CSV_Step", { step_id: "S9", funnel_stage: "ไม่ใช่สเตจ", ชื่อประตู: "x", ตัวอย่างคำตอบ: "hi", สถานะ: "" });
    expect(bad.status, "enum ผิด = กันไว้ก่อนถึง guard เขียน").toBe("funnel");
    seedBotLib({ stepRows: v3StepRows([{ step_id: "S1", funnel: VALID_FUNNEL_STAGES[0], guide: "สวัสดีค่ะ" }]) });
    // enum ถูก → ผ่าน guard ทุกตัว → ไปติดที่ D-68 write-disabled (throw ก่อนแตะ Google)
    await expect(appendRow("CSV_Step", { step_id: "S9", funnel_stage: VALID_FUNNEL_STAGES[1], ชื่อประตู: "x", ตัวอย่างคำตอบ: "สวัสดีจ้า", สถานะ: "" }))
      .rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
  });
});

// ---------- status live↔draft (soft delete) ----------
describe("T2-ค · setRowStatus (soft delete · TRAIN_LOG action)", () => {
  it("draft → live: เขียนเซลล์สถานะ + TRAIN_LOG action=status-change", async () => {
    faq([{ say: "ส่งกี่วัน", keyword: "ส่ง", fact: "1-2 วันค่ะ", status: "draft" }]);
    // 🔴 D-68: หาแถวเจอ (ผ่าน guard) แต่เขียนไม่ได้ → throw ก่อนแตะชีต
    sheetsCalls.batchUpdates.length = 0;
    sheetsCalls.appends.length = 0;
    await expect(setRowStatus("CSV_FAQ", "ส่งกี่วัน", "live")).rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
    expect([...sheetsCalls.batchUpdates, ...sheetsCalls.appends], "ห้ามแตะชีต/TRAIN_LOG").toHaveLength(0);
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
    const out = await listTabRows("CSV_FAQ");
    expect(out.rows.length, "ข้ามแถว key ว่าง").toBe(2);
    expect(out.hasStatusCol).toBe(true);
    expect(out.rows.find((r) => r.key === "ส่งกี่วัน")!.active).toBe(true);
    expect(out.rows.find((r) => r.key === "โปรวันนี้")!.active, "draft = ไม่ active").toBe(false);
  });
  it("suggestNextKey: Objections id ต่อเลข · FAQ = null", () => {
    expect(suggestNextKey("CSV_Objections", ["OBJ_1", "OBJ_2"])).toBe("OBJ_3");
    expect(suggestNextKey("CSV_FAQ", ["ส่งกี่วัน"])).toBeNull();
  });
});

// ---------- D-57 bugfix · resolve คอลัมน์สถานะ (CSV_FAQ="status" อังกฤษ · แท็บอื่น="สถานะ") ----------
describe("D-57 bugfix · statusColumnIndex — รองรับทั้ง 'status' (อังกฤษ) และ 'สถานะ' (ไทย)", () => {
  // 🔴 D-68: เส้นทาง end-to-end ของ header 'status' อังกฤษ **เข้าไม่ถึงแล้วใน v3**
  //    (adaptKnowledge ประกอบ header เองเสมอ → CSV_FAQ ได้ "สถานะ" ไทยทุกครั้ง)
  //    การันตีเดิมจึงพิสูจน์ที่ตัวฟังก์ชันแทน — ยังคุ้มเพราะ statusColumnIndex ใช้กับชีตดิบทุกแท็บ
  it("🔴 header 'status' (อังกฤษ) → เจอ · 'สถานะ' (ไทย) → เจอ · ไม่มีเลย → -1", () => {
    expect(statusColumnIndex(["คำถาม", "keywords", "action", "คำตอบ", "status"])).toBe(4);
    expect(statusColumnIndex(["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"])).toBe(3);
    expect(statusColumnIndex(["คำถาม", "คำตอบ"]), "ไม่มีคอลัมน์สถานะ = -1 (ผู้เรียกปฏิเสธการเขียน)").toBe(-1);
  });
  it("แท็บ Vars (ชีตดิบ · header 'สถานะ') → listTabRows เห็นคอลัมน์สถานะ", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn[TAB.vars] = [["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"], ["{a}", "1", "", "live"]];
    const out = await listTabRows("CSV_Vars");
    expect(out.statusCol).toBe("สถานะ");
    expect(out.hasStatusCol).toBe(true);
  });
});

// ---------- D-58 · lint H1 exempt สำหรับประตู CSV_Step handoff/handoff_notify ----------
describe("D-58 · lint H1 ยกเว้นประตู handoff/handoff_notify", () => {
  const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "สถานะ"];
  function seedStep(): void {
    seedBotLib({ stepRows: v3StepRows([{ step_id: "S1", funnel: "lead", name: "ทัก", guide: "สวัสดีค่ะ" }]) });
  }
  /** 🔴 D-68: lint ไม่ block → ไหลถึง guard เขียน (throw) · lint block → คืน {status:"lint"} ไม่ throw
   *  ใช้ throw เป็นตัวพิสูจน์ว่า "เขียนได้" เหมือนเดิม (ความหมายเดิมเป๊ะ · เขียนชีต v3 ยังปิดอยู่) */
  const expectLintPassed = (pr: Promise<unknown>) => expect(pr).rejects.toThrow(/ยังเขียนชีต v3 ไม่ได้/);
  it("ประตู handoff_notify: คำสุขภาพในคำตอบ → ไม่ block (เขียนได้)", async () => {
    seedStep();
    await expectLintPassed(appendRow("CSV_Step", { step_id: "H1", funnel_stage: "handoff_notify", ชื่อประตู: "สุขภาพ", ตัวอย่างคำตอบ: "สินค้ามีส่วนผสมปลาค่ะ หากแพ้อาหารแนะนำปรึกษาแพทย์", สถานะ: "" }));
  });
  it("ประตู handoff_notify: วลีรับรอง 'ทานได้' → warn (ไม่ block · ยังเขียนได้)", async () => {
    seedStep();
    await expectLintPassed(appendRow("CSV_Step", { step_id: "H1", funnel_stage: "handoff_notify", ชื่อประตู: "สุขภาพ", ตัวอย่างคำตอบ: "แพ้กุ้งก็ทานได้ค่ะ", สถานะ: "" }));
  });
  it("🔴 ประตูปกติ (lead): คำสุขภาพในคำตอบไม่ handoff → block (ไม่ยกเว้น)", async () => {
    seedStep();
    const res = await appendRow("CSV_Step", { step_id: "S9", funnel_stage: "lead", ชื่อประตู: "x", ตัวอย่างคำตอบ: "แพ้กุ้งทานได้เลยค่ะ", สถานะ: "" });
    expect(res.status).toBe("lint");
  });
});

// ---------- 🔴 prod กรอง draft · ห้องซ้อมเห็น draft ผ่าน overlay (ใช้ matcher prod จริง) ----------
describe("T2-ค · draft: prod ทิ้ง · sandbox เห็น (overlay สถานะ→live)", () => {
  const rows = [
    FAQ_H,
    ["โปรวันนี้มีไหม", "โปรวันนี้", "answer", "วันนี้มีโปรพิเศษค่ะ", "draft"],
  ];
  it("🔴 prod: buildFaqInjection ไม่เสิร์ฟแถว draft", () => {
    const prod = buildFaqInjection(rows, "โปรวันนี้มีไหม");
    expect(prod.verbatim, "draft ถูกกรองทิ้งฝั่ง prod").toBeNull();
  });
  it("🔴 sandbox: overlay สถานะ→live → matcher เดียวกันเสิร์ฟแถวนั้น", () => {
    const flipped = applyOverlayToTab("CSV_FAQ", rows, [{ tab: "CSV_FAQ", key: "โปรวันนี้มีไหม", column: "สถานะ", value: "live" }]);
    const sandbox = buildFaqInjection(flipped, "โปรวันนี้มีไหม");
    expect(sandbox.verbatim?.answer).toBe("วันนี้มีโปรพิเศษค่ะ");
  });
});
