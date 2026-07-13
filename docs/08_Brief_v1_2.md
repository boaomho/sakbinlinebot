# 08 · Brief (v1.2) — สเปคที่ build จริง (SakbinAdvBot / "ปลาทู")

> เอกสารนี้เขียนจาก **โค้ดจริงในสาขา `main`** ที่ build ผ่าน (tsc + next build เขียว)
> ทุกจุดที่ต่างจากบรีฟเดิม (08 v1.1) มีหมายเหตุ "**⚠️ ต่างจากบรีฟ**" กำกับ
> เป้าหมาย: อ่านไฟล์นี้แล้วสร้างบอทตัวเดียวกันได้ใหม่ตั้งแต่ต้น

---

## 1. Stack + เวอร์ชันแพ็กเกจจริง (จาก `package.json`)

| แพ็กเกจ | เวอร์ชัน | ใช้ทำอะไร |
|---|---|---|
| `next` | ^14.2.35 | Next.js 14 App Router (deploy Vercel) |
| `react` / `react-dom` | ^18.3.1 | (หน้าเว็บ boilerplate เฉย ๆ — บอทเป็น API route) |
| `@google/genai` | ^2.10.0 | เรียก Gemini · model `gemini-3.5-flash` |
| `@line/bot-sdk` | ^11.1.0 | LINE Messaging API (verify, reply/push, download รูป, loading, getProfile) |
| `@neondatabase/serverless` | ^0.10.4 | Neon Postgres (ความจำลูกค้า/แท็ก/debounce/ออเดอร์counter) |
| `@vercel/blob` | ^2.6.1 | เก็บสลิป (private + signed URL) / รูปสินค้า (public) — **ต้อง ≥2.4.0 ถึงมี private+signed** |
| `googleapis` | ^144.0.0 | เขียน/อ่านชีต Orders ผ่าน Google Sheets API (service account) |
| `promptpay-qr` | ^0.5.0 | (ใช้ใน flex-cards.ts — **ยังไม่ถูกเรียกจริง**) generate QR PromptPay |
| `qrcode` | ^1.5.4 | (ใน flex-cards.ts) render QR เป็นรูป |
| `typescript` | ^6.0.3 | — |

devDeps: `@types/node ^26.1.0`, `@types/qrcode ^1.5.5`, `@types/react`, `@types/react-dom`
เป้า TS: ES2017, module esnext, moduleResolution bundler, `paths: { "@/*": ["./*"] }`

---

## 2. โครงสร้างไฟล์ (1 บรรทัด/ไฟล์)

```
app/api/line-webhook/route.ts   # webhook หลัก: verify → debounce → orchestrate → ตอบลูกค้า + คำสั่งแอดมิน
app/api/cron/follow/route.ts    # cron ตามลูกค้าเงียบ (อ่าน CSV_Follow) — สวิตช์ปิด default
app/api/cron/orders/route.ts    # cron แจกเลขออเดอร์ atomic + ยิงกลุ่มแพ็ค (อ่านชีต Orders)
app/layout.tsx, app/page.tsx    # หน้าเว็บ boilerplate (ไม่เกี่ยวกับบอท)
lib/config.ts                   # โหลด CSV Config → parse key-value + สวิตช์ + all-or-nothing (resolveFeatureSwitches)
lib/sheets.ts                   # fetch CSV 4 แท็บ (Step/FAQ/Config/Follow) cache 60 วิ + CSV parser
lib/db.ts                       # Neon: schema (auto-migrate) + query ทั้งหมด (customers/messages/ฯลฯ)
lib/gemini.ts                   # เรียก gemini-3.5-flash JSON mode + validate output + fallback
lib/line.ts                     # LINE helpers: reply/push (+collapseBubbles), download รูป, loading, getProfile
lib/handoff.ts                  # keyword pre-check (ชั้นแรกของ handoff) + DEFAULT_HANDOFF_KEYWORDS
lib/blob.ts                     # Vercel Blob: uploadSlip(private)+getSlipSignedUrl / uploadProductImage(public)
lib/orders.ts                   # Google Sheets API: appendOrderRow / listPendingOrders / markOrderSent + sanitizers
lib/admin-commands.ts           # pure logic คำสั่งแอดมิน: parse, name matching, Thai relative time (มี unit test)
lib/flex-cards.ts               # ⚠️ builder Flex (QR/catalog/contact) — มีอยู่แต่ยังไม่ถูก import/เรียกที่ไหนเลย (dormant)
prompt/system.ts                # System Prompt: buildStaticSystemInstruction + buildUserContent
vercel.json                     # cron follow (schedule) + framework config
.env.example                    # รายการ env
```

**⚠️ ต่างจากบรีฟ:** บรีฟ v1.1 วางแผน `lib/flex-cards.ts` และ Rich Menu scripts · โค้ดจริงมี `flex-cards.ts` แต่**ยังไม่มี call site** (เป็นโครงเปล่ารอเปิดทีหลัง) · ไม่มีโฟลเดอร์ `scripts/` (Rich Menu ยังไม่ทำ)

---

## 3. Webhook flow (ทีละขั้น ตามโค้ดจริง `route.ts`)

**POST `/api/line-webhook`:**
1. อ่าน raw body ด้วย `req.text()` → `validateSignature(rawBody, LINE_CHANNEL_SECRET, x-line-signature)` — ไม่ผ่าน = **401**
2. `JSON.parse` body → `events`
3. `getConfig()` (โหลด/parse Config, memoize 5 วิ) + `resolveFeatureSwitches(config)` (เช็ค all-or-nothing กับ env)
4. `Promise.all(events.map(handleEvent))` → return 200 เสมอ (ยกเว้น signature ผิด = 401)

**`handleEvent(event)`:**
5. รับเฉพาะ `event.type === "message"` ที่มี `replyToken` และ `source`
6. **ถ้า source เป็น group:** ถ้า `groupId === ADMIN_GROUP_ID` และเป็น text → `handleAdminGroupCommand(...)` · กลุ่มอื่น (เช่น ORDER_GROUP_ID) = เพิกเฉย · แล้ว `return` (ไม่เข้า engine ขาย)
7. **ถ้า source เป็น user:** ต้องมี `userId`
8. ถ้า text = `/reset` และสวิตช์ `เปิด_คำสั่งเทสต์` เปิด → `handleResetCommand` แล้ว return (ล้างความจำเฉพาะคนนั้น ไม่เข้า engine)
9. ถ้า `!switches.salesCore` (env แกนขายไม่ครบ) → reply `DEFAULT_REPLY` แล้ว return
10. text → `handleTextMessage` · image → `handleImageMessage`

