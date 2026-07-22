# REPO-MAP — SakbinAdvBot (ปลาทู)

> อ่านจากโค้ดจริง commit ล่าสุด · "?" = ไม่ยืนยัน · สำหรับที่ปรึกษาที่ไม่มี repo access

## 1. File tree (lib/ · app/api/ · tests/)
```
lib/
  core/           # โดเมนล้วน ห้าม import LINE/Gemini/googleapis/Sheets
    orders.ts       gate ออเดอร์ (items+priceOk) + sanitizers + PendingOrder + ข้อความแจ้งแอดมิน
    pricing.ts      คำนวณราคา/ค่าส่ง/เพดาน (D-15) + resolveRuntimeVars({สรุปรายการ}/{ยอดรวม}/{การชำระเงิน})
    sheet-id.ts     แปลง env → spreadsheetId (รับ ID/URL, กัน published-CSV)
  sheets/         # อ่าน Google Sheets (header-driven)
    client.ts       getSheets() — JWT service account (อ่าน+เขียน)
    loader.ts       loadBotLibrary() — batchGet 8 แท็บ 1 call + cache 60วิ
    columns.ts      resolveColumns/cell/tabToText/columnLetter/rowFromValues
    clean.ts        cleanCell/stripKeyAnnotation/cleanHeader (กันอักขระล่องหน)
  agent/
    inject.ts       selective injection: step/faq/catalog เข้า prompt
    quote.ts        computeQuote (pending→price+vars) + guard 2 (เลขตรง Core) + var-guard (P2 · ทิ้งบอลลูนที่เหลือตัวแปรรู้จัก)
  gemini.ts       runSalesTurn() — เรียก Gemini, parse JSON output
  config.ts       getConfig()/resolveFeatureSwitches() — CSV_Config + สวิตช์
  db.ts           Neon Postgres — customer state, messages, pending_order, ฯลฯ
  line.ts         LINE Messaging API — reply/push/download/parseReply
  orders.ts       Google Sheet Orders — append/list/mark (header-driven)
  handoff.ts      keyword pre-check ส่งต่อแอดมิน
  blob.ts         Vercel Blob — สลิป (private) + สินค้า (public)
  admin-commands.ts  parse คำสั่งในกลุ่มแอดมิน (ปิด/เปิดบอท)
  flex-cards.ts   Flex Cards (ปิดอยู่)
app/api/
  line-webhook/route.ts   webhook หลัก (POST) — เครื่องยนต์ทั้งหมด
  cron/orders/route.ts    cron แจกเลขออเดอร์ + ยิงกลุ่มแพ็ค
  cron/follow/route.ts    cron ตามลูกค้า (Follow — dormant)
tests/
  harness/        replay(webhook+HMAC จริง) · setup(mock) · state · db · sheet · assert · fixtures
  scenarios/      *.test.ts (golden/order-core/inject/sheet-*/config-parse/gemini-guard/prompt-lint/image-url/expect-fail)
```

## 2. Export หลัก (ชื่อ · หน้าที่)
**lib/core/orders.ts** (pure)
- `evaluateOrderGate({pending, slipPresent, priceOk}) → {payment, complete, waitTag, missing, brokenOrder, readyExceptPrice}` — ตัดสินออเดอร์ครบ/ไม่ครบ (COD: ชื่อ+ที่อยู่+เบอร์+items ไม่ว่าง+priceOk · โอน: +สลิป) · `readyExceptPrice`=complete ถ้าสมมติ priceOk (D-23 · แจ้งแอดมิน "ราคาคำนวณไม่ได้" ตอนข้อมูลครบ)
- `PendingOrder {ชื่อ?,ที่อยู่?,เบอร์?,การชำระเงิน?,items?,order_id?}` · `normalizeItems`/`itemsEqual` (ตัดสิน "items เปลี่ยน") · **D-29** `generateOrderId(prefix, now, suffix?)` → `SKB-YYYYMMDD(ไทย)-xxxxxx`
- `addressComplete(p)` · `nameComplete(p)` · `sanitizePhone(s)` · `buildNewOrderAdminText(summary,total,payment,name,phone)`/`buildBrokenOrderAdminText`/`buildPriceStuckAdminText(pending,error,name,itemsText)` (D-23 · ข้อมูลลูกค้าเต็ม)

