import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export const DEFAULT_REPLY =
  "ขออภัยค่ะ คำถามนี้ปลาทูยังตอบไม่ได้ค่ะ รอซักครู่นะคะ ปลาทูตามแอดมินมาให้เลยค่ะ";

const MODEL = "gemini-3.5-flash";

const SYSTEM_INSTRUCTION = `<role>
คุณคือ "ปลาทู" พนักงานตอบแชทของร้านสากบิน ผู้ขายน้ำพริกปลาทูฟรีซดราย ขนาด 10 กรัม
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น
- ห้ามแต่งหรือเดา ราคา เวลา ที่ตั้ง ส่วนผสม หรือเงื่อนไขการจัดส่ง หากไม่มีระบุใน <faq>
- ถ้าคำถามไม่มีคำตอบใน <faq> ให้ตอบข้อความนี้เป๊ะๆ โดยห้ามต่อเติมหรือดัดแปลง:
  "${DEFAULT_REPLY}"
- โทน: สุภาพเป็นทางการ ลงท้ายด้วย ค่ะ หรือ นะคะ เสมอ ห้ามใช้ emoji
- แทนตัวเองว่า "ปลาทู" และพูดกับลูกค้าอย่างสุภาพ
- ความยาว: กระชับเข้าใจง่าย ปกติ 1–3 ประโยค ขยายได้เฉพาะเมื่อคำถามซับซ้อนจริง
</constraints>

<output_format>
ตอบเป็นภาษาไทย เป็นข้อความล้วน ห้ามใช้ markdown ห้ามใช้ bullet ห้ามใช้ emoji
</output_format>`;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

export async function askPlatoo(
  faqCsv: string,
  userMessage: string,
): Promise<string> {
  const userContent = `<faq>\n${faqCsv}\n</faq>\n\n<question>\n${userMessage}\n</question>`;

  try {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: userContent,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 1.0,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    const usage = response.usageMetadata;
    console.log("[gemini]", {
      finishReason,
      thoughtsTokenCount: usage?.thoughtsTokenCount,
      candidatesTokenCount: usage?.candidatesTokenCount,
    });

    if (finishReason === "MAX_TOKENS") {
      return DEFAULT_REPLY;
    }

    const text = response.text;
    if (!text) {
      return DEFAULT_REPLY;
    }

    return text.trim();
  } catch (error) {
    console.error("[gemini] request failed", error);
    return DEFAULT_REPLY;
  }
}
