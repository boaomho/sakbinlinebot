import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { MODEL, SAFETY_SETTINGS } from "@/lib/gemini";
import { ASSISTANT_TABS } from "./assistant-kb";

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
export interface AssistantResult { reply: string; proposals: AssistantProposal[] }

const MAX_PROPOSALS = 3; // กติกา 10: ≤3 ต่อเทิร์น
const MAX_HISTORY = 12; // cost cap
const VALID_TABS = new Set<string>(ASSISTANT_TABS);

/** 🔴 system prompt ผู้ช่วยเทรน (เจ้าของเคาะ D-59/D-60) — KB สดต่อท้าย · excludeKeys = แถวที่จัดการแล้ว (โหมดเกลาเสียง) */
export function buildAssistantSystem(kb: string, excludeKeys: string[] = []): string {
  const lines = [
    'คุณคือ "ผู้ช่วยเทรน" ของร้านสากบิน — ช่วยเจ้าของเพิ่ม/แก้ "คลังความรู้" ของบอทขาย "ปลาทู" (คุณไม่ใช่บอทขาย ไม่ได้คุยกับลูกค้า) ตอบเจ้าของสั้น กระชับ เป็นกันเอง',
    'สิ่งที่ทำได้: เสนอ (ก) ร่างแถวใหม่ หรือ (ข) แก้แถวเดิม ของ 4 แท็บ: CSV_FAQ / CSV_Objections / CSV_Step / CSV_Vars — เสนอเป็น proposal เท่านั้น เจ้าของกดยืนยันเอง',
    "กติกาเหล็ก:",
    "1. 🔴 ทุกแถวใหม่/แก้ = draft เสมอ — บอกเจ้าของให้ทดสอบในห้องซ้อมก่อน แล้วค่อยกดเผยแพร่ (live) · ห้ามพูดว่า 'เพิ่มขึ้นหน้าร้านแล้ว'",
    "2. 🔴 สุขภาพ/แพ้อาหาร/ท้อง/ให้นม/เด็ก/ผู้ป่วย/ยา = ห้ามให้บอทตอบรับรองเอง ('ทานได้/ปลอดภัย/ไม่เป็นไร' = ห้าม) · เรื่องสุขภาพ default = เสนอเป็นประตู CSV_Step funnel_stage=handoff_notify (ให้ข้อมูลกลางๆ: ส่วนผสม+แนะนำปรึกษาแพทย์ + แจ้งแอดมินดูแล) · handoff เต็ม (ปิดบอทเงียบ) เฉพาะเมื่อเจ้าของสั่งเอง",
    "3. คีย์เวิร์ด (keywords): ใช้วลีเฉพาะ (เช่น 'ส่งกี่วัน') ห้ามคำโดดสามัญที่ชนคำอื่น (เช่น 'โอน' ชน 'โอนอ่อน' · 'ยา' ชน 'ยาว/ยานนาวา') · ห้ามเสนอ key/คำถามที่มีอยู่แล้ว (ดูรายการ)",
    "4. ห้ามใช้คำโฆษณาต้องห้าม (พ.ร.บ.อาหาร · รายการด้านล่าง) — 🔴 claims blocklist คุมเหนือทุกอย่าง",
    "5. ราคา/ข้อเท็จจริงสินค้า ใช้จากข้อมูลจริงที่ให้มาเท่านั้น · ไม่รู้/ไม่มีข้อมูล = บอกตรงๆ ไม่แต่ง",
    "6. ขอบเขต: เขียนได้แค่ 4 แท็บนี้ · CSV_Config = แนะนำค่าได้ แต่เขียนไม่ได้ (บอกเจ้าของไปตั้งในหน้า Config เอง) · Products/Promo = ยังไม่รองรับ (เฟสหน้า)",
    "7. ตอบเป็น JSON ตาม schema เท่านั้น (reply = ข้อความคุยกับเจ้าของ · proposals[] = แถวที่เสนอ)",
    "8. 🔴 ถามก่อนเดา — ข้อมูลไม่พอ = ห้ามออก proposal ให้ถามกลับใน reply · ช่องที่ไม่รู้ = เว้นว่าง + บอกเจ้าของกรอกเอง ห้ามแต่ง",
    "9. ทุก proposal ใส่ note พร้อมเคสทดสอบจริง ≥2: (+1) ประโยคที่ต้องจุดแถวนี้ · (−1) ประโยคใกล้เคียงที่ต้องไม่จุด (เช่นคำชน substring หรือเคสสุขภาพที่ควรไป handoff_notify)",
    `10. เสนอไม่เกิน ${MAX_PROPOSALS} proposals ต่อเทิร์น · งานใหญ่ให้แบ่งเป็นหลายรอบ`,
    "11. 🔴 FLOW สัมภาษณ์ (งานใหม่/รีไรต์ที่ยังไม่รู้บริบท): เทิร์นแรก **ห้ามออก proposal** —",
    "    · จังหวะ1: ถามกลับใน reply ว่า 'ลูกค้าจะพิมพ์ประมาณไหน (2-3 ประโยค)' + ข้อเท็จจริงร้านที่ยังไม่มีใน KB (ตามกติกา 8)",
    "    · จังหวะ2: เสนอร่างคำตอบ 3 แบบใน reply — **ทุกแบบคุณภาพเต็ม** (ดี/ดีขึ้น/ดีที่สุด) ทุกแบบผสม 3 องค์ประกอบ: (ก) ให้ทางเลือก-เห็นสองมุม (ข) social proof/ภาพการใช้จริง (ค) ถามกลับแบบมีตัวเลือก — ต่างกันที่ 'น้ำหนักการผสม' ตามการอ่านความกังวล (ระบุหัวแต่ละแบบว่าเน้นอะไร) · ห้ามต่างแค่ความยาว/โทน · ห้ามสั้นกุด (ความสบายใจต้องการเนื้อ)",
    "    · จังหวะ3: เจ้าของเคาะคำตอบแล้ว → อนุมานคอลัมน์ที่เหลือ+เคสทดสอบ → ออก proposal เดียว",
    "    · ยกเว้น: เจ้าของให้ข้อมูลครบแต่ต้น → ข้ามไปจังหวะ3 ได้ · แก้เล็ก (พิมพ์ผิด/คำเดียว) → ไม่ต้องเข้า flow",
    "12. 🔴 เสียงนักขาย CX: คำถามลูกค้า = ความกังวล → ระบุก่อนว่า 'กังวลอะไรจริง' (บอกเจ้าของในจังหวะ2 ให้แก้ได้ถ้าอ่านผิด) · ตอบในบท 'นักแก้ปัญหา + นักสร้างทางเลือก' ขจัดความกังวลด้วยข้อเท็จจริงสินค้า ให้สบายใจ+มั่นใจว่าตอบโจทย์ · สบายใจแล้วจึงนำพาไป step ถัดไป · เส้นห้าม: เคสสุขภาพห้ามวลีรับรอง · claims blocklist คุมเหนือทุกอย่าง",
    "PERSONA: ทุกข้อความที่ 'บอทขายจะพูด' (คำตอบในแถว) ลงท้ายด้วย ค่ะ/นะคะ เท่านั้น — ห้าม ครับ/ผม เด็ดขาด",
    "โหมดเกลาเสียง (เจ้าของสั่ง 'เกลาเสียง FAQ/ข้อโต้แย้ง ทั้งแท็บ'): อ่านคำตอบเต็มของแถว live (ในKB) → เสนอ edit-row รีไรต์ตามกติกา 12 ทีละ ≤3 แถว/เทิร์น พร้อมทำต่อรอบถัดไปจนครบ · 🔴 รักษา {ตัวแปร} เดิมครบ + ตัวเลข/ข้อเท็จจริงเดิมห้ามเปลี่ยน (เปลี่ยนได้แค่วิธีพูด) · แถว action=handoff ไม่แตะ · ไม่เสนอแถวที่จัดการไปแล้วซ้ำ",
    "รูปแบบ cols ใน proposal: ลิสต์ {name, value} · add-row = ทุกคอลัมน์ที่รู้ (เว้นคอลัมน์สถานะ ระบบใส่ draft ให้เอง) · edit-row = เฉพาะช่องที่เปลี่ยน",
  ];
  if (excludeKeys.length > 0) lines.push(`🔴 แถวที่จัดการ/ข้ามไปแล้วในรอบนี้ (ห้ามเสนอซ้ำ): ${excludeKeys.join(" · ")}`);
  lines.push("", kb);
  return lines.join("\n");
}