**`handleTextMessage` (debounce):**
11. ถ้า `!humanLikeTiming` (ไม่มี memory) → `processMessage` ทันที (ไม่ debounce)
12. มี memory: `insertPendingMessage` (เก็บ text+replyToken ลง Neon), ถ้า `แสดง_typing` เปิด → `startLoadingIndicator`, แล้ว `sleep(debounceWaitMs)`
13. หลังตื่น: `getLatestPendingId` — ถ้ามี id ใหม่กว่าที่เรา insert = มีข้อความใหม่เข้ามาระหว่างรอ → `return` (ปล่อยให้ invocation ล่าสุดจัดการ กันตอบซ้ำ)
14. `collectAndClearPendingMessages` (รวมทุก text ค้างด้วย `\n`, ลบออก) → ถ้าว่าง = ถูก invocation อื่นเก็บไปแล้ว return · ไม่งั้น `processMessage(รวมข้อความ)`

**`handleImageMessage`:**
15. `downloadMessageContent` (จาก LINE) **เสมอ** (ไม่ผูกกับสวิตช์ orders, **ไม่อัปโหลดตรงนี้**) · placeholder text = "[ลูกค้าส่งรูปมา]" (โหลดไม่ได้ = "[ลูกค้าส่งรูปมาแต่โหลดรูปไม่สำเร็จ]") → `processMessage(placeholder, imageContent)` — รูปคือข้อความอีกรูปแบบ ส่งเข้า Gemini พร้อมบริบทครบ ให้ AI ตีความเจตนาเอง

**`processMessage` (แกนหลัก):**
16. สร้าง `imageForGemini` จาก imageContent (base64) ถ้ามีรูป — ส่งให้ Gemini เสมอ (ไม่ gate ด้วย orders)
17. ถ้ามี memory: `ensureCustomer` (สร้าง/อัปเดต last_seen) → ถ้า `display_name` ยังว่าง เรียก `getProfileName` เก็บลง Neon (ไว้ค้นในคำสั่งแอดมิน)
18. **เช็ค human_mode:** ถ้า `human_mode=true` → ดู "แชทเงียบ" = `now - last_seen(เดิม)` ≥ `adminSilenceReturnMinutes` นาที? → ถ้าใช่ ปลดล็อก (`setHumanMode false`) และดำเนินต่อ · ถ้าไม่ใช่ → บันทึกข้อความลูกค้า แล้ว **return เงียบ** (แอดมินดูแลอยู่ บอทไม่ตอบ)
19. **handoff keyword pre-check:** ถ้าสวิตช์ handoff เปิด → `checkHandoffKeywords` เจอคำ → `runHandoffFlow` (ตอบลูกค้าอบอุ่น + push กลุ่มแอดมิน + `setHumanMode true`) แล้ว return (ไม่เรียก Gemini — ประหยัด token)
20. โหลด Step/FAQ CSV, `formatConfigForPrompt`, `buildStateText`, `getRecentHistory(20)`
21. `runSalesTurn(Gemini, image=imageForGemini)` หุ้ม `withTimeout(8000ms)` → เกิน = fallback DEFAULT_REPLY · ถ้ามีรูป log `{scope:"image", intent, note}`
22. gate ด้วยสวิตช์: `effectiveTagsAdd`, `effectiveOrderAction` · `damageHandled = มีรูป && image_intent="damage"` · `effectiveHandoff = handoff switch && AI handoff && !damageHandled` (กันยิง handoff ซ้ำกับ damage)
23. **resume notice:** ถ้า `resume_notice_pending=true` → เติม `botResumeMessage[[เว้น]]` หน้า reply (ประโยคเปลี่ยนมือ 1 บับเบิล)
24. บันทึก Neon: `addMessage(user)`, `addMessage(assistant)`, `updateCustomerAfterTurn(stage, tags)`, `logFunnelEvent`, ถ้าส่ง resume แล้ว `clearResumeNotice`
25. `replyMessages(replyToken, finalReply, quotaSaver)` → ถ้า fail (token หมดอายุ) `pushMessages` แทน
26. **ถ้ามีรูป → `handleImageIntent`** (slip=อัปโหลด slips+signed URL+push ADMIN_GROUP_ID พร้อม image_note + จำ pathname · damage=อัปโหลดหลักฐาน+push ADMIN+`setHumanMode true` · other=ไม่ทำ)
27. ถ้า orders เปิด และ order_action ≠ none → `handleOrderAction` (COD ยิง **ADMIN_GROUP_ID** · address เขียนชีต · slip ไม่จัดการตรงนี้แล้ว)
28. ถ้า `effectiveHandoff=true` → `pushHandoffNotice` + `setHumanMode true`

---

## 4. Environment Variables (ที่โค้ดใช้จริง)

| env | ไฟล์ที่อ่าน | จำเป็นกับฟีเจอร์ |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | line.ts | **ขั้นต่ำ** — reply/push/download/getProfile |
| `LINE_CHANNEL_SECRET` | route.ts | **ขั้นต่ำ** — verify signature |
| `GEMINI_API_KEY` | gemini.ts | **ขั้นต่ำ** — เรียก Gemini |
| `SHEET_STEP_URL` | sheets.ts | แกนขาย (salesCore) |
| `SHEET_FAQ_URL` | sheets.ts | แกนขาย (salesCore) |
| `SHEET_CONFIG_URL` | sheets.ts | แกนขาย (salesCore) |
| `DATABASE_URL` | db.ts | ความจำ (memory) → ต่อยอด: ติดแท็ก, debounce, handoff, orders, follow, คำสั่งแอดมิน |
| `ADMIN_GROUP_ID` | route.ts | handoff + คำสั่งแอดมิน (ปิด/เปิดบอท) + **เช็คยอดสลิป/CF COD** |
| `ORDER_GROUP_ID` | cron/orders | กลุ่มแพ็คของ — รับเฉพาะออเดอร์ที่คอนเฟิร์มแล้ว (cron ยิงเลขออเดอร์) |
| `SHEET_ORDERS_ID` | orders.ts | ระบบออเดอร์ |
| `GOOGLE_SERVICE_ACCOUNT` | orders.ts | ระบบออเดอร์ (JSON service account key) |
| `BLOB_SLIPS_TOKEN` | blob.ts | ระบบออเดอร์ (เก็บสลิป private) |
| `BLOB_PRODUCTS_TOKEN` | blob.ts | รูปสินค้า public (ไม่บังคับ) |
| `SHEET_FOLLOW_URL` | sheets.ts | Follow |
| `CRON_SECRET` | cron/follow + cron/orders | auth ทุก cron endpoint |

