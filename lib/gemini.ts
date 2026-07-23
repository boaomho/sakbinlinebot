import { GoogleGenAI, ThinkingLevel, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { buildStaticSystemInstruction, buildUserContent } from "@/prompt/system";
import { AppConfig, DEFAULT_REPLY } from "./config";
import { AiOrderItem } from "./core/pricing";

/**
 * order_data ที่ AI ส่งกลับ (D-20) — 3 ช่องผู้รับ + items:[{qty}] (AI ส่งแค่ qty · โค้ดใส่ sku เอง)
 * 🔴 ไม่มี ยอด/สินค้า/sku — โค้ดคิดเงิน+แมป sku ให้ (ลดภาระ AI = thinking ไม่วน)
 * ทุกช่อง optional · ลูกค้ายังไม่ให้ = ไม่ต้องส่ง (ห้ามเดา placeholder)
 */
export interface OrderDataFromAI {
  ชื่อ?: string;
  ที่อยู่?: string;
  เบอร์?: string;
  items?: AiOrderItem[];
}

const MODEL = "gemini-3.5-flash";

/**
 * safetySettings = OFF ทั้ง 5 หมวดที่ปรับได้ (D-46) — บอทรับออเดอร์: ชื่อ/ที่อยู่/เบอร์/เลขบัญชี/สลิป
 * คือเนื้องานหลัก · availability ต้องมาก่อน · หมวดพวกนี้เคยช่วยกัน (ลูกค้าด่า/เนื้อหาแรง) มีตาข่ายเราเองแล้ว
 * (H4 handoff + verbatim = AI ไม่มีปากแต่งคำเสี่ยง)
 * 🔴 PROHIBITED_CONTENT เป็น core policy ปรับไม่ได้ → ยังบล็อกได้เสมอ = ชั้น degraded (route) คือหลักประกันจริง
 */
const SAFETY_SETTINGS = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
].map((category) => ({ category, threshold: HarmBlockThreshold.OFF }));

export interface GeminiImageInput {
  mimeType: string;
  base64Data: string;
}

export interface GeminiTurnInput {
  config: AppConfig;
  configText: string;
  stepText: string;
  faqText: string;
  catalogText: string;
  objectionText: string;
  stateText: string;
  historyText: string;
  userMessage: string;
  currentStage: string;
  image?: GeminiImageInput;
}

/** ช่องทางชำระเงินที่ AI ประเมินใหม่ทุกเทิร์นจากบทสนทนาล่าสุด · "" = ยังไม่ตัดสิน */
export type PaymentMethod = "โอน" | "COD" | "";

/** เจตนาของรูปที่ลูกค้าส่งมา (AI ตีความจาก stage+บริบท) — code ลงมือเฉพาะ slip/damage */
export type ImageIntent = "slip" | "damage" | "address" | "other";

