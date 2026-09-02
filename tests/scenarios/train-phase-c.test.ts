import { describe, it, expect, beforeAll } from "vitest";
import { sheetsCalls } from "../harness/state";
import { seedBotLib, v3StepRows, TAB } from "../harness/botlib-fixture";
import { diffCell, writeCell } from "@/lib/train/write";
import { loadBotLibrary, loadRawSheets } from "@/lib/sheets/loader";
import { patternFromColumns } from "@/lib/train/preview";
import { v3KnowRows } from "../harness/botlib-fixture";

/**
 * T-STUDIO เฟส ค — เขียนกลับชีต: target ด้วย key+header · conflict กัน · TRAIN_LOG จด · Orders บล็อก · lint gate
 * 🔴 write.ts รันนอก sandbox → getSheets() = mock (real client path) · ไม่แตะ Orders
 * 🔴 D-72b: พิกัดมาจาก "แถวดิบตามชีต" (loadRawSheets) — คอลัมน์ที่แก้ได้ = ชื่อจริงบนชีต
 *    (สาระที่ต้องสื่อ/แนวตอบ ของ Steps · ไม่ใช่ "ตัวอย่างคำตอบ" ของ shape ที่ normalize แล้ว)
 */

/** seed "ชีตดิบ v3" ผ่านเส้นทางเดียวกับ prod (loader → normalizeBundle) */
function steps(): string[][] {
  return v3StepRows([
    { step_id: "S1", essence: "แนะนำโปร 3 ถ้วย", guide: "สวัสดีค่ะ" },
    { step_id: "S2", essence: "ชวนเลือกช่องทางจ่าย", guide: "รับออเดอร์แล้วค่ะ" },
  ]);
}

beforeAll(() => {
  process.env.DATABASE_URL_TRAIN = process.env.DATABASE_URL;
  process.env.TRAIN_PASSWORD = "test-train-pass";
});

describe("🔴 D-72b · เขียนกลับชีตได้แล้ว — A1 ชี้พิกัด 'ชีตดิบ' เป๊ะ (ถูกแท็บ ถูกแถว ถูกคอลัมน์)", () => {
  // V3_STEP_HEADER: step_id(A) funnel_stage(B) ชื่อประตู(C) เข้าเมื่อ(D) สาระที่ต้องสื่อ(E)
  //                 ต้องได้อะไรถึงไปต่อ(F) ไปประตูไหน(G) แนวตอบ(H) handoff(I) สถานะ(J)
  it("writeCell Steps `สาระที่ต้องสื่อ` ของ S2 → batchUpdate ที่ Steps!E3 + TRAIN_LOG 1 แถว", async () => {
    seedBotLib({ stepRows: steps() });
    sheetsCalls.batchUpdates.length = 0;
    sheetsCalls.appends.length = 0;
    const res = await writeCell("Steps", "S2", "สาระที่ต้องสื่อ", "ชวนโอนหรือ COD", "ชวนเลือกช่องทางจ่าย");
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.range, "S2 = แถว 3 ของชีตดิบ · สาระที่ต้องสื่อ = คอลัมน์ E").toBe("Steps!E3");
    expect(sheetsCalls.batchUpdates).toHaveLength(1);
    expect(sheetsCalls.batchUpdates[0]).toEqual({ range: "Steps!E3", values: [["ชวนโอนหรือ COD"]] });
    expect(sheetsCalls.appends, "TRAIN_LOG จดการแก้").toHaveLength(1);
    expect(sheetsCalls.appends[0].range).toContain("TRAIN_LOG");
  });

  it("writeCell Steps `แนวตอบ` (คอลัมน์ที่ไม่เข้า prompt — แก้ได้ แต่พิกัดต้องเป็น H ของชีตดิบ)", async () => {
    seedBotLib({ stepRows: steps() });
    sheetsCalls.batchUpdates.length = 0;
    const res = await writeCell("Steps", "S1", "แนวตอบ", "สวัสดีจ้า", "สวัสดีค่ะ");
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.range).toBe("Steps!H2");
  });

  // V3_KNOW_HEADER: ลูกค้าพูดยังไง(A) keyword(B) ความกังวลจริง(C) ข้อเท็จจริง/สิ่งที่อยากให้รู้(D) แนวตอบ(E) สถานะ(F)
  it("🔴 Knowledge: เขียน `ข้อเท็จจริง` แถวที่ normalize เคยยุบ 3 คอลัมน์ → แตะ D2 เซลล์เดียว คอลัมน์อื่นไม่โดนทับ", async () => {
    seedBotLib(); // default: แถว "ส่งกี่วัน" (fact = "1-2 วันค่ะ")
    sheetsCalls.batchUpdates.length = 0;
    const res = await writeCell("Knowledge", "ส่งกี่วัน", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "ปกติ 1-2 วันค่ะ ช่วงเทศกาลอาจ 3 วัน", "1-2 วันค่ะ");
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.range, "ข้อเท็จจริง = คอลัมน์ D ของชีตดิบ (ไม่ใช่ 'คำตอบ' ของ shape)").toBe("Knowledge!D2");
    expect(sheetsCalls.batchUpdates, "🔴 เซลล์เดียวเท่านั้น — ความกังวลจริง/แนวตอบ/keyword ห้ามโดนแตะ").toHaveLength(1);
    expect(sheetsCalls.batchUpdates[0].values).toEqual([["ปกติ 1-2 วันค่ะ ช่วงเทศกาลอาจ 3 วัน"]]);
  });

  it("🔴 Knowledge: แก้ `keyword` ได้ (เจ้าของเคาะ D-72b — บั๊ก K018 'ถ้วยแตก' ต้องแก้จากหน้าเทรนได้)", async () => {
    seedBotLib();
    sheetsCalls.batchUpdates.length = 0;
    const res = await writeCell("Knowledge", "ส่งกี่วัน", "keyword", "ส่งกี่วัน,กี่วันถึง,นานไหม", "ส่งกี่วัน");
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.range).toBe("Knowledge!B2");
  });

  // Vars header: ตัวแปร(A) ค่า(B) หมายเหตุ(C) สถานะ(D)
  it("Vars: เขียน `ค่า` → Vars!B2", async () => {
    seedBotLib();
    sheetsCalls.batchUpdates.length = 0;
    const res = await writeCell("Vars", "{สัดส่วนปลาทู}", "ค่า", "เนื้อปลาทู 47%", "เนื้อปลาทู 45%");
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.range).toBe("Vars!B2");
  });
});

