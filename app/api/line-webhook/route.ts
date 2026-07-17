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
  setHumanModeAll,
  clearResumeNotice,
  updateDisplayName,
  setLastSlipPathname,
  mergePendingOrder,
  clearPendingOrderAndSlip,
  setHasWrittenOrder,
  setPaidNoAddressNotified,
  reconcileWaitTags,
  resetCustomerMemory,
  addMessage,
  getRecentHistory,
  formatHistoryForPrompt,
  insertPendingMessage,
  getLatestPendingId,
  collectAndClearPendingMessages,
  logFunnelEvent,
  getCustomer,
  getCustomersWithName,
  getRecentCustomers,
  savePendingChoices,
  getPendingChoices,
  clearPendingChoices,
  CustomerState,
  CustomerBrief,
  PendingChoice,
} from "@/lib/db";
import { runSalesTurn, ImageIntent } from "@/lib/gemini";
import {
  replyMessages,
  pushMessages,
  pushRawText,
  pushRawMessages,
  startLoadingIndicator,
  downloadMessageContent,
  getProfileName,
  DownloadedContent,
} from "@/lib/line";
import { checkHandoffKeywords } from "@/lib/handoff";
import {
  parseAdminCommand,
  matchCustomersByName,
  formatThaiRelative,
  isUserId,
  isChoiceNumber,
  PENDING_CHOICES_TTL_MS,
} from "@/lib/admin-commands";
import { uploadSlip, getSlipSignedUrl } from "@/lib/blob";
import { appendOrderRow } from "@/lib/orders";
import { evaluateOrderGate, formatProductAndQty, buildNewOrderAdminText } from "@/lib/core/orders";

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
  const pendingKeys = Object.entries(customer.pendingOrder)
    .filter(([, v]) => (v ?? "").trim() !== "")
    .map(([k, v]) => `${k}=${v}`);
  return [
    `ประตูปัจจุบัน: ${customer.stage ?? "(ยังไม่เคยเข้าประตูไหน)"}`,
    `แท็ก: ${customer.tags.length > 0 ? customer.tags.join(", ") : "(ยังไม่มีแท็ก)"}`,
    `สถานะ: ${customer.isReturning ? "ลูกค้าเก่า (เคยคุยมาก่อน)" : "ลูกค้าใหม่ (ทักครั้งแรก)"}`,
    `ข้อมูลออเดอร์ที่เก็บแล้ว: ${pendingKeys.length ? pendingKeys.join(", ") : "(ยังไม่มี)"}`,
    `มีสลิปที่ยังไม่ผูกออเดอร์: ${customer.lastSlipPathname ? "มี" : "ไม่มี"}`,
    `มีออเดอร์บันทึกลงระบบแล้ว: ${customer.hasWrittenOrder ? "ใช่ (ถ้าลูกค้าขอแก้ออเดอร์เดิม ให้ตั้ง order_edit_request=true)" : "ยัง"}`,
  ].join("\n");
}

async function pushHandoffNotice(
  userId: string,
  userMessage: string,
  reason: string,
  path: "keyword-precheck" | "ai-semantic",
): Promise<void> {
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (!adminGroupId) {
    console.warn(JSON.stringify({ scope: "handoff", path, warning: "ADMIN_GROUP_ID not set — push skipped" }));
    return;
  }

  try {
    const name = await getProfileName(userId);
    // เก็บชื่อลง Neon ด้วย เพื่อให้คำสั่ง ปิดบอท/เปิดบอท <ชื่อ> หาเจอ (userId อยู่เบื้องหลัง ไม่โชว์)
    if (name && name !== userId) await updateDisplayName(userId, name);
    const text =
      `🔔 ส่งต่อแอดมิน\n` +
      `ลูกค้า: ${name}\n` +
      `เหตุผล: ${reason}\n` +
      `ข้อความล่าสุด: ${userMessage}\n` +
      `———\n` +
      `ปิดบอท: ปิดบอท ${name}\n` +
      `เปิดบอท: เปิดบอท ${name}`;
    const ok = await pushRawText(adminGroupId, text);
    if (!ok) {
      console.warn(JSON.stringify({ scope: "handoff", path, warning: "push to admin group failed" }));
    }
  } catch (error) {
    console.error(JSON.stringify({ scope: "handoff", path, warning: "pushHandoffNotice threw", error: String(error) }));
  }
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

  const sent = await replyMessages(replyToken, finalReply, config.quotaSaver);
  if (!sent) await pushMessages(userId, finalReply, config.quotaSaver);

  await pushHandoffNotice(userId, userMessage, reason, "keyword-precheck");
}

