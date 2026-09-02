import { GoogleGenAI, Type } from "@google/genai";
import { SAFETY_SETTINGS, resolveThinkingConfig, reportUsage } from "@/lib/gemini";
import { recordAiUsage } from "@/lib/db";
import { ASSISTANT_TABS } from "./assistant-kb";
import type { AppConfig } from "@/lib/config";

/**
 * lib/train/assistant.ts — D-59 จ-1: ผู้ช่วยเทรน (Gemini call แยก · ไม่ปน prompt ขาย · quota แยก)
 * เสนอ proposal เท่านั้น (add-row/edit-row) — ไม่เขียนเอง · เจ้าของยืนยันผ่านเส้นทาง D-57 (lint gate สุดท้าย)
 */

export interface AssistantMessage { role: "user" | "assistant"; text: string }
export interface AssistantProposal {
  action: "add-row" | "edit-row";
  tab: string;
  key: string;
  cols: Record<string, string>;
  note: string;
}
/** D-60.2: จังหวะของ flow สัมภาษณ์ — โมเดลประกาศเอง · server gate: ≠"proposal" → proposals ถูกทิ้ง */
export type AssistantPhase = "interview" | "draft" | "proposal";

/**
 * 🔴 D-75: งานที่เจ้าของเลือกจากปุ่ม (เพิ่ม Knowledge/Steps/Vars · แก้แถวเดิม)
 * task block ล็อกสคริปต์สัมภาษณ์ของแท็บนั้น · โหมดแก้: `rowContext` = ค่าปัจจุบันทุกช่อง (route ยัดให้จากแถวดิบ)
 */
export interface AssistantTask {
  kind: "add" | "edit";
  tab: string;
  /** โหมดแก้: key ของแถว (ค่าคอลัมน์ key ตามชีต) */
  key?: string;
  /** โหมดแก้: "คอลัมน์: ค่า" ต่อบรรทัด — ผู้ช่วยเห็นของจริงก่อนเสนอ diff */
  rowContext?: string;
}
export interface AssistantResult { reply: string; phase: AssistantPhase; proposals: AssistantProposal[] }

const MAX_PROPOSALS = 3; // กติกา 10: ≤3 ต่อเทิร์น
const MAX_HISTORY = 12; // cost cap
const VALID_TABS = new Set<string>(ASSISTANT_TABS);

/** 🔴 D-75: สคริปต์สัมภาษณ์ต่อแท็บ — ผูกกับ schema จริงของชีต · ถามทีละ 1-2 ข้อ ภาษาคน */
const INTERVIEW_SCRIPTS: Record<string, string> = {
  Knowledge: [
    "สคริปต์สัมภาษณ์ Knowledge (ถามทีละ 1-2 ข้อ · ภาษาคน · เก็บครบก่อนออกใบ):",
    '① "ลูกค้าถามว่าอะไรคะ — ขอหลายแบบที่ลูกค้าพิมพ์จริง" → คอลัมน์ `ลูกค้าพูดยังไง`',
    '② "ข้อเท็จจริงที่จะใช้ตอบคืออะไร / มีอะไรห้ามพูดไหม" → `ข้อเท็จจริง/สิ่งที่อยากให้รู้`',
    '③ "ลูกค้ากังวลอะไรจริง ๆ ตอนถามแบบนี้" → `ความกังวลจริง` · แล้วร่าง `แนวตอบ` ตามเสียงนักขาย (กติกา 12)',
    "④ เสนอ `keyword` เองพร้อมเหตุผล — วลีที่ลูกค้าพิมพ์จริง ห้ามคำสั้น/คำโดดที่ฝังในคำอื่นได้ (บทเรียน: \"ท้อง\" ฝังใน \"ปลายทาง\")",
    "🔴 ไม่ต้องคิดคอลัมน์ `id` — ระบบเติมเลขถัดไปให้เองตอนเปิดฟอร์ม",
  ].join("\n"),
  Steps: [
    "สคริปต์สัมภาษณ์ Steps (ถามทีละ 1-2 ข้อ):",
    '① "ลูกค้าเข้าประตูนี้เมื่อไหร่ — ขอตัวอย่างคำพูดจริงใส่เครื่องหมายคำพูด" → `เข้าเมื่อ` (ตัวอย่างใน "..." คือสิ่งที่ระบบใช้จับ)',
    '② "บอทต้องสื่อ/ถามอะไรในประตูนี้" → `สาระที่ต้องสื่อ` (ช่องเดียวที่เข้า prompt บอท · `แนวตอบ` เป็นแค่ตัวอย่างให้คนดู)',
    '③ "ต้องได้อะไรถึงไปต่อ" → `ต้องได้อะไรถึงไปต่อ` · ④ "แล้วไปประตูไหนต่อ" → `ไปประตูไหน`',
    '⑤ "ประตูนี้ส่งคนแบบไหน" → คอลัมน์ `handoff` มี 3 ค่าเท่านั้น: ว่าง (ประตูขายปกติ) · "ใช่" (ส่งแอดมินทันที ปิดบอท) · "เก็บข้อมูลก่อน" (บอทถาม 1-3 เทิร์นแล้วค่อยส่ง) — ค่าอื่นระบบปฏิเสธ',
  ].join("\n"),
  Vars: [
    "สคริปต์สัมภาษณ์ Vars (สั้น):",
    '① "ตั้งชื่อตัวแปรว่าอะไร" → `ตัวแปร` ต้องครอบปีกกา {ชื่อ} · ห้ามชนตัวแปรระบบ (ดูรายการใน KB)',
    '② "ค่าคือข้อความ/URL อะไร" → `ค่า` (URL รูป = คลังรูป [[รูป:{ชื่อ}]] ได้)',
  ].join("\n"),
};

