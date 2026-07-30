import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sheetsCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { appendRow, setRowStatus, listTabRows, suggestNextKey } from "@/lib/train/write";
import { lintPattern } from "@/lib/train/lint";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { getConfig } from "@/lib/config";
import { buildFaqInjection, VALID_FUNNEL_STAGES } from "@/lib/agent/inject";
import { applyOverlayToTab } from "@/lib/train/sandbox";

/**
 * T2-ค — จัดการแถวคลังความรู้จากเว็บ (add-row draft-forced · status live↔draft · lint H1 · sandbox draft-preview)
 * 🔴 หัวใจความปลอดภัย: (1) แถวใหม่ = draft เสมอ (ไม่มีคอลัมน์สถานะ=ปฏิเสธ) (2) prod กรอง draft ทิ้ง ·
 *    ห้องซ้อมเห็น draft ผ่าน overlay สถานะ→live (3) คำสุขภาพ (H1) block เว้นคำตอบเป็นการส่งต่อ
 */

const FAQ_H = ["คำถาม", "keywords", "action", "คำตอบ", "สถานะ"];
function faq(rows: string[][]): void {
  seedBotLib();
  sheetsCalls.botLibReturn.CSV_FAQ = [FAQ_H, ...rows];
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
    faq([["ส่งกี่วัน", "ส่งกี่วัน", "answer", "1-2 วันค่ะ", "live"]]);
    const res = await appendRow("CSV_FAQ", { คำถาม: "ส่งเสาร์อาทิตย์ไหม", keywords: "เสาร์", action: "answer", คำตอบ: "ส่งทุกวันค่ะ", สถานะ: "live" });
    expect(res.status).toBe("ok");
    const app = sheetsCalls.appends.filter((a) => a.range.startsWith("CSV_FAQ")).pop();
    expect(app, "append ลง CSV_FAQ").toBeTruthy();
    expect(app!.values[0][FAQ_H.indexOf("สถานะ")], "บังคับ draft แม้ส่ง live มา").toBe("draft");
    expect(app!.values[0][FAQ_H.indexOf("คำถาม")]).toBe("ส่งเสาร์อาทิตย์ไหม");
  });

  it("🔴 แท็บไม่มีคอลัมน์สถานะ → ปฏิเสธ (no_status_col · ไม่ append) — กันแถวใหม่ live ทันที", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn.CSV_FAQ = [["คำถาม", "keywords", "action", "คำตอบ"], ["ส่งกี่วัน", "ส่ง", "answer", "1-2 วันค่ะ"]];
    const before = sheetsCalls.appends.length;
    const res = await appendRow("CSV_FAQ", { คำถาม: "ใหม่", keywords: "ใหม่", action: "answer", คำตอบ: "ค่ะ" });
    expect(res.status).toBe("no_status_col");
    expect(sheetsCalls.appends.length, "ไม่เขียน").toBe(before);
  });

  it("key ซ้ำ → dup (ไม่ append)", async () => {
    faq([["ส่งกี่วัน", "ส่ง", "answer", "1-2 วันค่ะ", "live"]]);
    const before = sheetsCalls.appends.length;
    const res = await appendRow("CSV_FAQ", { คำถาม: "ส่งกี่วัน", keywords: "ส่ง", action: "answer", คำตอบ: "ซ้ำ", สถานะ: "" });
    expect(res.status).toBe("dup");
    expect(sheetsCalls.appends.length).toBe(before);
  });

  it("🔴 H1 คำสุขภาพในคำตอบ → lint (ไม่ append) · แต่ถ้าส่งต่อ → ok", async () => {
    faq([["x", "x", "answer", "y", "live"]]);
    const blocked = await appendRow("CSV_FAQ", { คำถาม: "แพ้กุ้งทานได้ไหม", keywords: "แพ้กุ้ง", action: "answer", คำตอบ: "ทานได้ค่ะ ไม่เป็นไร" });
    expect(blocked.status).toBe("lint");
    const ok = await appendRow("CSV_FAQ", { คำถาม: "แพ้กุ้งทานได้ไหม", keywords: "แพ้กุ้ง", action: "answer", คำตอบ: "เรื่องแพ้อาหารขอส่งต่อให้แอดมินดูแลนะคะ" });
    expect(ok.status, "ตอบด้วยการส่งต่อ = เขียนได้").toBe("ok");
  });

  it("Vars key ไม่มีปีกกา → key_invalid", async () => {
    seedBotLib();
    sheetsCalls.botLibReturn.CSV_Vars = [["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"], ["{มีอยู่}", "x", "", "live"]];
    const res = await appendRow("CSV_Vars", { ตัวแปร: "ไม่มีปีกกา", ค่า: "abc", สถานะ: "" });
    expect(res.status).toBe("key_invalid");
  });

  it("🔴 Step funnel_stage ผิด enum → funnel (ไม่ append) · ถูก enum → ok", async () => {
    const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "สถานะ"];
    seedBotLib();
    sheetsCalls.botLibReturn.CSV_Step = [STEP_H, ["S1", VALID_FUNNEL_STAGES[0], "ทักทาย", "สวัสดีค่ะ", "", "live"]];
    const bad = await appendRow("CSV_Step", { step_id: "S9", funnel_stage: "ไม่ใช่สเตจ", ชื่อประตู: "x", ตัวอย่างคำตอบ: "hi", สถานะ: "" });
    expect(bad.status).toBe("funnel");
    seedBotLib();
    sheetsCalls.botLibReturn.CSV_Step = [STEP_H, ["S1", VALID_FUNNEL_STAGES[0], "ทักทาย", "สวัสดีค่ะ", "", "live"]];
    const good = await appendRow("CSV_Step", { step_id: "S9", funnel_stage: VALID_FUNNEL_STAGES[1], ชื่อประตู: "x", ตัวอย่างคำตอบ: "สวัสดีจ้า", สถานะ: "" });
    expect(good.status).toBe("ok");
  });
});