**เงื่อนไข all-or-nothing (`resolveFeatureSwitches`):**
- `salesCore` = มี `SHEET_STEP_URL && SHEET_FAQ_URL && SHEET_CONFIG_URL`
- `memory` = มี `DATABASE_URL`
- `tagging` = สวิตช์ `เปิด_ติดแท็ก` **และ** memory
- `handoff` = สวิตช์ `เปิด_ส่งต่อแอดมิน` **และ** `ADMIN_GROUP_ID` **และ** memory
- `humanLikeTiming` = สวิตช์ `เปิด_จังหวะหน่วงเหมือนคน` **และ** memory
- `orders` = สวิตช์ `เปิด_ระบบออเดอร์` **และ** `ORDER_GROUP_ID` + `GOOGLE_SERVICE_ACCOUNT` + `SHEET_ORDERS_ID` + `BLOB_SLIPS_TOKEN` **และ** memory
- `follow` = สวิตช์ `เปิด_ระบบติดตาม` **และ** `SHEET_FOLLOW_URL` **และ** memory
- `flexCards` = สวิตช์ `เปิด_flex` (ไม่มี call site — เป็นสวิตช์เปล่า)
- ขาดข้อใด = ปิดฟีเจอร์นั้นเงียบ ๆ + `console.warn({scope:"feature-switch", feature, status:"disabled", reason})`

---

## 5. Neon schema (auto-migrate)

`ensureSchema()` รัน `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` ทุกครั้งที่เรียก DB ครั้งแรกต่อ warm instance (guard ด้วย flag `schemaReady`) — **ไม่ต้องรัน SQL migration เอง**

```
customers(
  user_id TEXT PRIMARY KEY,          -- LINE userId
  stage TEXT,                        -- ประตูขายปัจจุบัน (จาก Gemini)
  tags TEXT[] DEFAULT '{}',          -- แท็กความสนใจ
  last_seen TIMESTAMPTZ,             -- เวลาคุยล่าสุด (ใช้ debounce silence / follow / รายชื่อล่าสุด)
  human_mode BOOL DEFAULT false,     -- แอดมินดูแลเองอยู่ไหม
  human_mode_since TIMESTAMPTZ,      -- (เก็บไว้ แต่ logic คืนสิทธิ์ใช้ last_seen ไม่ได้ใช้ตัวนี้)
  is_returning BOOL DEFAULT false,   -- ลูกค้าเก่า/ใหม่
  last_slip_pathname TEXT,           -- pathname สลิปล่าสุด (ข้ามเทิร์นตอนเก็บที่อยู่)
  display_name TEXT,                 -- ชื่อ LINE (เก็บตอนคุยครั้งแรก — ไว้ค้นในคำสั่งแอดมิน)
  resume_notice_pending BOOL DEFAULT false, -- flag ส่งประโยคเปลี่ยนมือ 1 ครั้งตอนบอทกลับมา
  created_at TIMESTAMPTZ
)
messages(id BIGSERIAL PK, user_id, role, text, created_at)   -- ประวัติแชท (ดึง 20 ล่าสุดเข้า prompt)
follow_log(id, user_id, rule_name, sent_at)                  -- กันส่ง follow ซ้ำ
order_counter(day DATE PK, last_no INT)                      -- แจกเลขออเดอร์ atomic ต่อวัน
funnel_events(id, user_id, from_stage, to_stage, at)         -- log การเลื่อน stage (วิเคราะห์ conversion)
pending_messages(id BIGSERIAL PK, user_id, text, reply_token, at)  -- buffer debounce
admin_pending_choices(group_id TEXT PK, choices JSONB, created_at) -- รายการเลือกเลขข้อคำสั่งแอดมิน (หมดอายุ 1 นาที)
```

index: `messages(user_id, created_at)`, `pending_messages(user_id, id)`, `customers(last_seen DESC)`

---

## 6. คีย์ Config ทั้งหมดที่โค้ดอ่าน (`lib/config.ts`)

รูปแบบ lookup: `pick(candidate1, candidate2, ...)` คืนค่าแรกที่เจอ · ถ้าไม่เจอเลย = ใช้ default
**คีย์ถูก `stripKeyAnnotation` (ตัด " (...)" ท้ายคีย์) และ `cleanCell` (ตัดอักขระล่องหน) ก่อนเทียบเสมอ**