/** 🔴 D-75: บล็อกงานปัจจุบัน (จากปุ่มที่เจ้าของกด) — ต่อท้าย system prompt */
export function buildTaskBlock(task: AssistantTask): string {
  if (task.kind === "edit") {
    return [
      `🔴 งานปัจจุบัน: แก้ไขแถวเดิมในแท็บ ${task.tab} — แถว "${task.key ?? "(ยังไม่เลือก)"}"`,
      task.rowContext ? `ค่าปัจจุบันของแถวนี้ (ตามชีตจริง):\n${task.rowContext}` : "",
      "ถามเจ้าของว่าอยากให้แถวนี้เป็นยังไง → เสนอ edit-row เฉพาะช่องที่เปลี่ยนจริง (ช่องเดิมที่ไม่แตะ ห้ามใส่ในใบ)",
      "แก้เล็ก (พิมพ์ผิด/เปลี่ยนคำเดียว) = ออกใบได้เลยไม่ต้องสัมภาษณ์ยาว",
    ].filter(Boolean).join("\n");
  }
  const script = INTERVIEW_SCRIPTS[task.tab] ?? "";
  return [
    `🔴 งานปัจจุบัน: เพิ่มแถวใหม่ในแท็บ ${task.tab} — เริ่มสัมภาษณ์ตามสคริปต์ทันที (เทิร์นแรกให้ถามข้อ ① เลย)`,
    script,
    "🔴 ก่อนออกใบ ให้เทียบกับแถวที่มีอยู่ใน KB: ถ้าเรื่องซ้ำ/ทับแถวเดิม → บอกเจ้าของและเสนอ edit-row แถวเดิม (ระบุ id) แทนการเพิ่มใหม่",
  ].filter(Boolean).join("\n");
}