// ---------- status live↔draft (soft delete) ----------
describe("T2-ค · setRowStatus (soft delete · TRAIN_LOG action)", () => {
  it("draft → live: เขียนเซลล์สถานะ + TRAIN_LOG action=status-change", async () => {
    faq([["ส่งกี่วัน", "ส่ง", "answer", "1-2 วันค่ะ", "draft"]]);
    const res = await setRowStatus("CSV_FAQ", "ส่งกี่วัน", "live");
    expect(res.status).toBe("ok");
    const upd = sheetsCalls.batchUpdates.pop();
    expect(upd!.values[0][0]).toBe("live");
    const log = sheetsCalls.appends.filter((a) => a.range.startsWith("TRAIN_LOG")).pop();
    expect(log!.values[log!.values.length - 1][6], "action = status-change").toBe("status-change");
  });
});

// ---------- list + suggest ----------
describe("T2-ค · listTabRows + suggestNextKey", () => {
  it("list ข้ามแถว key ว่าง (หมายเหตุ) · active flag ตรง", async () => {
    faq([
      ["ส่งกี่วัน", "ส่ง", "answer", "1-2 วันค่ะ", "live"],
      ["โปรวันนี้", "โปร", "answer", "มีโปรค่ะ", "draft"],
      ["", "", "", "หมายเหตุ", ""],
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

// ---------- D-58 · lint H1 exempt สำหรับประตู CSV_Step handoff/handoff_notify ----------
describe("D-58 · lint H1 ยกเว้นประตู handoff/handoff_notify", () => {
  const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "สถานะ"];
  function seedStep(): void {
    seedBotLib();
    sheetsCalls.botLibReturn.CSV_Step = [STEP_H, ["S1", "lead", "ทัก", "สวัสดีค่ะ", "", "live"]];
  }
  it("ประตู handoff_notify: คำสุขภาพในคำตอบ → ไม่ block (เขียนได้)", async () => {
    seedStep();
    const res = await appendRow("CSV_Step", { step_id: "H1", funnel_stage: "handoff_notify", ชื่อประตู: "สุขภาพ", ตัวอย่างคำตอบ: "สินค้ามีส่วนผสมปลาค่ะ หากแพ้อาหารแนะนำปรึกษาแพทย์", สถานะ: "" });
    expect(res.status).toBe("ok");
  });
  it("ประตู handoff_notify: วลีรับรอง 'ทานได้' → warn (ไม่ block · ยังเขียนได้)", async () => {
    seedStep();
    const res = await appendRow("CSV_Step", { step_id: "H1", funnel_stage: "handoff_notify", ชื่อประตู: "สุขภาพ", ตัวอย่างคำตอบ: "แพ้กุ้งก็ทานได้ค่ะ", สถานะ: "" });
    expect(res.status, "assurance = warn ไม่ block").toBe("ok");
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
