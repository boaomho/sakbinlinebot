import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
import { sendText } from "../harness/replay";
import { scriptGemini, turn, lineCalls } from "../harness/state";
import { seedBotLib } from "../harness/botlib-fixture";
import { lintPattern } from "@/lib/train/lint";
import { collectDroppedBubbles } from "@/lib/train/preview";
import { buildStepInjection, buildFaqInjection } from "@/lib/agent/inject";
import { loadBotLibrary } from "@/lib/sheets/loader";
import { getConfig } from "@/lib/config";
import { sheetSchema } from "@/lib/schema-mode";

/**
 * D-67 · ปลดล็อกตัวแปรรูปในโหมด v3 — CSV_Vars = คลังรูป ตั้งชื่อเองได้
 * ครอบ: (1) [[รูป:{ชื่อตั้งเอง}]] จาก CSV_Vars → บอลลูนรูปจริง (2) ชนชื่อระบบ → ระบบชนะ + lint เตือน
 * (3) URL resolve ไม่ได้ → log event `image-dropped` + ห้องซ้อมโชว์บอลลูนขีดฆ่า (4) แถว live ค่าว่าง → lint เตือน
 * (5) token เข้า prompt ได้ทั้งจากเส้นทางขาย (สาระที่ต้องสื่อ) และแท็บความรู้ (คำตอบ)
 * โหมด v3 เฉพาะไฟล์นี้ (afterAll คืน v2 — sentinel v2-frozen ของชุดเทสที่เหลือ)
 */

const IMG_URL = "https://blob.test/skb-promo.jpg";

/** CSV_Vars ที่มี: ตัวแปรรูปตั้งชื่อเอง · แถวชนชื่อระบบ · แถว live ค่าว่าง */
function varsFixture(): string[][] {
  return [
    ["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"],
    ["{รูปโปรทดสอบ}", IMG_URL, "คลังรูป D-67", "live"],
    ["{สัดส่วนปลาทู}", "เนื้อปลาทู 45%", "", "live"],
    ["{ยอดรวม}", "999", "🔴 ชนตัวแปรระบบ — ระบบต้องชนะ", "live"],
    ["{รูปยังไม่พร้อม}", "", "live แต่ค่าว่าง", "live"],
  ];
}

beforeAll(() => {
  process.env.SHEET_SCHEMA = "v3";
  expect(sheetSchema()).toBe("v3");
});
afterAll(() => {
  delete process.env.SHEET_SCHEMA; // 🔴 คืน v2 ให้ไฟล์เทสอื่นทั้ง repo
});
beforeEach(() => seedBotLib({ varsRows: varsFixture() }));

const U = "U" + "d67".padEnd(32, "0");

function messagesOut(): { type: string; url?: string; text?: string }[] {
  return lineCalls.replies.flatMap((r) => r.messages).map((m) => {
    const mm = m as { type: string; originalContentUrl?: string; text?: string };
    return { type: mm.type, url: mm.originalContentUrl, text: mm.text };
  });
}

describe("D-67 · [[รูป:{ตัวแปรตั้งเอง}]] จาก CSV_Vars → บอลลูนรูปจริง (v3)", () => {
  it("โมเดล copy token → resolver แทน URL → ลูกค้าได้บอลลูนรูป + ข้อความปิดท้าย", async () => {
    scriptGemini([turn({ reply: "รายละเอียดค่ะ[[เว้น]][[รูป:{รูปโปรทดสอบ}]][[เว้น]]รับโปรไหนดีคะ", stage: "S2" })]);
    await sendText(U, "สนใจค่ะ");
    const out = messagesOut();
    const img = out.find((m) => m.type === "image");
    expect(img, "ต้องมีบอลลูนรูป").toBeTruthy();
    expect(img?.url, "URL ต้องมาจาก CSV_Vars").toBe(IMG_URL);
    expect(out[out.length - 1].type, "ปิดท้ายด้วยข้อความ").toBe("text");
    expect(JSON.stringify(out), "token ต้องไม่ค้างดิบ").not.toContain("{รูปโปรทดสอบ}");
  });

  it("🔴 ชื่อชนตัวแปรระบบ ({ยอดรวม}) → ค่าระบบชนะ ค่าชีต (999) ต้องไม่โผล่", async () => {
    scriptGemini([turn({ reply: "ยอดรวม {ยอดรวม} บาทค่ะ[[เว้น]]โอนเลยไหมคะ", stage: "S3" })]);
    await sendText(U, "เอา 3 ถ้วยค่ะ");
    const all = JSON.stringify(messagesOut());
    expect(all, "ค่าจากชีต (999) ห้ามทับระบบ").not.toContain("999");
  });
});