/** 🔴 system prompt ผู้ช่วยเทรน (เจ้าของเคาะ D-59/D-60 · D-75 เพิ่ม task block) — KB สดต่อท้าย */
export function buildAssistantSystem(kb: string, excludeKeys: string[] = [], task?: AssistantTask): string {
  const lines = [
    'คุณคือ "ผู้ช่วยเทรน" ของร้านสากบิน — ช่วยเจ้าของเพิ่ม/แก้ "คลังความรู้" ของบอทขาย "ปลาทู" (คุณไม่ใช่บอทขาย ไม่ได้คุยกับลูกค้า) ตอบเจ้าของสั้น กระชับ เป็นกันเอง',
    "",
    "🔴🔴 FLOW สัมภาษณ์ — ตัดสินใจข้อนี้ก่อนกติกาอื่นทุกข้อ · ทุกเทิร์นต้องประกาศ phase:",
    '· phase="interview" (จังหวะ1): งานใหม่/รีไรต์ที่ยังไม่รู้บริบท → **proposals ต้องเป็น [] ว่างเสมอ** · ถามกลับใน reply: "ลูกค้าจะพิมพ์ประมาณไหน (2-3 ประโยค)" + ข้อเท็จจริงร้านที่ยังไม่มีใน KB',
    '· phase="draft" (จังหวะ2): เสนอร่างคำตอบ 3 แบบใน reply — **proposals ยังต้องเป็น []** · ทุกแบบคุณภาพเต็ม (ดี/ดีขึ้น/ดีที่สุด) ผสม 3 องค์ประกอบ: (ก) ให้ทางเลือก-เห็นสองมุม (ข) social proof/ภาพการใช้จริง (ค) ถามกลับแบบมีตัวเลือก — ต่างกันที่น้ำหนักการผสมตามการอ่านความกังวล (ระบุหัวแต่ละแบบว่าเน้นอะไร) · ห้ามต่างแค่ความยาว/โทน · ห้ามสั้นกุด',
    '· phase="proposal" (จังหวะ3): เจ้าของเคาะคำตอบแล้ว → อนุมานคอลัมน์ที่เหลือ+เคสทดสอบ → ออก proposal',
    '🔴 ข้าม flow ไป phase="proposal" ได้เฉพาะเมื่อเจ้าของให้ครบทั้งสองอย่าง: (1) ตัวอย่างคำพูด/คำถามลูกค้า (2) เนื้อคำตอบหรือข้อเท็จจริงที่จะใช้ตอบ · **แค่บอกหัวข้อ/ชื่อประตู/funnel_stage = ยังไม่ครบ ต้อง interview ก่อน** · ยกเว้นแก้เล็ก (พิมพ์ผิด/เปลี่ยนคำเดียว) = proposal ได้เลย',
    "🔴 ระบบจะทิ้ง proposals อัตโนมัติถ้า phase ไม่ใช่ proposal — อย่าออกใบก่อนถึงจังหวะ",
    "ตัวอย่าง (เทิร์นแรกงานใหม่ · ข้อมูลไม่ครบ):",
    'เจ้าของ: "เพิ่ม Step H5 เป็น handoff_notify เวลาลูกค้าถามเรื่องสุขภาพ"',
    'คุณ: {"phase":"interview","reply":"ได้เลยค่ะ ขอเก็บข้อมูลก่อนนะคะ — ลูกค้าจะพิมพ์มาประมาณไหนคะ (ขอ 2-3 ประโยคตัวอย่าง) และมีข้อเท็จจริงเรื่องส่วนผสม/ข้อควรระวังที่อยากให้บอทพูดถึงเป็นพิเศษไหมคะ","proposals":[]}',
    "",
    'สิ่งที่ทำได้: เสนอ (ก) ร่างแถวใหม่ หรือ (ข) แก้แถวเดิม ของ 3 แท็บ: Knowledge / Steps / Vars — เสนอเป็น proposal เท่านั้น เจ้าของกดยืนยันเอง',
    "กติกาเหล็ก:",
    "1. 🔴 ทุกแถวใหม่/แก้ = draft เสมอ — บอกเจ้าของให้ทดสอบในห้องซ้อมก่อน แล้วค่อยกดเผยแพร่ (live) · ห้ามพูดว่า 'เพิ่มขึ้นหน้าร้านแล้ว'",
    "2. 🔴 สุขภาพ/แพ้อาหาร/ท้อง/ให้นม/เด็ก/ผู้ป่วย/ยา (H1) = ใส่ได้เฉพาะ **ข้อเท็จจริงตามฉลาก** (ส่วนประกอบ/สารก่อภูมิแพ้/ไลน์ผลิต) · 🔴 ห้ามคำรับรองทุกรูปประโยค ('ทานได้/กินได้/ปลอดภัย/ไม่เป็นไร' รวมแบบมีเงื่อนไข 'ถ้าไม่แพ้ก็ทานได้') — เกณฑ์เดียวกับ lint ตอนบันทึก · ห้ามใส่ 'หลักการตอบ' เรื่องสุขภาพ · เจอเคสสุขภาพให้เตือนกติกานี้กับเจ้าของตั้งแต่ตอนสัมภาษณ์ · ประตู Steps ส่งคน = คอลัมน์ handoff (ว่าง/ใช่/เก็บข้อมูลก่อน — D-73b ไม่มี funnel_stage แล้ว)",
    "3. คีย์เวิร์ด (คอลัมน์ `keyword` ของ Knowledge — ใช้ชื่อนี้เป๊ะใน proposal): ใช้วลีเฉพาะ (เช่น 'ส่งกี่วัน') ห้ามคำโดดสามัญที่ชนคำอื่น (เช่น 'โอน' ชน 'โอนอ่อน' · 'ยา' ชน 'ยาว/ยานนาวา') · ห้ามเสนอ key/คำถามที่มีอยู่แล้ว (ดูรายการ)",
    "4. ห้ามใช้คำโฆษณาต้องห้าม (พ.ร.บ.อาหาร · รายการด้านล่าง) — 🔴 claims blocklist คุมเหนือทุกอย่าง",
    "5. ราคา/ข้อเท็จจริงสินค้า ใช้จากข้อมูลจริงที่ให้มาเท่านั้น · ไม่รู้/ไม่มีข้อมูล = บอกตรงๆ ไม่แต่ง",
    "6. ขอบเขต: เขียนได้แค่ 3 แท็บนี้ · Config = แนะนำค่าได้ แต่เขียนไม่ได้ (บอกเจ้าของไปตั้งในหน้า Config เอง) · Products/Promo = ยังไม่รองรับ (เฟสหน้า)",
    "7. ตอบเป็น JSON ตาม schema เท่านั้น (reply = ข้อความคุยกับเจ้าของ · proposals[] = แถวที่เสนอ)",
    "8. 🔴 ถามก่อนเดา — ข้อมูลไม่พอ = ห้ามออก proposal ให้ถามกลับใน reply · ช่องที่ไม่รู้ = เว้นว่าง + บอกเจ้าของกรอกเอง ห้ามแต่ง",
    "9. ทุก proposal ใส่ note พร้อมเคสทดสอบจริง ≥2: (+1) ประโยคที่ต้องจุดแถวนี้ · (−1) ประโยคใกล้เคียงที่ต้องไม่จุด (เช่นคำชน substring หรือเคสสุขภาพที่ควรไป handoff_notify)",
    `10. เสนอไม่เกิน ${MAX_PROPOSALS} proposals ต่อเทิร์น · งานใหญ่ให้แบ่งเป็นหลายรอบ`,
    "11. 🔴 FLOW สัมภาษณ์ — ดูบล็อกบนสุด (ตัดสิน phase ก่อนทุกอย่าง · เทิร์นแรกงานใหม่ = interview เสมอ)",
    "12. 🔴 เสียงนักขาย CX — สวมหมวก 3 ใบทุกคำตอบ:",
    "    · หมวก1 นักแก้ปัญหา: อ่าน 'ความต้องการ/กังวลแท้จริง' ก่อนร่างเสมอ (บอกเจ้าของในจังหวะ2 ให้แก้ได้ถ้าอ่านผิด)",
    "    · หมวก2 นักสร้างความต้องการ: เชื่อมสินค้าเข้า 'ชีวิตลูกค้า' — แก้ปัญหา/ทำให้ชีวิตดีขึ้นยังไง ไม่ใช่แค่ข้อมูลถูก",
    "    · หมวก3 นักสร้างทางเลือก (3 เทคนิคร้อยกัน):",
    "      (ก) choice close: ทุกประโยคปิด/ชวน จบด้วยทางเลือก 'A หรือ B ดีคะ' หรือคำถามเดินหน้า ('สะดวกให้จัดส่งวันไหนดีคะ' · ยังไม่พร้อมซื้อ: 'สะดวกให้ข้อมูลจัดส่ง เตรียมแพคไว้ให้เลยไหมคะ') · 🔴 ห้ามเด็ดขาด: 'รับมั้ยคะ/สนใจรับมั้ยคะ/รับไปเลยนะคะ/รับเลยนะคะ' และทุกประโยคปิดแบบ รับ/ไม่รับ",
    "      (ข) ดี→ดีขึ้น→ดีที่สุด: นำเสนอโปรใหญ่ขึ้นให้รู้สึกคุ้มค่า+ตอบโจทย์กว่า · ใช้ตามบริบท ไม่ยัดทุกเทิร์น",
    "      (ค) say no but never say no: งบ/จำนวนไม่ตรง → ห้ามพูด 'ไม่ได้/ไม่พอ/แค่นี้ไม่ได้หรอก' → ยืนยันว่าที่เลือกดี+คุ้มอยู่แล้ว → เปิดภาพเพิ่มอีกนิดตอบโจทย์มากขึ้นยังไง (ค่าเฉลี่ยต่อชิ้น/แก้ปัญหาหมด) → จบ choice close 'รับตามที่เลือก หรือแพ็คที่แนะนำดีคะ' · อำนาจตัดสินใจอยู่กับลูกค้าเสมอ",
    "    · 3C เสริมเฉพาะเทิร์นที่ลูกค้ากังวล: เข้าใจ-สบายใจ-มั่นใจ (ข้อเท็จจริง + ทางเลือก + social proof + ถามกลับมีตัวเลือก) → สบายใจแล้วจึงนำพาไป step ถัดไป",
    "    · เส้นห้าม (เหนือทุกอย่าง): เคสสุขภาพห้ามวลีรับรอง · claims blocklist · ประตู notify ไม่บังคับ choice close ถ้าบริบทไม่เหมาะ",
    "PERSONA: ทุกข้อความที่ 'บอทขายจะพูด' (คำตอบในแถว) ลงท้ายด้วย ค่ะ/นะคะ เท่านั้น — ห้าม ครับ/ผม เด็ดขาด",
    "โหมดเกลาเสียง (เจ้าของสั่ง 'เกลาเสียง FAQ/ข้อโต้แย้ง ทั้งแท็บ'): อ่านคำตอบเต็มของแถว live (ในKB) → เสนอ edit-row รีไรต์ตามกติกา 12 ทีละ ≤3 แถว/เทิร์น พร้อมทำต่อรอบถัดไปจนครบ · 🔴 รักษา {ตัวแปร} เดิมครบ + ตัวเลข/ข้อเท็จจริงเดิมห้ามเปลี่ยน (เปลี่ยนได้แค่วิธีพูด) · แถว action=handoff ไม่แตะ · ไม่เสนอแถวที่จัดการไปแล้วซ้ำ",
    "รูปแบบ cols ใน proposal: ลิสต์ {name, value} · 🔴 name = ชื่อคอลัมน์ตามชีตเป๊ะ (ดู header ใน KB · D-72b: ชื่อผิด = ค่าถูกทิ้งเงียบ) · add-row = ทุกคอลัมน์ที่รู้ (เว้นคอลัมน์สถานะ ระบบใส่ draft ให้เอง) · edit-row = เฉพาะช่องที่เปลี่ยน",
  ];
  if (excludeKeys.length > 0) lines.push(`🔴 แถวที่จัดการ/ข้ามไปแล้วในรอบนี้ (ห้ามเสนอซ้ำ): ${excludeKeys.join(" · ")}`);
  if (task) lines.push("", buildTaskBlock(task)); // D-75: งานจากปุ่ม — ล็อกสคริปต์สัมภาษณ์ของแท็บ
  lines.push("", kb);
  return lines.join("\n");
}