describe("เฟส ค · กันชนกัน (conflict)", () => {
  it("🔴 expectedOld ไม่ตรงค่าจริงในชีต → conflict + คืนค่าจริง · ไม่เขียน", async () => {
    seedBotLib({ stepRows: steps() });
    const before = sheetsCalls.batchUpdates.length;
    const res = await writeCell("Steps", "S2", "สาระที่ต้องสื่อ", "ใหม่", "ค่าที่คนอื่นแก้ไปแล้ว");
    expect(res.status).toBe("conflict");
    if (res.status === "conflict") expect(res.current).toBe("ชวนเลือกช่องทางจ่าย");
    expect(sheetsCalls.batchUpdates.length, "ไม่เขียนทับ").toBe(before);
  });
});

describe("เฟส ค · hard guard — ห้ามแตะ Orders / แท็บนอก BotLibrary", () => {
  it("🔴 tab นอก editable (Orders) → throw ไม่เขียน", async () => {
    seedBotLib({ stepRows: steps() });
    await expect(writeCell("Orders", "x", "ยอดเงิน", "9", "")).rejects.toThrow(/เขียนไม่ได้|Orders/);
    await expect(diffCell("Orders", "x", "ยอดเงิน")).rejects.toThrow();
  });
  it("คอลัมน์นอก whitelist ของแท็บ → throw (รวมชื่อ shape เก่า 'ตัวอย่างคำตอบ' ที่ไม่มีบนชีตจริง)", async () => {
    seedBotLib({ stepRows: steps() });
    await expect(writeCell("Steps", "S1", "step_id", "hack", "S1")).rejects.toThrow(/แก้ไม่ได้/);
    await expect(writeCell("Steps", "S1", "ตัวอย่างคำตอบ", "x", "สวัสดีค่ะ"), "ชื่อคอลัมน์ของ shape ภายใน ≠ ชีต — ต้องปฏิเสธ ไม่ใช่เขียนผิดช่อง").rejects.toThrow(/แก้ไม่ได้/);
  });
});

describe("เฟส ค · lint gate ฝั่ง server (ไม่เชื่อ client)", () => {
  it("🔴 ค่าใหม่มีราคานอกระบบ/ตัวแปรผิด → status lint · ไม่เขียน", async () => {
    seedBotLib({ stepRows: steps() });
    const before = sheetsCalls.batchUpdates.length;
    const res = await writeCell("Steps", "S1", "สาระที่ต้องสื่อ", "พิเศษ 999 บาท {ตัวแปรมั่ว}", "แนะนำโปร 3 ถ้วย");
    expect(res.status).toBe("lint");
    if (res.status === "lint") expect(res.lint.some((f) => f.level === "block")).toBe(true);
    expect(sheetsCalls.batchUpdates.length, "lint block = ไม่เขียน").toBe(before);
  });
});