| field (โค้ด) | คีย์จริงในชีต | alias สำรอง | default | ชนิด |
|---|---|---|---|---|
| `botName` | `ชื่อบอท` | — | "ปลาทู" | prompt (แทนใน `<บทบาท>`) |
| `shopName` | `ชื่อร้าน/แบรนด์` | `ชื่อร้าน` | "สากบิน" | prompt |
| `personaGender` | `เพศบอท` | — | "หญิง" | prompt (hard: "ชาย"/"หญิง") |
| `useEmoji` | `ใช้ emoji` (มีเว้นวรรค) | `ใช้_emoji`, `emoji` | ปิด(false) | prompt (แทน emojiRule) |
| `temperature` | `temperature` | — | 1.0 | **hard** (ส่งเข้า Gemini) |
| `maxOutputTokens` | `maxOutputTokens` | `max_output_tokens` | 2048 (Math.max 2048) | **hard** (Gemini) — เผื่อ thinking+output เทิร์นสรุปออเดอร์ |
| `showTyping` | `แสดง_typing` | `typing` | เปิด(true) | **hard** (loading indicator) |
| `debounceWaitMs` | `debounce_รวบคำถาม` | prefix `debounce` | 6 วิ | **hard** (เวลา debounce) |
| `delayBetweenBubblesMs` | `หน่วง_ระหว่างบอลลูน` | `หน่วง_ระหว่างข้อความ` | 1 วิ | อ่านแต่**ยังไม่ได้ใช้จริง** (ส่งบอลลูนใน reply เดียว) |
| `slipUrlExpiryDays` | `อายุลิงก์สลิป_วัน` | `อายุลิงก์สลิป` | 7 | **hard** (อายุ signed URL สลิป) |
| `orderCutoffTime` | `เวลาตัดรอบออเดอร์` | `เวลารอบตัดออเดอร์` | "12:00" | **hard** (cron แจกเลข) |
| `orderNumberResetDaily` | `เลขออเดอร์_รีเซ็ตทุกวัน` | `เลขออเดอร์รีเซ็ตทุกวัน` | เปิด(true) | **hard** (รูปแบบเลขออเดอร์) |
| `handoffKeywords` | `คำ_handoff` | `คำ_ส่งต่อแอดมิน`, `keyword_handoff` | [] → ใช้ DEFAULT list | **hard** (keyword pre-check) |
| `adminSilenceReturnMinutes` | `คืนสิทธิ์บอท_หลังแชทเงียบ` | `..._นาที` | 45 (นาที) | **hard** (คืน human_mode) |
| `botResumeMessage` | `ประโยคเปลี่ยนมือ_บอทรับต่อ` | — | "ปลาทูมาดูแลต่อเองนะคะ" | **hard** (เกริ่นตอนบอทกลับ) |
| `testCommandsEnabled` | `เปิด_คำสั่งเทสต์` | `เปิด_คำสั่งเทส` | เปิด(true) | **hard** (คุม /reset) |
| `quotaSaver` | `โหมดประหยัดโควตา` | — | เปิด(true) | **hard** (ยุบบับเบิลเป็น reply เดียว) |
| `rawSwitches.tagging` | `เปิด_ติดแท็ก` | — | เปิด(true) | **hard** สวิตช์ |
| `rawSwitches.handoff` | `เปิด_ส่งต่อแอดมิน` (ตัด " (Handoff)") | — | ปิด(false) | **hard** สวิตช์ |
| `rawSwitches.orders` | `เปิด_ระบบออเดอร์` (ตัด " (Orders)") | — | ปิด(false) | **hard** สวิตช์ |
| `rawSwitches.follow` | `เปิด_ระบบติดตาม` (ตัด " (Follow)") | — | ปิด(false) | **hard** สวิตช์ |
| `rawSwitches.flexCards` | `เปิด_flex` | `เปิด_การ์ด_flex`, `เปิด_การ์ด flex` | ปิด(false) | สวิตช์ (ไม่มี call site) |
| `rawSwitches.timing` | `เปิด_จังหวะหน่วงเหมือนคน` | `เปิด_จังหวะหน่วง` | เปิด(true) | **hard** สวิตช์ (debounce) |

**คีย์ที่ไหลเข้า prompt เฉย ๆ (ไม่ parse เป็นตัวแปร):** ทุกคีย์ในชีต Config (รวม `โหมดความยาว`, `หน่วง_ก่อนพาไปประตูถัดไป` ฯลฯ) ถูกพิมพ์ลง `<ข้อมูล Config>` ผ่าน `formatConfigForPrompt` ให้ AI อ่านเอง — เฉพาะที่ระบุ "hard/prompt" ในตารางเท่านั้นที่โค้ดดึงเป็นตัวแปรจริง

**`parseSwitch` ตีความค่าเป็น boolean:** true = `เปิด/true/on/1/ใช่/yes` · false = `ปิด/false/off/0/ไม่/no/ค่าว่าง` · **คีย์หายไปเลย = ใช้ default** (ต่างจากเซลล์ว่างที่ = false) · ไม่สนตัวพิมพ์เล็กใหญ่

> คำสั่งแอดมิน (ปิดบอท/เปิดบอท/คืนบอท ฯลฯ) ใช้ synonyms hardcode ใน `admin-commands.ts` ไม่มีคีย์ Config

---

## 7. โครงชีตที่โค้ดคาดหวัง (อ่านแบบไหน)

| แท็บ | โค้ดอ่านยังไง | คอลัมน์ |
|---|---|---|
| **Step** | ส่ง CSV ดิบเข้า Gemini ทั้งก้อน **ไม่ parse คอลัมน์** | อิสระ (AI อ่านเอง) |
| **FAQ** | ส่ง CSV ดิบเข้า Gemini ทั้งก้อน **ไม่ parse คอลัมน์** | อิสระ |
| **Config** | **header-driven** — `findKeyValueCols` หาคอลัมน์ key (header มี "key" หรือ = "ค่า") + value (header มี "ค่าที่ตั้ง"/"value") · fallback = คอลัมน์ B(1)/C(2) | A=หมวด B=ค่า(key) C=ค่าที่ตั้ง D=หน่วย E=คำอธิบาย |
| **Follow** | **header-driven** — หา ชื่อกฎ / รอกี่วัน / ข้อความ · fallback index 0/3/4 · ข้าม header, ข้ามแถวที่ waitDays ไม่ใช่เลข>0 | A=ชื่อกฎ B=เงื่อนไข C=เริ่มนับจาก D=รอกี่วัน E=ข้อความ F=ปิดใช้หลังส่ง G=หยุดตามเมื่อ (⚠️ B/C/F/G **ยังไม่ถูกประเมิน** — ตามจาก "เงียบเกิน D วัน" อย่างเดียว) |
| **Orders** | **index A-R คงที่** (ไม่ header-driven) | ดูข้อ 9 |

CSV parser (`parseCsvRows`) รองรับ quoted field (comma/newline/`""` ในเครื่องหมายคำพูด) + CRLF/LF · cache 60 วิ · โหลดไม่ได้ = ใช้ cache เก่า, ไม่มี cache = null

---

## 8. คำสั่งแอดมิน (`admin-commands.ts` + `handleAdminGroupCommand`)

**รับเฉพาะจากกลุ่ม `ADMIN_GROUP_ID` เท่านั้น** (กลุ่มอื่น/แชท 1:1 เพิกเฉย) · ตอบกลับผ่าน reply token (ฟรี) fallback เป็น push

| คำสั่ง | คำสำรอง | ทำอะไร |
|---|---|---|
| `ปิดบอท <ชื่อ/เลข/userId>` | `หยุดบอท` | เข้า human_mode เฉพาะคนนั้น (บอทหยุดตอบเขา) |
| `เปิดบอท <ชื่อ/เลข/userId>` | `คืนบอท` | ออก human_mode (บอทกลับมาดูแล) |
| `ปิดบอททั้งหมด` | `หยุดบอททั้งหมด` | `setHumanModeAll(true)` ปิดทุกคน + ตอบจำนวน |
| `เปิดบอททั้งหมด` | `คืนบอททั้งหมด` | `setHumanModeAll(false)` เปิดทุกคน + ตอบจำนวน |
| `รายชื่อล่าสุด` | `รายชื่อ` | โชว์ลูกค้าคุยล่าสุด 10 คน + 🔴/🟢 + เวลา + เลขข้อ |