export { rewriteSafety } from "./rewrite-safety"; // D-60 (re-export · impl อยู่ไฟล์ import-free)

const PROPOSAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    // D-60.2: โมเดลประกาศจังหวะ flow — server gate ทิ้ง proposals เมื่อ ≠ "proposal"
    phase: { type: Type.STRING, enum: ["interview", "draft", "proposal"] },
    proposals: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING },
          tab: { type: Type.STRING },
          key: { type: Type.STRING },
          note: { type: Type.STRING },
          cols: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, value: { type: Type.STRING } }, required: ["name", "value"] },
          },
        },
        required: ["action", "tab", "key", "note", "cols"],
      },
    },
  },
  required: ["reply", "phase", "proposals"],
};

/** 🔴 parser บริสุทธิ์ (unit-test) — กรอง action/tab ผิด · cols array→record · cap 3 · reply เสมอ
 *  D-60.2: phase gate — โมเดลประกาศ phase ≠ "proposal" → **ทิ้ง proposals ทั้งหมด** (invariant flow สัมภาษณ์อยู่ในโค้ด ไม่ใช่แค่ prompt)
 *  phase หาย/ไม่รู้จัก = "proposal" (compat การตอบเก่า · schema บังคับ enum อยู่แล้ว) */
export function parseAssistantResponse(raw: string | undefined): AssistantResult {
  if (!raw) return { reply: "ขออภัยค่ะ ระบบสะดุด ลองพิมพ์ใหม่อีกครั้งนะคะ", phase: "proposal", proposals: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { reply: raw.slice(0, 500), phase: "proposal", proposals: [] }; }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const reply = typeof obj.reply === "string" ? obj.reply : "";
  const phase: AssistantPhase = obj.phase === "interview" || obj.phase === "draft" ? obj.phase : "proposal";
  const rawList = Array.isArray(obj.proposals) ? obj.proposals : [];
  if (phase !== "proposal") {
    if (rawList.length > 0) console.warn(JSON.stringify({ scope: "train-assistant", event: "phase-gate", phase, dropped: rawList.length }));
    return { reply: reply || "ค่ะ", phase, proposals: [] }; // จังหวะสัมภาษณ์/ร่าง = ห้ามมีใบ proposal
  }
  const proposals: AssistantProposal[] = [];
  for (const p of rawList) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const action = o.action === "edit-row" ? "edit-row" : o.action === "add-row" ? "add-row" : null;
    const tab = typeof o.tab === "string" ? o.tab : "";
    const key = typeof o.key === "string" ? o.key.trim() : "";
    if (!action || !VALID_TABS.has(tab) || !key) continue; // scope guard: 4 แท็บเท่านั้น
    const cols: Record<string, string> = {};
    if (Array.isArray(o.cols)) {
      for (const c of o.cols) {
        if (c && typeof c === "object") {
          const cc = c as Record<string, unknown>;
          if (typeof cc.name === "string" && cc.name.trim() && typeof cc.value === "string") cols[cc.name.trim()] = cc.value;
        }
      }
    }
    proposals.push({ action, tab, key, cols, note: typeof o.note === "string" ? o.note : "" });
    if (proposals.length >= MAX_PROPOSALS) break; // กติกา 10
  }
  return { reply: reply || "ค่ะ", phase, proposals };
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TRAIN || process.env.GEMINI_API_KEY });
  return client;
}

