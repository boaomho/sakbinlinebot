import { webhook } from "@line/bot-sdk";
import {
  getConfig,
  formatConfigForPrompt,
  resolveFeatureSwitches,
  DEFAULT_REPLY,
  AppConfig,
  FeatureSwitches,
} from "@/lib/config";
import { loadBotLibrary, BotLibrary } from "@/lib/sheets/loader";
import { isSchemaV3 } from "@/lib/schema-mode";
import { findAssuranceHits, cutAssuranceLines } from "@/lib/guards/assurance";
import { buildStepInjection, buildFaqInjection, buildCatalogInjection, buildObjectionInjection, readConfigDescription, funnelStageOf, stepNameOf, stepVerbatim, stepClosing, joinVerbatimParts, detectPaymentChoice, isPaymentChoiceOnly, resolvePaymentStep, resolveRecoveredStage, redactFinancial } from "@/lib/agent/inject";
import { isFirstMessageOfDay, prependToFirstTextBubble, DEFAULT_DAILY_GREETING } from "@/lib/greeting";
import {
  ensureCustomer,
  updateCustomerAfterTurn,
  setHumanMode,
  setHumanModeAll,
  isChannelEnabled,
  setChannelEnabled,
  clearResumeNotice,
  updateDisplayName,
  setLastSlipPathname,
  mergePendingOrder,
  clearPendingOrderAndSlip,
  isOrderWritten,
  markOrderWritten,
  setLastOrder,
  setLastOrderLocked,
  setHasWrittenOrder,
  setPaidNoAddressNotified,
  reconcileWaitTags,
  resetCustomerMemory,
  addDeliveredStep,
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
import { runSalesTurn, ImageIntent, GeminiTurnOutput } from "@/lib/gemini";
import {
  replyMessages,
  pushMessages,
  pushRawText,
  pushRawMessages,
  startLoadingIndicator,
  downloadMessageContent,
  DownloadedContent,
} from "@/lib/line";
import { ChannelTransport, LineTransport } from "@/lib/channel/transport";
import { channelLabel } from "@/lib/channel/label";
import { messengerPageIds } from "@/lib/channel/pages";
import { botModeMsg, channelSwitchMsg, channelStatusLine } from "@/lib/train/bot-switch";
import { checkHandoffKeywords, DEFAULT_HANDOFF_KEYWORDS, DEFAULT_HANDOFF_KEYWORDS_V3 } from "@/lib/handoff";
import {
  parseAdminCommand,
  matchCustomersByName,
  formatThaiRelative,
  isUserId,
  isChoiceNumber,
  PENDING_CHOICES_TTL_MS,
} from "@/lib/admin-commands";
import { uploadSlip, getSlipSignedUrl } from "@/lib/blob";
import { appendOrderRow, updateOrderRow } from "@/lib/orders";
import { evaluateOrderGate, buildNewOrderAdminText, buildBrokenOrderAdminText, buildPriceStuckAdminText, buildOrderStateWarning, buildOrderEditAdminText, generateOrderId, sanitizePhone, itemsEqual, normalizeItems, PendingOrder } from "@/lib/core/orders";
import { resolveRuntimeVars, formatLinesForSheet, formatOrderSummary, buildProductNameMap, resolveAiItems, buildAllowedPriceStrings, RuntimeVarContext, PriceResult } from "@/lib/core/pricing";
import { computeQuote, unresolvedTransferVars, resolveOrderVars, findBannedClaims, parseClaimsList, findBadPrices, extractBahtNumbers, extractPriceNumbers, dropUnresolvedVarBubbles, resolveAllVars, AllVarsContext } from "@/lib/agent/quote";

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

/** ส่งข้อความถึงลูกค้า: reply ก่อน · ล้มเหลว (token หมดอายุ) → push */
/** ส่งข้อความถึงลูกค้า (reply → fallback push) · คืน true เมื่อส่งสำเร็จจริง (D-45b: ใช้ตัดสินตั้งธง delivered_steps) */
async function deliverReply(transport: ChannelTransport, text: string, quotaSaver: boolean): Promise<boolean> {
  const sent = await transport.reply(text, quotaSaver);
  if (sent) return true;
  return transport.push(text, quotaSaver);
}

const EMPTY_VARS: RuntimeVarContext = { summary: null, total: null, payment: null, breakdown: null, nextTierOffer: null };

/** "ชื่อสินค้า xqty · ..." สำหรับข้อความแจ้งแอดมิน (แทน sku ดิบด้วยชื่อจาก CSV_Products) */
function itemsToNames(items: PendingOrder["items"], nameMap: Map<string, string>): string {
  const norm = normalizeItems(items);
  return norm.length > 0 ? norm.map((it) => `${nameMap.get(it.sku) ?? it.sku} x${it.qty}`).join(" · ") : "(ไม่มี)";
}

/**
 * @param priceStuck true = เทิร์นนี้ pending มี items แต่ระบบคำนวณยอดไม่ได้ (config ราคาพัง/เกินเพดาน)
 *   → บอกสถานะตรง ๆ ว่า "ยังบันทึกไม่ได้ รอแอดมินตรวจยอด" เพื่อให้ AI ไม่สัญญาว่าบันทึก/แจ้งวันส่ง
 *   (แก้ที่ state ไม่ใช่ guard — โค้ดไม่บล็อกคำพูด แค่บอกความจริงให้ AI ตัดสินเอง · ท่ารับมือเทรนในชีต Step ได้)
 */
function buildStateText(customer: CustomerState | null, orderWarning: string | null = null, priceStuck = false, lastOrderLine: string | null = null): string {
  if (!customer) {
    return "(ไม่มีความจำลูกค้า ระบบความจำปิดอยู่ ถือว่าเป็นการเริ่มบทสนทนาใหม่ทุกครั้ง)";
  }
  const po = customer.pendingOrder;
  const pendingKeys: string[] = [];
  for (const k of ["ชื่อ", "ที่อยู่", "เบอร์", "การชำระเงิน"] as const) {
    const v = po[k];
    if (typeof v === "string" && v.trim() !== "") pendingKeys.push(`${k}=${v}`);
  }
  const normItems = normalizeItems(po.items);
  if (normItems.length > 0) pendingKeys.push(`รายการ=${normItems.map((it) => `${it.sku} x${it.qty}`).join(", ")}`);
  const lines = [
    `ประตูปัจจุบัน: ${customer.stage ?? "(ยังไม่เคยเข้าประตูไหน)"}`,
    `แท็ก: ${customer.tags.length > 0 ? customer.tags.join(", ") : "(ยังไม่มีแท็ก)"}`,
    `สถานะ: ${customer.isReturning ? "ลูกค้าเก่า (เคยคุยมาก่อน)" : "ลูกค้าใหม่ (ทักครั้งแรก)"}`,
    `ข้อมูลออเดอร์ที่เก็บแล้ว: ${pendingKeys.length ? pendingKeys.join(", ") : "(ยังไม่มี)"}`,
    `มีสลิปที่ยังไม่ผูกออเดอร์: ${customer.lastSlipPathname ? "มี" : "ไม่มี"}`,
    `มีออเดอร์บันทึกลงระบบแล้ว: ${customer.hasWrittenOrder ? "ใช่ (ถ้าลูกค้าขอแก้ออเดอร์เดิม ให้ตั้ง order_edit_request=true)" : "ยัง"}`,
  ];
  if (lastOrderLine) lines.push(lastOrderLine); // D-32: ออเดอร์ที่บันทึกแล้ว (ให้ AI จำ/แก้/ทวน)
  // D-30: ข้อมูลขาด (มีเจตนาซื้อแล้วแต่ไม่ครบ) มาก่อน · ถ้า field ครบแต่ราคาล้ม → priceStuck (D-23)
  if (orderWarning) {
    lines.push(orderWarning);
  } else if (priceStuck) {
    lines.push(
      "⚠️ สถานะการบันทึกออเดอร์นี้: ยังบันทึกไม่ได้ — ระบบคำนวณยอดไม่สำเร็จ กำลังให้แอดมินตรวจยอด · ยังไม่ถือว่าสั่งซื้อสำเร็จ อย่าเพิ่งยืนยันการบันทึกหรือแจ้งวันจัดส่ง บอกลูกค้าตามจริงว่ากำลังให้ทีมงานตรวจยอดแล้วจะรีบแจ้งกลับ",
    );
  }
  return lines.join("\n");
}

/** 🔴 D-58: ประตูเป้าหมายของ pre-check `คำ_notify` — ตายตัว (ยังไม่ config ประตู · ขยายทีหลังถ้ามีเคสจริง) */
const NOTIFY_DOOR = "H1";

/**
 * 🔴 ประตู handoff รวมศูนย์ (D-33) — "ปิดบอท + แจ้งแอดมิน + footer" ที่เดียว
 * ทุกทางที่ต้องส่งต่อคน **ต้องเรียกฟังก์ชันนี้** (guard: setHumanMode(userId,true) ห้ามอยู่ที่อื่น)
 * footer มาเสมอ · reason เปลี่ยนแค่หัวข้อ · attachImage = แนบรูปหลักฐาน (เคลม) ไม่ให้หาย
 */
async function handoff(
  userId: string,
  switches: FeatureSwitches,
  opts: { reason: string; userMessage?: string; attachImage?: { url: string; note?: string } },
  transport: ChannelTransport,
): Promise<void> {
  // ปิดบอท (จุดเดียวในระบบที่เรียก setHumanMode(userId, true))
  if (switches.memory) await setHumanMode(userId, true);

  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (!adminGroupId) {
    console.warn(JSON.stringify({ scope: "handoff", reason: opts.reason, warning: "ADMIN_GROUP_ID not set — push skipped" }));
    return;
  }
  try {
    const name = await transport.getProfileName();
    if (name && name !== userId) await updateDisplayName(userId, name); // ให้คำสั่ง เปิดบอท <ชื่อ> หาเจอ
    const footer = `🔴 บอทปิดการทำงานกับลูกค้ารายนี้แล้ว · รอแอดมินรับช่วง (เปิดคืน: เปิดบอท ${name})`;
    const text = [
      `🔔 ส่งต่อแอดมิน — ${opts.reason}`,
      `ลูกค้า: ${channelLabel(userId)} ${name}`,
      opts.userMessage ? `ข้อความล่าสุด: ${opts.userMessage}` : null,
      opts.attachImage?.note || null,
      "———",
      footer,
    ]
      .filter(Boolean)
      .join("\n");
    if (opts.attachImage) {
      await pushRawMessages(adminGroupId, [
        { type: "text", text },
        { type: "image", originalContentUrl: opts.attachImage.url, previewImageUrl: opts.attachImage.url },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
    } else {
      const ok = await pushRawText(adminGroupId, text);
      if (!ok) console.warn(JSON.stringify({ scope: "handoff", reason: opts.reason, warning: "push to admin group failed" }));
    }
  } catch (error) {
    console.error(JSON.stringify({ scope: "handoff", reason: opts.reason, warning: "handoff push threw", error: String(error) }));
  }
}

async function runHandoffFlow(
  userId: string,
  userMessage: string,
  transport: ChannelTransport,
  config: AppConfig,
  switches: FeatureSwitches,
  reason: string,
): Promise<void> {
  const base = `${config.botName}ขอตามแอดมินมาดูแลต่อให้เลยนะคะ`;
  const finalReply = config.useEmoji ? `${base} 🙏` : base;

  if (switches.memory) {
    await addMessage(userId, "user", userMessage);
    await addMessage(userId, "assistant", finalReply);
  }

  const sent = await transport.reply(finalReply, config.quotaSaver);
  if (!sent) await transport.push(finalReply, config.quotaSaver);

  await handoff(userId, switches, { reason, userMessage }, transport); // ปิดบอท + แจ้งแอดมิน + footer (จุดเดียว)
}

// ═══════════════ D-61.A · v2/v3 branch helpers — เช็ค isSchemaV3() ต้นทางแล้ว dispatch เข้า function ชัด (ห้ามหว่าน if ในเนื้อ logic · เตรียมลบ v2 ง่ายหลังเกษียณ) ═══════════════

/** D-61.A (v3): marker dedup 🔔 ธงสุขภาพใน delivered_steps — prefix __ กันชน step_id จริง (เจ้าของเคาะ #3) · ล้างพร้อมธงตอนปิดออเดอร์/cron/reset = "ต่อเคส" จริง */
const HEALTH_NOTIFY_MARKER = "__HEALTH_NOTIFY__";

/** D-61.A (v3): ทุกบอลลูนโดน assurance ตัดหมด → ข้อความสุภาพ ห้ามบอทเงียบใส่ลูกค้าทุกกรณี (เจ้าของเคาะ #2) */
const ASSURANCE_FALLBACK_REPLY = "ขออภัยค่ะ เรื่องนี้ขอให้แอดมินช่วยดูแลต่อเพื่อความแม่นยำนะคะ ทีมงานจะรีบมาตอบโดยเร็วเลยค่ะ";

/** D-58/D-60 (v2 เท่านั้น): pre-check คำ_notify รายประตู — ย้ายก้อนเดิมมาทั้งดุ้น (พฤติกรรมเดิมเป๊ะ) · handled=true = ปิดบอทไปแล้ว caller ต้อง return */
async function notifyPrecheckV2(args: {
  userId: string;
  userMessage: string;
  transport: ChannelTransport;
  config: AppConfig;
  switches: FeatureSwitches;
  lib: BotLibrary | null;
}): Promise<{ handled: boolean; forcedStage: string | null }> {
  const { userId, userMessage, transport, config, switches, lib } = args;
  const doors = [
    ...config.notifyDoors,
    ...(config.notifyKeywords.length > 0 ? [{ door: NOTIFY_DOOR, keywords: config.notifyKeywords }] : []),
  ];
  for (const d of doors) {
    if (!checkHandoffKeywords(userMessage, d.keywords).matched) continue;
    const doorFunnel = lib ? funnelStageOf(lib.CSV_Step, d.door) : null;
    const sv = lib ? stepVerbatim(lib.CSV_Step, d.door) : null;
    if (doorFunnel === "handoff_notify" && sv && sv.pattern.trim() !== "") {
      console.log(JSON.stringify({ scope: "notify-precheck", door: d.door }));
      return { handled: false, forcedStage: d.door }; // match แรกชนะ
    }
    console.warn(JSON.stringify({ scope: "notify-precheck", event: "misconfigured", door: d.door, funnel: doorFunnel, hasPattern: Boolean(sv && sv.pattern.trim()), action: "fallback-handoff" }));
    await runHandoffFlow(userId, userMessage, transport, config, switches, `คำ_notify ประตู ${d.door} funnel=${doorFunnel ?? "ไม่พบ"}/pattern ว่าง — ปิดบอทเพื่อความปลอดภัย`);
    return { handled: true, forcedStage: null };
  }
  return { handled: false, forcedStage: null };
}

/** D-61.A (v3): ธงสุขภาพ — match คำ_ธงสุขภาพ (fallback [] = ไม่มี key ว่าง→ปิด) · ไม่ force stage ไม่ปิดบอท */
function matchHealthFlagV3(userMessage: string, config: AppConfig): boolean {
  if (config.healthFlagKeywords.length === 0) return false;
  return checkHandoffKeywords(userMessage, config.healthFlagKeywords, []).matched;
}

/** D-61.A (v3): hint ต่อท้าย state — delivered_steps เปลี่ยนหน้าที่จาก "เลือกข้อความ" → คำใบ้ให้ AI ไม่ทวนซ้ำ + บริบทสุขภาพ */
function buildV3StateHints(customer: CustomerState | null, healthFlagged: boolean): string {
  const parts: string[] = [];
  const sent = (customer?.deliveredSteps ?? []).filter((s) => !s.startsWith("__"));
  if (sent.length > 0) parts.push(`(เคยส่งสาระของประตูเหล่านี้ให้ลูกค้าแล้ว อย่าทวนซ้ำยาว สรุปสั้นพอ: ${sent.join(", ")})`);
  if (healthFlagged) {
    parts.push("🔴 บริบทสุขภาพเทิร์นนี้: ให้ข้อเท็จจริงจากข้อมูลสินค้า ถามกลับเพื่อเข้าใจได้ ห้ามประโยครับรองแทนลูกค้า (ทานได้/ปลอดภัย/ไม่เป็นไร) · ไม่รู้ = บอกตรงๆ + เสนอให้แอดมินเช็ค");
  }
  return parts.length > 0 ? `\n${parts.join("\n")}` : "";
}

interface ComposeReplyResult {
  baseReply: string;
  verbatimMode: boolean;
  deliverMarksStep: boolean;
}

/** v2 (D-42/D-45b): เลือกที่มาข้อความ precedence handoff > order-complete > OBJ > FAQ > step — ย้ายก้อนเดิมมาทั้งดุ้น (พฤติกรรมเดิมเป๊ะ) */
function composeReplyV2(args: {
  lib: BotLibrary | null;
  geminiOutput: GeminiTurnOutput;
  customer: CustomerState | null;
  config: AppConfig;
  objection: { verbatim: { id: string; pattern: string } | null };
  faqInj: { verbatim: { answer: string } | null };
  orderCompleteThisTurn: boolean;
  imageFallback: boolean;
  isHandoffTurn: boolean;
}): ComposeReplyResult {
  const { lib, geminiOutput, customer, config, objection, faqInj, orderCompleteThisTurn, imageFallback, isHandoffTurn } = args;
  const sv = lib ? stepVerbatim(lib.CSV_Step, geminiOutput.stage) : null;
  const stepFull = sv?.mode === "ปิด" ? sv.pattern : ""; // เนื้อเต็มก้อน (คำตอบ+ปิดท้าย) — เฉพาะโหมดปิด
  const stepClose = lib ? stepClosing(lib.CSV_Step, geminiOutput.stage) : "";
  const stepAlreadySent = (customer?.deliveredSteps ?? []).includes(geminiOutput.stage);
  // "กลับบ้าน" ต่อท้าย FAQ/OBJ: ยังไม่เคยส่งเนื้อหา step นี้ → เต็มก้อน · เคยแล้ว → ปิดท้าย (mode เปิด/เต็มว่าง → ปิดท้าย = พฤติกรรม D-42 เดิม)
  const homeSuffix = stepAlreadySent ? stepClose : stepFull || stepClose;
  const homeIsFull = !stepAlreadySent && stepFull !== "";
  // D-49 #3: ออเดอร์ครบเทิร์นนี้ (จริง ไม่ใช่แค่มี pending) → complete ชนะ FAQ/OBJ · log ตอนมีตัวจะแทรกจริง
  if (orderCompleteThisTurn && !isHandoffTurn && (objection.verbatim || faqInj.verbatim)) {
    console.log(JSON.stringify({ scope: "verbatim", event: "order-complete-overrides-faq-obj", stage: geminiOutput.stage, hadObjection: Boolean(objection.verbatim), hadFaq: Boolean(faqInj.verbatim) }));
  }
  if (imageFallback) {
    return { baseReply: imageReceivedReply(config), verbatimMode: false, deliverMarksStep: false }; // AI degraded อ่านรูปไม่ได้ → ไม่ verbatim (stage ไม่น่าเชื่อถือ)
  }
  if (geminiOutput.degraded) {
    // 🔴 D-46: เทิร์นข้อความล้วนที่ Gemini ไม่ตอบ → บอกตรงว่า "ยังไม่ได้รับข้อความล่าสุด รบกวนส่งใหม่" · ห้าม verbatim/resend step
    console.warn(JSON.stringify({ scope: "degraded", reason: "gemini-no-output", stage: geminiOutput.stage }));
    return { baseReply: DEGRADED_NO_INPUT_REPLY, verbatimMode: false, deliverMarksStep: false };
  }
  if (!isHandoffTurn && !orderCompleteThisTurn && objection.verbatim) {
    console.log(JSON.stringify({ scope: "verbatim", source: "objection", id: objection.verbatim.id, homeFull: homeIsFull }));
    return { baseReply: joinVerbatimParts(objection.verbatim.pattern, homeSuffix), verbatimMode: true, deliverMarksStep: homeIsFull };
  }
  if (!isHandoffTurn && !orderCompleteThisTurn && faqInj.verbatim) {
    // D-42/D-45b: FAQ answer + กลับบ้าน (เต็มก้อน step ครั้งแรก · ปิดท้ายเมื่อเคยส่งแล้ว)
    console.log(JSON.stringify({ scope: "verbatim", source: "faq", stage: geminiOutput.stage, homeFull: homeIsFull }));
    return { baseReply: joinVerbatimParts(faqInj.verbatim.answer, homeSuffix), verbatimMode: true, deliverMarksStep: homeIsFull };
  }
  // step path: ยังไม่เคยส่ง → เต็มก้อน · เคยส่งแล้ว → ปิดท้ายอย่างเดียว (ปิดท้ายว่าง → fallback AI ผ่าน guard เดิม)
  const stepPattern = stepAlreadySent ? stepClose : stepFull;
  if (sv?.mode === "ปิด" && stepPattern) {
    console.log(JSON.stringify({ scope: "verbatim", source: "step", stage: geminiOutput.stage, resendClosingOnly: stepAlreadySent }));
    return { baseReply: stepPattern, verbatimMode: true, deliverMarksStep: !stepAlreadySent };
  }
  // safety (D-39): ปิดแต่ pattern ว่าง (2 ช่องว่าง / เคยส่งแล้ว+ปิดท้ายว่าง) → fallback เปิด (AI ผ่าน guard ครบ) + log
  if (sv?.mode === "ปิด" && !stepPattern) {
    console.warn(JSON.stringify({ scope: "verbatim", event: "empty-pattern-fallback-ai", stage: geminiOutput.stage, alreadySent: stepAlreadySent }));
  }
  return { baseReply: geminiOutput.reply, verbatimMode: false, deliverMarksStep: false };
}

/** D-61.A (v3): เรียบเรียงสด — reply ของ AI ส่งตรง (ยามตรวจ "ผลลัพธ์" ทีหลัง ไม่บังคับเนื้อหา) · เหลือ 2 ทางพิเศษเดิม: รูป-fallback / degraded */
function composeReplyV3(args: { geminiOutput: GeminiTurnOutput; imageFallback: boolean; config: AppConfig }): ComposeReplyResult {
  const { geminiOutput, imageFallback, config } = args;
  if (imageFallback) return { baseReply: imageReceivedReply(config), verbatimMode: false, deliverMarksStep: false };
  if (geminiOutput.degraded) {
    console.warn(JSON.stringify({ scope: "degraded", reason: "gemini-no-output", stage: geminiOutput.stage }));
    return { baseReply: DEGRADED_NO_INPUT_REPLY, verbatimMode: false, deliverMarksStep: false };
  }
  // delivered_steps ใน v3 = hint + dedup 🔔 เท่านั้น (A1) — mark ทุกเทิร์นที่เนื้อหาถึงลูกค้าจริง
  return { baseReply: geminiOutput.reply, verbatimMode: false, deliverMarksStep: true };
}

/**
 * D-61.A (v3): assurance guard — เทิร์นธงสุขภาพ + คำตอบมีประโยครับรอง →
 * บล็อก → regenerate 1 ครั้ง (แนบเหตุผล) → ยังหลุด/ล้ม/timeout = กลับคำตอบรอบแรกตัดประโยคผิด (เจ้าของเคาะ #2)
 * ตัดแล้วว่างหมด = fallback สุภาพ · ห้ามล้มทั้งเทิร์น ห้ามบอทเงียบ
 */
async function applyAssuranceGuardV3(opts: {
  outReply: string;
  phrases: string[];
  regenerate: (correction: string) => Promise<GeminiTurnOutput | null>;
  resolveReply: (raw: string) => string;
}): Promise<string> {
  const hits = findAssuranceHits(opts.outReply, opts.phrases);
  if (hits.length === 0) return opts.outReply;
  console.warn(JSON.stringify({ scope: "assurance-guard", event: "hit", hits }));
  let candidate: string | null = null;
  try {
    const regen = await opts.regenerate(`มีประโยครับรองเรื่องสุขภาพแทนลูกค้า (${hits.join(", ")}) — ห้ามใช้ทุกรูปแบบ ให้ข้อเท็จจริงแล้วลูกค้าตัดสินใจเอง`);
    if (regen && !regen.degraded && regen.reply.trim() !== "") candidate = opts.resolveReply(regen.reply);
  } catch (error) {
    console.error(JSON.stringify({ scope: "assurance-guard", warning: "regenerate failed", error: String(error).slice(0, 80) }));
  }
  if (candidate && findAssuranceHits(candidate, opts.phrases).length === 0) {
    console.log(JSON.stringify({ scope: "assurance-guard", event: "regenerated-clean" }));
    return candidate;
  }
  const cut = cutAssuranceLines(opts.outReply, opts.phrases);
  console.warn(JSON.stringify({ scope: "assurance-guard", event: "cut", cutLines: cut.cutLines, droppedBubbles: cut.droppedBubbles, empty: cut.text === "" }));
  return cut.text === "" ? ASSURANCE_FALLBACK_REPLY : cut.text;
}

/** D-58 (v2): 🔔 ประตู notify — ย้ายก้อนเดิมมาทั้งดุ้น (ข้อความเดิมเป๊ะ) · เรียกเฉพาะใน block mark delivered_steps (dedup เดิม) */
async function pushNotifyDoorV2(args: { userId: string; userMessage: string; stageFunnelReply: string | null; transport: ChannelTransport }): Promise<void> {
  if (args.stageFunnelReply !== "handoff_notify") return;
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (!adminGroupId) return;
  const name = await args.transport.getProfileName();
  await pushRawText(adminGroupId, `🔔 ${channelLabel(args.userId)} ${name} ถามเรื่องสุขภาพ/แพ้อาหาร — บอทตอบข้อมูลตามชีตแล้ว ยังคุยต่อ (ไม่ได้ปิดบอท) รบกวนช่วยดูให้ด้วยค่ะ\nข้อความ: ${args.userMessage}`);
}

/**
 * D-61.A (v3): 🔔 ธงสุขภาพ — ครั้งเดียวต่อเคสผ่าน HEALTH_NOTIFY_MARKER (mark ก่อน push กันยิงซ้ำ)
 * 🔴 D-61.C2: แยก 2 แบบตามว่าลูกค้าได้คำตอบไหม
 *   - ตอบแล้ว    → เนื้อจาก Config `ข้อความ_แจ้งแอดมิน_notify` (ตามได้ ไม่ด่วน · ของเดิมเป๊ะ)
 *   - ยังไม่ตอบ → เนื้อในโค้ด HEALTH_NOTIFY_UNANSWERED (ด่วน) — template ในชีตเขียนไว้สำหรับเคส
 *     "บอทตอบแล้ว" เอามาใช้ตอนบอทยังไม่ตอบจะสื่อผิดและทำให้แอดมินไม่รีบ
 * dedup marker ตัวเดียวคุมทั้งสองแบบ → 1 เคสได้ 🔔 ครั้งเดียว ไม่ว่าเทิร์นแรกจบแบบไหน
 */
async function pushHealthNotifyV3(args: {
  userId: string;
  userMessage: string;
  healthFlagged: boolean;
  customer: CustomerState;
  config: AppConfig;
  transport: ChannelTransport;
  /** เทิร์นนี้ลูกค้าไม่ได้คำตอบจริง (AI ล้ม / อ่านรูปไม่ได้ / ส่งไม่สำเร็จ) */
  unanswered: boolean;
}): Promise<void> {
  if (!args.healthFlagged) return;
  if (args.customer.deliveredSteps.includes(HEALTH_NOTIFY_MARKER)) return; // dedup ต่อเคส (คุมทั้ง 2 แบบ)
  await addDeliveredStep(args.userId, HEALTH_NOTIFY_MARKER);
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  if (!adminGroupId) return;
  const name = await args.transport.getProfileName();
  const head = args.unanswered ? "🔴🔔" : "🔔";
  const body = args.unanswered ? HEALTH_NOTIFY_UNANSWERED : args.config.notifyAdminHealthTemplate;
  console.log(JSON.stringify({ scope: "health-notify", event: "push", unanswered: args.unanswered }));
  await pushRawText(adminGroupId, `${head} ${channelLabel(args.userId)} ${name} ${body}\nข้อความ: ${args.userMessage}`);
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
  transport: ChannelTransport,
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
      const name = await transport.getProfileName();
      const text = `💰 มีลูกค้าส่งสลิปมาค่ะ${noteLine}\n\nLineOA: ${channelLabel(userId)} ${name}`;
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
    const signedUrl = uploaded ? await getSlipSignedUrl(uploaded.pathname, config.slipUrlExpiryDays) : null;
    // เคลม = ส่งต่อคน → ผ่านประตูรวม (ปิดบอท + footer + แนบรูปหลักฐาน ไม่ให้หาย)
    await handoff(userId, switches, {
      reason: "ลูกค้าแจ้งปัญหา/เคลม",
      attachImage: signedUrl ? { url: signedUrl, note: imageNote ? `หลักฐาน:${noteLine}` : undefined } : undefined,
    }, transport);
  }
  return null;
}

/**
 * gate ออเดอร์: ตัดสินจาก pending_order (merge แล้วจากผู้เรียก) + ผลราคาจาก lib/core/pricing → ลงมือ
 * การ "ตัดสิน" อยู่ที่ lib/core/orders.ts (evaluateOrderGate) · ฟังก์ชันนี้เหลือแค่ I/O: DB / ชีต / Blob / push
 * 🔴 D-18: ยอด/ค่าส่ง มาจาก price (Core) เสมอ — ไม่อ่านจาก AI · guard 2 ไม่บล็อกคำพูด (ส่งไปแล้ว)
 *   แต่ถ้าเลขที่บอทพูด (X บาท) ≠ เลขที่ Core รู้จัก → ไม่ปิดออเดอร์ + แจ้งแอดมินให้ยืนยัน
 */
async function runOrderGate(
  userId: string,
  customer: CustomerState,
  pending: PendingOrder,
  price: PriceResult | null,
  slipThisTurn: string | null,
  config: AppConfig,
  nameMap: Map<string, string>,
  replyText: string,
  allowedNumbers: Set<string>,
  transport: ChannelTransport,
): Promise<void> {
  const slipPathname = slipThisTurn ?? customer.lastSlipPathname ?? null;
  const priceOk = price !== null && price.error === null && !price.needsHandoff;
  const gate = evaluateOrderGate({ pending, slipPresent: Boolean(slipPathname), priceOk });
  const payment = gate.payment;
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  const normItems = normalizeItems(pending.items);

  // guard 2 (ไม่บล็อกคำพูด · ปกป้องเงิน): เลขที่บอท "แจ้งเป็นยอด" (X บาท) ต้องเป็นเลขที่ Core รู้จัก
  const spokenBaht = extractBahtNumbers(replyText);
  const guard2Off = spokenBaht.filter((n) => !allowedNumbers.has(n));
  const priceSpeechOk = guard2Off.length === 0;
  const complete = gate.complete && priceSpeechOk;

  // log gate ทุกเทิร์น (PII-safe: ชื่อ field + จำนวน item + สถานะราคา · ไม่ log ค่าจริง)
  console.log(
    JSON.stringify({
      scope: "orders",
      event: "gate",
      filledFields: (["ชื่อ", "ที่อยู่", "เบอร์", "การชำระเงิน"] as const).filter((k) => (pending[k] ?? "").trim() !== ""),
      itemCount: normItems.length,
      priceOk,
      priceError: price?.error ?? null,
      priceHandoff: price?.needsHandoff ?? false,
      payment,
      complete,
      priceSpeechOk,
      guard2Offending: guard2Off,
      missing: gate.missing,
      brokenOrder: gate.brokenOrder,
      waitTag: gate.waitTag,
      slipPresent: Boolean(slipPathname),
    }),
  );

  // guard 2 mismatch: บอทพูดยอดที่ Core ไม่รู้จัก ทั้งที่ข้อมูลครบ → ไม่ปิด + แจ้งแอดมินยืนยัน (ไม่บล็อกคำพูด)
  if (gate.complete && !priceSpeechOk) {
    if (adminGroupId) {
      const name = await transport.getProfileName();
      await pushRawText(
        adminGroupId,
        `⚠️ ยอดไม่ตรง — บอทแจ้งลูกค้า ${guard2Off.join("/")} บาท · ระบบคำนวณ ${price ? price.total : "?"} บาท ขอยืนยัน\nรายการ: ${itemsToNames(pending.items, nameMap)}\n———\nLineOA: ${channelLabel(userId)} ${name}`,
      );
    }
  }

  if (complete && price) {
    const orderId = pending.order_id ?? "";
    // idempotency (D-29): "เขียนสำเร็จแล้ว" (มีใน Neon) → ข้าม ไม่เขียนซ้ำ · retry ที่ clear ค้างก็จบ
    //   🔴 ต่างจาก "มี order_id ใน pending" (แค่สร้าง id · append อาจล้ม) — เช็คสถานะ "เขียนสำเร็จ" เท่านั้น
    if (orderId && (await isOrderWritten(orderId))) {
      console.log(JSON.stringify({ scope: "orders", event: "idempotent-skip", orderId, reason: "เขียนสำเร็จแล้ว (retry หลัง clear ล้ม) — ไม่เขียนซ้ำ ไม่ push" }));
      await clearPendingOrderAndSlip(userId);
      await reconcileWaitTags(userId, null);
      await setPaidNoAddressNotified(userId, false);
      return;
    }
    const name = await transport.getProfileName();
    try {
      await appendOrderRow({
        lineDisplayName: name,
        productAndQty: formatLinesForSheet(price.lines), // I = "น้ำพริกปลาทู x4 | ..."
        total: String(price.total), // J = ยอดจาก Core
        customerName: pending["ชื่อ"],
        phone: pending["เบอร์"],
        address: pending["ที่อยู่"],
        paymentMethod: payment,
        slipPathname: payment === "โอน" ? slipPathname ?? undefined : undefined,
        itemsJson: JSON.stringify(normItems), // S = items_json
        shippingFee: String(price.shippingFee), // T = ค่าส่ง
        orderId, // Q = idempotency key
        lineUserId: userId, // R = join key — cron ล้างธง delivered_steps ตอนแจกเลข (KI-06) · M-2 = fb:... สำหรับ messenger
        sourceChannel: transport.channel === "messenger" ? "messenger" : "", // U (M-2 · LINE ว่างเปล่าเดิม)
      });
    } catch (error) {
      // 🔴 append ล้มจริง (403/network/quota) = ยังไม่เขียน → ไม่ mark written ไม่ clear → retry เทิร์นหน้า "เขียนใหม่" (ออเดอร์ไม่หาย)
      console.error(JSON.stringify({ scope: "orders", warning: "appendOrderRow failed", orderId, error: String(error) }));
      return; // เขียนไม่สำเร็จ = ไม่ล้าง ไม่ push (retry เทิร์นหน้าได้)
    }
    // เขียนชีตสำเร็จ → บันทึกใน Neon ทันที (source of truth กันเขียนซ้ำ) ก่อน clear/push
    await markOrderWritten(orderId, userId);
    // D-32: เก็บ snapshot ออเดอร์ (แยกจาก pending ที่กำลังจะ clear) → แก้/ทวน/ไม่ถูกโยนกลับต้นกรวย
    if (orderId) {
      await setLastOrder(userId, {
        order_id: orderId,
        ชื่อ: pending["ชื่อ"],
        ที่อยู่: pending["ที่อยู่"],
        เบอร์: pending["เบอร์"],
        items: normItems,
        total: price.total,
        payment,
      });
    }
    await clearPendingOrderAndSlip(userId);
    await reconcileWaitTags(userId, null);
    await setHasWrittenOrder(userId);
    await setPaidNoAddressNotified(userId, false);
    if (adminGroupId) {
      const text = buildNewOrderAdminText(formatOrderSummary(price.lines), price.total, payment, `${channelLabel(userId)} ${name}`, pending["เบอร์"] ?? "");
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

  // ---- ยังไม่ครบ → ติดแท็กรอ (D-11: ไม่ push ตอนจัดส่งยังไม่ครบ) ----
  await reconcileWaitTags(userId, gate.waitTag);

  // ปัญหาที่ต้องแจ้งแอดมิน (กัน spam ด้วย flag เดียว · แจ้ง "ตอนสรุปครบ" ไม่ใช่ระหว่างทาง):
  //  - D-13 brokenOrder: จัดส่งครบ แต่ AI ไม่ extract items
  //  - price ล้ม ทั้งที่ "ข้อมูลลูกค้าครบพร้อมปิดยกเว้นราคา" = ราคาคำนวณไม่ได้/เกินเพดาน (กฎ j/k)
  //    🔴 ใช้ readyExceptPrice (ไม่ใช่แค่ items>0) — กันแจ้งเร็วตอนยังไม่มีที่อยู่แล้วเผา flag
  //       จนตอนข้อมูลครบจริงไม่ได้แจ้ง (แอดมินเลยไม่มีข้อมูลติดต่อลูกค้า)
  const priceFailed = price !== null && (price.error !== null || price.needsHandoff);
  const priceStuckReady = gate.readyExceptPrice && priceFailed;
  if ((gate.brokenOrder || priceStuckReady) && !customer.paidNoAddressNotified) {
    if (adminGroupId) {
      const name = await transport.getProfileName();
      const labeledName = `${channelLabel(userId)} ${name}`;
      const text = priceStuckReady
        ? buildPriceStuckAdminText(pending, price?.error ?? "เกินเพดาน/ต้องมีคนดู", labeledName, itemsToNames(pending.items, nameMap))
        : buildBrokenOrderAdminText(pending, gate.missing, labeledName);
      await pushRawText(adminGroupId, text);
    }
    await setPaidNoAddressNotified(userId, true);
  }
}

// export สำหรับ T-STUDIO (/train) เท่านั้น — simulator เรียก pipeline เต็มสายผ่านตัวนี้ตรง
// (ข้าม debounce ของ handleTextMessage โดยตั้งใจ: debounce มีผลแค่รวบข้อความ ไม่มีผลต่อผลลัพธ์ต่อเทิร์น)
export async function processMessage(
  userId: string,
  userMessage: string,
  transport: ChannelTransport,
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
      const name = await transport.getProfileName();
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
        // 🔴 log ให้ชัดว่าบอท "ถูกปิดอยู่" (human_mode) — เดิม return เงียบ = debug ไม่ได้ เข้าใจผิดว่าระบบล่ม
        console.log(JSON.stringify({
          scope: "handoff", event: "bot-silent-human-mode",
          reason: "อยู่โหมดแอดมินดูแล (human_mode) — บอทไม่ตอบ",
          silentMinutes: Math.floor(silentMs / 60000),
          returnAfterMinutes: config.adminSilenceReturnMinutes,
          hint: "คืนบอท: พิมพ์ 'เปิดบอท <ชื่อ>' ในกลุ่มแอดมิน หรือ /reset (โหมดเทสต์)",
        }));
        await addMessage(userId, "user", userMessage);
        return; // แอดมินกำลังดูแลลูกค้ารายนี้อยู่ ไม่ตอบอัตโนมัติ
      }
    }

  }

  // 🔴 D-61.A: โหมด schema — เช็คครั้งเดียวต้นทาง ทุก branch point ใช้ตัวนี้ (v2 = เส้นเดิมทุกบรรทัด)
  const v3 = isSchemaV3();

  if (switches.handoff) {
    // v3: DEFAULT fallback = เฉพาะเจตนาเรียกคน (ตาข่ายสุขภาพย้ายไปธง+assurance guard) · v2: ชุดเดิมห้ามขยับ (เจ้าของเคาะ #1)
    const preCheck = checkHandoffKeywords(userMessage, config.handoffKeywords, v3 ? DEFAULT_HANDOFF_KEYWORDS_V3 : DEFAULT_HANDOFF_KEYWORDS);
    if (preCheck.matched) {
      await runHandoffFlow(userId, userMessage, transport, config, switches, `เจอคำสำคัญ: ${preCheck.keyword}`);
      return;
    }
  }

  const previousStage = customer?.stage ?? null;

  // D-18 region injection: โค้ดตัดสิน funnel จาก pending (ก่อน merge) ไม่พึ่ง stage ที่ AI ตอบ
  //   quoted = pending มี items แล้ว (= สรุปยอดไปแล้ว → S4) · ยังไม่มี = S1-S3 (สรุปยอดเข้าถึงได้)
  // FAQ: สารบัญทุกข้อ + เต็มเฉพาะที่ keyword ตรง
  const lib = await loadBotLibrary();

  // 🔴 D-61.A branch: v2 = คำ_notify force ประตู (D-58/D-60 เดิมเป๊ะ · notifyPrecheckV2) · v3 = ธงสุขภาพ (ไม่ force · hint+🔔+assurance guard)
  let notifyForcedStage: string | null = null;
  let healthFlagged = false;
  if (switches.handoff) {
    if (v3) {
      healthFlagged = matchHealthFlagV3(userMessage, config);
      if (healthFlagged) console.log(JSON.stringify({ scope: "health-flag", event: "flagged" }));
    } else {
      const r = await notifyPrecheckV2({ userId, userMessage, transport, config, switches, lib });
      if (r.handled) return; // fail-safe ปิดบอทไปแล้ว
      notifyForcedStage = r.forcedStage;
    }
  }

  const preItems = normalizeItems(customer?.pendingOrder.items);

  // D-32: ออเดอร์ที่เขียนแล้ว (last_order) → สัญญาณ routing + บรรทัดสถานะ + ตัวแปรทวน (แยกจาก pending)
  const lastOrder = customer?.lastOrder ?? null;
  const orderLocked = customer?.lastOrderLocked ?? false;
  const lastOrderNameMap = lib ? buildProductNameMap(lib.CSV_Products) : new Map<string, string>();
  const lastOrderItemsText = lastOrder?.items?.length
    ? lastOrder.items.map((it) => `${lastOrderNameMap.get(it.sku) ?? it.sku} x${it.qty}`).join(" · ")
    : "";
  // 🔴 สัญญาณสำหรับ "เข้าเมื่อ" ในชีต (เจ้าของคุมประตู) — order_editable (M≠TRUE) / order_confirmed_locked (M=TRUE)
  const orderSignals: string[] = lastOrder ? [orderLocked ? "order_confirmed_locked" : "order_editable"] : [];
  const lastOrderLine = lastOrder
    ? `ออเดอร์ที่บันทึกแล้ว ${lastOrder.order_id}: ชื่อ ${lastOrder["ชื่อ"] ?? "-"} · ที่อยู่ ${lastOrder["ที่อยู่"] ?? "-"} · เบอร์ ${lastOrder["เบอร์"] ?? "-"} · ${lastOrderItemsText || "-"} · ยอด ${lastOrder.total ?? "-"} บาท · สถานะ: ${orderLocked ? "คอนเฟิร์มแล้ว (ของอาจแพ็คแล้ว · แก้เองไม่ได้ ส่งต่อแอดมิน)" : "ยังแก้ได้ (ลูกค้าขอแก้ field ไหน → ส่ง order_data ของ field นั้น 'เต็มก้อน' ที่แก้แล้ว ไม่ใช่เศษ)"}`
    : null;

  const stepTextRaw =
    lib && lib.CSV_Step.length > 0
      ? buildStepInjection(lib.CSV_Step, { quoted: preItems.length > 0, payment: customer?.pendingOrder["การชำระเงิน"] ?? "", userMessage, signals: orderSignals, stayStage: customer?.stage ?? undefined })
      : "(ไม่มีข้อมูลสเต็ป)";

  // D-15 pre-resolve: ถ้า pending มี items อยู่แล้ว (จากเทิร์นก่อน) → คำนวณยอด แล้วเติม
  // {สรุปรายการ}/{ยอดรวม}/{การชำระเงิน} ในสเต็ป → บอทพูดยอดได้ในเทิร์นเดียว (ไม่ต้อง pass 2)
  const nowDate = new Date();
  const ordersActive = switches.orders && switches.memory && Boolean(customer);
  const preQuote = ordersActive && customer ? computeQuote(customer.pendingOrder, lib, config, nowDate) : null;
  const preVars: RuntimeVarContext = preQuote?.vars ?? EMPTY_VARS;
  // D-32: resolve ตัวแปรออเดอร์ล่าสุด ({ออเดอร์_ที่อยู่} ฯลฯ) ใน stepText → AI เห็นค่าจริงไว้ทวน/ประกอบที่อยู่ใหม่
  const stepText = resolveOrderVars(resolveRuntimeVars(stepTextRaw, preVars), lastOrder, lastOrderItemsText);
  // มี items แล้วแต่ราคาคำนวณไม่ได้ (config พัง/เกินเพดาน) → บอก AI ว่ายังบันทึกไม่ได้ (กันสัญญาวันส่งเท็จ)
  const preOrderPriceStuck = preQuote !== null && !preQuote.ok;
  // D-30: เจตนาซื้อแล้ว (items+เลือกจ่าย) แต่ยังไม่ครบ → เตือนใน state ว่ายังไม่บันทึก + ระบุที่ขาด (กันบอทสัญญาวันส่ง)
  const preGate = customer
    ? evaluateOrderGate({ pending: customer.pendingOrder, slipPresent: Boolean(customer.lastSlipPathname), priceOk: preQuote?.ok ?? false })
    : null;
  const orderWarning = customer && preGate ? buildOrderStateWarning(customer.pendingOrder, preGate) : null;

  const faqInj = lib && lib.CSV_FAQ.length > 0 ? buildFaqInjection(lib.CSV_FAQ, userMessage) : { text: "(ไม่มีข้อมูล FAQ)", verbatim: null };
  const faqText = faqInj.text;
  // ยัดสินค้า+ราคาโปรเสมอ (บอทห้ามแต่งราคา C6) — CSV_Products/CSV_Promo ไม่เคยถูกยัดมาก่อน
  // ตารางราคาสำเร็จรูป (D-24): เลขทุกตัวจาก calculatePrice (แหล่งเดียวกับ gate) · payment ตาม pending เพื่อให้ตรงที่จะบันทึก
  const catalogText = lib
    ? buildCatalogInjection(lib.CSV_Products, lib.CSV_Promo, {
        config: Object.fromEntries(config.raw),
        payment: customer?.pendingOrder["การชำระเงิน"] ?? "",
        now: nowDate,
        methodDescription: readConfigDescription(lib.CSV_Config, "จำนวนที่ไม่มีโปร_คิดยังไง"),
        includeAllergen: v3, // D-61.B เคาะ #4ก — v3 เปิดสารก่อภูมิแพ้เข้า prompt
      })
    : "(ไม่มีข้อมูลสินค้า)";
  // D-27 Objections: keyword match → verbatim/จำแนก · cap จากชีต (ไม่ hardcode) · v2.0 (D-41): เลิก Examples
  const objCap = numFromRaw(config, "จำนวนข้อโต้แย้งที่ยัดเข้า prompt", 2);
  const objection = lib ? buildObjectionInjection(lib.CSV_Objections, userMessage, objCap) : { text: "", matchedIds: [] as string[], verbatim: null };
  const configText = formatConfigForPrompt(config);
  let stateText = buildStateText(customer, orderWarning, preOrderPriceStuck, lastOrderLine);
  // D-61.A (v3): hint เข้า state — delivered_steps ("อย่าทวนซ้ำยาว") + บริบทสุขภาพ (ธง A6)
  if (v3) stateText += buildV3StateHints(customer, healthFlagged);

  let historyText = "(ระบบความจำปิดอยู่)";
  let historyLen = 0; // D-51: ประวัติก่อนเทิร์นนี้ (0 = ลูกค้าใหม่/หลัง reset) — ใช้ตัดสินทักทายรายวัน
  if (switches.memory) {
    const history = await getRecentHistory(userId, 20);
    historyLen = history.length;
    historyText = formatHistoryForPrompt(history);
  }

  // 🔴 D-47 ชิ้น 2: redact เลขบัญชี/เบอร์ (ค่าที่รู้จริง) ใน input โมเดล — ลดชนวน money-fraud classifier
  //    เฉพาะ history (เทิร์นเก่า) + state · ข้อความสด userMessage ไม่แตะ (AI ต้องสกัดเบอร์/ที่อยู่จากเทิร์นนี้) · DB/ลูกค้า ไม่แตะ
  const redactAccounts = [config.raw.get("เลขที่บัญชี") ?? "", config.raw.get("เลขพร้อมเพย์") ?? ""];
  const redactPhones = [customer?.pendingOrder["เบอร์"] ?? "", lastOrder?.["เบอร์"] ?? ""];
  const redactHistory = redactFinancial(historyText, redactAccounts, redactPhones);
  const redactState = redactFinancial(stateText, redactAccounts, []); // state คง เบอร์ ไว้ให้ AI รู้ว่าเก็บแล้ว (redact แค่บัญชี)
  historyText = redactHistory.text;
  stateText = redactState.text;
  // D-48 ตอบข้อ 1: นับ redaction ต่อเทิร์น → ยืนยันว่า input โมเดลเป็น [เลขบัญชี]/[เบอร์] จริง ไม่ใช่เลขดิบ
  console.log(JSON.stringify({ scope: "redact", history: redactHistory.count, state: redactState.count, historyLen: historyText.length }));

  // 🔴 D-47 ชิ้น 1: payment pre-check — เทิร์นเลือกวิธีจ่าย (เสี่ยงบล็อกสูงสุด) โค้ดตัดสิน ไม่พึ่ง AI
  //    เงื่อนไข: มี items ใน pending + ไม่มีรูป → จับ โอน/COD จากข้อความ
  //    D-48 fix (2): ตัด noPaymentYet ออก — เดิมล็อกยิงเฉพาะเทิร์นเลือกจ่ายครั้งแรก · เคส "เปลี่ยนเป็น COD"
  //    (ลูกค้ามี payment=โอน อยู่แล้ว) เลย detect ไม่ได้ → gate คงค่าเก่า · detect ทุกเทิร์นครอบเคสเปลี่ยนด้วย
  const prePayment = ordersActive && customer && preItems.length > 0 && !imageContent
    ? detectPaymentChoice(userMessage) : "";
  // ข้อความ = คำเลือกวิธีจ่ายล้วน + resolve ประตูได้ → ข้าม AI ทั้งเทิร์น (deterministic)
  // 🔴 D-61.A: skip นี้ = v2 เท่านั้น — v3 ต้องให้ AI เขียน reply เสมอ (ไม่มี verbatim มาเติม) · lock ทับ payment_method (D-47 ชิ้น 1) ยังคุมทั้งสองโหมด
  const preCheckStep = !v3 && prePayment && isPaymentChoiceOnly(userMessage) && lib ? resolvePaymentStep(lib.CSV_Step, prePayment) : null;

  let geminiOutput: GeminiTurnOutput;
  if (preCheckStep) {
    geminiOutput = {
      reply: "", stage: preCheckStep, tagsAdd: [], handoff: false, handoffReason: "",
      orderData: {}, paymentMethod: prePayment, orderEditRequest: false,
      imageIntent: "other", imageNote: "", objectionDetected: "none", degraded: false,
    };
    console.log(JSON.stringify({ scope: "payment-precheck", payment: prePayment, stage: preCheckStep, skippedAI: true }));
  } else if (notifyForcedStage) {
    // 🔴 D-58: บังคับประตู notify (ข้าม AI/FAQ/OBJ) → pipeline เดิมส่ง pattern verbatim + 🔔 + ไม่ปิดบอท (funnel=handoff_notify)
    geminiOutput = {
      reply: "", stage: notifyForcedStage, tagsAdd: [], handoff: false, handoffReason: "",
      orderData: {}, paymentMethod: "" as const, orderEditRequest: false,
      imageIntent: "other", imageNote: "", objectionDetected: "none", degraded: false,
    };
    console.log(JSON.stringify({ scope: "notify-precheck", forced: true, stage: notifyForcedStage, skippedAI: true }));
  } else {
    geminiOutput = await withTimeout(
      runSalesTurn({
        config,
        configText,
        stepText,
        faqText,
        catalogText,
        objectionText: objection.text,
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
        orderData: {},
        paymentMethod: "" as const,
        orderEditRequest: false,
        imageIntent: "other" as ImageIntent,
        imageNote: "",
        objectionDetected: "none",
        degraded: true, // withTimeout กินเวลาเกิน 8s = Gemini ล้ม
      },
    );
    // 🔴 เส้นทางเงิน deterministic: pre-check จับวิธีจ่ายได้ (ข้อความพ่วงอื่น/AI degraded ไม่ตั้ง) → ล็อกทับผล AI
    if (prePayment && !geminiOutput.paymentMethod) {
      geminiOutput = { ...geminiOutput, paymentMethod: prePayment };
      console.log(JSON.stringify({ scope: "payment-precheck", payment: prePayment, lockedOverAI: true }));
    }
  }

  // D-27 log: objection ที่ AI ตรวจพบ vs code keyword-match → หาสำนวนที่ยังไม่อยู่ในชีต (เจ้าของเติมช่อง "ลูกค้าพูดแบบไหนบ้าง")
  if (geminiOutput.objectionDetected && geminiOutput.objectionDetected !== "none") {
    console.log(JSON.stringify({
      scope: "objection", event: "detected",
      aiDetected: geminiOutput.objectionDetected,
      codeMatched: objection.matchedIds,
      gap: objection.matchedIds.includes(geminiOutput.objectionDetected) ? null : "AI เจอแต่ keyword ไม่ match — เติมสำนวนในชีต",
    }));
  }

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

  // ลูกค้าขอแก้ออเดอร์ที่ "บันทึกลงชีตแล้ว" (D-31 Plan B): M≠TRUE → แก้แถวเดิมด้วย order_id (ไม่ handoff) · M=TRUE/หาไม่เจอ → handoff
  let editHandled = false;
  if (geminiOutput.orderEditRequest && customer?.hasWrittenOrder) {
    editHandled = true; // ข้าม order flow (ห้ามเขียนแถวใหม่) + ข้าม AI-semantic handoff ท้ายเทิร์น
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    const orderId = customer.lastOrderId ?? "";
    const name = await transport.getProfileName();

    // ค่าใหม่ที่ลูกค้าแก้เทิร์นนี้ (เฉพาะที่ AI ส่งมา) → keyed ด้วยชื่อคอลัมน์ Orders
    const { items: aiEditItems, ...editReceiver } = geminiOutput.orderData;
    const changes: Record<string, string> = {};
    if (editReceiver["ชื่อ"]?.trim()) changes["ชื่อ-นามสกุล"] = editReceiver["ชื่อ"].trim();
    if (editReceiver["ที่อยู่"]?.trim()) changes["ที่อยู่"] = editReceiver["ที่อยู่"].trim();
    if (editReceiver["เบอร์"]?.trim()) changes["เบอร์โทร"] = sanitizePhone(editReceiver["เบอร์"]);
    const editItems = resolveAiItems(aiEditItems, lib?.CSV_Products ?? []);
    if (editItems.length > 0 && geminiOutput.paymentMethod) {
      const q = computeQuote({ items: editItems, การชำระเงิน: geminiOutput.paymentMethod }, lib, config, nowDate);
      if (q?.ok) {
        changes["สินค้า+จำนวน"] = formatLinesForSheet(q.price.lines);
        changes["ยอดเงิน"] = String(q.price.total);
        changes["ค่าส่ง"] = String(q.price.shippingFee);
        changes["items_json"] = JSON.stringify(normalizeItems(editItems));
      }
    }

    const result = await updateOrderRow(orderId, changes, nowDate);
    console.log(JSON.stringify({ scope: "orders", event: "order-edit", orderId, status: result.status, changedFields: Object.keys(changes), suspect: result.suspect ?? [] }));
    if (result.status === "updated") {
      if (adminGroupId) await pushRawText(adminGroupId, buildOrderEditAdminText(orderId, result.changed ?? [], `${channelLabel(userId)} ${name}`));
    } else if (result.status === "confirmed") {
      // แอดมินคอนเฟิร์มแล้ว (M=TRUE · ของไปแพ็ค) → ล็อก + ส่งต่อคน (X2) ผ่านประตูรวม
      if (switches.memory) await setLastOrderLocked(userId);
      await handoff(userId, switches, { reason: `ขอแก้ออเดอร์ที่คอนเฟิร์มแล้ว ${orderId} (ของอาจแพ็คแล้ว)`, userMessage }, transport);
    } else if (result.status === "not_found") {
      console.error(JSON.stringify({ scope: "orders", event: "order-edit-not-found", orderId }));
      await handoff(userId, switches, { reason: `ขอแก้ออเดอร์ ${orderId || "(ไม่มี id)"} แต่หาแถวในชีตไม่เจอ`, userMessage }, transport);
    }
    // 🔴 ที่อยู่ใหม่สั้นผิดปกติ → ไม่ทับ (กันเขียนที่อยู่ผิด) + แจ้งแอดมิน (บอทควรถามลูกค้ายืนยันที่อยู่เต็ม — เทรนใน S_EDIT)
    if ((result.suspect?.length ?? 0) > 0 && adminGroupId) {
      await pushRawText(adminGroupId, `⚠️ ลูกค้าแก้ ${result.suspect!.join("/")} ของ ${orderId} แต่ค่าที่ได้สั้นผิดปกติ — ไม่เขียนลงชีต รบกวนยืนยันกับลูกค้า\n———\nLineOA: ${channelLabel(userId)} ${name}`);
    }
    // no_change (ไม่มี suspect) → ลูกค้ายืนยัน/ขอบคุณเฉยๆ → ไม่แก้ ไม่ push ไม่ handoff (Bug 2 หาย)
  }

  // ---- order flow (1-pass · AI เป็นเจ้าของบทสนทนา · โค้ดเป็นเจ้าของเงิน) ----
  // merge order_data.items → pending → คำนวณราคา (Core) · ยอดที่เขียนชีต/แจ้งแอดมิน มาจาก Core เสมอ
  const runOrders = ordersActive && !editHandled && Boolean(customer);
  const nameMap = lib ? buildProductNameMap(lib.CSV_Products) : new Map<string, string>();
  let pending: PendingOrder = customer?.pendingOrder ?? {};
  let postQuote = preQuote;
  if (runOrders && customer) {
    // D-20: AI ส่งแค่ qty → โค้ดใส่ sku จากสินค้า live (แมป sku ไม่ใช่งาน AI)
    const { items: aiItems, ...receiverFields } = geminiOutput.orderData;
    const resolvedItems = resolveAiItems(aiItems, lib?.CSV_Products ?? []);

    if (process.env.DIAG_PROMPT_TOKENS === "1") {
      const shape: Record<string, { len: number; digits: boolean }> = {};
      for (const k of ["ชื่อ", "ที่อยู่", "เบอร์"] as const) {
        const v = receiverFields[k];
        if (typeof v === "string" && v.trim() !== "") shape[k] = { len: v.trim().length, digits: /^\d+$/.test(v.trim()) };
      }
      console.log(JSON.stringify({
        scope: "orders", event: "ai-orderdata-raw",
        aiSentKeys: Object.keys(geminiOutput.orderData),
        stringShape: shape,
        aiQtys: (aiItems ?? []).map((it) => it.qty),
        resolvedItems: resolvedItems.map((it) => `${it.sku}x${it.qty}`),
      }));
    }

    const fields: PendingOrder = { ...receiverFields };
    if (resolvedItems.length > 0) fields.items = resolvedItems;
    if (geminiOutput.paymentMethod) fields["การชำระเงิน"] = geminiOutput.paymentMethod; // "" = คงเดิม
    // order_id (D-29): สร้างตอน items แรกเข้า pending (ยังไม่มี id + กำลังจะมี items) · prefix จากชีต · เสถียรข้าม retry
    const willHaveItems = resolvedItems.length > 0 || normalizeItems(customer.pendingOrder.items).length > 0;
    if (willHaveItems && !customer.pendingOrder.order_id) {
      const orderPrefix = (config.raw.get("รหัสนำหน้าออเดอร์") ?? "SKB").trim() || "SKB";
      fields.order_id = generateOrderId(orderPrefix, nowDate);
    }
    pending = await mergePendingOrder(userId, fields);
    postQuote = computeQuote(pending, lib, config, nowDate);
  }

  // ---- D-49: ปิดช่องว่างปาก-มือไม่ตรงกัน (คำนวณ gate ก่อนเลือกข้อความ) ----
  //   (1) #1 extraction-recovered → เลือกประตูปลายทาง deterministic (complete→won · เลือกจ่าย→ประตูวิธีจ่าย) แทนตรึง current
  //   (2) #3 ออเดอร์ complete เทิร์นนี้ → บังคับ step path (ปิด/ทวน) ชนะ FAQ/OBJ interception (ปาก-มือตรงกัน)
  //   (3) #2 บนเทิร์นเขียน lastOrder ยัง stale (setLastOrder อยู่ runOrderGate ท้ายเทิร์น) → สร้าง snapshot ทวนจาก pending+price ที่ "จะเขียนจริง"
  let orderCompleteThisTurn = false;
  let synthLastOrder: typeof lastOrder = null;
  let synthItemsText = "";
  if (runOrders && customer) {
    const postGate = evaluateOrderGate({ pending, slipPresent: Boolean(customer.lastSlipPathname), priceOk: postQuote?.ok ?? false });
    orderCompleteThisTurn = postGate.complete;
    if (geminiOutput.recovered && lib) {
      const dest = resolveRecoveredStage(lib.CSV_Step, postGate.complete, postGate.payment);
      if (dest && dest !== geminiOutput.stage) {
        console.log(JSON.stringify({ scope: "recovered-stage", from: geminiOutput.stage, to: dest, complete: postGate.complete, payment: postGate.payment }));
        geminiOutput = { ...geminiOutput, stage: dest };
      }
    }
    // snapshot เฉพาะเมื่อ "ยังไม่มี lastOrder จริง + ครบเทิร์นนี้" (purely additive · ไม่ทับ edit-flow) — ค่าจาก gate/pricing เท่านั้น
    //   🔴 order_id = "" (cron ยังไม่แจกเลขจริง) → {ออเดอร์_เลขที่} resolve ไม่ได้ → var-guard ทิ้งบอลลูนนั้น (ห้าม mock เลขปลอม)
    if (!lastOrder && orderCompleteThisTurn && postQuote?.price) {
      const items = normalizeItems(pending.items);
      synthItemsText = items.map((it) => `${lastOrderNameMap.get(it.sku) ?? it.sku} x${it.qty}`).join(" · ");
      synthLastOrder = {
        order_id: "", ชื่อ: pending["ชื่อ"], ที่อยู่: pending["ที่อยู่"], เบอร์: pending["เบอร์"],
        items, total: postQuote.price.total, payment: postGate.payment,
      };
    }
  }

  // ---- เลือกที่มาข้อความ (D-61.A dispatch): v2 = precedence D-42 (composeReplyV2 · ก้อนเดิมทั้งดุ้น) · v3 = เรียบเรียงสด (composeReplyV3) ----
  const stageFunnelReply = lib ? funnelStageOf(lib.CSV_Step, geminiOutput.stage) : null;
  // v2: handoff_notify นับเป็น handoff turn (D-58 ส่ง pattern ประตู) · v3: ไม่มี notify force — ธงสุขภาพคุมผ่าน assurance guard แทน
  const isHandoffTurn = geminiOutput.handoff || stageFunnelReply === "handoff" || stageFunnelReply === "handoff_after_intake" || (!v3 && stageFunnelReply === "handoff_notify");
  const sel = v3
    ? composeReplyV3({ geminiOutput, imageFallback, config })
    : composeReplyV2({ lib, geminiOutput, customer, config, objection, faqInj, orderCompleteThisTurn, imageFallback, isHandoffTurn });
  const baseReply = sel.baseReply;
  const verbatimMode = sel.verbatimMode;
  let deliverMarksStep = sel.deliverMarksStep; // guard ข้างล่างยัง set false ได้ (บล็อก/ทิ้งบอลลูน = เนื้อหาไม่ถึงลูกค้า)
  const shouldNotifyResume = Boolean(switches.memory && customer?.resumeNoticePending && config.botResumeMessage);
  const withResume = (text: string) => (shouldNotifyResume ? `${config.botResumeMessage}[[เว้น]]${text}` : text);

  // เติมตัวแปรราคา (template ที่เจ้าของเขียนในชีต) ด้วยเลข Core · มี items = ใช้ค่าล่าสุด, ยังไม่มี = preVars
  const outVars = postQuote?.ok ? postQuote.vars : preVars;
  // D-39: resolver รวม pass เดียว — AI reply(เปิด)+verbatim(ปิด) ตัวเดียวกัน · R1→R2→R3 คงลำดับ + Group X
  const varCtx: AllVarsContext = {
    // D-49 #2: เทิร์นเขียนออเดอร์ใช้ snapshot (pending+price ที่จะเขียนจริง) แทน lastOrder ที่ยัง stale · เทิร์นอื่น/edit = lastOrder จริง
    priceVars: outVars, config,
    lastOrder: synthLastOrder ?? lastOrder,
    lastOrderItemsText: synthLastOrder ? synthItemsText : lastOrderItemsText,
    pending, products: lib?.CSV_Products ?? [], promo: lib?.CSV_Promo ?? [], varsRows: lib?.CSV_Vars ?? [], now: nowDate,
  };
  let outReply = resolveAllVars(baseReply, varCtx);
  // 🔴 guard ร้ายแรง (ต่างจากราคา): ตัวแปรโอนเงิน resolve ไม่ได้ → ห้ามส่งข้อความจริง (ลูกค้าโอนไม่ได้ + เสียเครดิต)
  //    → ส่งข้อความพักสายปลอดภัยแทน + push แจ้งแอดมินให้แก้ CSV_Config
  const unresolvedTransfer = unresolvedTransferVars(outReply);
  if (unresolvedTransfer.length > 0) {
    console.error(JSON.stringify({ scope: "orders", event: "transfer-vars-unresolved", tokens: unresolvedTransfer, hint: "ตรวจ CSV_Config: เลขที่บัญชี/ชื่อบัญชี/ธนาคาร" }));
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (adminGroupId) {
      const name = await transport.getProfileName();
      await pushRawText(
        adminGroupId,
        `⚠️ ข้อมูลโอนเงิน resolve ไม่ได้: ${unresolvedTransfer.join(" ")} — บอทงดส่งข้อความโอนให้ลูกค้า\nตรวจ CSV_Config: เลขที่บัญชี / ชื่อบัญชี / ธนาคาร\n———\nLineOA: ${channelLabel(userId)} ${name}`,
      );
    }
    outReply = TRANSFER_UNRESOLVED_REPLY;
    deliverMarksStep = false; // D-45b: เนื้อหา step ไม่ถึงลูกค้า → ไม่ตั้งธง
  }
  // claims guard (พ.ร.บ.อาหาร · D-26): วลีโฆษณาต้องห้ามจากชีต · โหมด เตือน(default)=ส่ง+log+push · บล็อก=ไม่ส่ง+พักสาย+push
  const bannedClaims = findBannedClaims(
    outReply,
    parseClaimsList(config.raw.get("คำต้องห้าม_โฆษณา")),
    parseClaimsList(config.raw.get("คำยกเว้น_โฆษณา")),
  );
  if (bannedClaims.length > 0) {
    const claimsMode = (config.raw.get("โหมดคำต้องห้าม") ?? "เตือน").trim();
    const blockClaim = claimsMode === "บล็อก";
    // 🔴 log วลีที่ชน + ข้อความเต็ม (เจ้าของตัดสิน false positive) — นี่คือ reply ของบอท ไม่ใช่ PII ลูกค้า
    console.warn(JSON.stringify({ scope: "claims", event: "banned-claim", mode: claimsMode, blocked: blockClaim, phrases: bannedClaims, reply: outReply }));
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (adminGroupId) {
      const name = await transport.getProfileName();
      await pushRawText(
        adminGroupId,
        `⚠️ พบคำโฆษณาต้องห้าม (พ.ร.บ.อาหาร) · โหมด: ${claimsMode}\nวลีที่ชน: ${bannedClaims.join(", ")}\nข้อความบอท: ${outReply}\n———\nLineOA: ${channelLabel(userId)} ${name}`,
      );
    }
    if (blockClaim) {
      outReply = CLAIMS_BLOCKED_REPLY;
      deliverMarksStep = false; // D-45b: บล็อกแล้ว เนื้อหาไม่ถึงลูกค้า
    }
  }
  // KI-02 price guard (D-27): เลข "X บาท" ที่บอทพูด ต้องอยู่ใน allowed (raw+ตาราง+derived) · โหมด เตือน(default)/บล็อก
  if (lib) {
    const priceAllowed = buildAllowedPriceStrings(
      lib.CSV_Products,
      lib.CSV_Promo,
      Object.fromEntries(config.raw),
      customer?.pendingOrder["การชำระเงิน"] ?? "",
      nowDate,
    );
    const badPrices = findBadPrices(outReply, priceAllowed);
    if (badPrices.length > 0) {
      const priceMode = (config.raw.get("โหมดราคาผิด") ?? "เตือน").trim();
      const blockPrice = priceMode === "บล็อก";
      console.warn(JSON.stringify({ scope: "price-guard", event: "price-outside-catalog", mode: priceMode, blocked: blockPrice, bad: badPrices, reply: outReply, allowedSample: [...priceAllowed].slice(0, 40) }));
      const adminGroupId = process.env.ADMIN_GROUP_ID;
      if (adminGroupId) {
        const name = await transport.getProfileName();
        await pushRawText(adminGroupId, `⚠️ บอทพูดราคานอกระบบ · โหมด: ${priceMode}\nเลขที่ชน: ${badPrices.join(", ")} บาท\nข้อความบอท: ${outReply}\n———\nLineOA: ${channelLabel(userId)} ${name}`);
      }
      if (blockPrice) {
        outReply = PRICE_BAD_REPLY;
        deliverMarksStep = false; // D-45b: บล็อกแล้ว เนื้อหาไม่ถึงลูกค้า
      }
    }
  }

  // 🔴 D-61.A (v3): assurance guard — เทิร์นธงสุขภาพห้ามประโยครับรอง (block → regenerate 1 → cut · ห้ามล้มเทิร์น/ห้ามเงียบ)
  if (v3 && healthFlagged && !geminiOutput.degraded && !imageFallback) {
    outReply = await applyAssuranceGuardV3({
      outReply,
      phrases: config.assuranceBannedPhrases,
      regenerate: (correction) =>
        withTimeout<GeminiTurnOutput | null>(
          runSalesTurn({ config, configText, stepText, faqText, catalogText, objectionText: objection.text, stateText, historyText, userMessage, currentStage: previousStage ?? "1", image: imageForGemini, correction }),
          GEMINI_TIMEOUT_MS,
          null, // timeout = ถือว่า regenerate ล้ม → caller ตกไปตัดประโยค (เจ้าของเคาะ #2)
        ),
      resolveReply: (raw) => resolveAllVars(raw, varCtx),
    });
  }

  // 🔴 Phase2 var-guard (ทั้งโหมดเปิด/ปิด): กันลูกค้าเห็นตัวแปร "ที่รู้จัก" ดิบ ({ออเดอร์_ที่อยู่}/{การชำระเงิน}...)
  //    typo ตัวแปรผิด step / order ยังไม่มี → resolve ไม่ได้ → ทิ้งบอลลูนนั้น (ไม่ใช่ `{` ทุกตัว)
  {
    const { clean, dropped } = dropUnresolvedVarBubbles(outReply);
    if (dropped.length > 0) {
      const vmode = verbatimMode ? "ปิด" : "เปิด";
      // 🔴 log ชัด: ชื่อตัวแปรที่ค้าง + step ที่ AI เลือก (เจ้าของไล่ได้ว่าประตูไหนใส่ตัวแปรผิด)
      console.warn(JSON.stringify({ scope: "var-guard", event: "unresolved-runtime-var", mode: vmode, stage: geminiOutput.stage, dropped, before: outReply }));
      if (clean) {
        outReply = clean;
      } else if (verbatimMode) {
        // ปิด + เหลือว่างหมด → fallback AI (resolve reply ของ AI ซ้ำ · เช็คตัวแปรค้างอีกชั้น)
        console.error(JSON.stringify({ scope: "var-guard", event: "all-bubbles-dropped", mode: "ปิด", stage: geminiOutput.stage, fallback: "ai" }));
        const aiResolved = resolveAllVars(geminiOutput.reply, varCtx);
        outReply = dropUnresolvedVarBubbles(aiResolved).clean || VAR_FALLBACK_REPLY;
        deliverMarksStep = false; // D-45b: เนื้อหา step ถูกทิ้งหมด ไม่ถึงลูกค้า
      } else {
        // เปิด + เหลือว่างหมด = เคสแปลก (AI พ่นตัวแปรทุกบอลลูน) → log หนัก + พักสาย
        console.error(JSON.stringify({ scope: "var-guard", event: "all-bubbles-dropped", mode: "เปิด", reply: outReply }));
        outReply = VAR_FALLBACK_REPLY;
        deliverMarksStep = false;
      }
    }
  }
  // D-51 ทักทายรายวัน: เทิร์นแรกของวัน (เวลาไทย) → เติม prefix หน้าบอลลูนข้อความแรก (delivery ล้วน)
  //   ข้าม: handoff (H4/ลูกค้าไม่พอใจ + handoff อื่นๆ = ทิศปลอดภัย) · degraded (ระบบสะดุด) · รูป-fallback · ค่าว่าง=ปิด
  if (switches.memory && customer && !imageFallback && !geminiOutput.degraded && !isHandoffTurn) {
    const rawGreet = config.raw.get("ทักทายรายวัน");
    const greet = rawGreet === undefined ? DEFAULT_DAILY_GREETING : rawGreet;
    if (greet && isFirstMessageOfDay(historyLen, customer.lastSeen, nowDate)) {
      outReply = prependToFirstTextBubble(outReply, greet);
      console.log(JSON.stringify({ scope: "greeting", event: "daily-first", historyLen }));
    }
  }
  const assistantSaved = outReply;
  const deliveredOk = await deliverReply(transport, withResume(outReply), config.quotaSaver);
  // D-45b: ตั้งธง "ส่งเนื้อหา step นี้แล้ว" เฉพาะเมื่อ deliver สำเร็จจริง + เทิร์นนี้มีเนื้อเต็มก้อนของ step อยู่ในข้อความ
  if (deliveredOk && deliverMarksStep && switches.memory && customer) {
    await addDeliveredStep(userId, geminiOutput.stage);
    // 🔔 v2 = ประตู notify (D-58 dedup ผ่านธง step) · v3 ย้ายออกไปนอกบล็อกแล้ว (D-61.C2 ข้างล่าง)
    if (!v3) await pushNotifyDoorV2({ userId, userMessage, stageFunnelReply, transport });
  }

  // 🔴 D-61.C2 (v3): ธงสุขภาพต้องแจ้ง "เสมอ" — healthFlagged ตัดสินจาก keyword ตั้งแต่ก่อนเรียก AI
  //    เดิมผูกอยู่ในบล็อก deliverMarksStep ข้างบน → เทิร์นที่ AI ล้ม (degraded) / อ่านรูปไม่ได้ / ส่งไม่สำเร็จ
  //    = แอดมินไม่รู้เลยว่ามีคนถามเรื่องแพ้อาหาร (H1 = ความเสี่ยงอันดับ 1 · golden ชั้น G จับได้ D-61.C1)
  //    ลูกค้าไม่ได้คำตอบ → 🔔 แบบด่วน · dedup marker เดิมคุมทั้ง 2 แบบ (ถามซ้ำไม่ยิงซ้ำ)
  if (v3 && switches.memory && customer) {
    await pushHealthNotifyV3({
      userId, userMessage, healthFlagged, customer, config, transport,
      unanswered: geminiOutput.degraded || imageFallback || !deliveredOk,
    });
  }

  // D-34/D-35: handoff_after_intake — คุยก่อนค่อยส่งคน · นับเทิร์น + reset (ออกประตู/handoff/เงียบนาน) + เพดาน/ขั้นต่ำ
  const stageFunnel = lib ? funnelStageOf(lib.CSV_Step, geminiOutput.stage) : null;
  const stageIsHandoff = stageFunnel === "handoff"; // ส่งต่อทันที (D-33)
  const stageIsIntake = stageFunnel === "handoff_after_intake";
  const stageIsNotify = stageFunnel === "handoff_notify"; // D-58: ตอบ+แจ้งแอดมิน แต่ห้ามปิดบอท
  const intakeCap = numFromRaw(config, "เพดานเทิร์นก่อนส่งแอดมิน", 3); // คุยได้มากสุด → handoff แน่นอน
  const intakeMin = numFromRaw(config, "เทิร์นขั้นต่ำก่อนส่งแอดมิน", 1); // ต้องถามอย่างน้อย N เทิร์น (1..N=ถาม) → handoff เทิร์นที่ N+1
  // 🔴 D-35 timeout: เงียบเกิน adminSilenceReturnMinutes → เริ่มนับ intake ใหม่ (เคสเข้า intake แล้วหายกลางคัน ไม่ handoff ไม่ออก)
  const intakeStale = Boolean(customer && Date.now() - customer.lastSeen.getTime() >= config.adminSilenceReturnMinutes * 60 * 1000);
  const prevIntakeTurns = intakeStale ? 0 : customer?.intakeTurns ?? 0;
  const newIntakeTurns = stageIsIntake ? prevIntakeTurns + 1 : 0;
  const intakeCapReached = stageIsIntake && newIntakeTurns >= intakeCap;
  const intakeMinReached = stageIsIntake && newIntakeTurns > intakeMin; // > : เทิร์น 1..min = ถาม (ยอม handoff เทิร์นถัดจาก min)

  // handoff: funnel_stage=handoff (D-33 ทันที) · AI flag · intake (ถามครบขั้นต่ำ/เกินเพดาน) · "ขอคุยแอดมิน"=keyword pre-check (ก่อน Gemini)
  const intakeHandoff = stageIsIntake && (intakeCapReached || (geminiOutput.handoff && intakeMinReached));
  const doHandoff =
    switches.handoff && !damageHandled && !editHandled && !stageIsNotify && // 🔴 D-58: ประตู notify ห้ามปิดบอทเด็ดขาด (แม้ AI ตั้ง flag)
    (intakeHandoff || (!stageIsIntake && (geminiOutput.handoff || stageIsHandoff)));
  // 🔴 D-35 reset ตอน handoff จาก intake: เคลมจบ → ครั้งหน้าเริ่มนับใหม่ (กัน counter ค้างข้ามเซสชัน = handoff เทิร์นแรก)
  const persistIntakeTurns = doHandoff && stageIsIntake ? 0 : newIntakeTurns;

  console.log(JSON.stringify({
    scope: "handoff-decision",
    stage: geminiOutput.stage, funnelStage: stageFunnel, stepRows: lib?.CSV_Step.length ?? 0,
    prevIntakeTurns, intakeTurns: newIntakeTurns, persistIntakeTurns, intakeStale, intakeMin, intakeCap,
    aiHandoffFlag: geminiOutput.handoff, stageIsIntake, stageIsHandoff,
    minReached: intakeMinReached, capReached: intakeCapReached, finalHandoff: doHandoff,
    trigger: !doHandoff ? "none" : intakeCapReached ? "cap" : geminiOutput.handoff ? "ai-flag" : stageIsHandoff ? "funnel-handoff" : "?",
  }));

  if (switches.memory) {
    await addMessage(userId, "user", userMessage);
    await addMessage(userId, "assistant", assistantSaved);
    await updateCustomerAfterTurn(userId, { stage: geminiOutput.stage, tagsAdd: effectiveTagsAdd, intakeTurns: persistIntakeTurns });
    await logFunnelEvent(userId, previousStage, geminiOutput.stage);
    if (shouldNotifyResume) await clearResumeNotice(userId);
  }

  // จัดการรูป: ปกติตาม image_intent · ถ้า Gemini ล้ม → บังคับ slip พร้อมโน้ตเตือน · คืน pathname สลิปเทิร์นนี้
  let slipThisTurn: string | null = null;
  if (imageContent) {
    slipThisTurn = imageFallback
      ? await handleImageIntent(userId, "slip", "⚠️ AI อ่านรูปไม่สำเร็จ (timeout/error) ช่วยเช็คให้ด้วยค่ะ", imageContent, config, switches, transport)
      : await handleImageIntent(userId, geminiOutput.imageIntent, geminiOutput.imageNote, imageContent, config, switches, transport);
  }

  // order gate — โค้ดเป็นเจ้าของ: เขียนชีต/แจ้งแอดมิน (ยอดจาก Core) · guard 2 = ตรวจเลขในคำพูดบอท
  if (runOrders && customer) {
    // whitelist เลขที่บอทพูดได้: ยอด Core + ทุกเลขในตารางสินค้า/ราคาที่บอทเห็น (catalog)
    const allowed = new Set<string>([...extractPriceNumbers(catalogText)]);
    if (postQuote?.price) {
      const pr = postQuote.price;
      [pr.total, pr.subtotal, pr.shippingFee, ...pr.lines.map((l) => l.lineTotal)].forEach((n) => allowed.add(String(n)));
    }
    await runOrderGate(userId, customer, pending, postQuote?.price ?? null, slipThisTurn, config, nameMap, outReply, allowed, transport);
  }

  // handoff เกิดขึ้น (doHandoff คำนวณไว้ข้างบนแล้ว) · else = push-on-exit ถ้าเพิ่งออกจาก intake
  if (doHandoff) {
    const reason =
      intakeCapReached && !geminiOutput.handoff && !stageIsHandoff
        ? `เก็บข้อมูลครบ/เกินเพดาน (${intakeCap} เทิร์น) → ส่งแอดมิน`
        : stageIsHandoff && !geminiOutput.handoff
          ? "อยู่ประตูส่งต่อ (funnel_stage=handoff · โค้ดการันตี)"
          : geminiOutput.handoffReason || "AI ประเมินว่าควรส่งต่อ";
    await handoff(userId, switches, { reason, userMessage }, transport);
  } else if (switches.memory && prevIntakeTurns > 0 && !stageIsIntake) {
    // 🔴 push-on-exit (D-34): เคยอยู่ intake แล้วย้ายประตูออก (ไม่ handoff) → แจ้งแอดมินรับรู้เรื่องค้าง
    //    ≠ handoff: ไม่ปิดบอท ไม่มี footer (บอทคุยขายต่อ) · reuse pushRawText · edge เดียว (intake_turns reset แล้ว = ไม่ push ซ้ำ)
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (adminGroupId) {
      const name = await transport.getProfileName();
      const prevDoor = (lib && customer?.stage ? stepNameOf(lib.CSV_Step, customer.stage) : null) ?? "เรื่องที่คุยค้าง";
      const newDoor = (lib ? stepNameOf(lib.CSV_Step, geminiOutput.stage) : null) ?? "ประตูอื่น";
      await pushRawText(adminGroupId, `⚠️ ลูกค้าเพิ่งคุยเรื่อง "${prevDoor}" แล้วเปลี่ยนไป "${newDoor}" · รบกวนตรวจสอบเรื่องค้าง (บอทยังดูแลต่ออยู่)\nข้อความล่าสุด: ${userMessage}\n———\nLineOA: ${channelLabel(userId)} ${name}`);
    }
  }
}

/**
 * M-2: entry ข้อความ "ช่องทางกลาง" — debounce ร่วม (LINE/Messenger ใช้เส้นเดียวกัน)
 * makeTransport(replyToken ล่าสุด) = สร้าง transport ต่อ channel · onTyping = loading indicator ต่อ channel
 */
export async function runInboundText(
  userId: string,
  text: string,
  config: AppConfig,
  switches: FeatureSwitches,
  makeTransport: (replyToken: string | null) => ChannelTransport,
  onTyping?: () => Promise<void>,
  initialReplyToken: string | null = null,
): Promise<void> {
  if (!switches.humanLikeTiming) {
    await processMessage(userId, text, makeTransport(initialReplyToken), config, switches);
    return;
  }

  const insertedId = await insertPendingMessage(userId, text, initialReplyToken);

  if (config.showTyping && onTyping) {
    await onTyping();
  }

  await new Promise((resolve) => setTimeout(resolve, config.debounceWaitMs));

  const latestId = await getLatestPendingId(userId);
  if (latestId !== null && latestId > insertedId) {
    // มีข้อความใหม่กว่าเข้ามาระหว่างรอ ปล่อยให้ invocation ของข้อความนั้นจัดการแทน (กันตอบซ้ำ)
    return;
  }

  const collected = await collectAndClearPendingMessages(userId);
  if (!collected.text) return; // ถูกอีก invocation เก็บไปประมวลผลแล้ว

  await processMessage(userId, collected.text, makeTransport(collected.replyToken ?? initialReplyToken), config, switches);
}

/** M-2: entry รูป "ช่องทางกลาง" — รูปโหลดที่ entry layer แล้ว (ต่าง channel ต่างแหล่ง) แล้วเข้า pipeline เดิม */
export async function runInboundImage(
  userId: string,
  content: DownloadedContent | null,
  config: AppConfig,
  switches: FeatureSwitches,
  transport: ChannelTransport,
): Promise<void> {
  const placeholderText = content ? "[ลูกค้าส่งรูปมา]" : "[ลูกค้าส่งรูปมาแต่โหลดรูปไม่สำเร็จ]";
  await processMessage(userId, placeholderText, transport, config, switches, content ?? undefined);
}

async function handleTextMessage(
  userId: string,
  text: string,
  replyToken: string,
  config: AppConfig,
  switches: FeatureSwitches,
): Promise<void> {
  await runInboundText(
    userId,
    text,
    config,
    switches,
    (rt) => new LineTransport(rt ?? "", userId),
    () => startLoadingIndicator(userId, Math.ceil(config.debounceWaitMs / 1000) + 5),
    replyToken,
  );
}

async function handleImageMessage(
  userId: string,
  messageId: string,
  replyToken: string,
  config: AppConfig,
  switches: FeatureSwitches,
): Promise<void> {
  // รูปคือ "ข้อความอีกรูปแบบ" — โหลดเสมอ (ไม่ผูกกับสวิตช์ orders) แล้วส่งให้ Gemini พร้อมบริบทครบชุด
  const content = await downloadMessageContent(messageId);
  await runInboundImage(userId, content, config, switches, new LineTransport(replyToken, userId));
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
  await replyToAdmin(replyToken, groupId, botModeMsg(name, close, config.adminSilenceReturnMinutes));
}

function buildDisambigMessage(query: string, matches: CustomerBrief[], verb: string): string {
  const lines = matches.map((m, i) => `${i + 1}) ${channelLabel(m.userId)} ${m.displayName ?? "(ไม่มีชื่อ)"} — คุยล่าสุด ${formatThaiRelative(m.lastSeen)}`);
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

/**
 * D-53: แปลง arg คำสั่ง → channel key จริง ("line" | "fb:<pageId>") · null = ไม่ใช่ channel (→ รายคนเดิม)
 * "fb" (ไม่ระบุเพจ) = shortcut ชั้นภาษา → resolver แปลงเป็น key จริงตอนเขียน (ห้ามเก็บ alias "fb" ลอยๆ ในข้อมูล)
 */
function resolveChannelArg(arg: string): { key?: string; error?: string } | null {
  const a = arg.trim().toLowerCase();
  if (a === "line") return { key: "line" };
  if (a.startsWith("fb:")) return { key: a }; // ระบุเพจตรงๆ
  if (a === "fb") {
    const pages = messengerPageIds();
    if (pages.length === 0) return { error: "ยังไม่ได้ผูกเพจ Messenger (ตั้ง META_PAGE_ID ก่อน)" };
    if (pages.length === 1) return { key: `fb:${pages[0]}` };
    // 🔴 อนาคตหลายเพจ: ตอบรายชื่อให้เลือก แทนการเดา (วันนี้ env 1 เพจ ไม่เข้าเคสนี้)
    return { error: `มีหลายเพจ — ระบุ "${arg.includes("ปิด") ? "ปิด" : "เปิด"}บอท fb:<pageId>" (${pages.join(", ")})` };
  }
  return null;
}

async function handleCloseOpenCommand(
  arg: string,
  verb: string,
  close: boolean,
  replyToken: string,
  groupId: string,
  config: AppConfig,
): Promise<void> {
  // D-53: ดัก channel keyword (line/fb/fb:<pageId>) ก่อน logic รายคนเดิม
  const ch = resolveChannelArg(arg);
  if (ch) {
    if (ch.error) {
      await replyToAdmin(replyToken, groupId, `⚠️ ${ch.error}`);
      return;
    }
    await setChannelEnabled(ch.key!, !close);
    await replyToAdmin(replyToken, groupId, channelSwitchMsg(ch.key!, close, await channelStatusLine()));
    return;
  }

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
    return `${i + 1}) ${status} ${channelLabel(m.userId)} ${m.displayName ?? "(ไม่มีชื่อ)"} — คุยล่าสุด ${formatThaiRelative(m.lastSeen)}`;
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

/** ข้อความพักสายตอนตัวแปรโอนเงิน resolve ไม่ได้ — ไม่ให้ลูกค้าเงียบ แต่ก็ไม่ส่งเลขบัญชีผิด (แอดมินถูก push แล้ว) */
const TRANSFER_UNRESOLVED_REPLY = "ขอสักครู่นะคะ ปลาทูขอเช็คข้อมูลการโอนให้แน่ใจก่อน เดี๋ยวรีบแจ้งกลับเลยค่ะ 🙏";

/** ข้อความพักสายตอน claims guard โหมด "บล็อก" จับคำโฆษณาต้องห้าม — ไม่ส่งของจริง (แอดมินถูก push แล้ว) */
const CLAIMS_BLOCKED_REPLY = "ขอสักครู่นะคะ ปลาทูขอเช็คข้อมูลให้ชัดเจนก่อน เดี๋ยวรีบแจ้งกลับค่ะ 🙏";

/** ข้อความพักสายตอน price guard โหมด "บล็อก" จับราคานอกระบบ — ไม่ส่งเลขผิด (แอดมินถูก push แล้ว) */
const PRICE_BAD_REPLY = "ขอสักครู่นะคะ ปลาทูขอเช็คราคาให้แน่ใจก่อน เดี๋ยวรีบแจ้งกลับเลยค่ะ 🙏";
// Phase2 var-guard: ทุกบอลลูนโดนทิ้ง (ตัวแปรค้างหมด) → ส่งข้อความพักสายปลอดภัย (ลูกค้าไม่เห็นทั้งของว่าง/ของดิบ)
const VAR_FALLBACK_REPLY = "ขอสักครู่นะคะ ปลาทูขอเช็คข้อมูลให้เรียบร้อยก่อน เดี๋ยวรีบแจ้งกลับเลยค่ะ 🙏";
// 🔴 D-46: เทิร์นข้อความล้วนที่ Gemini ไม่ตอบ (blocked/timeout/parse-fail) — บอกตรงว่ายังไม่ได้รับ + ขอให้ส่งใหม่
//    (ต่างจาก DEFAULT_REPLY "รอสักครู่แล้วทักใหม่" ที่ทำให้ลูกค้านั่งรอเฉยๆ ทั้งที่ข้อมูลเมื่อกี้ไม่ถึง)
//    🔴 D-61.C2: ห้ามมีคำว่า "รบกวน" (กฎเหล็ก CLAUDE.md) — golden ชั้น D/G มี invariant คุมแล้ว
const DEGRADED_NO_INPUT_REPLY = "ขออภัยค่ะ ระบบสะดุดนิดหน่อย ปลาทูยังไม่ได้รับข้อความล่าสุดของลูกค้านะคะ ช่วยพิมพ์ส่งมาอีกครั้งนะคะ 🙏";

/** D-61.C2: เนื้อ 🔔 กรณีเทิร์นธงสุขภาพจบแบบลูกค้าไม่ได้คำตอบ — แอดมินต้องตามด่วน (แยกจาก template ในชีต) */
const HEALTH_NOTIFY_UNANSWERED =
  "ถามเรื่องสุขภาพ/แพ้อาหาร แต่ระบบสะดุด — 🔴 บอทยังไม่ได้ตอบคำถามนี้ ช่วยตามด่วนค่ะ (ลูกค้าอาจกำลังรออยู่)";

/** อ่านค่าตัวเลขจาก CSV_Config (config.raw) · ไม่มี/อ่านไม่ได้ = fallback */
function numFromRaw(config: AppConfig, key: string, fallback: number): number {
  const v = config.raw.get(key);
  if (v === undefined) return fallback;
  const n = Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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

export async function handleEvent(event: webhook.Event, config: AppConfig, switches: FeatureSwitches): Promise<void> {
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

    // D-53: ช่อง LINE ถูกปิด → เงียบ (log · คำสั่งกลุ่มไม่โดน เพราะ source=group คนละสาย → เปิดคืนได้)
    if (switches.memory && !(await isChannelEnabled("line"))) {
      console.log(JSON.stringify({ scope: "channel-switch", channel: "line", event: "inbound-silenced" }));
      return;
    }

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