**การหา userId จากชื่อ (flexible, `matchCustomersByName`):**
1. arg เป็นเลข → เลือกจากรายการที่ค้างใน `admin_pending_choices` (ถ้าหมดอายุ 1 นาที → "รายการหมดอายุแล้ว พิมพ์คำสั่งใหม่อีกครั้ง")
2. arg เป็น userId เต็ม (`/^U[0-9a-f]{32}$/i`) → ทำเลย
3. arg เป็นชื่อ → `normalizeName` (lowercase + ตัด emoji/สัญลักษณ์ด้วย `[^\p{L}\p{N}\s]` + ยุบช่องว่าง) แล้ว (ก) match เป๊ะหลัง normalize → ถ้าเจอคืนเลย (ข) ไม่เจอ = partial (`includes`)
   - เจอ 1 คน → ทำเลย
   - เจอหลายคน → บันทึกรายการ (สูงสุด 10, เรียง last_seen ใหม่→เก่า) + ตอบรายการเลือกเลขข้อ (สะท้อน verb เดิม เช่น "ปิดบอท 1")
   - ไม่เจอ → ข้อความช่วย (พิมพ์บางส่วน / ดูรายชื่อล่าสุด)
4. พิมพ์คำสั่งไม่มี arg → บอกวิธีใช้

**`/reset`** (แชท 1:1 เท่านั้น, คุมด้วย `เปิด_คำสั่งเทสต์`): ล้าง stage/tags/last_slip_pathname + messages + pending_messages ของคนที่พิมพ์ (ไม่แตะ human_mode) → ตอบ "รีเซ็ตความจำแล้ว เริ่มใหม่ได้เลยค่ะ"

---

## 9. ระบบออเดอร์ + สลิป (flow เต็ม)

**รูปทุกชนิด (`handleImageMessage`):** ดาวน์โหลด → ส่งให้ Gemini พร้อมบริบทครบ (stage/history/Step/FAQ/Config) **โดยไม่อัปโหลดก่อน** · AI ตอบ `image_intent` = `slip`/`damage`/`other` + `image_note` · โค้ด `handleImageIntent` ลงมือเฉพาะ slip/damage:

**สลิป (`image_intent="slip"`):**
1. `uploadSlip(userId, buffer)` → Blob **private** store (`BLOB_SLIPS_TOKEN`), path = `slips/{YYYY-MM}/{userId}_{timestamp}.jpg`, `addRandomSuffix:false` (คืน null ถ้าไม่มี token — graceful)
2. เก็บ pathname ลง `customers.last_slip_pathname` (เผื่อ `address_collected` เทิร์นถัดไปผูกออเดอร์)
3. `getSlipSignedUrl(pathname, slipUrlExpiryDays)` สร้าง signed GET URL → **push เข้า `ADMIN_GROUP_ID`** (กลุ่มเช็คยอด) ข้อความ `💰 มีลูกค้าส่งสลิปมาค่ะ\n{image_note}\n\nLineOA: {ชื่อ}` + รูป signed URL
4. บอทตอบลูกค้าตาม flow ปกติ (AI ตอบประตู 4a: ขอบคุณ + ขอที่อยู่) — เป็นส่วนของ reply ที่ส่งไปก่อน handleImageIntent

**ของเสียหาย/เคลม (`image_intent="damage"`):** อัปโหลดรูปเป็นหลักฐาน → push **`ADMIN_GROUP_ID`** ข้อความ `⚠️ ลูกค้าแจ้งปัญหา/เคลมค่ะ\n{image_note}\n\nLineOA: {ชื่อ}` + รูป → `setHumanMode(true)` (เคลมต้องใช้คน)

**รูปอื่น (`image_intent="other"`):** ไม่อัปโหลด ไม่ยิงกลุ่ม — บอทตอบตามที่ AI คิด (บทสนทนาปกติ เช่น รูปสินค้าที่ลูกค้าเลือก)

**COD (`order_action="cod_confirmed"`, เทิร์นข้อความ):** push **`ADMIN_GROUP_ID`** ข้อความ `📦 ขอ CF COD ค่ะ\n{สินค้า x จำนวน}\n\nLineOA: {ชื่อ}`

**เก็บที่อยู่ครบ (`order_action="address_collected"`):** `appendOrderRow` เขียนแถวลงชีต Orders (คอลัมน์ A-R):
```
A ลำดับ(ว่าง) · B วันที่(ISO) · C ชื่อไลน์ลูกค้า(getProfileName) · D ชื่อ-นามสกุล · E เบอร์โทร(sanitize 10 หลัก)
F ที่อยู่ · G ตำบล · H อำเภอ · I จังหวัด · J รหัสไปรษณีย์ · K สินค้า+จำนวน("สินค้า x จำนวน")
L ยอดเงิน(sanitize เลข/จุด) · M การชำระเงิน · N รูปSlip(pathname) · O คอนเฟิร์ม=FALSE · P ยกเลิก=FALSE
Q ส่งออเดอร์แล้ว=FALSE · R เลขTracking(ว่าง)
```
sanitize ทุก field ก่อนเขียน (กัน AI ใส่ข้อมูลแฝง): เบอร์ต้อง 10 หลักติดกันไม่งั้นว่าง, ยอดเก็บเฉพาะเลข/จุด, ตัด newline

**cron แจกเลข (`/api/cron/orders`):**
1. auth `Authorization: Bearer <CRON_SECRET>` ไม่ผ่าน = 401
2. เช็คสวิตช์ orders + ORDER_GROUP_ID
3. `listPendingOrders`: อ่าน A2:R → กรอง **คอนเฟิร์ม(O)=TRUE และ ไม่ยกเลิก(P) และ ยังไม่ส่ง(Q)** (ติ๊กทั้ง O+P = ถือว่ายกเลิก, ปลอดภัยไว้ก่อน)
4. ต่อแถว: `nextOrderNumber(day)` atomic (`INSERT ... ON CONFLICT DO UPDATE last_no+1 RETURNING`) · `day` = วันตามรอบตัด (`resolveOrderDay` อิงเวลาไทย UTC+7 + `เวลาตัดรอบออเดอร์`) ถ้า `orderNumberResetDaily` เปิด, ไม่งั้น "ALL"
5. เลขออเดอร์: reset รายวัน = `{MMDD}-{seq}` · ไม่ reset = `{seq}`
6. `markOrderSent(rowIndex, orderNumber)` เขียนเลขลง A + Q=TRUE · push `ORDER_GROUP_ID` ข้อความแพ็ค (เลข.สินค้า+จำนวน / ยอด+ชำระ+อำเภอ / ชื่อ+ที่อยู่+เบอร์ / LineOA)