**lib/core/time.ts** (pure · D-37 · เวลาไทยฐานเดียว) — `bangkokShift`/`bangkokDateTime`(B,Y)/`bangkokYMD`(promo,ตัดรอบ)/`bangkokYMDCompact`(order_id)/**D-39** `bangkokDeliveryDay(cutoff, now)`→"วันนี้"/"พรุ่งนี้"/null (`{วันจัดส่ง}`) · +7 อ่าน getUTC* · ทุกจุดเวลาใช้ที่นี่
**lib/core/pricing.ts** (pure · D-15) — `calculatePrice({items,paymentMethod,now?}, promoRows, productRows, config) → {lines(+basePromo/extraQty/extraAmount/isExactTier), subtotal, shippingFee, total, nextTier, error, needsHandoff}`
- โปรฐาน = live+ในช่วงวันที่ จำนวนมากสุด≤qty · extraAmount=lineTotal−ฐาน (บวกแล้วเท่ายอดเสมอ) · nextTier=ชั้นสูงกว่าใกล้สุด (single-sku) · อ่านชีตล้วน ห้าม hardcode
- `formatOrderSummary`(" · ")/`formatLinesForSheet`(" | ") · `formatPayment` · `buildBreakdownVars`→{วิธีคิดยอด}/{ทางเลือกถัดไป} · `buildProductNameMap` · `resolveRuntimeVars(text, 5 vars)`
- **D-39 Group X resolver:** `resolveCatalogVars(text, products, promo, now)` = `{ชื่อสินค้า}`/`{วิธีเก็บรักษา}`(สินค้า live ตัวแรก) `{โปรโมชั่นทั้งหมด}`(ข้อความโชว์ promo live · \n คั่น) · `resolveDeliveryVar(text, cutoff, now)` = `{วันจัดส่ง}`(→ วันนี้/พรุ่งนี้) · `CATALOG_TEXT_VARS`/`DELIVERY_VARS`
- `buildPriceTable(sku, promoRows, productRows, config, payment, now?) → {sku,name,unit,ceiling,rows[{qty,subtotal,shippingFee,total,freeShip}],error}` (D-24 · enumerate 1..เพดาน เรียก calculatePrice ทุกแถว = เลขเดียวกับ gate) · `liveProductSkus`/`resolveAiItems`(D-20)
- `buildAllowedPriceStrings(products, promo, config, payment, now?) → Set<string>` (D-27 · KI-02) — allowed = คอลัมน์ราคา Products/Promo + ตารางคำนวณ + derived ต่อหน่วย (ไม่กวาดทั้งแถว กัน 200 มล./sku ปลอม)

**lib/agent/quote.ts** — `computeQuote(pending, lib, config, now) → {price, vars, ok}|null` · `hasUnresolvedPricingVars` (log-only เดิม · route ไม่เรียกแล้ว—var-guard คุมแทน · ยังมีเทส) · `checkReplyNumbers(reply, allowedText, extraNums)` (guard 2 · whitelist จากบล็อก inject) · **D-25** `resolveTransferVars(text, config)` แทน {เลขที่บัญชี}/{ชื่อบัญชี}/{ธนาคาร}+alias{เลขพร้อมเพย์} จาก config.raw · `unresolvedTransferVars(text)` เหลือค้าง→route บล็อกส่ง+push แอดมิน (guard ร้ายแรง) · **D-26** `findBannedClaims(text, banned, exceptions)` (วลี · ยกเว้นชนะ) + `parseClaimsList` — claims blocklist พ.ร.บ.อาหาร (โหมด เตือน/บล็อก) · **D-27** `findBadPrices(text, allowed)` — เลข "X บาท" นอก allowed → price guard (โหมด เตือน/บล็อก · KI-02) · **D-32** `resolveOrderVars(text, lastOrder, itemsText)` — {ออเดอร์_ชื่อ/ที่อยู่/เบอร์/รายการ/ยอด/เลขที่} จาก last_order · **P2** `ORDER_VARS` + `dropUnresolvedVarBubbles(text, known?) → {clean, dropped}` — แยกบอลลูน ทิ้งเฉพาะบอลลูนที่เหลือตัวแปร "ที่รู้จัก" resolve ไม่ได้ (ไม่ใช่ `{` ทุกตัว) · route เรียกก่อน deliver ทั้งโหมดเปิด/ปิด · **D-39** `resolveAllVars(text, ctx)` — **resolver รวม pass เดียว** (R1 เงิน→R2 บัญชี→R3 snapshot→catalog→pending→delivery · AI reply+verbatim เรียกตัวเดียวกัน · ตัวแปรใหม่เพิ่มที่นี่ที่เดียว) · `resolvePendingVars(text, pending)` = `{ชื่อ}{ที่อยู่เต็ม}{เบอร์}{การชำระเงินใหม่}` (pending ปัจจุบัน · **คนละชุดกับ `{ออเดอร์_*}` snapshot**) · `PENDING_VARS` · `KNOWN_RUNTIME_VARS` = 6 กลุ่ม (pricing+transfer+order+catalog+pending+delivery)

**lib/sheets/loader.ts** — `loadBotLibrary(): Promise<BotLibrary|null>` batchGet 8 แท็บ + cache · `BOTLIB_TABS`
**lib/sheets/columns.ts** — `resolveColumns(header, required, label) → map|null` (all-or-nothing) · `cell` · `tabToText` · `rowFromValues` · `columnLetter`
**lib/agent/inject.ts** — `buildStepInjection(rows, {quoted,payment,userMessage,signals?})` **region routing (D-19)** · **D-32** signals(order_editable/order_confirmed_locked)→ประตูที่ "เข้าเมื่อ" มี token ยัดเต็ม · **D-33** `funnelStageOf(rows, stepId)` (โค้ดการันตี handoff เมื่อ funnel_stage=handoff) · **D-34** `stepNameOf(rows, stepId)` + `stayStage`(คงประตู handoff_after_intake ข้ามเทิร์น · additive) + validStages รับ handoff_after_intake · **D-38** `validateStepFunnelStages(rows)→BadFunnelStage[]` + `VALID_FUNNEL_STAGES`(9) (loader เรียกตอนโหลด · console.error · diag `/api/diag/steps`): โค้ดตัดสิน funnel จาก pending (quoted=มี items → S4 · ไม่มี → S1-S3) ไม่พึ่ง AI stage · สารบัญทุกประตู + เต็ม cap 4 (priority: match วิธีจ่าย>ปลายทาง>entry-match>proximity) · handoff+crossover(ประตูข้าม ไม่มีใครชี้มา) เต็มเฉพาะ entry-match ไม่นับ cap · `buildCatalogInjection(products, promo, {config,payment,now,methodDescription})` **D-24 C6 เต็ม**: ยัด "ตารางราคาสำเร็จรูป" (สินค้า+ทุกจำนวน 1..เพดาน จาก `buildPriceTable`→calculatePrice ตัวเดียวกับ gate · payment ตาม pending · calc ล้ม→ไม่ยัดตาราง+handoff) แทนตารางโปรดิบ · `readConfigDescription(configRows, key)` อ่านคอลัมน์คำอธิบาย (วิธีคิดจากชีต) · **D-27** `buildObjectionInjection(rows, userMessage, cap)→{text,matchedIds,verbatim}` (keyword match "ลูกค้าพูดแบบไหนบ้าง" · สารบัญ+เต็มเฉพาะ match · **P2** `verbatim`={id,pattern} เมื่อ objection ที่ match มี คิดเอง=ปิด+ตัวอย่างคำตอบ → route ให้ชนะ step) · `buildExampleInjection(rows, stepId, objectionIds, cap)` (match step/obj · เลียนน้ำเสียง) · `buildFaqInjection` · `resolveDestinations` · **P2 ชั้น③** `parseThinkMode(raw)→"เปิด"|"ปิด"`(ว่าง/ไม่รู้จัก=เปิด) + `stepVerbatim(rows, stepId)→{mode,pattern}|null` — โหมดปิด route ส่ง `pattern` เป๊ะ (verbatim) แทน reply ที่ AI แต่ง · **D-39B2** `pattern` = `joinVerbatimParts(ตัวอย่างคำตอบ, ปิดท้าย)` = 2 ช่องคั่น `[[แยก]]` อัตโนมัติ (ข้ามช่องว่าง · ปิดท้าย=บอลลูนสุดท้าย) · คอลัมน์ `คิดเอง` = optional (ไม่มี=เปิด · ไม่ regression)
**lib/orders.ts** — `appendOrderRow(input+orderId)` · `listPendingOrders()` · `markOrderSent(row, num)` · **D-31** `updateOrderRow(orderId, changes, now) → {status:updated/confirmed/not_found/no_change, changed[]}` (แก้แถวเดิมโดย order_id · M=TRUE→confirmed · Y ประวัติ/Z นับ) · `ORDERS_HEADER` (26 คอล A–Z: +Y แก้ไขล่าสุด +Z แก้ไขกี่ครั้ง · header-driven)
**lib/gemini.ts** — `runSalesTurn(GeminiTurnInput{configText,stepText,faqText,catalogText,objectionText,exampleText,stateText,historyText,...}) → GeminiTurnOutput{reply, stage, tagsAdd, handoff, orderData{ชื่อ?,ที่อยู่?,เบอร์?,items?}, paymentMethod, orderEditRequest, imageIntent, imageNote, objectionDetected(D-27), degraded}`
**lib/config.ts** — `getConfig()` · `resolveFeatureSwitches(config) → FeatureSwitches` · `formatConfigForPrompt`
**lib/db.ts** — `ensureCustomer`/`mergePendingOrder`(items+order_id)/`reconcileWaitTags`(ลบเฉพาะ รอโอน/รอที่อยู่)/`resetCustomerMemory`(ล้าง human_mode+last_order · D-25/D-32)/`nextOrderNumber`(atomic · ลำดับ col A)/**D-29** `isOrderWritten`/`markOrderWritten`(ตาราง `orders_written` · idempotency source of truth)/**D-32** `setLastOrder`(customers.last_order JSONB snapshot)/`setLastOrderLocked`(M=TRUE) ฯลฯ · CustomerState +`lastOrder`/`lastOrderLocked` · `CustomerState.tags` inject เข้า `<สถานะลูกค้า>` ทุกเทิร์น (คุมเงื่อนไขขายด้วยแท็กได้)

## 3. จุดประกอบ prompt (ตามลำดับ)
1. `route.ts processMessage` → `loadBotLibrary()` ได้ CSV_Step/FAQ/Products/Promo/Config
2. `buildStepInjection` + `buildFaqInjection` + `buildCatalogInjection` + `buildObjectionInjection` + `buildExampleInjection` → stepText/faqText/catalogText/objectionText/exampleText
3. `formatConfigForPrompt` → configText · `buildStateText` → stateText · `getRecentHistory`+`formatHistoryForPrompt` → historyText
   - 🔴 D-15 **pre-resolve**: ถ้า pending มี items → `computeQuote` → `resolveRuntimeVars(stepText, vars)` (บอทพูดยอดได้ในเทิร์นเดียว)
4. `runSalesTurn(...)` (pass 1) → **`prompt/system.ts`**:
   - `buildStaticSystemInstruction()` = systemInstruction (คงที่: บทบาท/กฎเหล็ก/order_data items/needs_price_quote/รูปแบบผลลัพธ์)
   - `buildUserContent({...,pass2Note?})` = user content (+`<หมายเหตุระบบ>` ตอน pass 2)
5. Gemini generateContent (responseSchema JSON) → parse → GeminiTurnOutput
6. 🔴 D-15 **2-pass**: ถ้า items เปลี่ยน (`itemsEqual` เทียบก่อน merge · items ว่าง=ไม่เปลี่ยน) → merge → `computeQuote` → pass 2 (inject ยอด) → guard 2/5 → ส่ง (quota-saver ยุบ 1 reply) · fail-safe เมื่อ pricing/pass2 ล้ม → แจ้งลูกค้า+แอดมิน
7. `runOrderGate(pending, price, ...)` → เขียนชีต I/J/S/T จาก price (ไม่อ่านยอดจาก AI)

## 4. คำสั่งพิเศษ
- **`/reset`** (แชท 1:1) — `route.ts` `isResetCommand` → `resetCustomerMemory(userId)`: ล้าง stage/tags/pending_order + DELETE messages+pending_messages · ทำงานเมื่อ Config `เปิด_คำสั่งเทสต์`=เปิด (default เปิด)
- **กลุ่มแอดมิน (`ADMIN_GROUP_ID`)** — `parseAdminCommand`: `ปิดบอท <ชื่อ>` · `เปิดบอท <ชื่อ>` · `ปิดบอททั้งหมด` · `เปิดบอททั้งหมด` · `รายชื่อล่าสุด` · เลขข้อ (เลือกจากรายการ)

## 5. ENV ที่โค้ดอ่านจริง
| env | ใช้ที่ |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` · `LINE_CHANNEL_SECRET` | line.ts · route.ts (verify signature) |
| `GEMINI_API_KEY` | gemini.ts |
| `DATABASE_URL` | db.ts (Neon) — คุม switch `memory` |
| `SHEET_BOTLIB_ID` | loader.ts (batchGet ทุกแท็บ) — คุม `salesCore`+`follow` |
| `SHEET_ORDERS_ID` | orders.ts (อ่าน/เขียน Orders) — คุม `orders` |
| `GOOGLE_SERVICE_ACCOUNT` | sheets/client.ts (JWT) |
| `ADMIN_GROUP_ID` · `ORDER_GROUP_ID` | route.ts/cron (push แอดมิน/แพ็ค) |
| `BLOB_SLIPS_TOKEN` · `BLOB_PRODUCTS_TOKEN` | blob.ts |
| `CRON_SECRET` | cron/* (Bearer auth) |
| `DIAG_PROMPT_TOKENS` | gemini.ts (=1 → log token จริงต่อ segment) |
> ⚠️ `SHEET_STEP/FAQ/CONFIG/FOLLOW_URL` **โค้ดไม่อ่านแล้ว** (Step 1 ย้ายไป BOTLIB) — ลบได้ (Phase C ยังไม่ทำ)

## 6. CSV_Config keys ที่โค้ดอ่าน (ชื่อตรงตัว · มี alias)
`ชื่อบอท` · `ชื่อร้าน`(/`ชื่อร้าน/แบรนด์`) · `เพศบอท` · `ใช้ emoji`(/`ใช้_emoji`/`emoji`) · `temperature` · `maxOutputTokens`(พื้น 4096) · `แสดง_typing`(/`typing`) · `debounce_รวบคำถาม`(prefix `debounce`) · `หน่วง_ระหว่างบอลลูน`(/`หน่วง_ระหว่างข้อความ`) · `อายุลิงก์สลิป_วัน` · `เวลาตัดรอบออเดอร์`(/`เวลารอบตัดออเดอร์`) · `เลขออเดอร์_รีเซ็ตทุกวัน` · `คำ_handoff`(/`คำ_ส่งต่อแอดมิน`/`keyword_handoff`) · `คืนสิทธิ์บอท_หลังแชทเงียบ` · `ประโยคเปลี่ยนมือ_บอทรับต่อ` · `เปิด_คำสั่งเทสต์` · `โหมดประหยัดโควตา`
**pricing (D-15/D-22 · lib/core/pricing อ่านจาก config.raw):** `ยอดขั้นต่ำส่งฟรี_บาท`(275) · `ค่าส่ง_มาตรฐาน`(30) · `ค่าส่ง_COD_เพิ่ม`(0) · `เพดานจำนวน_คูณโปรใหญ่สุด`(2) · `จำนวนที่ไม่มีโปร_คิดยังไง`(ค่า: `เทียบโปรฐาน`=default/ว่าง · `ราคาปกติ` · อื่น→handoff)
> ⚠️ 4 คีย์แรก: ว่าง/อ่านไม่ได้ → error+handoff (ไม่มี fallback) · `จำนวนที่ไม่มีโปร_คิดยังไง`: ว่าง/ไม่มี key → default `เทียบโปรฐาน` (เลือกวิธี ไม่ใช่ตัวเลข) · ค่าที่พิมพ์ผิด(ไม่ว่าง) → handoff
**โอนเงิน (D-25 · resolve ฝั่งโค้ด quote.ts):** `เลขที่บัญชี`(alias `เลขพร้อมเพย์`) · `ชื่อบัญชี` · `ธนาคาร` — resolve ไม่ได้ → บล็อกส่ง+push
**claims (D-26 · พ.ร.บ.อาหาร):** `คำต้องห้าม_โฆษณา`(วลี,คั่น ,) · `คำยกเว้น_โฆษณา` · `โหมดคำต้องห้าม`(`เตือน`=default/`บล็อก`)
**price guard (D-27 · KI-02):** `โหมดราคาผิด`(`เตือน`=default/`บล็อก`)
**คิดเอง / verbatim (P2 · ชั้น③ · คอลัมน์ในแถว ไม่ใช่ CSV_Config):** คอลัมน์ `คิดเอง` (optional) ใน **CSV_Step** + **CSV_Objections** — `ปิด`=ส่ง "ตัวอย่างคำตอบ" เป๊ะ (แทนตัวแปรอย่างเดียว ไม่ให้ AI แต่ง) · ว่าง/`เปิด`=AI เรียบเรียงเดิม · CSV_Objections เพิ่มคอลัมน์ `ตัวอย่างคำตอบ` (pattern verbatim ของข้อโต้แย้ง) · objection ปิด(มี pattern) ชนะ step · ปิดแต่ตัวอย่างว่าง→fallback AI
**objections/examples (D-27):** `จำนวนข้อโต้แย้งที่ยัดเข้า prompt`(2) · `จำนวนตัวอย่างที่ยัดเข้า prompt`(3)
**order_id (D-29):** `รหัสนำหน้าออเดอร์`(default `SKB`) · `เลขออเดอร์_รีเซ็ตทุกวัน`(ลำดับ col A)
**handoff_after_intake (D-34/D-35):** `เพดานเทิร์นก่อนส่งแอดมิน`(default 3 · คุยมากสุด) · `เทิร์นขั้นต่ำก่อนส่งแอดมิน`(default 1 · ถามก่อน · เพิกเฉย AI flag จนเทิร์น min+1) · 🔴 คำ trigger ห้ามซ้ำ `คำ_handoff` (keyword pre-check ปิดก่อนเข้า intake)
**สวิตช์:** `เปิด_ติดแท็ก` · `เปิด_ส่งต่อแอดมิน` · `เปิด_ระบบออเดอร์` · `เปิด_ระบบติดตาม` · `เปิด_การ์ด_flex` · `เปิด_จังหวะหน่วงเหมือนคน`
> ค่าสวิตช์ที่รับ: `เปิด/true/on/1/ใช่/yes` = true · `ปิด/false/off/0/ไม่/no/ว่าง` = false

## 7. วิธีรันเทส
- **harness + unit ทั้งหมด:** `npm test` (vitest · ต้องมี `.env.test` ชี้ Neon branch harness-test) → 90 passed | 5 expected fail
- **เทส real Gemini:** ตั้ง `HARNESS_REAL_GEMINI=1` (bypass scripted) · วัด token: `DIAG_PROMPT_TOKENS=1`
- **build:** `npm run build` (tsc + next build)

## 8. Known issues (docs/DECISIONS.md)
- **KI-01** 🔴 `คำ_handoff` substring match ("PR" ชน promotion/express) → เสียยอด · แก้ Step 4 · `lib/handoff.ts`
- **KI-02** ยังไม่มี price guard ฝั่งโค้ด (C6 เต็มรูป = Step 3 pricing.ts) · `lib/agent/inject.ts` ยัดตารางให้บอทอ่าน (ชั่วคราว)
- **KI-03** backtick ในเนื้อ prompt ปิด template literal (เกิด 6 ครั้ง) — guard `tests/scenarios/prompt-lint.test.ts`
- **KI-04** harness state.ts ห้าม import อะไรที่ import googleapis (circular → เทสค้าง)
- **KI-05** 🟡 `nextOrderNumber` counter atomic จริง (`INSERT..ON CONFLICT DO UPDATE last_no+1 RETURNING`) แต่ `cron/orders/route.ts` loop `listPendingOrders → nextOrderNumber → markOrderSent` **ไม่มี lock กัน cron รันซ้อน** → 2 รอบทับกันแจกเลขคนละเลขให้ออเดอร์เดียวกัน + push แพ็คซ้ำ · ตรงกับ Don't "แจกเลขแบบไม่ atomic" ใน CLAUDE.md ที่ **ยังไม่ทำ guard ระดับ loop**
- prompt ยังใหญ่ (~9,707 tokens · เป้า <5000 ยังไม่ถึง) — ลด systemInstruction = รอบ 2a (DECISIONS.md)
- **KI-06** 🟡 D-15 resolver ครอบแค่ 3 ตัวแปรเงิน ({สรุปรายการ}/{ยอดรวม}/{การชำระเงิน}) · ตัวแปรอื่นในชีต ({ชื่อสินค้า}/{เลข อย.}/{ชื่อบัญชี}…) ยังให้ AI เติมชั่วคราว → resolver เต็ม = commit ถัดไป (D-16, DECISIONS.md)
- **KI-07** 🟡 D-15 2-pass = เทิร์นที่ items เปลี่ยนยิง Gemini 2 ครั้ง (คนละ request ไม่ชน timeout 8s) · เพิ่มค่า model ต่อเทิร์นสั่ง · G/H (จังหวัด/รหัส) เขียนว่างเสมอ (ตั้งใจ ดู DECISIONS D-15)
- validate stage-enum เลื่อนไป Step 6
