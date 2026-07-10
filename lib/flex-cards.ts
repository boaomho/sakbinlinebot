import { messagingApi } from "@line/bot-sdk";
import generatePayload from "promptpay-qr";
import QRCode from "qrcode";
import { uploadProductImage } from "./blob";

type FlexMessage = messagingApi.FlexMessage;
type FlexBubble = messagingApi.FlexBubble;
type FlexComponent = messagingApi.FlexComponent;

export interface PromptPayCardInput {
  /** เบอร์โทรหรือเลขบัตรประชาชนของร้านที่ผูก PromptPay */
  promptPayId: string;
  amount: number;
  shopName: string;
}

/** สร้างการ์ด QR PromptPay — generate payload + QR image แล้วอัปโหลดขึ้น Blob products store */
export async function buildPromptPayQrCard(input: PromptPayCardInput): Promise<FlexMessage | null> {
  try {
    const payload: string = generatePayload(input.promptPayId, { amount: input.amount });
    const qrBuffer = await QRCode.toBuffer(payload, { type: "png", width: 600, margin: 1 });
    const uploaded = await uploadProductImage("_qr", `promptpay_${Date.now()}.png`, qrBuffer, "image/png");
    if (!uploaded) return null;

    const bubble: FlexBubble = {
      type: "bubble",
      hero: {
        type: "image",
        url: uploaded.url,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `ชำระเงิน ${input.shopName}`, weight: "bold", size: "md" },
          {
            type: "text",
            text: `ยอด ${input.amount.toLocaleString("th-TH")} บาท`,
            size: "lg",
            color: "#e05353",
            weight: "bold",
          },
          {
            type: "text",
            text: "สแกน QR พร้อมเพย์แล้วส่งสลิปกลับมาได้เลยนะคะ",
            size: "sm",
            color: "#666666",
            wrap: true,
          },
        ],
      },
    };

    return { type: "flex", altText: `QR ชำระเงิน ${input.shopName}`, contents: bubble };
  } catch (error) {
    console.error(JSON.stringify({ scope: "flex-cards", warning: "buildPromptPayQrCard failed", error: String(error) }));
    return null;
  }
}

export interface ProductCardInput {
  name: string;
  price: string;
  imageUrl: string;
}

/** carousel การ์ดสินค้า พร้อมปุ่ม "สนใจสินค้านี้" ต่อชิ้น */
export function buildProductCatalogCard(products: ProductCardInput[]): FlexMessage | null {
  if (products.length === 0) return null;

  const bubbles: FlexBubble[] = products.slice(0, 10).map((p) => ({
    type: "bubble",
    hero: { type: "image", url: p.imageUrl, size: "full", aspectRatio: "1:1", aspectMode: "cover" },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: p.name, weight: "bold", size: "md", wrap: true },
        { type: "text", text: p.price, size: "md", color: "#e05353" },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#e05353",
          action: { type: "message", label: "สนใจสินค้านี้", text: `สนใจ ${p.name}` },
        },
      ],
    },
  }));

  return { type: "flex", altText: "รายการสินค้า", contents: { type: "carousel", contents: bubbles } };
}

export interface ContactCardInput {
  shopName: string;
  phone?: string;
  lineId?: string;
}

/** การ์ดข้อมูลติดต่อ พร้อมปุ่มขอคุยกับแอดมิน (จุดเข้าสู่ keyword handoff pre-check) */
export function buildContactCard(input: ContactCardInput): FlexMessage {
  const contents: FlexComponent[] = [{ type: "text", text: input.shopName, weight: "bold", size: "lg" }];
  if (input.phone) contents.push({ type: "text", text: `โทร: ${input.phone}`, size: "sm" });
  if (input.lineId) contents.push({ type: "text", text: `LINE: ${input.lineId}`, size: "sm" });

  const bubble: FlexBubble = {
    type: "bubble",
    body: { type: "box", layout: "vertical", contents },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#e05353",
          action: { type: "message", label: "ขอคุยกับแอดมิน", text: "ขอคุยกับแอดมินค่ะ" },
        },
      ],
    },
  };

  return { type: "flex", altText: `ติดต่อ ${input.shopName}`, contents: bubble };
}