**หน้าที่ 2 กลุ่มแยกกันชัดเจน (ตรงกับบรีฟ):**
- **`ADMIN_GROUP_ID`** (กลุ่มปลาทูเรียก) = รับ handoff + คำสั่งแอดมิน (ปิด/เปิดบอท) + **เช็คยอดสลิป/CF COD**
- **`ORDER_GROUP_ID`** (กลุ่มปลาทูส่งออเดอร์) = กลุ่มแพ็คของ = รับเฉพาะออเดอร์ที่คอนเฟิร์มแล้ว จาก `cron/orders` เท่านั้น

---

## 10. Vercel Blob 2 store

| store | token | access | ใช้ทำอะไร | naming |
|---|---|---|---|---|
| slips | `BLOB_SLIPS_TOKEN` | **private** | สลิปโอนเงิน (PII) | `slips/{YYYY-MM}/{userId}_{timestamp}.jpg` |
| products | `BLOB_PRODUCTS_TOKEN` | **public** | รูปสินค้า (ใช้ URL ตรง) | `products/{ชื่อสินค้า}/{filename}` |

- สลิป private: เก็บแค่ **pathname** ลงชีต (คอลัมน์ N) ไม่เก็บ signed URL (เพราะหมดอายุ) · สร้าง signed GET URL ใหม่ทุกครั้งที่ต้องโชว์ (`getSlipSignedUrl` → `issueSignedToken` operations:["get"] + `presignUrl` access:"private", validUntil = `slipUrlExpiryDays` วัน)
- ต้องใช้ `@vercel/blob` **≥2.4.0** (private + signed URL GA มิ.ย. 2026) — โค้ดใช้ ^2.6.1
- `uploadProductImage` มีอยู่แต่ **ยังไม่มี call site จริง** (จะถูกเรียกจาก flex-cards ที่ยัง dormant)

---

## 11. Cron

| endpoint | ตั้งที่ไหน | auth | ทำอะไร |
|---|---|---|---|
| `/api/cron/follow` | `vercel.json` crons: `0 3 * * *` (ตี 3 ทุกวัน — Vercel Hobby รันวันละครั้ง) | `Bearer CRON_SECRET` | ตามลูกค้าเงียบเกิน N วัน |
| `/api/cron/orders` | **external cron (เช่น cron-job.org)** ทุก 2-5 นาที — ไม่อยู่ใน vercel.json | `Bearer CRON_SECRET` | แจกเลขออเดอร์ + ยิงกลุ่มแพ็ค |

- ทั้งคู่เช็ค `Authorization: Bearer <CRON_SECRET>` ไม่ตรง = 401 (Vercel cron แนบ header นี้อัตโนมัติจาก env `CRON_SECRET`; external cron ต้องตั้ง custom header เอง)
- **⚠️ ต่างจากบรีฟ:** บรีฟให้ cron follow วิ่งบ่อย · โค้ดจริง `vercel.json` ตั้ง follow = วันละครั้ง (ตี 3) ตามข้อจำกัด Vercel Hobby · `/api/cron/orders` **ไม่ได้อยู่ใน vercel.json** ต้องตั้ง external cron แยก
- Follow cron อ่าน CSV_Follow (header-driven), หาลูกค้า `getStaleCustomers(waitDays)` (เงียบเกิน D วัน, ไม่ human_mode), เช็ค `hasFollowedRecently` (กันซ้ำใน waitDays*24 ชม.), push ข้อความ, `logFollowSent`

---

## 12. human_mode (เข้า/ออก + flag)

**เข้า human_mode (`setHumanMode(userId, true)` — arm `resume_notice_pending=true` ด้วย):**
- handoff keyword pre-check เจอคำ (`runHandoffFlow`)
- Gemini ตอบ `handoff=true` (AI-semantic) และสวิตช์ handoff เปิด
- คำสั่งแอดมิน `ปิดบอท <ชื่อ>` / `ปิดบอททั้งหมด`

**ออก human_mode:**
- คำสั่งแอดมิน `เปิดบอท <ชื่อ>` / `เปิดบอททั้งหมด` (`setHumanMode false` — ไม่ล้าง resume flag)
- auto-timeout: ลูกค้าพิมพ์มาใหม่ตอน `now - last_seen ≥ adminSilenceReturnMinutes` นาที (default 45) → ปลดล็อกเอง

**resume notice (ประโยคเปลี่ยนมือ):**
- `resume_notice_pending` arm ตอนเข้า human_mode · ส่ง `botResumeMessage` เกริ่น 1 บับเบิลตอนบอทกลับมา (ทั้ง auto-timeout และ `เปิดบอท`) · ส่งผ่าน reply ของข้อความลูกค้าครั้งถัดไป (ฟรี ไม่ push เชิงรุก) · ล้าง flag หลังส่ง → ข้อความถัดไปไม่ส่งซ้ำ
- **จุดสำคัญ:** `เปิดบอท`/`เปิดบอททั้งหมด` **ไม่ push หาลูกค้าทันที** — รอลูกค้าพิมพ์ครั้งถัดไปแล้วเกริ่นผ่าน reply (money-safe, กันเผา push quota โดยเฉพาะ bulk)
- **auto-return วัดจาก `last_seen` (แชทเงียบ) หน่วยนาที** (คีย์ `คืนสิทธิ์บอท_หลังแชทเงียบ`, default 45) — **จงใจเลือก last_seen ไม่ใช่ human_mode_since** เพราะให้แอดมินคุยกับลูกค้าได้ไม่จำกัดเวลา พอเงียบจริง 45 นาที (จบเคส) บอทค่อยกลับมา · ถ้านับจาก human_mode_since บอทอาจเด้งแทรกกลางวงสนทนาที่แอดมินยังคุยอยู่ = เสียหายกว่า · column `human_mode_since` ยังมีในตารางแต่ logic ไม่ได้ใช้

---

## 13. Safety / guardrails ในโค้ด