/** ข้อความสบายใจตอน AI อ่านรูปไม่สำเร็จ — รับรูปแล้ว กำลังตรวจสอบ (ไม่ทำให้ลูกค้ากังวล) */
function imageReceivedReply(config: AppConfig): string {
  const base = `ได้รับรูปแล้วนะคะ ${config.botName}กำลังตรวจสอบให้ค่ะ ขอสักครู่นะคะ`;
  return config.useEmoji ? `${base} 🙏` : base;
}

/**
 * จัดการรูปตาม image_intent ที่ AI ตัดสิน (เรียกเฉพาะเทิร์นที่มีรูปจริง):
 * - slip    → อัปโหลด slips store (private) + signed URL → push ADMIN (💰 สลิป ทันที) · จำ pathname · คืน pathname
 * - damage  → อัปโหลดหลักฐาน + push ADMIN + เข้า human_mode (เคลมต้องใช้คน) · คืน null
 * - address → ไม่ทำอะไรกับตัวรูป (AI อ่านที่อยู่ในรูปแล้วใส่ order_data มาให้แล้ว) · คืน null
 * - other   → ไม่ทำอะไร (คืน null)
 * คืน pathname สลิปของเทิร์นนี้ (ถ้าเป็น slip) เพื่อให้ order gate รู้ว่ามีสลิปแล้ว
 */