export interface GeminiTurnOutput {
  reply: string;
  stage: string;
  tagsAdd: string[];
  handoff: boolean;
  handoffReason: string;
  /** ข้อมูลจัดส่ง+รายการที่ AI จับได้เทิร์นนี้ (โค้ด merge ลง pending_order · ไม่รวมช่องทางชำระ) */
  orderData: OrderDataFromAI;
  /** ช่องทางชำระ "ล่าสุด" — AI ประเมินใหม่ทุกเทิร์น (โค้ดใช้ตัดสิน gate) */
  paymentMethod: PaymentMethod;
  /** true = ลูกค้าขอแก้ออเดอร์ที่ "บันทึกลงชีตแล้ว" (เปลี่ยนที่อยู่/COD↔โอน/เพิ่มลด/ยกเลิก) → โค้ด handoff */
  orderEditRequest: boolean;
  /** ใช้เฉพาะเทิร์นที่มีรูป · เทิร์นข้อความล้วน AI จะตอบ "other" */
  imageIntent: ImageIntent;
  /** สิ่งที่ AI อ่านได้จากรูป (สลิป: ยอด/ธนาคาร/เวลา · อื่นๆ: สรุปสั้นๆ) */
  imageNote: string;
  /** objection_id ที่ AI คิดว่าเจอ (หรือ "none") — log คู่กับ code-match หา keyword ที่ยังไม่อยู่ในชีต (D-27) */
  objectionDetected: string;
  /** true = ผลนี้มาจาก fallback (timeout/MAX_TOKENS/parse fail/error) ไม่ใช่คำตอบจริงจาก AI
   *  ใช้ให้โค้ดรู้ว่า image_intent/order ไม่น่าเชื่อ ต้องปกป้องเรื่องเงินเอง (ถือรูปเป็นสลิปไว้ก่อน) */
  degraded: boolean;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    stage: { type: Type.STRING },
    tags_add: { type: Type.ARRAY, items: { type: Type.STRING } },
    handoff: { type: Type.BOOLEAN },
    handoff_reason: { type: Type.STRING },
    order_data: {
      type: Type.OBJECT,
      properties: {
        // ผู้รับ 3 ช่อง (ก้อนดิบ ไม่แยกจังหวัด/รหัส) + items รายการสั่งซื้อ
        ชื่อ: { type: Type.STRING },
        ที่อยู่: { type: Type.STRING },
        เบอร์: { type: Type.STRING },
        // 🔴 D-20: AI ส่งแค่ qty (โค้ดใส่ sku + คิดเงินเอง · ลดภาระ AI) · หลายรายการได้
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              qty: { type: Type.NUMBER },
            },
          },
        },
      },
    },
    payment_method: { type: Type.STRING },
    order_edit_request: { type: Type.BOOLEAN },
    image_intent: { type: Type.STRING },
    image_note: { type: Type.STRING },
    objection_detected: { type: Type.STRING },
  },
  required: [
    "reply",
    "stage",
    "tags_add",
    "handoff",
    "handoff_reason",
    "order_data",
    "payment_method",
    "order_edit_request",
    "image_intent",
    "image_note",
    "objection_detected",
  ],
};

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

function fallback(stage: string): GeminiTurnOutput {
  return {
    reply: DEFAULT_REPLY,
    stage,
    tagsAdd: [],
    handoff: false,
    handoffReason: "",
    orderData: {},
    paymentMethod: "",
    orderEditRequest: false,
    imageIntent: "other",
    imageNote: "",
    objectionDetected: "none",
    degraded: true,
  };
}

function toPaymentMethod(value: unknown): PaymentMethod {
  return value === "โอน" || value === "COD" ? value : "";
}

/**
 * แปลง order_data ดิบจาก AI → OrderDataFromAI (เก็บเฉพาะช่องที่มีค่าจริง)
 * items: รับเฉพาะ {sku:string, qty:number>0} · กันของแปลก/ไม่ครบ (parse ไม่พังทั้งเทิร์น)
 */
function parseOrderData(raw: unknown): OrderDataFromAI {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  // 🔬 DIAG: raw ที่ AI ส่ง "ก่อนกรอง" — ชี้ขาดว่า AI ส่ง items มั้ย + sku ว่าง/ผิดมั้ย + เบอร์มั่วมั้ย
  //    sku = product code (ไม่ใช่ PII · log ค่าได้) · เบอร์ = อาจเป็นเบอร์จริง (PII) → log แค่ len/digits
  if (process.env.DIAG_PROMPT_TOKENS === "1") {
    const rawItems = Array.isArray(o["items"]) ? (o["items"] as unknown[]) : [];
    const phone = typeof o["เบอร์"] === "string" ? (o["เบอร์"] as string).trim() : "";
    console.log(JSON.stringify({
      scope: "gemini", event: "orderdata-raw",
      keys: Object.keys(o),
      rawItems: rawItems.map((el) => {
        const e = (el ?? {}) as Record<string, unknown>;
        return { sku: e.sku ?? null, qty: e.qty ?? null };
      }),
      phoneShape: phone ? { len: phone.length, digits: /^\d+$/.test(phone) } : null,
    }));
  }
  const out: OrderDataFromAI = {};
  if (typeof o["ชื่อ"] === "string" && o["ชื่อ"].trim()) out["ชื่อ"] = o["ชื่อ"];
  if (typeof o["ที่อยู่"] === "string" && o["ที่อยู่"].trim()) out["ที่อยู่"] = o["ที่อยู่"];
  if (typeof o["เบอร์"] === "string" && o["เบอร์"].trim()) out["เบอร์"] = o["เบอร์"];
  if (Array.isArray(o["items"])) {
    // D-20: AI ส่งแค่ qty (sku โค้ดใส่เอง) · รับเฉพาะ qty>0
    const items: AiOrderItem[] = [];
    for (const el of o["items"] as unknown[]) {
      if (!el || typeof el !== "object") continue;
      const e = el as Record<string, unknown>;
      const qty = typeof e.qty === "number" ? e.qty : Number(e.qty);
      if (Number.isFinite(qty) && qty > 0) items.push({ qty });
    }
    if (items.length > 0) out.items = items;
  }
  return out;
}