- **verify signature:** `validateSignature` ทุก request ไม่ผ่าน = 401
- **timeout Gemini:** `withTimeout(8000ms)` → fallback DEFAULT_REPLY
- **retry LINE:** `withRetry` 3 ครั้ง exponential backoff (300/600/1200ms) · ยังไม่ได้ = log + คืน null (ไม่ throw)
- **MAX_TOKENS:** finishReason MAX_TOKENS → DEFAULT_REPLY (กันตอบครึ่งประโยค) · `maxOutputTokens` บังคับ ≥2048 (gemini-3.x นับ thinking+output รวม · เทิร์นสรุปออเดอร์ 4b เคยชน 1024)
- **degraded flag:** ทุก fallback (timeout/MAX_TOKENS/parse fail/error) ตั้ง `degraded=true` · ถ้าเทิร์นนั้นมีรูป → โค้ดถือรูปเป็น "slip" ไว้ก่อน (อัปโหลด+ยิง ADMIN พร้อมโน้ต "AI อ่านรูปไม่สำเร็จ") + ตอบลูกค้าแบบสบายใจ — เรื่องเงินห้ามพลาด เก็บเกินดีกว่าทำหาย
- **กฎปิดท้ายด้วยข้อความ (safety net):** `enforceTextLast` — ถ้าบับเบิลสุดท้ายเป็นรูป จะสลับให้ข้อความอยู่ท้าย ถ้ามีแต่รูปจะเติม "สอบถามเพิ่มเติมได้เลยนะคะ" + log warn
- **กัน injection:** ข้อความลูกค้าอยู่ใน user content (บล็อก `<ข้อความลูกค้า>`) แยกจาก systemInstruction · sanitize `order_data` ก่อนเขียนชีต
- **atomic order number:** `INSERT ... ON CONFLICT DO UPDATE last_no+1 RETURNING` (กัน cron รันซ้อนแจกเลขซ้ำ)
- **all-or-nothing:** ทุกฟีเจอร์เช็คสวิตช์+env ครบก่อนทำ ขาด = ปิดทั้งฟีเจอร์ + log
- **debounce dedup:** เทียบ `getLatestPendingId` กันหลาย invocation ตอบซ้ำ
- **cap 5 บับเบิล/ครั้ง:** `MAX_MESSAGES_PER_SEND=5` เกินตัดทิ้ง + log
- **quota saver:** ยุบ `[[เว้น]]` เป็นย่อหน้าเมื่อเปิด → reply เดียว ไม่ล้นไป push (default เปิด = money-safe เมื่อโหลด config ไม่ได้)
- **PII:** log เป็น JSON structured ไม่ log ข้อความเต็มลูกค้า · display_name/สลิป เก็บ Neon/Blob ไม่โชว์ในกลุ่มเกินจำเป็น
- return 200 เสมอ (ยกเว้น signature = 401) — LINE ไม่ retry ซ้ำ

---

## 14. จุดที่ตัดสินใจเองระหว่างทาง + เหตุผล

1. **`last_slip_pathname` ใน customers (deterministic + ล้างเมื่อสำเร็จ)** — ลูกค้ามักส่งสลิปเทิร์นหนึ่งแล้วพิมพ์ที่อยู่เทิร์นถัดไป ต้องจำ pathname ข้ามเทิร์นถึงเขียนคอลัมน์ N ได้ถูกแถว · เขียนด้วย `GREATEST(last_slip_pathname, new)` เก็บใบล่าสุด (timestamp ในชื่อไฟล์สูงกว่า) กันส่งสลิปหลายใบพร้อมกันแล้ว invocation แข่งเขียนทับกันมั่ว · **ล้าง (`clearLastSlipPathname`) เมื่อ `appendOrderRow` สำเร็จเท่านั้น** (pathname อยู่ในชีตแล้ว) — ถ้า throw จะไม่ล้าง (retry เทิร์นหน้าได้)
2. **resume notice ใช้ arm-flag แทน push เชิงรุก** — `เปิดบอท` ไม่ push หาลูกค้าทันที แต่รอลูกค้าพิมพ์แล้วเกริ่นผ่าน reply (ฟรี) → กันเผา push quota โดยเฉพาะ `เปิดบอททั้งหมด` (เงินจริง)
3. **quotaSaver default เปิด** — เมื่อโหลด Config ไม่ได้ (loadFailed) ให้ money-safe ไว้ก่อน (ยุบเป็น reply เดียว ไม่มีทางล้นไป push)
4. **display_name เก็บตอนคุยครั้งแรก (เมื่อ null)** — getProfile ไม่คิดเงิน แต่เรียกทุกเทิร์นเปลือง latency → เก็บครั้งเดียว (ข้อจำกัด: ลูกค้าเปลี่ยนชื่อแล้วค้นชื่อใหม่ไม่เจอจนกว่าจะทัก → มี "รายชื่อล่าสุด" เป็นตาข่ายกันตก)
5. **admin_pending_choices เก็บใน Neon** (ไม่ใช่ in-memory) — serverless มีหลาย invocation/cold start, in-memory Map หาย → เก็บ DB ผูกกับ group id หมดอายุ 1 นาที
6. **human_mode คืนสิทธิ์วัดจาก last_seen (แชทเงียบ) ไม่ใช่ human_mode_since** — ให้แอดมินคุยกับลูกค้าได้ไม่จำกัดเวลา พอเงียบจริง 45 นาที (จบเคส) บอทค่อยกลับ · ถ้านับจาก human_mode_since จะกินเวลาช่วงแอดมินยังไม่ทันเห็นแชท + อาจเด้งแทรกกลางวงสนทนา = เสียหายกว่า
7. **สลิป/COD ยิง ADMIN_GROUP_ID** (กลุ่มเช็คยอด) · ORDER_GROUP_ID = กลุ่มแพ็ค รับเฉพาะออเดอร์คอนเฟิร์มแล้วจาก cron — แยกหน้าที่ 2 กลุ่มชัดเจน (ดูข้อ 9)
8. **cleanCell + stripKeyAnnotation ทั้ง key และ value** — กันชีตมีอักขระล่องหน/วงเล็บกำกับทำ lookup พลาด (ดูข้อ 15)
9. **Config lookup แบบ alias หลายชื่อ + header-driven** — ทนต่อชื่อคีย์เพี้ยน/คอลัมน์สลับ ขาดก็ fallback default (graceful)
10. **รูป = ข้อความอีกรูปแบบ (เลื่อนอัปโหลดไว้ทีหลัง)** — โค้ดเดิมอัปโหลดทุกรูปเข้า slips store ทันที (ถือว่าทุกรูป=สลิป) · โค้ดใหม่ส่งรูปเข้า Gemini พร้อมบริบทก่อน ให้ AI ตัดสิน `image_intent` แล้วค่อยอัปโหลด/ยิงกลุ่มเฉพาะ slip/damage — ไม่ hardcode ลิสต์เคสรูป (แจกแจงไม่มีวันครบ) · ถ้าไม่แน่ใจ AI ถามลูกค้า · สลิปอ่านไม่ชัด = ถือเป็น slip ไว้ก่อน (เรื่องเงินห้ามพลาด)
11. **image-fallback กัน Gemini ล้มทำสลิปหาย** — ถ้าเทิร์นมีรูปแต่ Gemini fallback (`degraded=true`: timeout/MAX_TOKENS/parse fail/error) → `image_intent` เชื่อไม่ได้ → บังคับถือเป็น slip (อัปโหลด+ยิง ADMIN พร้อมโน้ต "AI อ่านรูปไม่สำเร็จ") + ตอบลูกค้าแบบสบายใจ (รับรูปแล้ว กำลังตรวจสอบ) — พลาดฝั่ง "เก็บเกิน" ดีกว่า "ทำหาย"

