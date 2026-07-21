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
import { loadBotLibrary } from "@/lib/sheets/loader";
import { buildStepInjection, buildFaqInjection, buildCatalogInjection, buildObjectionInjection, buildExampleInjection, readConfigDescription } from "@/lib/agent/inject";
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
  isOrderWritten,
  markOrderWritten,
  setLastOrder,
  setLastOrderLocked,
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
import { appendOrderRow, updateOrderRow } from "@/lib/orders";
import { evaluateOrderGate, buildNewOrderAdminText, buildBrokenOrderAdminText, buildPriceStuckAdminText, buildOrderStateWarning, buildOrderEditAdminText, generateOrderId, sanitizePhone, itemsEqual, normalizeItems, PendingOrder } from "@/lib/core/orders";
import { resolveRuntimeVars, formatLinesForSheet, formatOrderSummary, buildProductNameMap, resolveAiItems, buildAllowedPriceStrings, RuntimeVarContext, PriceResult } from "@/lib/core/pricing";
import { computeQuote, hasUnresolvedPricingVars, resolveTransferVars, unresolvedTransferVars, resolveOrderVars, findBannedClaims, parseClaimsList, findBadPrices, extractBahtNumbers, extractPriceNumbers } from "@/lib/agent/quote";

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

/** ส่งข้อความถึงลูกค้า: reply ก่อน · ล้มเหลว (token หมดอายุ) → push */
async function deliverReply(replyToken: string, userId: string, text: string, quotaSaver: boolean): Promise<void> {
  const sent = await replyMessages(replyToken, text, quotaSaver);
  if (!sent) await pushMessages(userId, text, quotaSaver);
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
      const name = await getProfileName(userId);
      await pushRawText(
        adminGroupId,
        `⚠️ ยอดไม่ตรง — บอทแจ้งลูกค้า ${guard2Off.join("/")} บาท · ระบบคำนวณ ${price ? price.total : "?"} บาท ขอยืนยัน\nรายการ: ${itemsToNames(pending.items, nameMap)}\n———\nLineOA: ${name}`,
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
    const name = await getProfileName(userId);
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
      const text = buildNewOrderAdminText(formatOrderSummary(price.lines), price.total, payment, name, pending["เบอร์"] ?? "");
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
      const name = await getProfileName(userId);
      const text = priceStuckReady
        ? buildPriceStuckAdminText(pending, price?.error ?? "เกินเพดาน/ต้องมีคนดู", name, itemsToNames(pending.items, nameMap))
        : buildBrokenOrderAdminText(pending, gate.missing, name);
      await pushRawText(adminGroupId, text);
    }
    await setPaidNoAddressNotified(userId, true);
  }
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

  if (switches.handoff) {
    const preCheck = checkHandoffKeywords(userMessage, config.handoffKeywords);
    if (preCheck.matched) {
      await runHandoffFlow(userId, userMessage, replyToken, config, switches, `เจอคำสำคัญ: ${preCheck.keyword}`);
      return;
    }
  }

  const previousStage = customer?.stage ?? null;

  // D-18 region injection: โค้ดตัดสิน funnel จาก pending (ก่อน merge) ไม่พึ่ง stage ที่ AI ตอบ
  //   quoted = pending มี items แล้ว (= สรุปยอดไปแล้ว → S4) · ยังไม่มี = S1-S3 (สรุปยอดเข้าถึงได้)
  // FAQ: สารบัญทุกข้อ + เต็มเฉพาะที่ keyword ตรง
  const lib = await loadBotLibrary();
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
      ? buildStepInjection(lib.CSV_Step, { quoted: preItems.length > 0, payment: customer?.pendingOrder["การชำระเงิน"] ?? "", userMessage, signals: orderSignals })
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

  const faqText = lib && lib.CSV_FAQ.length > 0 ? buildFaqInjection(lib.CSV_FAQ, userMessage) : "(ไม่มีข้อมูล FAQ)";
  // ยัดสินค้า+ราคาโปรเสมอ (บอทห้ามแต่งราคา C6) — CSV_Products/CSV_Promo ไม่เคยถูกยัดมาก่อน
  // ตารางราคาสำเร็จรูป (D-24): เลขทุกตัวจาก calculatePrice (แหล่งเดียวกับ gate) · payment ตาม pending เพื่อให้ตรงที่จะบันทึก
  const catalogText = lib
    ? buildCatalogInjection(lib.CSV_Products, lib.CSV_Promo, {
        config: Object.fromEntries(config.raw),
        payment: customer?.pendingOrder["การชำระเงิน"] ?? "",
        now: nowDate,
        methodDescription: readConfigDescription(lib.CSV_Config, "จำนวนที่ไม่มีโปร_คิดยังไง"),
      })
    : "(ไม่มีข้อมูลสินค้า)";
  // D-27 Objections/Examples: keyword match → ประกอบคำตอบเอง · cap จากชีต (ไม่ hardcode)
  const objCap = numFromRaw(config, "จำนวนข้อโต้แย้งที่ยัดเข้า prompt", 2);
  const exCap = numFromRaw(config, "จำนวนตัวอย่างที่ยัดเข้า prompt", 3);
  const objection = lib ? buildObjectionInjection(lib.CSV_Objections, userMessage, objCap) : { text: "", matchedIds: [] };
  const exampleText = lib ? buildExampleInjection(lib.CSV_Examples, customer?.stage ?? "", objection.matchedIds, exCap) : "";
  const configText = formatConfigForPrompt(config);
  const stateText = buildStateText(customer, orderWarning, preOrderPriceStuck, lastOrderLine);

  let historyText = "(ระบบความจำปิดอยู่)";
  if (switches.memory) {
    const history = await getRecentHistory(userId, 20);
    historyText = formatHistoryForPrompt(history);
  }

  const geminiOutput = await withTimeout(
    runSalesTurn({
      config,
      configText,
      stepText,
      faqText,
      catalogText,
      objectionText: objection.text,
      exampleText,
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
    const name = await getProfileName(userId);

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
      if (adminGroupId) await pushRawText(adminGroupId, buildOrderEditAdminText(orderId, result.changed ?? [], name));
    } else if (result.status === "confirmed") {
      // แอดมินคอนเฟิร์มแล้ว (ของไปแพ็ค) → ล็อก + คนต้องจัดการ (X2)
      if (switches.memory) await setLastOrderLocked(userId);
      if (adminGroupId) await pushRawText(adminGroupId, `✏️ ลูกค้าขอแก้ออเดอร์ที่คอนเฟิร์มแล้ว ${orderId}\nรบกวนแอดมินดูแล (ของอาจแพ็คแล้ว)\n———\nLineOA: ${name}`);
      if (switches.memory) await setHumanMode(userId, true);
    } else if (result.status === "not_found") {
      console.error(JSON.stringify({ scope: "orders", event: "order-edit-not-found", orderId }));
      if (adminGroupId) await pushRawText(adminGroupId, `✏️ ลูกค้าขอแก้ออเดอร์ ${orderId || "(ไม่มี id)"} แต่หาแถวในชีตไม่เจอ — รบกวนแอดมินตรวจ\n———\nLineOA: ${name}`);
      if (switches.memory) await setHumanMode(userId, true);
    }
    // 🔴 ที่อยู่ใหม่สั้นผิดปกติ → ไม่ทับ (กันเขียนที่อยู่ผิด) + แจ้งแอดมิน (บอทควรถามลูกค้ายืนยันที่อยู่เต็ม — เทรนใน S_EDIT)
    if ((result.suspect?.length ?? 0) > 0 && adminGroupId) {
      await pushRawText(adminGroupId, `⚠️ ลูกค้าแก้ ${result.suspect!.join("/")} ของ ${orderId} แต่ค่าที่ได้สั้นผิดปกติ — ไม่เขียนลงชีต รบกวนยืนยันกับลูกค้า\n———\nLineOA: ${name}`);
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

  // ---- ส่งข้อความถึงลูกค้า (โค้ดไม่บล็อก/ไม่แทนที่คำพูด) ----
  const baseReply = imageFallback ? imageReceivedReply(config) : geminiOutput.reply;
  const shouldNotifyResume = Boolean(switches.memory && customer?.resumeNoticePending && config.botResumeMessage);
  const withResume = (text: string) => (shouldNotifyResume ? `${config.botResumeMessage}[[เว้น]]${text}` : text);

  // เติมตัวแปรราคา (template ที่เจ้าของเขียนในชีต) ด้วยเลข Core · มี items = ใช้ค่าล่าสุด, ยังไม่มี = preVars
  const outVars = postQuote?.ok ? postQuote.vars : preVars;
  let outReply = resolveRuntimeVars(baseReply, outVars);
  // ตัวแปรข้อมูลโอนเงิน (เลขที่บัญชี/ชื่อบัญชี/ธนาคาร) — โค้ด resolve จาก CSV_Config
  outReply = resolveTransferVars(outReply, config);
  outReply = resolveOrderVars(outReply, lastOrder, lastOrderItemsText); // D-32: {ออเดอร์_*} ในคำพูดบอท
  // guard 5 = LOG อย่างเดียว ไม่บล็อก (ยังไม่มี items = AI เติมเอง · ตัวแปรอื่นคงพฤติกรรมเดิม)
  if (hasUnresolvedPricingVars(outReply)) {
    console.warn(JSON.stringify({ scope: "orders", warning: "reply เหลือตัวแปรราคา resolve ไม่ได้ (ยังไม่มี items) — ปล่อยผ่าน ไม่บล็อก" }));
  }
  // 🔴 guard ร้ายแรง (ต่างจากราคา): ตัวแปรโอนเงิน resolve ไม่ได้ → ห้ามส่งข้อความจริง (ลูกค้าโอนไม่ได้ + เสียเครดิต)
  //    → ส่งข้อความพักสายปลอดภัยแทน + push แจ้งแอดมินให้แก้ CSV_Config
  const unresolvedTransfer = unresolvedTransferVars(outReply);
  if (unresolvedTransfer.length > 0) {
    console.error(JSON.stringify({ scope: "orders", event: "transfer-vars-unresolved", tokens: unresolvedTransfer, hint: "ตรวจ CSV_Config: เลขที่บัญชี/ชื่อบัญชี/ธนาคาร" }));
    const adminGroupId = process.env.ADMIN_GROUP_ID;
    if (adminGroupId) {
      const name = await getProfileName(userId);
      await pushRawText(
        adminGroupId,
        `⚠️ ข้อมูลโอนเงิน resolve ไม่ได้: ${unresolvedTransfer.join(" ")} — บอทงดส่งข้อความโอนให้ลูกค้า\nตรวจ CSV_Config: เลขที่บัญชี / ชื่อบัญชี / ธนาคาร\n———\nLineOA: ${name}`,
      );
    }
    outReply = TRANSFER_UNRESOLVED_REPLY;
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
      const name = await getProfileName(userId);
      await pushRawText(
        adminGroupId,
        `⚠️ พบคำโฆษณาต้องห้าม (พ.ร.บ.อาหาร) · โหมด: ${claimsMode}\nวลีที่ชน: ${bannedClaims.join(", ")}\nข้อความบอท: ${outReply}\n———\nLineOA: ${name}`,
      );
    }
    if (blockClaim) outReply = CLAIMS_BLOCKED_REPLY;
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
        const name = await getProfileName(userId);
        await pushRawText(adminGroupId, `⚠️ บอทพูดราคานอกระบบ · โหมด: ${priceMode}\nเลขที่ชน: ${badPrices.join(", ")} บาท\nข้อความบอท: ${outReply}\n———\nLineOA: ${name}`);
      }
      if (blockPrice) outReply = PRICE_BAD_REPLY;
    }
  }
  const assistantSaved = outReply;
  await deliverReply(replyToken, userId, withResume(outReply), config.quotaSaver);

  if (switches.memory) {
    await addMessage(userId, "user", userMessage);
    await addMessage(userId, "assistant", assistantSaved);
    await updateCustomerAfterTurn(userId, { stage: geminiOutput.stage, tagsAdd: effectiveTagsAdd });
    await logFunnelEvent(userId, previousStage, geminiOutput.stage);
    if (shouldNotifyResume) await clearResumeNotice(userId);
  }

  // จัดการรูป: ปกติตาม image_intent · ถ้า Gemini ล้ม → บังคับ slip พร้อมโน้ตเตือน · คืน pathname สลิปเทิร์นนี้
  let slipThisTurn: string | null = null;
  if (imageContent) {
    slipThisTurn = imageFallback
      ? await handleImageIntent(userId, "slip", "⚠️ AI อ่านรูปไม่สำเร็จ (timeout/error) ช่วยเช็คให้ด้วยค่ะ", imageContent, config, switches)
      : await handleImageIntent(userId, geminiOutput.imageIntent, geminiOutput.imageNote, imageContent, config, switches);
  }

  // order gate — โค้ดเป็นเจ้าของ: เขียนชีต/แจ้งแอดมิน (ยอดจาก Core) · guard 2 = ตรวจเลขในคำพูดบอท
  if (runOrders && customer) {
    // whitelist เลขที่บอทพูดได้: ยอด Core + ทุกเลขในตารางสินค้า/ราคาที่บอทเห็น (catalog)
    const allowed = new Set<string>([...extractPriceNumbers(catalogText)]);
    if (postQuote?.price) {
      const pr = postQuote.price;
      [pr.total, pr.subtotal, pr.shippingFee, ...pr.lines.map((l) => l.lineTotal)].forEach((n) => allowed.add(String(n)));
    }
    await runOrderGate(userId, customer, pending, postQuote?.price ?? null, slipThisTurn, config, nameMap, outReply, allowed);
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

/** ข้อความพักสายตอนตัวแปรโอนเงิน resolve ไม่ได้ — ไม่ให้ลูกค้าเงียบ แต่ก็ไม่ส่งเลขบัญชีผิด (แอดมินถูก push แล้ว) */
const TRANSFER_UNRESOLVED_REPLY = "ขอสักครู่นะคะ ปลาทูขอเช็คข้อมูลการโอนให้แน่ใจก่อน เดี๋ยวรีบแจ้งกลับเลยค่ะ 🙏";

/** ข้อความพักสายตอน claims guard โหมด "บล็อก" จับคำโฆษณาต้องห้าม — ไม่ส่งของจริง (แอดมินถูก push แล้ว) */
const CLAIMS_BLOCKED_REPLY = "ขอสักครู่นะคะ ปลาทูขอเช็คข้อมูลให้ชัดเจนก่อน เดี๋ยวรีบแจ้งกลับค่ะ 🙏";

/** ข้อความพักสายตอน price guard โหมด "บล็อก" จับราคานอกระบบ — ไม่ส่งเลขผิด (แอดมินถูก push แล้ว) */
const PRICE_BAD_REPLY = "ขอสักครู่นะคะ ปลาทูขอเช็คราคาให้แน่ใจก่อน เดี๋ยวรีบแจ้งกลับเลยค่ะ 🙏";

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