async function handleImageIntent(
  userId: string,
  intent: ImageIntent,
  imageNote: string,
  content: DownloadedContent,
  config: AppConfig,
  switches: FeatureSwitches,
): Promise<string | null> {
  if (intent === "other" || intent === "address") return null;

  const adminGroupId = process.env.ADMIN_GROUP_ID;
  const noteLine = imageNote ? `\n${imageNote}` : "";

  if (intent === "slip") {
    // เรื่องเงิน — อัปโหลดเก็บเสมอถ้ามี token (uploadSlip คืน null ถ้าไม่มี) แล้ว push เข้ากลุ่มเช็คยอดทันที (push จุดที่ 1)
    const uploaded = await uploadSlip(userId, content.buffer, content.contentType);
    if (uploaded && switches.memory) {
      await setLastSlipPathname(userId, uploaded.pathname); // จำไว้ผูกออเดอร์ตอน gate
    }
    if (adminGroupId) {
      const name = await getProfileName(userId);
      const text = `💰 มีลูกค้าส่งสลิปมาค่ะ${noteLine}\n\nLineOA: ${name}`;
      const signedUrl = uploaded ? await getSlipSignedUrl(uploaded.pathname, config.slipUrlExpiryDays) : null;
      if (signedUrl) {
        await pushRawMessages(adminGroupId, [
          { type: "text", text },
          { type: "image", originalContentUrl: signedUrl, previewImageUrl: signedUrl },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any);
      } else {
        await pushRawText(adminGroupId, text);
      }
    }
    return uploaded?.pathname ?? null;
  }

  if (intent === "damage") {
    const uploaded = await uploadSlip(userId, content.buffer, content.contentType); // เก็บเป็นหลักฐานเคลม
    if (adminGroupId) {
      const name = await getProfileName(userId);
      const text = `⚠️ ลูกค้าแจ้งปัญหา/เคลมค่ะ${noteLine}\n\nLineOA: ${name}`;
      const signedUrl = uploaded ? await getSlipSignedUrl(uploaded.pathname, config.slipUrlExpiryDays) : null;
      if (signedUrl) {
        await pushRawMessages(adminGroupId, [
          { type: "text", text },
          { type: "image", originalContentUrl: signedUrl, previewImageUrl: signedUrl },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any);
      } else {
        await pushRawText(adminGroupId, text);
      }
    }
    if (switches.memory) await setHumanMode(userId, true); // เคลม = ส่งต่อคน
  }
  return null;
}

/**
 * gate ออเดอร์: merge ข้อมูลเทิร์นนี้ลง pending_order → ให้ core ตัดสิน → ลงมือตามผล
 * การ "ตัดสิน" อยู่ที่ lib/core/orders.ts (evaluateOrderGate) เพื่อให้ช่องทางอื่น (Salepage)
 * ใช้กติกาเดียวกันได้ · ฟังก์ชันนี้เหลือแค่ I/O: DB / ชีต / Blob / push
 */
async function runOrderGate(
  userId: string,
  customer: CustomerState,
  gemini: { orderData: Record<string, string>; paymentMethod: string; imageNote: string },
  slipThisTurn: string | null,
  config: AppConfig,
): Promise<void> {
  const fields: Record<string, string> = { ...gemini.orderData };
  if (gemini.paymentMethod) fields["การชำระเงิน"] = gemini.paymentMethod; // "" = คงของเดิม
  const pending = await mergePendingOrder(userId, fields);

  const slipPathname = slipThisTurn ?? customer.lastSlipPathname ?? null;
  const gate = evaluateOrderGate({ pending, slipPresent: Boolean(slipPathname) });
  const payment = gate.payment;
  const adminGroupId = process.env.ADMIN_GROUP_ID;

  // log ผลการตัดสิน gate ทุกเทิร์น — ออเดอร์เคยหายเงียบเพราะพาธ "ไม่ครบ" ไม่เคย log อะไรเลย
  // ⚠️ log แค่ "ชื่อฟิลด์ที่มีค่า" ห้าม log ค่าจริง (ชื่อ/ที่อยู่/เบอร์ = PII ตาม CLAUDE.md)
  console.log(
    JSON.stringify({
      scope: "orders",
      event: "gate",
      pendingFilledFields: Object.keys(pending).filter((k) => (pending[k] ?? "").trim() !== ""),
      payment: gate.payment,
      complete: gate.complete,
      missing: gate.missing,
      waitTag: gate.waitTag,
      slipPresent: Boolean(slipPathname),
    }),
  );

  if (gate.complete) {
    const name = await getProfileName(userId);
    try {
      await appendOrderRow({
        lineDisplayName: name,
        productAndQty: formatProductAndQty(pending),
        total: pending["ยอด"],
        customerName: pending["ชื่อ"],
        phone: pending["เบอร์"],
        address: pending["ที่อยู่"],
        province: pending["จังหวัด"],
        postalCode: pending["รหัสไปรษณีย์"],
        paymentMethod: payment,
        slipPathname: payment === "โอน" ? slipPathname ?? undefined : undefined,
      });
    } catch (error) {
      console.error(JSON.stringify({ scope: "orders", warning: "appendOrderRow failed", error: String(error) }));
      return; // เขียนไม่สำเร็จ = ไม่ล้าง ไม่ push (retry เทิร์นหน้าได้)
    }
    // สำเร็จ → ล้าง pending+สลิป, ลบแท็กรอ, mark เขียนแล้ว, reset flag แจ้งเตือน
    await clearPendingOrderAndSlip(userId);
    await reconcileWaitTags(userId, null);
    await setHasWrittenOrder(userId);
    await setPaidNoAddressNotified(userId, false);
    // push จุดที่ 2 — ออเดอร์ใหม่ (โอน แนบรูปสลิป)
    if (adminGroupId) {
      const text = buildNewOrderAdminText(pending, payment, name);
      const signedUrl = payment === "โอน" && slipPathname ? await getSlipSignedUrl(slipPathname, config.slipUrlExpiryDays) : null;
      if (signedUrl) {
        await pushRawMessages(adminGroupId, [
          { type: "text", text },
          { type: "image", originalContentUrl: signedUrl, previewImageUrl: signedUrl },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any);
      } else {
        await pushRawText(adminGroupId, text);
      }
    }
    return;
  }

  // ---- ยังไม่ครบ → ติดแท็กรอ (ป้อน Follow) · ไม่แจ้งกลุ่ม · บอทขอสิ่งที่ยังขาดจากลูกค้าเอง ----
  // 🔴 D-11: ไม่มี push ⚠️ ระหว่างทางแล้ว (มันแจ้งเร็วไป: COD ยังไม่ได้ที่อยู่ก็ยิงกลุ่ม)
  //   COD ยังไม่จ่าย บอทเก็บข้อมูลเองพอ · โอน แอดมินรู้ตอนสลิป (push 💰 ใน handleImageIntent)
  await reconcileWaitTags(userId, gate.waitTag);
}

async function processMessage(
  userId: string,
  userMessage: string,
  replyToken: string,
  config: AppConfig,
  switches: FeatureSwitches,
  imageContent?: DownloadedContent,
): Promise<void> {
  let customer: CustomerState | null = null;

  // รูป(ถ้ามี) ส่งให้ Gemini เสมอ พร้อมบริบทเหมือนข้อความตัวอักษร — ยังไม่อัปโหลด/ยิงกลุ่ม
  const imageForGemini = imageContent
    ? { mimeType: imageContent.contentType, base64Data: imageContent.buffer.toString("base64") }
    : undefined;

  if (switches.memory) {
    customer = await ensureCustomer(userId);

    // เก็บชื่อ LINE ไว้ค้นในคำสั่งแอดมิน (ครั้งแรกที่ยังไม่มีชื่อ) — getProfile ไม่คิดค่า push
    if (!customer.displayName) {
      const name = await getProfileName(userId);
      if (name && name !== userId) {
        await updateDisplayName(userId, name);
        customer = { ...customer, displayName: name };
      }
    }

    if (customer.humanMode) {
      // คืนสิทธิ์บอทเมื่อ "แชทเงียบ" เกิน N นาที — วัดจาก last_seen เดิม (ก่อนข้อความนี้)
      // ที่ ensureCustomer คืนค่ามาให้ (ยังเป็นเวลาก่อนอัปเดต) ตรงกับ Config `คืนสิทธิ์บอท_หลังแชทเงียบ`
      // ใช้ last_seen ไม่ใช่ human_mode_since: ให้แอดมินคุยกับลูกค้าได้ไม่จำกัดเวลา พอเงียบจริง 45 นาที
      // (จบเคสแล้ว) บอทค่อยกลับมา — กันบอทเด้งแทรกกลางวงสนทนาที่แอดมินยังคุยอยู่
      const silentMs = Date.now() - customer.lastSeen.getTime();
      if (silentMs >= config.adminSilenceReturnMinutes * 60 * 1000) {
        await setHumanMode(userId, false);
        customer = { ...customer, humanMode: false, humanModeSince: null };
        // resume_notice_pending ยัง true (arm ตอนเข้า human_mode) → จะไปเกริ่นประโยคเปลี่ยนมือตอนสร้าง reply
      } else {
        await addMessage(userId, "user", userMessage);
        return; // แอดมินกำลังดูแลลูกค้ารายนี้อยู่ ไม่ตอบอัตโนมัติ
      }
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
      image: imageForGemini,
    }),
    GEMINI_TIMEOUT_MS,
    {
      reply: DEFAULT_REPLY,
      stage: previousStage ?? "1",
      tagsAdd: [] as string[],
      handoff: false,
      handoffReason: "",
      orderData: {} as Record<string, string>,
      paymentMethod: "" as const,
      orderEditRequest: false,
      imageIntent: "other" as ImageIntent,
      imageNote: "",
      degraded: true, // withTimeout กินเวลาเกิน 8s = Gemini ล้ม
    },
  );

  // เรื่องเงินห้ามพลาด: ถ้าเทิร์นนี้มีรูป แต่ Gemini ล้ม (degraded) → image_intent เชื่อไม่ได้
  // ถือรูปเป็น "สลิป" ไว้ก่อน (เก็บเกินดีกว่าทำหาย) แล้วตอบลูกค้าแบบไม่ทำให้กังวล
  const imageFallback = Boolean(imageContent && geminiOutput.degraded);

  // AI จัดหมวดรูป → log เก็บสถิติจริง (ไม่ log ตัวรูป · image_note เป็นสรุปสั้นจาก AI ไม่ใช่ raw PII)
  if (imageContent) {
    console.log(
      JSON.stringify({
        scope: "image",
        intent: imageFallback ? "slip(fallback)" : geminiOutput.imageIntent,
        note: geminiOutput.imageNote.slice(0, 120),
        degraded: geminiOutput.degraded,
      }),
    );
  }

  const effectiveTagsAdd = switches.tagging ? geminiOutput.tagsAdd : [];
  // damage = เคลม/ของเสียหาย → จัดการเป็น handoff ผ่าน image-intent handler (กันยิงซ้ำกับ handoff ทั่วไป)
  const damageHandled = Boolean(imageContent && !imageFallback && geminiOutput.imageIntent === "damage");

  // ข้อความถึงลูกค้า: ถ้า image-fallback ใช้ข้อความสบายใจ (รับรูปแล้ว กำลังตรวจสอบ) แทน DEFAULT_REPLY
  const baseReply = imageFallback ? imageReceivedReply(config) : geminiOutput.reply;

  // บอทเพิ่งกลับมาดูแล (auto-timeout หรือแอดมินสั่งเปิดบอท) → เกริ่นประโยคเปลี่ยนมือก่อน 1 บับเบิล
  // ส่งครั้งเดียว: flag arm ตอนเข้า human_mode, ล้างหลังส่ง (ข้อความถัดไปไม่ส่งซ้ำ)
  const shouldNotifyResume = Boolean(switches.memory && customer?.resumeNoticePending && config.botResumeMessage);
  const finalReply = shouldNotifyResume ? `${config.botResumeMessage}[[เว้น]]${baseReply}` : baseReply;

  if (switches.memory) {
    await addMessage(userId, "user", userMessage);
    await addMessage(userId, "assistant", baseReply);
    await updateCustomerAfterTurn(userId, { stage: geminiOutput.stage, tagsAdd: effectiveTagsAdd });
    await logFunnelEvent(userId, previousStage, geminiOutput.stage);
    if (shouldNotifyResume) await clearResumeNotice(userId);
  }

  const sent = await replyMessages(replyToken, finalReply, config.quotaSaver);
  if (!sent) {
    await pushMessages(userId, finalReply, config.quotaSaver);
  }

  // จัดการรูป: ปกติตาม image_intent · ถ้า Gemini ล้ม → บังคับ slip พร้อมโน้ตเตือน · คืน pathname สลิปเทิร์นนี้
  let slipThisTurn: string | null = null;
  if (imageContent) {
    slipThisTurn = imageFallback
      ? await handleImageIntent(userId, "slip", "⚠️ AI อ่านรูปไม่สำเร็จ (timeout/error) ช่วยเช็คให้ด้วยค่ะ", imageContent, config, switches)
      : await handleImageIntent(userId, geminiOutput.imageIntent, geminiOutput.imageNote, imageContent, config, switches);
  }

  // ลูกค้าขอแก้ออเดอร์ที่ "บันทึกลงชีตแล้ว" → handoff ให้แอดมิน (ห้ามเขียน/แก้แถวอัตโนมัติ) · push จุดพิเศษ ✏️
  let editHandled = false;
  if (geminiOutput.orderEditRequest && customer?.hasWrittenOrder) {
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (adminGroupId) {
      const name = await getProfileName(userId);
      const what = geminiOutput.handoffReason || "ลูกค้าขอแก้ไข";
      await pushRawText(adminGroupId, `✏️ ลูกค้าขอแก้ออเดอร์ที่บันทึกแล้ว: ${what}\n\nLineOA: ${name}`);
    }
    if (switches.memory) await setHumanMode(userId, true);
    editHandled = true;
  }

  // order gate — โค้ดตัดสินจาก pending_order (merge → ครบ/ไม่ครบ) · ข้ามถ้าเป็นการขอแก้ออเดอร์เดิม
  if (switches.orders && switches.memory && customer && !editHandled) {
    await runOrderGate(userId, customer, geminiOutput, slipThisTurn, config);
  }

  // handoff ทั่วไป (AI-semantic) · ข้ามถ้าจัดการเป็น damage หรือ edit ไปแล้ว (กันยิงซ้ำ)
  if (switches.handoff && geminiOutput.handoff && !damageHandled && !editHandled) {
    await pushHandoffNotice(userId, userMessage, geminiOutput.handoffReason || "AI ประเมินว่าควรส่งต่อ", "ai-semantic");
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
  // รูปคือ "ข้อความอีกรูปแบบ" — โหลดเสมอ (ไม่ผูกกับสวิตช์ orders) แล้วส่งให้ Gemini พร้อมบริบทครบชุด
  // ไม่อัปโหลด/ยิงกลุ่มตรงนี้ — รอ AI ตัดสิน image_intent ก่อน (โค้ดค่อยลงมือเฉพาะ slip/damage)
  const content = await downloadMessageContent(messageId);
  const placeholderText = content ? "[ลูกค้าส่งรูปมา]" : "[ลูกค้าส่งรูปมาแต่โหลดรูปไม่สำเร็จ]";
  await processMessage(userId, placeholderText, replyToken, config, switches, content ?? undefined);
}

// ---- คำสั่งในกลุ่มแอดมิน (ปิด/เปิดบอท ต่อคน · ทั้งหมด · รายชื่อล่าสุด) ----

/** ตอบกลับในกลุ่มแอดมิน — ใช้ reply token (ฟรี) ก่อน ถ้าหมดอายุค่อย push */
async function replyToAdmin(replyToken: string, groupId: string, text: string): Promise<void> {
  const sent = await replyMessages(replyToken, text);
  if (!sent) await pushRawText(groupId, text);
}

async function applyBotMode(
  userId: string,
  name: string,
  close: boolean,
  replyToken: string,
  groupId: string,
  config: AppConfig,
): Promise<void> {
  await setHumanMode(userId, close);
  if (close) {
    await replyToAdmin(
      replyToken,
      groupId,
      `🔴 ปิดบอทให้ "${name}" แล้ว\nบอทจะกลับมาเองเมื่อลูกค้าเงียบครบ ${config.adminSilenceReturnMinutes} นาที หรือพิมพ์: เปิดบอท ${name}`,
    );
  } else {
    await replyToAdmin(replyToken, groupId, `🟢 เปิดบอทให้ "${name}" แล้ว`);
  }
}

function buildDisambigMessage(query: string, matches: CustomerBrief[], verb: string): string {
  const lines = matches.map((m, i) => `${i + 1}) ${m.displayName ?? "(ไม่มีชื่อ)"} — คุยล่าสุด ${formatThaiRelative(m.lastSeen)}`);
  return (
    `⚠️ เจอลูกค้าชื่อ "${query}" ${matches.length} คน — เลือกคนที่ต้องการ\n\n` +
    `${lines.join("\n")}\n\n` +
    `พิมพ์เลขข้อต่อท้ายคำสั่ง เช่น: ${verb} 1\n` +
    `(รายการนี้มีอายุ 1 นาที หลังจากนั้นต้องพิมพ์คำสั่งใหม่)`
  );
}

function buildNotFoundMessage(query: string): string {
  return (
    `❌ ไม่พบลูกค้าชื่อ "${query}" ในระบบ\n\n` +
    `อาจเป็นเพราะลูกค้าเปลี่ยนชื่อ LINE หรือยังไม่เคยคุยกับปลาทู\n\n` +
    `ลองวิธีนี้:\n` +
    `• พิมพ์แค่บางส่วนของชื่อ เช่น: ปิดบอท Bee\n` +
    `• หรือดูรายชื่อลูกค้าที่คุยล่าสุด: พิมพ์ "รายชื่อล่าสุด"`
  );
}

async function handleCloseOpenCommand(
  arg: string,
  verb: string,
  close: boolean,
  replyToken: string,
  groupId: string,
  config: AppConfig,
): Promise<void> {
  if (!arg) {
    await replyToAdmin(replyToken, groupId, `พิมพ์: ${verb} <ชื่อลูกค้า>\nหรือดูรายชื่อก่อน: รายชื่อล่าสุด`);
    return;
  }

  // เลขข้อ → เลือกจากรายการที่ค้างไว้ (ชื่อซ้ำ/รายชื่อล่าสุด)
  if (isChoiceNumber(arg)) {
    const choices = await getPendingChoices(groupId, PENDING_CHOICES_TTL_MS);
    if (!choices) {
      await replyToAdmin(replyToken, groupId, "รายการหมดอายุแล้ว พิมพ์คำสั่งใหม่อีกครั้ง");
      return;
    }
    const pick = choices.find((c) => c.n === Number(arg));
    if (!pick) {
      await replyToAdmin(replyToken, groupId, `ไม่มีข้อ ${arg} ในรายการ พิมพ์คำสั่งใหม่อีกครั้ง`);
      return;
    }
    await applyBotMode(pick.userId, pick.name || "(ไม่มีชื่อ)", close, replyToken, groupId, config);
    await clearPendingChoices(groupId);
    return;
  }

  // userId เต็ม → ทำเลย (fallback สำหรับก๊อปจาก log)
  if (isUserId(arg)) {
    const c = await getCustomer(arg);
    await applyBotMode(arg, c?.displayName ?? arg, close, replyToken, groupId, config);
    return;
  }

  // ชื่อ → ค้นแบบยืดหยุ่น
  const candidates = await getCustomersWithName();
  const matches = matchCustomersByName(candidates, arg);
  if (matches.length === 0) {
    await replyToAdmin(replyToken, groupId, buildNotFoundMessage(arg));
    return;
  }
  if (matches.length === 1) {
    await applyBotMode(matches[0].userId, matches[0].displayName ?? arg, close, replyToken, groupId, config);
    return;
  }
  const choices: PendingChoice[] = matches.slice(0, 10).map((m, i) => ({ n: i + 1, userId: m.userId, name: m.displayName ?? "" }));
  await savePendingChoices(groupId, choices);
  await replyToAdmin(replyToken, groupId, buildDisambigMessage(arg, matches.slice(0, 10), verb));
}

async function handleListRecentCommand(replyToken: string, groupId: string): Promise<void> {
  const recent = await getRecentCustomers(10);
  if (recent.length === 0) {
    await replyToAdmin(replyToken, groupId, "ยังไม่มีลูกค้าในระบบ");
    return;
  }
  const choices: PendingChoice[] = recent.map((m, i) => ({ n: i + 1, userId: m.userId, name: m.displayName ?? "" }));
  await savePendingChoices(groupId, choices);
  const lines = recent.map((m, i) => {
    const status = m.humanMode ? "🔴" : "🟢";
    return `${i + 1}) ${status} ${m.displayName ?? "(ไม่มีชื่อ)"} — คุยล่าสุด ${formatThaiRelative(m.lastSeen)}`;
  });
  await replyToAdmin(
    replyToken,
    groupId,
    `รายชื่อลูกค้าที่คุยล่าสุด (🔴=บอทปิดอยู่ · 🟢=บอทดูแลอยู่)\n\n${lines.join("\n")}\n\nพิมพ์: ปิดบอท 1 หรือ เปิดบอท 1 (รายการมีอายุ 1 นาที)`,
  );
}

async function handleAdminGroupCommand(
  text: string,
  replyToken: string,
  groupId: string,
  config: AppConfig,
  switches: FeatureSwitches,
): Promise<void> {
  if (!switches.memory) return; // ต้องมี Neon ถึงจะจัดการ human_mode ได้
  const cmd = parseAdminCommand(text);

  switch (cmd.kind) {
    case "none":
      return; // ไม่ใช่คำสั่ง เพิกเฉย (ไม่รบกวนการแชทในกลุ่ม)
    case "close_all": {
      const n = await setHumanModeAll(true);
      await replyToAdmin(
        replyToken,
        groupId,
        `🔴 ปิดบอททั้งหมดแล้ว (${n} คน)\nบอทจะกลับมาเองเมื่อลูกค้าแต่ละคนเงียบครบ ${config.adminSilenceReturnMinutes} นาที หรือพิมพ์: เปิดบอททั้งหมด`,
      );
      return;
    }
    case "open_all": {
      const n = await setHumanModeAll(false);
      await replyToAdmin(replyToken, groupId, `🟢 เปิดบอททั้งหมดแล้ว (${n} คน)`);
      return;
    }
    case "list":
      await handleListRecentCommand(replyToken, groupId);
      return;
    case "close":
      await handleCloseOpenCommand(cmd.arg, cmd.verb, true, replyToken, groupId, config);
      return;
    case "open":
      await handleCloseOpenCommand(cmd.arg, cmd.verb, false, replyToken, groupId, config);
      return;
  }
}

const RESET_COMMAND = "/reset";

function isResetCommand(text: string): boolean {
  return text.trim() === RESET_COMMAND;
}

/** คำสั่งเทสต์ /reset (แชท 1:1 เท่านั้น) — ล้างความจำเฉพาะคนที่พิมพ์ ไม่เข้า engine ขาย */
async function handleResetCommand(userId: string, replyToken: string, switches: FeatureSwitches): Promise<void> {
  if (switches.memory) {
    await resetCustomerMemory(userId);
  }
  const reply = "รีเซ็ตความจำแล้ว เริ่มใหม่ได้เลยค่ะ";
  const sent = await replyMessages(replyToken, reply);
  if (!sent) await pushMessages(userId, reply);
}

async function handleEvent(event: webhook.Event, config: AppConfig, switches: FeatureSwitches): Promise<void> {
  try {
    if (event.type !== "message") return;
    const replyToken = event.replyToken;
    if (!replyToken) return;
    if (!event.source) return;

    // คำสั่งแอดมินรับเฉพาะจากกลุ่ม ADMIN_GROUP_ID เท่านั้น (กันคนนอก/กลุ่มอื่นสั่งปิดบอท)
    if (event.source.type === "group") {
      if (event.source.groupId === process.env.ADMIN_GROUP_ID && event.message.type === "text") {
        await handleAdminGroupCommand(event.message.text, replyToken, event.source.groupId, config, switches);
      }
      return; // กลุ่มอื่น (เช่น ORDER_GROUP_ID) เพิกเฉย
    }

    if (event.source.type !== "user") return;
    const userId = event.source.userId;
    if (!userId) return;

    if (event.message.type === "text" && config.testCommandsEnabled && isResetCommand(event.message.text)) {
      await handleResetCommand(userId, replyToken, switches);
      return;
    }

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
