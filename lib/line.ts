import { messagingApi } from "@line/bot-sdk";

type Message = messagingApi.Message;

const MAX_MESSAGES_PER_SEND = 5;
const IMAGE_TOKEN = /\[\[รูป:([^\]]+)\]\]/g;

let client: messagingApi.MessagingApiClient | null = null;
let blobClient: messagingApi.MessagingApiBlobClient | null = null;

function getClient(): messagingApi.MessagingApiClient {
  if (!client) {
    client = new messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    });
  }
  return client;
}

function getBlobClient(): messagingApi.MessagingApiBlobClient {
  if (!blobClient) {
    blobClient = new messagingApi.MessagingApiBlobClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    });
  }
  return blobClient;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T | null> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** i * 300));
      }
    }
  }
  console.error(JSON.stringify({ scope: "line", label, warning: "failed after retries", error: String(lastError) }));
  return null;
}

function parseSegmentToMessages(segment: string): Message[] {
  const messages: Message[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  IMAGE_TOKEN.lastIndex = 0;

  while ((match = IMAGE_TOKEN.exec(segment)) !== null) {
    const textPart = segment.slice(lastIndex, match.index).trim();
    if (textPart) messages.push({ type: "text", text: textPart } as Message);

    const url = match[1].trim();
    if (url) {
      messages.push({ type: "image", originalContentUrl: url, previewImageUrl: url } as Message);
    }
    lastIndex = IMAGE_TOKEN.lastIndex;
  }

  const rest = segment.slice(lastIndex).trim();
  if (rest) messages.push({ type: "text", text: rest } as Message);

  return messages;
}

/** กฎเหล็ก: บับเบิลสุดท้ายต้องเป็นข้อความเสมอ ห้ามจบด้วยรูป — ถ้าหลุดให้สลับ/เติม + log */
function enforceTextLast(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;
  const result = [...messages];
  const last = result[result.length - 1];
  if (last.type === "text") return result;

  if (result.length >= 2 && result[result.length - 2].type === "text") {
    const secondLast = result[result.length - 2];
    result[result.length - 2] = last;
    result[result.length - 1] = secondLast;
    console.warn(JSON.stringify({ scope: "line", warning: "reply ลงท้ายด้วยรูป สลับให้ข้อความอยู่ท้ายสุดแทน" }));
    return result;
  }

  console.warn(JSON.stringify({ scope: "line", warning: "reply มีแต่รูปไม่มีข้อความปิดท้าย เติมข้อความปิดให้อัตโนมัติ" }));
  result.push({ type: "text", text: "สอบถามเพิ่มเติมได้เลยนะคะ" } as Message);
  return result;
}

export function parseReplyIntoMessages(reply: string): Message[] {
  const segments = reply.split("[[เว้น]]");
  let messages: Message[] = [];
  for (const seg of segments) {
    messages.push(...parseSegmentToMessages(seg));
  }

  messages = enforceTextLast(messages);

  if (messages.length > MAX_MESSAGES_PER_SEND) {
    console.warn(
      JSON.stringify({ scope: "line", warning: "reply เกิน 5 บับเบิล ตัดเหลือ 5 บับเบิลแรก", total: messages.length }),
    );
    messages = messages.slice(0, MAX_MESSAGES_PER_SEND);
    messages = enforceTextLast(messages);
  }

  return messages;
}

export async function replyMessages(replyToken: string, reply: string): Promise<boolean> {
  const messages = parseReplyIntoMessages(reply);
  if (messages.length === 0) return false;
  const result = await withRetry(
    () => getClient().replyMessage({ replyToken, messages }),
    "replyMessage",
  );
  return result !== null;
}

export async function pushMessages(to: string, reply: string): Promise<boolean> {
  const messages = parseReplyIntoMessages(reply);
  if (messages.length === 0) return false;
  const result = await withRetry(() => getClient().pushMessage({ to, messages }), "pushMessage");
  return result !== null;
}

export async function pushRawText(to: string, text: string): Promise<boolean> {
  const result = await withRetry(
    () => getClient().pushMessage({ to, messages: [{ type: "text", text } as Message] }),
    "pushMessage-raw",
  );
  return result !== null;
}

export async function pushRawMessages(to: string, messages: Message[]): Promise<boolean> {
  if (messages.length === 0) return false;
  const result = await withRetry(
    () => getClient().pushMessage({ to, messages: messages.slice(0, MAX_MESSAGES_PER_SEND) }),
    "pushMessage-raw-multi",
  );
  return result !== null;
}

export async function startLoadingIndicator(chatId: string, seconds = 20): Promise<void> {
  const clamped = Math.max(5, Math.min(60, Math.round(seconds / 5) * 5));
  await withRetry(
    () => getClient().showLoadingAnimation({ chatId, loadingSeconds: clamped }),
    "showLoadingAnimation",
    1,
  );
}

export async function getProfileName(userId: string): Promise<string> {
  const result = await withRetry(() => getClient().getProfile(userId), "getProfile", 2);
  return result?.displayName || userId;
}

/** ใช้คู่กับ log ชั่วคราวไว้ดักหา groupId — bot ต้องเป็นสมาชิกกลุ่มนั้นอยู่ก่อนถึงจะดึงชื่อได้ */
export async function getGroupName(groupId: string): Promise<string | null> {
  const result = await withRetry(() => getClient().getGroupSummary(groupId), "getGroupSummary", 1);
  return result?.groupName ?? null;
}

export interface DownloadedContent {
  buffer: Buffer;
  contentType: string;
}

export async function downloadMessageContent(messageId: string): Promise<DownloadedContent | null> {
  try {
    const stream = await getBlobClient().getMessageContent(messageId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return { buffer: Buffer.concat(chunks), contentType: "image/jpeg" };
  } catch (error) {
    console.error(JSON.stringify({ scope: "line", warning: "downloadMessageContent failed", error: String(error) }));
    return null;
  }
}