function isValidImageIntent(value: unknown): value is ImageIntent {
  return value === "slip" || value === "damage" || value === "address" || value === "other";
}

export async function runSalesTurn(input: GeminiTurnInput): Promise<GeminiTurnOutput> {
  const systemInstruction = buildStaticSystemInstruction({
    botName: input.config.botName,
    shopName: input.config.shopName,
    personaGender: input.config.personaGender,
    useEmoji: input.config.useEmoji,
  });

  const userText = buildUserContent({
    configText: input.configText,
    stepText: input.stepText,
    faqText: input.faqText,
    catalogText: input.catalogText,
    objectionText: input.objectionText,
    stateText: input.stateText,
    historyText: input.historyText,
    userMessage: input.userMessage,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [{ text: userText }];
  if (input.image) {
    parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.base64Data } });
  }

  // แยกขนาดแต่ละส่วน (char = estimate เท่านั้น) — หาว่าส่วนไหนใหญ่สุด selective ทำงานจริงมั้ย
  console.log(
    JSON.stringify({
      scope: "prompt-size",
      note: "char = estimate ไม่ใช่ token จริง (ดู prompt-tokens ถ้า DIAG_PROMPT_TOKENS=1)",
      chars: {
        system: systemInstruction.length,
        config: input.configText.length,
        step: input.stepText.length,
        faq: input.faqText.length,
        catalog: input.catalogText.length,
        state: input.stateText.length,
        history: input.historyText.length,
        grandTotal: systemInstruction.length + userText.length,
      },
    }),
  );

  // preview 200 ตัวอักษรแรก (เนื้อจากชีต ไม่ใช่ PII) — eyeball ว่าสารบัญสั้นจริง/catalog ยัดทั้งตาราง
  console.log(
    JSON.stringify({
      scope: "prompt-preview",
      step: input.stepText.slice(0, 200),
      catalog: input.catalogText.slice(0, 200),
      faq: input.faqText.slice(0, 200),
    }),
  );

  // token จริงต่อ segment (gate ด้วย env กัน N countTokens calls ทุกเทิร์นใน production ปกติ)
  // ตั้ง DIAG_PROMPT_TOKENS=1 แล้วเทส → ได้ token จริงต่อส่วน + เทียบ promptTokenCount ที่ Gemini คืน
  if (process.env.DIAG_PROMPT_TOKENS === "1") {
    const countTok = async (text: string): Promise<number> => {
      if (!text) return 0;
      try {
        const r = await getClient().models.countTokens({ model: MODEL, contents: text });
        return r.totalTokens ?? -1;
      } catch {
        return -1;
      }
    };
    const [system, config, step, faq, catalog, state, history, user] = await Promise.all([
      countTok(systemInstruction),
      countTok(input.configText),
      countTok(input.stepText),
      countTok(input.faqText),
      countTok(input.catalogText),
      countTok(input.stateText),
      countTok(input.historyText),
      countTok(input.userMessage),
    ]);
    const segmentSum = [system, config, step, faq, catalog, state, history, user].reduce((a, b) => a + Math.max(0, b), 0);
    console.log(
      JSON.stringify({
        scope: "prompt-tokens",
        real: true,
        segments: { system, config, step, faq, catalog, state, history, user },
        segmentSum,
        note: "sum ≈ promptTokenCount (ต่างเพราะ responseSchema+role overhead ที่ไม่ได้นับต่อ segment)",
      }),
    );
  }

  try {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: parts,
      config: {
        systemInstruction,
        temperature: input.config.temperature,
        maxOutputTokens: input.config.maxOutputTokens,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        safetySettings: SAFETY_SETTINGS, // D-46: OFF 5 หมวด (บอทรับ PII เป็นเนื้องาน)
      },
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    const usage = response.usageMetadata;
    // thinking+output ใช้เพดานร่วมกัน → ต้องเห็นสัดส่วนถึงจะรู้ว่าใครกิน budget
    const budget = {
      finishReason,
      maxOutputTokens: input.config.maxOutputTokens,
      thoughtsTokenCount: usage?.thoughtsTokenCount, // thinking กินเท่าไหร่
      candidatesTokenCount: usage?.candidatesTokenCount, // คำตอบจริงกินเท่าไหร่
      totalTokenCount: usage?.totalTokenCount,
      promptTokenCount: usage?.promptTokenCount, // prompt บวมมั้ย (Step/FAQ/ประวัติ)
    };

    if (finishReason === "MAX_TOKENS") {
      // ชนเพดาน = JSON ขาดกลางคัน → ห้าม parse เด็ดขาด (จะได้ค่าครึ่ง ๆ / throw)
      // ลูกค้าจะเห็น DEFAULT_REPLY ("ขัดข้อง") ซึ่งมักเกิดตอนเทิร์นสรุปออเดอร์ = เทิร์นปิดการขาย
      console.error(JSON.stringify({ scope: "gemini", warning: "MAX_TOKENS — ตอบไม่จบ ใช้ fallback", ...budget }));
      return fallback(input.currentStage);
    }

    console.log(JSON.stringify({ scope: "gemini", ...budget }));

    const text = response.text;
    if (!text) {
      // 🔬 candidates ว่าง/ไม่มี text = Gemini ไม่ผลิต output (prompt ถูกบล็อก / safety / อื่นๆ)
      //    ก่อนหน้านี้ตกลง fallback เงียบ ไม่รู้สาเหตุ — log ตัวชี้ขาด (ไม่มี PII: enum + คะแนน category)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = response as any;
      const raw = {
        blockReason: r.promptFeedback?.blockReason,
        promptSafety: r.promptFeedback?.safetyRatings,
        candidatesLen: response.candidates?.length ?? 0,
        candFinishReason: response.candidates?.[0]?.finishReason,
        candSafety: response.candidates?.[0]?.safetyRatings,
        candFinishMessage: r.candidates?.[0]?.finishMessage,
      };
      console.error(JSON.stringify({ scope: "gemini", warning: "no text — candidates ว่าง/ถูกบล็อก", ...raw, ...budget }));
      if (process.env.DIAG_PROMPT_TOKENS === "1") {
        // dump ทั้ง promptFeedback + candidate[0] (ไม่รวม content ที่อาจมี echo ข้อความลูกค้า)
        console.log(JSON.stringify({ scope: "gemini", event: "raw-empty", promptFeedback: r.promptFeedback ?? null, candidate0: r.candidates?.[0] ? { ...r.candidates[0], content: undefined } : null }));
      }
      return fallback(input.currentStage);
    }

    const parsed = JSON.parse(text);

    return {
      reply: typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : DEFAULT_REPLY,
      stage: typeof parsed.stage === "string" && parsed.stage ? parsed.stage : input.currentStage,
      tagsAdd: Array.isArray(parsed.tags_add) ? parsed.tags_add.filter((t: unknown) => typeof t === "string") : [],
      handoff: Boolean(parsed.handoff),
      handoffReason: typeof parsed.handoff_reason === "string" ? parsed.handoff_reason : "",
      orderData: parseOrderData(parsed.order_data),
      paymentMethod: toPaymentMethod(parsed.payment_method),
      orderEditRequest: Boolean(parsed.order_edit_request),
      imageIntent: isValidImageIntent(parsed.image_intent) ? parsed.image_intent : "other",
      imageNote: typeof parsed.image_note === "string" ? parsed.image_note : "",
      objectionDetected: typeof parsed.objection_detected === "string" && parsed.objection_detected.trim() ? parsed.objection_detected.trim() : "none",
      degraded: false,
    };
  } catch (error) {
    console.error(JSON.stringify({ scope: "gemini", warning: "request failed", error: String(error) }));
    return fallback(input.currentStage);
  }
}
