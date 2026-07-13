import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { buildStaticSystemInstruction, buildUserContent } from "@/prompt/system";
import { AppConfig, DEFAULT_REPLY } from "./config";

const MODEL = "gemini-3.5-flash";

export interface GeminiImageInput {
  mimeType: string;
  base64Data: string;
}

export interface GeminiTurnInput {
  config: AppConfig;
  configText: string;
  stepText: string;
  faqText: string;
  stateText: string;
  historyText: string;
  userMessage: string;
  currentStage: string;
  image?: GeminiImageInput;
}

export type OrderAction = "none" | "slip_received" | "cod_confirmed" | "address_collected";

/** เจตนาของรูปที่ลูกค้าส่งมา (AI ตีความจาก stage+บริบท) — code ลงมือเฉพาะ slip/damage */
export type ImageIntent = "slip" | "damage" | "other";

export interface GeminiTurnOutput {
  reply: string;
  stage: string;
  tagsAdd: string[];
  handoff: boolean;
  handoffReason: string;
  orderAction: OrderAction;
  orderData: Record<string, string>;
  /** ใช้เฉพาะเทิร์นที่มีรูป · เทิร์นข้อความล้วน AI จะตอบ "other" */
  imageIntent: ImageIntent;
  /** สิ่งที่ AI อ่านได้จากรูป (สลิป: ยอด/ธนาคาร/เวลา · อื่นๆ: สรุปสั้นๆ) */
  imageNote: string;
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
    order_action: { type: Type.STRING },
    order_data: {
      type: Type.OBJECT,
      properties: {
        ชื่อ: { type: Type.STRING },
        เบอร์: { type: Type.STRING },
        ที่อยู่: { type: Type.STRING },
        ตำบล: { type: Type.STRING },
        อำเภอ: { type: Type.STRING },
        จังหวัด: { type: Type.STRING },
        รหัสไปรษณีย์: { type: Type.STRING },
        สินค้า: { type: Type.STRING },
        จำนวน: { type: Type.STRING },
        ยอด: { type: Type.STRING },
        การชำระเงิน: { type: Type.STRING },
      },
    },
    image_intent: { type: Type.STRING },
    image_note: { type: Type.STRING },
  },
  required: [
    "reply",
    "stage",
    "tags_add",
    "handoff",
    "handoff_reason",
    "order_action",
    "order_data",
    "image_intent",
    "image_note",
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
    orderAction: "none",
    orderData: {},
    imageIntent: "other",
    imageNote: "",
    degraded: true,
  };
}

function isValidOrderAction(value: unknown): value is OrderAction {
  return value === "none" || value === "slip_received" || value === "cod_confirmed" || value === "address_collected";
}

function isValidImageIntent(value: unknown): value is ImageIntent {
  return value === "slip" || value === "damage" || value === "other";
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
    stateText: input.stateText,
    historyText: input.historyText,
    userMessage: input.userMessage,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [{ text: userText }];
  if (input.image) {
    parts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.base64Data } });
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
      },
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    const usage = response.usageMetadata;
    console.log(
      JSON.stringify({
        scope: "gemini",
        finishReason,
        thoughtsTokenCount: usage?.thoughtsTokenCount,
        candidatesTokenCount: usage?.candidatesTokenCount,
      }),
    );

    if (finishReason === "MAX_TOKENS") {
      return fallback(input.currentStage);
    }

    const text = response.text;
    if (!text) {
      return fallback(input.currentStage);
    }

    const parsed = JSON.parse(text);

    return {
      reply: typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : DEFAULT_REPLY,
      stage: typeof parsed.stage === "string" && parsed.stage ? parsed.stage : input.currentStage,
      tagsAdd: Array.isArray(parsed.tags_add) ? parsed.tags_add.filter((t: unknown) => typeof t === "string") : [],
      handoff: Boolean(parsed.handoff),
      handoffReason: typeof parsed.handoff_reason === "string" ? parsed.handoff_reason : "",
      orderAction: isValidOrderAction(parsed.order_action) ? parsed.order_action : "none",
      orderData:
        parsed.order_data && typeof parsed.order_data === "object" && !Array.isArray(parsed.order_data)
          ? (parsed.order_data as Record<string, string>)
          : {},
      imageIntent: isValidImageIntent(parsed.image_intent) ? parsed.image_intent : "other",
      imageNote: typeof parsed.image_note === "string" ? parsed.image_note : "",
      degraded: false,
    };
  } catch (error) {
    console.error(JSON.stringify({ scope: "gemini", warning: "request failed", error: String(error) }));
    return fallback(input.currentStage);
  }
}