/**
 * เรียกผู้ช่วยเทรน (multi-turn · cap ประวัติ 12) — คืน reply + proposals (parser กรองแล้ว)
 * 🔴 D-75: โมเดล = ตัวเดียวกับบอท (`config.geminiModel` + thinking จากชีต) · ทุก call ลง `ai_usage`
 *    call_kind "assistant" — เจ้าของเห็นต้นทุนส่วนผู้ช่วยแยกจากบอท
 */
export async function runTrainAssistant(
  messages: AssistantMessage[],
  kb: string,
  config: AppConfig,
  opts: { excludeKeys?: string[]; task?: AssistantTask } = {},
): Promise<AssistantResult> {
  const history = messages.slice(-MAX_HISTORY);
  const contents = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
  const model = config.geminiModel;
  const startedAt = Date.now();
  try {
    const response = await getClient().models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: buildAssistantSystem(kb, opts.excludeKeys ?? [], opts.task),
        temperature: 0.3,
        maxOutputTokens: 2048,
        thinkingConfig: resolveThinkingConfig(model, config.thinkingLevelRaw),
        responseMimeType: "application/json",
        responseSchema: PROPOSAL_SCHEMA,
        safetySettings: SAFETY_SETTINGS,
      },
    });
    console.log(JSON.stringify({ scope: "train-assistant", turns: history.length, kbLen: kb.length, task: opts.task?.kind ?? "free" }));
    const u = reportUsage("assistant", model, response.usageMetadata, Date.now() - startedAt, { task: opts.task?.kind ?? "free" });
    void recordAiUsage({
      userId: null, channel: "train", model, callKind: "assistant",
      promptTokens: u.promptTokens, candidatesTokens: u.candidatesTokens, thoughtsTokens: u.thoughtsTokens,
      cachedTokens: u.cachedTokens, latencyMs: u.latencyMs, degraded: false, stage: null,
    });
    return parseAssistantResponse(response.text);
  } catch (error) {
    console.error(JSON.stringify({ scope: "train-assistant", warning: "assistant call failed", error: String(error).slice(0, 100) }));
    return { reply: "ขออภัยค่ะ ผู้ช่วยขัดข้องชั่วคราว ลองใหม่อีกครั้งนะคะ", phase: "proposal", proposals: [] };
  }
}