**ยกยอดเฟส 2 (ยังไม่ทำ):** รูปหลายใบ/รูป+ข้อความในหน้าต่างเดียว — ปัจจุบัน image event ไม่เข้า debounce (`handleImageMessage` → `processMessage` ตรง) · การเอารูปเข้า `pending_messages` buffer ให้รวบเป็น Gemini call เดียว (รองรับหลายรูป) เป็นงานโครงใหญ่ (schema buffer + multi-image Gemini + rewrite collector) เลื่อนไว้เฟส 2 · 4a (deterministic pathname) ทำแล้ว

---

## 15. บั๊กที่เคยเจอ + วิธีแก้ (บอทตัวใหม่ต้องระวัง)

1. **อ่านผิดคอลัมน์ Config** — โครงชีตจริง A=หมวด, B=key, C=value แต่โค้ดแรกอ่าน key=A/value=B (offset เลื่อน) → ทุกสวิตช์ตกไป default (handoff default false → ไม่ push) · **แก้:** header-driven `findKeyValueCols` หาคอลัมน์จากชื่อ header, fallback B(1)/C(2)
2. **parseSwitch ไม่รองรับค่าไทย** — โค้ดแรกเทียบ `=== "เปิด"` เป๊ะ ๆ พอเซลล์มีอักขระล่องหน (zero-width/BOM/nbsp) ที่ `.trim()` จับไม่หมด → เทียบไม่ผ่าน = false · **แก้:** `cleanCell` ตัด `[​-‍﻿ ]` + `parseSwitch` รับหลายคำ (เปิด/true/on/1/ใช่/yes) · **คีย์หาย = default, เซลล์ว่าง = false** (แยกกัน)
3. **คีย์มีวงเล็บกำกับ** — ชีตเขียน `เปิด_ส่งต่อแอดมิน (Handoff)` แต่โค้ด lookup `เปิด_ส่งต่อแอดมิน` · **แก้:** `stripKeyAnnotation` ตัด " (...)" ท้ายคีย์
4. **ชื่อคีย์เพี้ยน/สลับคำ** — เช่น โค้ดอ่าน `เวลารอบตัดออเดอร์` แต่ชีตจริง `เวลาตัดรอบออเดอร์` · debounce ชีต `debounce_รวบคำถาม` แต่โค้ดเดา `รวมคำถาม` · หน่วยต่อท้ายคีย์ (`_วิ`/`_วัน`) ที่จริงอยู่คอลัมน์ D แยก · **แก้:** lookup แบบ alias หลายชื่อ + prefix fallback (`debounce`)
5. **handoff ไม่ push แบบเงียบ** — โค้ดแรก `if (!adminGroupId) return;` ไม่ log อะไรเลย → env ไม่ถึง/สวิตช์ปิดแยกจาก push สำเร็จไม่ออก · **แก้:** log warn ชัดทุกกรณี + เข้าใจว่า all-or-nothing gate (สวิตช์+env+memory) บังคับ effectiveHandoff
6. **Follow อ่านผิดคอลัมน์** — โค้ดแรกอ่าน B=stage/C=hours/D=message แต่ชีตจริง D=รอกี่วัน/E=ข้อความ · **แก้:** header-driven + ใช้ waitDays, เลิกใช้ stage (ชีตไม่มีคอลัมน์ stage)
7. **`mode` webhook เป็น active เสมอ** — เคยหวังใช้ `mode:"standby"` จับตอนแอดมินแทรกตอบ (auto human_mode) · **ผลจริง:** setup Chat mode + Webhook (ไม่มี module channel) ได้ `mode:"active"` ทุก event, LINE ไม่ echo ข้อความแอดมิน → **auto-detect ทำไม่ได้** → ใช้คำสั่ง manual ในกลุ่มแอดมินแทน
8. **`@vercel/blob` เวอร์ชันเก่าไม่มี private+signed** — ต้อง ≥2.4.0 · โค้ดใช้ `put(access:"private")` + `issueSignedToken` + `presignUrl`

---

## ภาคผนวก: สถานะฟีเจอร์ (สวิตช์ default ในโค้ด)

| ฟีเจอร์ | สวิตช์ default | หมายเหตุ |
|---|---|---|
| แกนขาย (Step+FAQ+Config) | (ไม่มีสวิตช์ — เช็ค env) | เปิดถ้า SHEET_*_URL ครบ |
| ความจำ (Neon) | (เช็ค DATABASE_URL) | — |
| ติดแท็ก | เปิด | ต้องมี memory |
| จังหวะเหมือนคน (debounce) | เปิด | ต้องมี memory |
| ส่งต่อแอดมิน (handoff) | **ปิด** | ต้องมี ADMIN_GROUP_ID + memory |
| ระบบออเดอร์ | **ปิด** | ต้องมี ORDER_GROUP_ID+service account+SHEET_ORDERS_ID+BLOB_SLIPS_TOKEN+memory |
| ตามลูกค้า (follow) | **ปิด** | ต้องมี SHEET_FOLLOW_URL + memory + กฎในชีต |
| Flex Cards | **ปิด** | โค้ด builder มี แต่ยังไม่มี call site (dormant) |
| คำสั่งเทสต์ (/reset) | เปิด | ปิดตอนขายจริง |
| โหมดประหยัดโควตา | เปิด | hard-logic คุม push |
