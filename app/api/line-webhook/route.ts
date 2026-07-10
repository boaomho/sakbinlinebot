import { NextRequest, NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import {
  getConfig,
  formatConfigForPrompt,
  resolveFeatureSwitches,
  DEFAULT_REPLY,
  AppConfig,
  FeatureSwitches,
} from "@/lib/config";
import { getStepCsv, getFaqCsv } from "@/lib/sheets";
import {
  ensureCustomer,
  updateCustomerAfterTurn,
  setHumanMode,
  setLastSlipPathname,
  addMessage,
  getRecentHistory,
  formatHistoryForPrompt,
  insertPendingMessage,
  getLatestPendingId,
  collectAndClearPendingMessages,
  logFunnelEvent,
  CustomerState,
} from "@/lib/db";
import { runSalesTurn, GeminiImageInput, OrderAction } from "@/lib/gemini";
import {
  replyMessages,
  pushMessages,
  pushRawText,
  pushRawMessages,
  startLoadingIndicator,
  downloadMessageContent,
  getProfileName,
} from "@/lib/line";
import { checkHandoffKeywords } from "@/lib/handoff";
import { uploadSlip, getSlipSignedUrl } from "@/lib/blob";
import { appendOrderRow } from "@/lib/orders";

export const maxDuration = 30;

const GEMINI_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function buildStateText(customer: CustomerState | null): string {
  if (!customer) {
    return "(ไม่มีความจำลูกค้า ระบบความจำปิดอยู่ ถือว่าเป็นการเริ่มบทสนทนาใหม่ทุกครั้ง)";
  }
  return [
    `ประตูปัจจุบัน: ${customer.stage ?? "(ยังไม่เคยเข้าประตูไหน)"}`,
    `แท็ก: ${customer.tags.length > 0 ? customer.tags.join(", ") : "(ยังไม่มีแท็ก)"}`,
    `สถานะ: ${customer.isReturning ? "ลูกค้าเก่า (เคยคุยมาก่อน)" : "ลูกค้าใหม่ (ทักครั้งแรก)"}`,
  ].join("\n");
}

async function pushHandoffNotice(userId: string, userMessage: string, reason: string): Promise<void> {
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (!adminGroupId) return;
  const name = await getProfileName(userId);
  const text = `🔔 ส่งต่อแอดมิน\nลูกค้า: ${name}\nuserId: ${userId}\nเหตุผล: ${reason}\nข้อความล่าสุด: ${userMessage}`;
  await pushRawText(adminGroupId, text);
}

async function runHandoffFlow(
  userId: string,
  userMessage: string,
  replyToken: string,
  config: AppConfig,
  switches: FeatureSwitches,
  reason: string,
): Promise<void> {
  const base = `${config.botName}ขอตามแอดมินมาดูแลต่อให้เลยนะคะ`;
  const finalReply = config.useEmoji ? `${base} 🙏` : base;

  if (switches.memory) {
    await addMessage(userId, "user", userMessage);
    await addMessage(userId, "assistant", finalReply);
    await setHumanMode(userId, true);
  }

  const sent = await replyMessages(replyToken, finalReply);
  if (!sent) await pushMessages(userId, finalReply);

  await pushHandoffNotice(userId, userMessage, reason);
}

function formatProductAndQty(orderData: Record<string, string>): string {
  return [orderData["สินค้า"], orderData["จำนวน"]].filter(Boolean).join(" x");
}

async function handleOrderAction(
  userId: string,
  action: OrderAction,
  orderData: Record<string, string>,
  config: AppConfig,
  slipPathname: string | undefined,
): Promise<void> {
  const orderGroupId = process.env.ORDER_GROUP_ID;
  const productAndQty = formatProductAndQty(orderData);

  if (action === "slip_received") {
    if (!orderGroupId) return;
    const name = await getProfileName(userId);
    const text = `💰 มีลูกค้าส่งสลิปมาค่ะ\n${productAndQty}\n\nLineOA: ${name}`;
    const signedUrl = slipPathname ? await getSlipSignedUrl(slipPathname, config.slipUrlExpiryDays) : null;
    if (signedUrl) {
      await pushRawMessages(orderGroupId, [
        { type: "text", text },
        { type: "image", originalContentUrl: signedUrl, previewImageUrl: signedUrl },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
    } else {
      await pushRawText(orderGroupId, text);
    }
    return;
  }

  if (action === "cod_confirmed") {
    if (!orderGroupId) return;
    const name = await getProfileName(userId);
    const text = `📦 ขอ CF COD ค่ะ\n${productAndQty}\n\nLineOA: ${name}`;
    await pushRawText(orderGroupId, text);
    return;
  }

  if (action === "address_collected") {
    try {
      const name = await getProfileName(userId);
      await appendOrderRow({
        lineDisplayName: name,
        productAndQty,
        total: orderData["ยอด"],
        customerName: orderData["ชื่อ"],
        phone: orderData["เบอร์"],
        address: orderData["ที่อยู่"],
        subdistrict: orderData["ตำบล"],
        district: orderData["อำเภอ"],
        province: orderData["จังหวัด"],
        postalCode: orderData["รหัสไปรษณีย์"],
        paymentMethod: orderData["การชำระเงิน"],
        slipPathname,
      });
    } catch (error) {
      console.error(JSON.stringify({ scope: "orders", warning: "appendOrderRow failed", error: String(error) }));
    }
  }
}

async function processMessage(
  userId: string,
  userMessage: string,
  replyToken: string,
  config: AppConfig,
  switches: FeatureSwitches,
  image?: GeminiImageInput,
  slipPathname?: string,
): Promise<void> {
  let customer: CustomerState | null = null;

  if (switches.memory) {
    customer = await ensureCustomer(userId);
    if (customer.humanMode) {
      const since = customer.humanModeSince ? customer.humanModeSince.getTime() : Date.now();
      const daysElapsed = (Date.now() - since) / (1000 * 60 * 60 * 24);
      if (daysElapsed >= config.adminSilenceReturnDays) {
        await setHumanMode(userId, false);
        customer = { ...customer, humanMode: false, humanModeSince: null };
      } else {
        await addMessage(userId, "user", userMessage);
        return; // แอดมินกำลังดูแลลูกค้ารายนี้อยู่ ไม่ตอบอัตโนมัติ
      }
    }

    // จำ pathname สลิปล่าสุดไว้กับลูกค้า เผื่อ order_action="address_collected" มาถึงในเทิร์นถัดไป
    // (ลูกค้าส่งสลิปเทิร์นนี้ แล้วค่อยพิมพ์ที่อยู่เทิร์นหลัง)
    if (slipPathname) {
      await setLastSlipPathname(userId, slipPathname);
      customer = { ...customer, lastSlipPathname: slipPathname };
    }
  }

  if (switches.handoff) {
    const preCheck = checkHandoffKeywords(userMessage, config.handoffKeywords);
    if (preCheck.matched) {
      await runHandoffFlow(userId, userMessage, replyToken, config, switches, `เจอคำสำคัญ: ${preCheck.keyword}`);
      return;
    }
  }

  const [stepCsv, faqCsv] = await Promise.all([getStepCsv(), getFaqCsv()]);
  const stepText = stepCsv ?? "(ไม่มีข้อมูลสเต็ป)";
  const faqText = faqCsv ?? "(ไม่มีข้อมูล FAQ)";
  const configText = formatConfigForPrompt(config);
  const stateText = buildStateText(customer);

  let historyText = "(ระบบความจำปิดอยู่)";
  if (switches.memory) {
    const history = await getRecentHistory(userId, 20);
    historyText = formatHistoryForPrompt(history);
  }

  const previousStage = customer?.stage ?? null;

  const geminiOutput = await withTimeout(
    runSalesTurn({
      config,
      configText,
      stepText,
      faqText,
      stateText,
      historyText,
      userMessage,
      currentStage: previousStage ?? "1",
      image,
    }),
    GEMINI_TIMEOUT_MS,
    {
      reply: DEFAULT_REPLY,
      stage: previousStage ?? "1",
      tagsAdd: [] as string[],
      handoff: false,
      handoffReason: "",
      orderAction: "none" as OrderAction,
      orderData: {} as Record<string, string>,
    },
  );

  const effectiveTagsAdd = switches.tagging ? geminiOutput.tagsAdd : [];
  const effectiveHandoff = switches.handoff ? geminiOutput.handoff : false;
  const effectiveOrderAction: OrderAction = switches.orders ? geminiOutput.orderAction : "none";

  if (switches.memory) {
    await addMessage(userId, "user", userMessage);
    await addMessage(userId, "assistant", geminiOutput.reply);
    await updateCustomerAfterTurn(userId, { stage: geminiOutput.stage, tagsAdd: effectiveTagsAdd });
    await logFunnelEvent(userId, previousStage, geminiOutput.stage);
  }

  const sent = await replyMessages(replyToken, geminiOutput.reply);
  if (!sent) {
    await pushMessages(userId, geminiOutput.reply);
  }

  if (switches.orders && effectiveOrderAction !== "none") {
    const effectiveSlipPathname = slipPathname ?? customer?.lastSlipPathname ?? undefined;
    await handleOrderAction(userId, effectiveOrderAction, geminiOutput.orderData, config, effectiveSlipPathname);
  }

  if (effectiveHandoff) {
    await pushHandoffNotice(userId, userMessage, geminiOutput.handoffReason || "AI ประเมินว่าควรส่งต่อ");
    if (switches.memory) await setHumanMode(userId, true);
  }
}

async function handleTextMessage(
  userId: string,
  text: string,
  replyToken: string,
  config: AppConfig,
  switches: FeatureSwitches,
): Promise<void> {
  if (!switches.humanLikeTiming) {
    await processMessage(userId, text, replyToken, config, switches);
    return;
  }

  const insertedId = await insertPendingMessage(userId, text, replyToken);

  if (config.showTyping) {
    await startLoadingIndicator(userId, Math.ceil(config.debounceWaitMs / 1000) + 5);
  }

  await new Promise((resolve) => setTimeout(resolve, config.debounceWaitMs));

  const latestId = await getLatestPendingId(userId);
  if (latestId !== null && latestId > insertedId) {
    // มีข้อความใหม่กว่าเข้ามาระหว่างรอ ปล่อยให้ invocation ของข้อความนั้นจัดการแทน (กันตอบซ้ำ)
    return;
  }

  const collected = await collectAndClearPendingMessages(userId);
  if (!collected.text) return; // ถูกอีก invocation เก็บไปประมวลผลแล้ว

  await processMessage(userId, collected.text, collected.replyToken ?? replyToken, config, switches);
}

async function handleImageMessage(
  userId: string,
  messageId: string,
  replyToken: string,
  config: AppConfig,
  switches: FeatureSwitches,
): Promise<void> {
  let slipPathname: string | undefined;
  let imageForGemini: GeminiImageInput | undefined;

  if (switches.orders) {
    const content = await downloadMessageContent(messageId);
    if (content) {
      const uploaded = await uploadSlip(userId, content.buffer, content.contentType);
      slipPathname = uploaded?.pathname;
      imageForGemini = { mimeType: content.contentType, base64Data: content.buffer.toString("base64") };
    }
  }

  const placeholderText = switches.orders ? "[ลูกค้าส่งรูปสลิป/หลักฐานการโอนมา]" : "[ลูกค้าส่งรูปมา]";
  await processMessage(userId, placeholderText, replyToken, config, switches, imageForGemini, slipPathname);
}

async function handleAdminGroupCommand(text: string, config: AppConfig, switches: FeatureSwitches): Promise<void> {
  if (!switches.memory) return;
  const trimmed = text.trim();
  if (!trimmed.startsWith(config.releaseKeyword)) return;
  const userId = trimmed.slice(config.releaseKeyword.length).trim();
  if (!userId) return;
  await setHumanMode(userId, false);
}

async function handleEvent(event: webhook.Event, config: AppConfig, switches: FeatureSwitches): Promise<void> {
  try {
    if (event.type !== "message") return;
    const replyToken = event.replyToken;
    if (!replyToken) return;
    if (!event.source) return;

    if (event.source.type === "group" && event.source.groupId === process.env.ADMIN_GROUP_ID) {
      if (event.message.type === "text") {
        await handleAdminGroupCommand(event.message.text, config, switches);
      }
      return;
    }

    if (event.source.type !== "user") return;
    const userId = event.source.userId;
    if (!userId) return;

    if (!switches.salesCore) {
      await replyMessages(replyToken, DEFAULT_REPLY);
      return;
    }

    if (event.message.type === "text") {
      await handleTextMessage(userId, event.message.text, replyToken, config, switches);
    } else if (event.message.type === "image") {
      await handleImageMessage(userId, event.message.id, replyToken, config, switches);
    }
  } catch (error) {
    console.error(JSON.stringify({ scope: "webhook", warning: "handleEvent failed", error: String(error) }));
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  if (!signature || !validateSignature(rawBody, process.env.LINE_CHANNEL_SECRET ?? "", signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body: webhook.CallbackRequest = JSON.parse(rawBody);
  const events = body.events ?? [];

  const config = await getConfig();
  const switches = resolveFeatureSwitches(config);

  await Promise.all(events.map((event) => handleEvent(event, config, switches)));

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