describe("D-67 · รูปหายต้องมองเห็น — log event + ห้องซ้อมขีดฆ่า", () => {
  afterEach(() => vi.restoreAllMocks());

  it("URL resolve ไม่ได้ (token ค้าง) → ไม่ส่งรูป + log event image-dropped ครั้งเดียว", async () => {
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => warns.push(String(a[0])));
    scriptGemini([turn({ reply: "ก[[เว้น]][[รูป:{รูปที่ไม่มีจริง}]][[เว้น]]ปิดท้ายค่ะ", stage: "S2" })]);
    await sendText(U, "สนใจค่ะ");
    expect(messagesOut().some((m) => m.type === "image"), "รูปมั่วห้ามส่ง").toBe(false);
    const events = warns.filter((w) => w.includes('"image-dropped"'));
    expect(events.length, "ต้อง log ครั้งเดียว (ไม่ยิงซ้ำจากตัวนับ C6)").toBe(1);
    expect(events[0]).toContain("รูปที่ไม่มีจริง");
  });

  it("collectDroppedBubbles อ่าน event image-dropped → บอลลูนขีดฆ่า (รวม dedup + อยู่ร่วม var-guard ได้)", () => {
    const logs = [
      { scope: "line", event: "image-dropped", url: "{รูปโปรโมชั่น}", segment: "[[รูป:{รูปโปรโมชั่น}]]" },
      { scope: "line", event: "image-dropped", url: "{รูปโปรโมชั่น}", segment: "[[รูป:{รูปโปรโมชั่น}]]" }, // ซ้ำ → dedup
      { scope: "var-guard", event: "unresolved-runtime-var", before: "ยอด {ยอดรวม} บาท", dropped: ["{ยอดรวม}"] },
    ];
    const dropped = collectDroppedBubbles(logs as Record<string, unknown>[]);
    expect(dropped.length, "var-guard 1 + image 1 (dedup)").toBe(2);
    const img = dropped.find((d) => d.vars.includes("{รูปโปรโมชั่น}"));
    expect(img?.text).toContain("[[รูป:");
  });
});

describe("D-67 · lint — ชนชื่อระบบ + ค่าว่าง (warn ไม่ block)", () => {
  it("token ชนตัวแปรระบบ → warn var-collision · แนะให้เปลี่ยนชื่อ", async () => {
    const lib = (await loadBotLibrary())!;
    const f = lintPattern("ยอด {ยอดรวม} บาทค่ะ", { config: await getConfig(), lib, payment: "", now: new Date() });
    const hit = f.find((x) => x.kind === "var-collision");
    expect(hit?.level).toBe("warn");
    expect(hit?.hits).toContain("{ยอดรวม}");
    expect(f.some((x) => x.level === "block"), "collision ห้าม block").toBe(false);
  });

  it("แถว CSV_Vars เองชื่อชนระบบ (opts.varName) → warn แม้ค่าไม่ถูกใช้ในแพตเทิร์น", async () => {
    const lib = (await loadBotLibrary())!;
    const f = lintPattern("999", { config: await getConfig(), lib, payment: "", now: new Date(), varName: "{ยอดรวม}" });
    expect(f.find((x) => x.kind === "var-collision")?.hits).toContain("{ยอดรวม}");
  });

  it("แถว live ค่าว่าง → warn var-empty (เดิมเขียวทั้งที่ค้างดิบถึงลูกค้า)", async () => {
    const lib = (await loadBotLibrary())!;
    const f = lintPattern("ดูรูปค่ะ [[รูป:{รูปยังไม่พร้อม}]]", { config: await getConfig(), lib, payment: "", now: new Date() });
    const hit = f.find((x) => x.kind === "var-empty");
    expect(hit?.level).toBe("warn");
    expect(hit?.hits).toContain("{รูปยังไม่พร้อม}");
    expect(f.some((x) => x.kind === "unknown-var"), "มีแถวจริง ไม่ใช่ unknown").toBe(false);
  });

  it("ตัวแปรปกติมีค่า → ไม่มี warn ใหม่ (กัน false positive ท่วมจอ)", async () => {
    const lib = (await loadBotLibrary())!;
    const f = lintPattern("มี {สัดส่วนปลาทู} ค่ะ [[รูป:{รูปโปรทดสอบ}]] สนใจไหมคะ", { config: await getConfig(), lib, payment: "", now: new Date() });
    expect(f.filter((x) => x.kind === "var-collision" || x.kind === "var-empty")).toHaveLength(0);
  });
});

describe("D-67 · token เข้า prompt ได้ทั้งสองเส้นทาง (หลักฐานฝั่ง inject)", () => {
  const STEP_H = ["step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "ไปประตูถัดไปเมื่อ", "ต้องเก็บข้อมูล", "สาระที่ต้องสื่อ", "ตัวอย่างคำตอบ", "ตัวอย่างประโยคปิดท้าย", "สถานะ"];
  it("เส้นทางขาย: token ใน `สาระที่ต้องสื่อ` → อยู่ใน stepText ที่ยัดเข้า prompt", () => {
    // เข้าเมื่อ ต้องมีตัวอย่างในเครื่องหมายคำพูด — matchesEntry เป็น data-driven quote (inject.ts:222)
    const rows = [STEP_H, ["S2", "qualified", "แนะนำ", 'ลูกค้าพิมพ์ "สนใจ"', "ได้จำนวน", "", "ส่งรูปโปร [[รูป:{รูปโปรทดสอบ}]]", "", "", "live"]];
    const text = buildStepInjection(rows, { quoted: false, payment: "", userMessage: "สนใจค่ะ" });
    expect(text).toContain("[[รูป:{รูปโปรทดสอบ}]]");
  });
  it("แท็บความรู้: token ในคำตอบ → อยู่ใน faqText เมื่อ keyword ตรง", () => {
    const rows = [
      ["คำถาม", "keywords", "action", "คำตอบ", "สถานะ"],
      ["มีรูปโปรไหม", "โปรโมชั่น", "answer", "ส่งรูปให้ค่ะ [[รูป:{รูปโปรทดสอบ}]]", "live"],
    ];
    const inj = buildFaqInjection(rows, "ขอดูโปรโมชั่นค่ะ");
    expect(inj.text).toContain("[[รูป:{รูปโปรทดสอบ}]]");
  });
});
