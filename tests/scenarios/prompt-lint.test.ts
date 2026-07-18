import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 🔴 KI-03 guard (เกิด 4 ครั้ง = ต้องมี tooling ไม่ใช่ discipline)
 *
 * prompt/system.ts เป็น template literal ก้อนใหญ่ (` ... `) — เขียน backtick ในเนื้อ prompt
 * (เช่น markdown code `order_data`) = ปิด template literal กลางคัน → build พัง และ error
 * ชี้ไปไฟล์ที่ import (lib/gemini.ts) ไม่ใช่ไฟล์ที่ผิด → ตามหายาก เสียเวลาทุกครั้ง
 *
 * guard นี้อ่าน source ตรง ๆ (ไม่ import ไม่ผ่าน build) → จับได้เร็ว + ชี้บรรทัดที่ผิดชัด
 * backtick ที่อนุญาต = template delimiter เท่านั้น (บรรทัด `return \`` หรือ `\`;`)
 * backtick อื่น = อยู่ในเนื้อ prompt = บั๊ก (ใช้ '...' หรือ <...> แทน)
 */
describe("prompt/system.ts — ห้าม backtick ในเนื้อ prompt (KI-03)", () => {
  it("backtick ทุกตัวต้องเป็น template delimiter เท่านั้น", () => {
    const src = readFileSync(resolve(process.cwd(), "prompt/system.ts"), "utf8");
    const suspicious: string[] = [];

    src.split("\n").forEach((line, i) => {
      if (!line.includes("`")) return;
      const isOpen = /return\s+`/.test(line); // return `<...>  หรือ  return `${...}
      const isClose = /`\s*;/.test(line); //  ...>`;  หรือ  ...}`;
      if (isOpen || isClose) return;
      suspicious.push(`  บรรทัด ${i + 1}: ${line.trim().slice(0, 90)}`);
    });

    expect(
      suspicious,
      `เจอ backtick ในเนื้อ prompt (จะปิด template literal ทำ build พัง) — เปลี่ยนเป็น '...' หรือ <...>:\n${suspicious.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * 🔴 กันถอยหลัง bug A (นิยาม order_data ขัดกันเอง)
 *
 * รากของ bug A: บล็อกเคยประกาศ "ข้อมูลครบ = ครบ 3 อย่าง (ชื่อ/ที่อยู่/เบอร์)" อย่างเด่น
 * → โมเดลเข้าใจ order_data = ฟอร์มจัดส่ง เลยไม่เคยใส่ สินค้า/จำนวน/ยอด
 * แก้โดยเปลี่ยนชื่อเป็น "ข้อมูลจัดส่งครบ" + แยกจาก "order_data ครบ 6 ช่อง"
 * เทสนี้กันไม่ให้คำนิยามกำกวมแบบเดิมกลับมา
 */
describe("prompt/system.ts — นิยาม 'ครบ' ต้องไม่กำกวม (กันถอยหลัง bug A)", () => {
  const src = readFileSync(resolve(process.cwd(), "prompt/system.ts"), "utf8");

  it("ห้ามมีนิยาม 'ข้อมูลครบ = 3' หรือ 'ครบ(ทั้ง) 3 อย่าง' (ทำให้ order_data ถูกมองเป็นฟอร์มจัดส่ง)", () => {
    const banned = [/ข้อมูลครบ["']?\s*=\s*ครบ\s*3/, /ครบ\s*3\s*อย่าง/, /ครบทั้ง\s*3\s*อย่าง/];
    const hits = banned.filter((re) => re.test(src)).map((re) => re.source);
    expect(hits, `เจอนิยาม 'ครบ 3' กำกวม — ใช้ "ข้อมูลจัดส่งครบ" (3 ช่องผู้รับ) แยกจาก "order_data ครบ 6 ช่อง":\n${hits.join("\n")}`).toEqual([]);
  });

  it("ยังต้องมีนิยาม order_data ครบ 6 ช่อง (สินค้า/จำนวน/ยอด สำคัญเท่า ชื่อ/ที่อยู่/เบอร์)", () => {
    expect(src, "หายไปจะทำ bug A กลับมา").toMatch(/order_data ครบทั้ง 6 ช่อง|6 ช่อง สำคัญเท่ากันหมด/);
  });
});