describe("เฟส ค · diffCell อ่านค่าปัจจุบันสด", () => {
  it("คืนค่าเก่าจริงในชีต + exists (คอลัมน์ดิบตามชีต)", async () => {
    seedBotLib({ stepRows: steps() });
    const d = await diffCell("Steps", "S2", "แนวตอบ");
    expect(d.exists).toBe(true);
    expect(d.old).toBe("รับออเดอร์แล้วค่ะ");
    const d2 = await diffCell("Steps", "S1", "สาระที่ต้องสื่อ");
    expect(d2.old).toBe("แนะนำโปร 3 ถ้วย");
  });

  it("🔴 เฟส ง bug fix: diffCell อ่านสดเสมอ (bypass cache) — เปิด editor หลังชีตเปลี่ยนเห็นค่าล่าสุด", async () => {
    seedBotLib({ stepRows: steps() });
    await loadBotLibrary(); // ทำให้มี cache ค่าเดิม
    // จำลอง: เจ้าของแก้ชีต (หรือเพิ่งเขียนผ่าน T-STUDIO) → ชีตเป็นค่าใหม่
    sheetsCalls.botLibReturn[TAB.steps] = v3StepRows([
      { step_id: "S1", essence: "แนะนำโปร 3 ถ้วย", guide: "สวัสดีค่ะ (แก้ในชีตแล้ว)" },
      { step_id: "S2", essence: "ชวนเลือกช่องทางจ่าย", guide: "รับออเดอร์แล้วค่ะ" },
    ]);
    const d = await diffCell("Steps", "S1", "แนวตอบ");
    expect(d.old, "reset cache ก่อนอ่าน → ค่าล่าสุด ไม่ใช่ cache เก่า (client ใช้ตอนเปิด editor)").toBe("สวัสดีค่ะ (แก้ในชีตแล้ว)");
  });
});

describe("🔴 D-72b · สองมุมมองจาก batchGet เดียวกัน — raw ดิบเป๊ะ · bundle normalize แล้ว", () => {
  it("raw = แถวดิบตามชีตทุกตัวอักษร (สถานะว่างยังว่าง) · bundle เติม draft ให้ (invariant ว่าง=draft D-61.B)", async () => {
    seedBotLib({ knowRows: v3KnowRows([{ say: "แถวสถานะว่าง", keyword: "ว่าง", fact: "ข้อมูล", status: "" }]) });
    const [raw, lib] = await Promise.all([loadRawSheets(), loadBotLibrary()]);
    const rawRow = raw!.Knowledge[1];
    expect(rawRow[raw!.Knowledge[0].indexOf("สถานะ")], "raw: ค่าว่างต้องยังว่าง (Studio เห็นชีตจริง)").toBe("");
    const bRow = lib!.Knowledge[1];
    expect(bRow[lib!.Knowledge[0].indexOf("สถานะ")], "bundle: ว่าง=draft (ฝั่งบอทห้ามเห็นค่าว่าง)").toBe("draft");
  });

  it("🔴 แหล่งเดียว: patternFromColumns(Knowledge) จากคอลัมน์ดิบ === ก้อน `คำตอบ` ที่ normalize เข้า prompt", async () => {
    seedBotLib({ knowRows: v3KnowRows([{ say: "กลัวเค็ม", keyword: "เค็ม", concern: "กลัวเค็มเกิน", fact: "โซเดียมต่อถ้วย 120mg", guide: "ชวนลองถ้วยเดียวก่อน" }]) });
    const [raw, lib] = await Promise.all([loadRawSheets(), loadBotLibrary()]);
    const header = raw!.Knowledge[0];
    const cols = Object.fromEntries(header.map((h, i) => [h, raw!.Knowledge[1][i] ?? ""]));
    const fromStudio = patternFromColumns("Knowledge", cols);
    const answerIdx = lib!.Knowledge[0].indexOf("คำตอบ");
    expect(fromStudio, "Studio กับ normalize ต้องประกอบก้อนเดียวกันเป๊ะ (composeKnowledgeAnswer แหล่งเดียว)").toBe(lib!.Knowledge[1][answerIdx]);
    expect(fromStudio).toContain("ความกังวลจริง: กลัวเค็มเกิน");
    expect(fromStudio).toContain("ข้อเท็จจริง: โซเดียมต่อถ้วย 120mg");
    expect(fromStudio).toContain("แนวตอบ (ปรับตามบริบท): ชวนลองถ้วยเดียวก่อน");
  });
});
