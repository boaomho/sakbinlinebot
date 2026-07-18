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
    quote.ts        computeQuote (pending→price+vars) + guard 2 (เลขตรง Core) + guard 5 (เหลือ {...})
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
- `evaluateOrderGate({pending, slipPresent, priceOk}) → {payment, complete, waitTag, missing, brokenOrder}` — ตัดสินออเดอร์ครบ/ไม่ครบ (COD: ชื่อ+ที่อยู่+เบอร์+items ไม่ว่าง+priceOk · โอน: +สลิป)
- `PendingOrder {ชื่อ?,ที่อยู่?,เบอร์?,การชำระเงิน?,items?}` · `normalizeItems`/`itemsEqual` (ตัดสิน "items เปลี่ยน")
- `addressComplete(p)` · `nameComplete(p)` · `sanitizePhone(s)` · `buildNewOrderAdminText(summary,total,payment,name,phone)`/`buildBrokenOrderAdminText`

**lib/core/pricing.ts** (pure · D-15) — `calculatePrice({items,paymentMethod,now?}, promoRows, productRows, config) → {lines(+basePromo/extraQty/extraAmount/isExactTier), subtotal, shippingFee, total, nextTier, error, needsHandoff}`
- โปรฐาน = live+ในช่วงวันที่ จำนวนมากสุด≤qty · extraAmount=lineTotal−ฐาน (บวกแล้วเท่ายอดเสมอ) · nextTier=ชั้นสูงกว่าใกล้สุด (single-sku) · อ่านชีตล้วน ห้าม hardcode
- `formatOrderSummary`(" · ")/`formatLinesForSheet`(" | ") · `formatPayment` · `buildBreakdownVars`→{วิธีคิดยอด}/{ทางเลือกถัดไป} · `buildProductNameMap` · `resolveRuntimeVars(text, 5 vars)`

**lib/agent/quote.ts** — `computeQuote(pending, lib, config, now) → {price, vars, ok}|null` · `hasUnresolvedPricingVars` (guard 5) · `checkReplyNumbers(reply, allowedText, extraNums)` (guard 2 · whitelist จากบล็อก inject)

**lib/sheets/loader.ts** — `loadBotLibrary(): Promise<BotLibrary|null>` batchGet 8 แท็บ + cache · `BOTLIB_TABS`
**lib/sheets/columns.ts** — `resolveColumns(header, required, label) → map|null` (all-or-nothing) · `cell` · `tabToText` · `rowFromValues` · `columnLetter`
**lib/agent/inject.ts** — `buildStepInjection(rows, stage, msg)` สารบัญทุกประตู+เต็มที่เกี่ยว · `buildFaqInjection(rows, msg)` · `buildCatalogInjection(products, promo)` · `resolveDestinations(nextWhen, ids)`
**lib/orders.ts** — `appendOrderRow(input)` · `listPendingOrders()` · `markOrderSent(row, num)` · `ORDERS_HEADER` (24 คอล A–X, header-driven)
**lib/gemini.ts** — `runSalesTurn(GeminiTurnInput{...,pass2Note?}) → GeminiTurnOutput{reply, stage, tagsAdd, handoff, orderData:OrderDataFromAI{ชื่อ?,ที่อยู่?,เบอร์?,items?}, needsPriceQuote, itemsSource:"customer"|"bot_proposal", paymentMethod, orderEditRequest, imageIntent, imageNote, degraded}`
**lib/config.ts** — `getConfig()` · `resolveFeatureSwitches(config) → FeatureSwitches` · `formatConfigForPrompt`
**lib/db.ts** — `ensureCustomer`/`mergePendingOrder`(items)/`setProposedOrder`(bot_proposal · คอลัมน์ `proposed_order` JSONB)/`reconcileWaitTags`(ลบเฉพาะ รอโอน/รอที่อยู่)/`resetCustomerMemory`/`nextOrderNumber`(atomic · KI-05) ฯลฯ · `CustomerState.tags` inject เข้า `<สถานะลูกค้า>` ทุกเทิร์น (คุมเงื่อนไขขายด้วยแท็กได้)

## 3. จุดประกอบ prompt (ตามลำดับ)
1. `route.ts processMessage` → `loadBotLibrary()` ได้ CSV_Step/FAQ/Products/Promo/Config
2. `buildStepInjection` + `buildFaqInjection` + `buildCatalogInjection` → stepText/faqText/catalogText
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
**pricing (D-15 · lib/core/pricing อ่านจาก config.raw):** `ยอดขั้นต่ำส่งฟรี_บาท`(275) · `ค่าส่ง_มาตรฐาน`(30) · `ค่าส่ง_COD_เพิ่ม`(0) · `เพดานจำนวน_คูณโปรใหญ่สุด`(2)
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