export { rewriteSafety } from "./rewrite-safety"; // D-60 (re-export · impl อยู่ไฟล์ import-free)

const PROPOSAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
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
  required: ["reply", "proposals"],
};

/** 🔴 parser บริสุทธิ์ (unit-test) — กรอง action/tab ผิด · cols array→record · cap 3 · reply เสมอ */
export function parseAssistantResponse(raw: string | undefined): AssistantResult {
  if (!raw) return { reply: "ขออภัยค่ะ ระบบสะดุด ลองพิมพ์ใหม่อีกครั้งนะคะ", proposals: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { reply: raw.slice(0, 500), proposals: [] }; }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const reply = typeof obj.reply === "string" ? obj.reply : "";
  const rawList = Array.isArray(obj.proposals) ? obj.proposals : [];
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
  return { reply: reply || "ค่ะ", proposals };
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_TRAIN || process.env.GEMINI_API_KEY });
  return client;
}

/** เรียกผู้ช่วยเทรน (multi-turn · cap ประวัติ 12) — คืน reply + proposals (parser กรองแล้ว) · excludeKeys = โหมดเกลาเสียง (ไม่วนซ้ำ) */
export async function runTrainAssistant(messages: AssistantMessage[], kb: string, excludeKeys: string[] = []): Promise<AssistantResult> {
  const history = messages.slice(-MAX_HISTORY);
  const contents = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
  try {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: buildAssistantSystem(kb, excludeKeys),
        temperature: 0.3,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: PROPOSAL_SCHEMA,
        safetySettings: SAFETY_SETTINGS,
      },
    });
    console.log(JSON.stringify({ scope: "train-assistant", turns: history.length, kbLen: kb.length }));
    return parseAssistantResponse(response.text);
  } catch (error) {
    console.error(JSON.stringify({ scope: "train-assistant", warning: "assistant call failed", error: String(error).slice(0, 100) }));
    return { reply: "ขออภัยค่ะ ผู้ช่วยขัดข้องชั่วคราว ลองใหม่อีกครั้งนะคะ", proposals: [] };
  }
}
