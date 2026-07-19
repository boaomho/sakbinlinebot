# SAKBIN — DECISIONS & KNOWN ISSUES

> บันทึกการตัดสินใจนอกบรีฟ + บั๊กที่รู้แล้วแต่ยังไม่แก้ (พร้อมเหตุผลว่าทำไมถึงยังไม่แก้)
> อ้างอิง: `BRIEF-ClaudeCode-v1.5.md` · `SAKBIN-CONTRACTS-v1.5.md` · `SAKBIN-FOLLOW-SPEC.md`

---

## Known Issues

### KI-01 · 🔴 priority สูง · แก้ตอน Step 4 (รื้อ `คำ_handoff`)

**`คำ_handoff` ใช้ substring match → คำถามการขายโดนโยน handoff = เสียยอดขาย**

[`lib/handoff.ts`](../lib/handoff.ts) `checkHandoffKeywords()` เทียบด้วย
`normalized.includes(keyword.toLowerCase())` = **substring match ล้วน**

keyword `"PR"` ใน `DEFAULT_HANDOFF_KEYWORDS` (เจตนา = ประชาสัมพันธ์/ติดต่อสื่อ) จึงไปแมตช์
**ทุกคำที่มี `pr` อยู่ข้างใน**:

| ลูกค้าพิมพ์ | ผลที่เกิดจริง |
|---|---|
| "มี **pr**omotion อะไรบ้าง" | โดน handoff → บอทเงียบ |
| "ส่ง ex**pr**ess ได้มั้ย" | โดน handoff → บอทเงียบ |
| "**pr**ice เท่าไหร่" | โดน handoff → บอทเงียบ |

เป็นคำถาม **กลางกรวยการขาย** ที่ควรตอบเองได้ แต่กลับถูกโยนเข้า `human_mode` เงียบ ๆ
→ ลูกค้ารอแอดมิน → **เสียการขายโดยไม่มีใครรู้** (ไม่มี error ไม่มี log ผิดปกติ)

`"PR"` อันตรายเป็นพิเศษเพราะเป็น keyword เดียวในลิสต์ที่สั้น + เป็น ASCII
(คำไทยที่เหลือยาวพอจนไม่ชนโดยบังเอิญ)

**ค้นพบโดย:** regression harness (ก้อน A) — บท 12 "เขียวเพราะอุบัติเหตุ": ข้อความ
injection มีคำว่า `prompt` → ชน `"PR"` → บอทไม่เคยเรียก Gemini → ไม่มีตัวเลขราคาให้ตรวจ
→ assertion ผ่านทั้งที่ยังไม่มี price guard

**ทำไมยังไม่แก้:** ก้อน A มีกติกาว่า harness ห้ามแตะ product code (ต้องได้ baseline v1.2
แท้ ๆ ก่อนรื้อ core) · และ Step 4 จะรื้อ `คำ_handoff` อยู่แล้ว → แก้ตอนนั้นทีเดียว ไม่ปนกัน

**ต้องทำตอน Step 4:** เปลี่ยนเป็น **word-boundary match** สำหรับ keyword ที่เป็น ASCII ล้วน
(คำไทยไม่มีช่องว่างระหว่างคำ ใช้ substring ต่อไปได้) · แล้วปลด comment กันชนใน
`tests/scenarios/expect-fail.test.ts` บท 12

---

### KI-02 · Step 5 (claims/price guard)

**ยังไม่มี price guard ฝั่งโค้ด — ราคาที่ AI แต่งเองหลุดถึงลูกค้าได้**

`assertNoPriceOutsideCatalog()` มีใน [`tests/harness/assert.ts`](../tests/harness/assert.ts) แล้ว
แต่ยังไม่มีโค้ดฝั่ง product ที่บังคับจริง — ถ้า AI ตอบราคาที่ไม่มีใน `CSV_Products`/`CSV_Promo`
(เช่น โดน injection หลอกให้ลด 90%) **ไม่มีอะไรกันไว้เลย**

ตอนนี้บท 12 เป็น `it.fails` = คาดว่าแดง · เมื่อ Step 3/5 ทำ pricing + guard เสร็จ
บทนี้จะเขียวขึ้นมาเอง แล้ว vitest จะฟ้อง "expected to fail but passed" → ให้ปลด `.fails` ออก

**หมายเหตุสำคัญ:** harness รันด้วย **scripted Gemini** เป็น default → บทที่ต้องวัด
"ความฉลาดของ AI" จริง ๆ (บท 5, 12) ต้องรันด้วย `HARNESS_REAL_GEMINI=1` ถึงจะมีความหมาย
ส่วน default mode พิสูจน์ได้แค่ **ชั้นที่เป็นโค้ด** (keyword pre-check, gate, guard)

---

### KI-03 · ✍️ ระวังตอนแก้ prompt (โดนมาแล้ว 2 ครั้ง)

**backtick ในข้อความ prompt ปิด template literal**

`prompt/system.ts` เป็น template literal ก้อนใหญ่ — เขียน `` `ที่อยู่` `` (markdown code) ในข้อความ
= ปิด string กลางคัน → **build พังทันที** และ error ชี้ไปที่ `lib/gemini.ts` (ไฟล์ที่ import)
ไม่ใช่ไฟล์ที่ผิดจริง ทำให้ตามหายาก

**กติกา:** ในข้อความ prompt ใช้ `<แท็ก>` เปล่า ๆ ห้ามครอบ backtick

**🔴 เกิด 4 ครั้งแล้ว = ต้องมี tooling ไม่ใช่ discipline** (เจ้าของสั่ง):
guard จริง `tests/scenarios/prompt-lint.test.ts` — อ่าน source ตรง ๆ (ไม่ผ่าน build)
จับ backtick ที่ไม่ใช่ template delimiter → รันใน npm test ทุกครั้ง ชี้บรรทัดชัด
+ กติกา workflow: แก้ไฟล์ที่มี backtick ใช้ Write/Edit tool ห้าม node -e/heredoc ผ่าน bash
(bash กิน backtick เป็น command substitution — คนละเคสกับ template literal แต่รากเดียวกัน)

---

### KI-04 · 🧪 harness: state.ts ห้าม import อะไรที่ import googleapis

mock factory ของ `googleapis` ทำ `await import("./state")` — ถ้า `state.ts` import `@/lib/orders`
(ซึ่ง import `googleapis`) → **circular dependency → เทสค้างค้างไม่มี error ไม่มี timeout message**
เสียเวลาตามหานาน

**กติกา:** helper ที่ต้องใช้ `ORDERS_HEADER` อยู่ที่ `tests/harness/sheet.ts` ไม่ใช่ `state.ts`

---

## Decisions

### D-01 · ทำ Step 9 (regression harness) ก่อน Step 0 (แยก core)

บรีฟเรียง 0 → 9 แต่เจ้าของสั่งสลับ: harness คือ **ตาข่ายที่ทำให้การรื้อ core ปลอดภัย**
ต้องมีก่อนรื้อ · ผลลัพธ์: บท 1/7/8/9 เขียวกับ v1.2 = ได้ baseline นิ่ง + ยืนยันว่า
flowing order-model ถูกต้องจริง ก่อนเริ่มขยับไฟล์

### D-02 · harness ใช้ Neon branch จริง (ไม่ mock db, ไม่ใช้ pglite)

`neon()` คุยได้เฉพาะ Neon HTTP protocol → ต่อ local Postgres/pglite ตรง ๆ ไม่ได้ ต้องใส่ seam
ใน `db.ts` ซึ่งขัดกติกา "harness ห้ามแตะ product code"

เลือกใช้ **Neon branch `harness-test`** ผ่าน `DATABASE_URL` ใน `.env.test` แทน:
- **แก้ product code = ศูนย์** (env อย่างเดียว)
- SQL จริงตรงกับ prod เป๊ะ (`TEXT[]`, JSONB, `array_remove`, `GREATEST`, `ON CONFLICT`)
  ซึ่ง order-model พึ่งพาหนัก — เทสกับของจริงเท่านั้นถึงพิสูจน์ได้
- กันยิงผิด DB ด้วย `HARNESS_DB_CONFIRM=harness-test` (harness ทำ `TRUNCATE` จริง)

### D-03 · mock LINE ที่ชั้น SDK client ไม่ใช่ที่ `lib/line`

ถ้า mock `lib/line` ทั้งก้อน จะ mock ทิ้ง `parseReplyIntoMessages()` + `enforceTextLast()`
ซึ่งเป็นที่อยู่ของ **กฎเหล็กข้อ 9 (บอลลูนสุดท้ายต้องเป็นข้อความ)** → assertion กลาง
"บอลลูนสุดท้ายเป็นข้อความ" จะกลายเป็นการเทสของปลอม

จึง mock แค่ `messagingApi.MessagingApiClient` / `MessagingApiBlobClient` (ชั้นล่างสุดที่ยิงเน็ต)
→ `lib/line` ทำงานเต็ม · และคำนวณ HMAC signature จริงให้ผ่าน `validateSignature()` ของจริง
→ เดินพาธจริงตั้งแต่ `POST` รวมพาธ auth

### D-04 · `stage` enum ใน assertion กลาง = เซ็ตของ v1.2 ไปก่อน

บรีฟให้ assert `stage` อยู่ใน enum แต่ v1.2 ยังใช้ค่าอิสระ (`1/2/3/4a/4b`)
→ ตอนนี้ assert กับเซ็ต v1.2 (`V1_2_STAGES`) เพื่อจับ regression ของการ persist
→ **Step 6** เปลี่ยนเป็น enum เข้ม `S1..H4` แล้วอัปเดตลิสต์ใน `tests/harness/assert.ts`

### D-05 · 🔴 ที่อยู่เก็บเป็น "ก้อนเดียว" — บอทไม่ตรวจที่อยู่

**ที่มา:** ออเดอร์หายเงียบทั้งระบบ · `addressComplete` เดิมบังคับ ตำบล/อำเภอ/จังหวัด แยกเป็นฟิลด์
แต่ลูกค้าพิมพ์ที่อยู่ก้อนเดียวไม่มี ต./อ./จ. นำ → AI ส่งมาแค่ [ชื่อ, ที่อยู่, รหัส, เบอร์]
→ `complete=false` ตลอดกาล → ลูกค้าที่ตกลงซื้อแล้วหลุดหมด (ยืนยันจาก log จริง)

**หน้าที่บอท:** ตอบดี · ขายได้ · เก็บ ชื่อ/ที่อยู่/เบอร์ · แจ้งแอดมิน · เขียนชีต · ปิดจบ — แค่นั้น
**การตรวจ/จับคู่ตำบล-อำเภอ-รหัส = หน้าที่ระบบขนส่ง+แอดมิน ไม่ใช่บอท**

**ยกเลิกทั้งหมด:** ฐานข้อมูลไปรษณีย์ · cross-check · แยกตำบล/อำเภอ · ธง 3 ระดับ (✅/⚠️/🔴)
*(เคยประเมิน `thai-address-database` ไว้แล้ว — `splitAddress` แยกเคสที่พังได้จริง แต่เจ้าของ
ตัดสินว่าไม่ใช่หน้าที่บอท จึงไม่เอา)*

**กฎ prompt "ทวนตามลูกค้า ห้ามคิดเอง":** ห้ามเดาจังหวัดจากรหัส · ห้ามเติม ต./อ. ที่ลูกค้าไม่ได้พิมพ์ ·
ห้ามแก้คำที่คิดว่าสะกดผิด → **บอทเดา = ของส่งผิดบ้านโดยลูกค้าไม่รู้ตัว**

### D-06 · order gate 2 ระดับ — "มีคนอยากซื้อ ห้ามเงียบ"

กฎเดิม "ชีตรับเฉพาะออเดอร์สมบูรณ์" ทำร้ายการขาย — ข้อมูลขาด = ระบบเงียบ = แอดมินไม่รู้ว่ามีคนอยากซื้อ

- **ครบ** (ชื่อ + เบอร์ + ที่อยู่ก้อนไม่ว่าง · COD ต้องมือถือ · โอนต้องมีสลิป) → เขียนชีต + push 📦
- **ไม่ครบ + สั่งแล้ว** (เลือกวิธีจ่ายแล้ว) → **push ⚠️ อย่างเดียว ยังไม่เขียนแถว** + บอทถามที่ขาด
  *ยังไม่เขียนแถวเพราะยังไม่มี `order_id` ให้แอดมินเติมทีหลัง (มาตอน Step 2)*
- **ยังไม่สั่ง** → เงียบได้
- **ข้อยกเว้นเดียว:** COD + เบอร์ไม่ใช่มือถือ → บอทถามเบอร์เอง ยังไม่ push (บอทกำลังจัดการอยู่)

กัน push ซ้ำทุกเทิร์นด้วย flag เดิม `paid_no_address_notified` (ไม่เพิ่ม state ใหม่)

### D-07 · เบอร์: "มีตัวเลข = ผ่าน" จบ (ยกเลิกการเช็คทั้งหมด)

**ประวัติ 3 รอบ:**
1. เดิม: บังคับ 10 หลักเป๊ะ → เบอร์บ้านไทย (9 หลักเสมอ) ตกหมด
2. แก้เป็น 9–10 หลัก + COD บังคับมือถือ (06/08/09) → **เคสเยอะ เทสบาน error เยอะ**
3. **เคาะสุดท้าย: ตัดทิ้งหมด** — `sanitizePhone` strip เหลือแต่ตัวเลข · มีตัวเลข = ผ่าน
   ไม่เช็คมือถือ ไม่เช็คจำนวนหลัก ไม่แยก COD/โอน

**ทำไม:** การเช็คเบอร์ไม่สร้างมูลค่า — **แอดมินโทรถามเบอร์เอาเองได้** แต่กฎเช็คสร้าง
เคสที่ต้องเทสเยอะ + เสี่ยงบล็อกออเดอร์ที่ลูกค้าจ่ายเงินมาแล้ว (ขัดหลัก "จ่ายแล้วห้ามหลุด")

**เกณฑ์ปิดเหลือ:** ชื่อ + เบอร์(ไม่ว่าง) + ที่อยู่(ก้อนไม่ว่าง) · โอนเพิ่มแค่สลิป
ยกเลิก `isMobilePhone` และ `codPhoneBlocked` ออกจาก contract

### D-08 · 🔴 harness ต้อง mock ที่ชั้น googleapis ไม่ใช่ lib/orders

เดิม mock `appendOrderRow` ทิ้ง → `sanitizePhone` + **การจัดคอลัมน์ตัวจริงไม่เคยถูกเทส**
= จุดบอดเดียวกับที่ทำให้ **บั๊ก P0 (SHEET_ORDERS_ID เป็น CSV URL) รอดสายตามาได้**
บท 1 เขียวแปลว่า "gate ตัดสินถูก" ไม่ได้แปลว่า "ออเดอร์ถึงชีตจริง"

ตอนนี้ mock ที่ `googleapis` → `appendOrderRow` ตัวจริงรันเต็ม แล้ว assert **แถวดิบเทียบตัวอักษร
คอลัมน์ A–X** (`tests/scenarios/sheet-layout.test.ts`) → "ค่าลงผิดช่อง" ถูกจับได้ทันที
*(บั๊กค่าลงผิดช่องคือบั๊กที่แพงที่สุดของระบบนี้ เพราะมันเงียบ — ไม่มี error ออเดอร์ดูปกติ)*

### D-09 · Orders A–X 24 คอลัมน์ · Q–X เลื่อนซ้าย 2 ช่องจาก contract เดิม

ลบ ตำบล/อำเภอ ออก → คอลัมน์หลังเลื่อนซ้ายหมด (CONTRACTS §8 เดิมจอง S–Z ไว้):

| field | contract เดิม | ตอนนี้ |
|---|---|---|
| `order_id` (idempotency key) | S | **Q** |
| `line_user_id` | T | **R** |
| `items_json` | U | **S** |
| `ค่าส่ง` | V | **T** |
| `source_channel` | W | **U** |
| `ref_code` | X | **V** |
| `ยอดในสลิป` | Y | **W** |
| `bot_version` | Z | **X** |

Q–X เขียนเป็นช่องว่างไว้ก่อน (จองตำแหน่งให้ตรงชีต) — Step 2/3 จะเติมค่า
⚠️ index ตายตัวชั่วคราว — **Step 1 (header-driven) จะรื้อถาวร** `sheet-layout.test.ts` คือตาข่ายจนถึงตอนนั้น

### D-10 · 🔴 maxOutputTokens พื้น 4096 (เดิม 2048 ชนจริง)

gemini-3.x นับ **thinking + output รวมกัน** ในเพดาน `maxOutputTokens`
ของจริง: เทิร์นสรุปออเดอร์ชน **2032/2048** → `finishReason=MAX_TOKENS` → JSON ขาดกลางคัน
→ fallback → **ลูกค้าเห็น "ปลาทูขัดข้อง" ตอนกำลังจะจ่ายเงิน** = เทิร์นที่แพงที่สุดของ funnel

**guard มีอยู่แล้ว** (`if (finishReason === "MAX_TOKENS") return fallback()`) → ไม่เคย parse ครึ่ง ๆ
อาการ "บอทตอบขัดข้อง" คือ fallback ทำงานถูกต้อง — **บั๊กจริงคือเพดานต่ำเกิน** ไม่ใช่ตัว parse

**แก้:** พื้น `Math.max(4096, ...)` (pattern เดียวกับที่เคยยก 1024→2048) · ชีตตั้ง 2048 ไว้ซึ่งไม่พอจริง
**log ใหม่:** `thoughtsTokenCount` vs `candidatesTokenCount` vs `promptTokenCount` → เห็นว่าใครกิน budget
**ตาข่าย:** `tests/scenarios/gemini-guard.test.ts` (จำลอง JSON ขาด → ต้อง degraded ไม่ throw ไม่หยิบ order_data)

**เลเวอร์ที่ยังไม่ได้ใช้:** `ThinkingLevel` มี `MINIMAL` ต่ำกว่า `LOW` ที่ใช้อยู่ — ถ้า log ชี้ว่า
thinking กิน budget เกินควร ลดเป็น MINIMAL ได้ (แต่กระทบคุณภาพการตอบ = เจ้าของตัดสิน)

**เพิ่ม KI-03:** ห้ามใช้ `node -e` ที่มี backtick ผ่าน bash — bash กิน backtick เป็น command
substitution แล้วเนื้อหาหายเงียบ (โดนมาแล้ว) ให้ใช้เครื่องมือแก้ไฟล์ตรง ๆ

### D-11 · จังหวะแจ้งกลุ่มแอดมิน — ตัด push ⚠️ ระหว่างทางออก

**บั๊กจริง:** COD ที่เพิ่งเลือกวิธีจ่าย (ยังไม่ได้ที่อยู่) → `incompleteWithIntent` ยิง ⚠️
เข้ากลุ่มแอดมินทันที = **แจ้งเร็วไป** แอดมินโดนกวนตั้งแต่ลูกค้ายังไม่ให้ข้อมูล

**เคาะใหม่ — admin รู้แค่ 2 จังหวะ:**
- **COD:** ยังไม่จ่าย → บอทเก็บ ชื่อ/ที่อยู่/เบอร์ เองพอ ไม่กวนแอดมิน → **ครบ = 📦**
- **โอน:** แอดมินรู้ตอน **สลิป** อยู่แล้ว (push 💰 ใน `handleImageIntent` แยกต่างหาก) → **ครบ = 📦 อีกรอบ**
- **ระหว่างทางไม่มี ⚠️ อีกต่อไป** — ลบ `incompleteWithIntent` + `buildIncompleteOrderAdminText` ออก

**ทำไมไม่ขัดหลัก "ห้ามเงียบ":** ไม่ครบ = **บอทขอลูกค้าเอง** (นั่นคือ action) ไม่ใช่เงียบ ·
ลูกค้าที่หายไปเงียบ ๆ = งานของ Follow engine (แท็ก รอที่อยู่/รอโอน ยัง reconcile อยู่) ไม่ใช่ push แอดมิน

**แก้ควบ:** addressComplete ยอมรับที่อยู่ก้อนไม่ว่าง (ที่ log เจอ "9/9 ต.อ่า อ.เอือง จ.สุโขทัย
18000 → รอที่อยู่" เพราะที่อยู่หายจาก orderData ตอน MAX_TOKENS ไม่ใช่ addressComplete ผิด) ·
เช็คครบ 3 อย่างแยกกัน (missing) บอทขอเฉพาะที่ขาดจนครบ ห้ามหยุดหลังได้อันเดียว ·
reply guardrail (สั้น ห้ามลอก Step/FAQ ทั้งก้อน) กัน output runaway → MAX_TOKENS

**หมายเหตุ MAX_TOKENS:** guardrail ช่วยลดโอกาส แต่ถ้า prompt 9357 tokens ยังทำ output บวม
ต้องลด prompt (ยัด Step/FAQ เฉพาะที่เกี่ยว) — ยกไปทำพร้อม Step 1 (header-driven parse)

### D-12 · Step 1 — Sheet loader ตัวเดียว + header-driven + selective injection

**Part A/B/3/4 (แก้ราก MAX_TOKENS + สลับคอลัมน์ไม่พัง + โตผ่านชีต):**

- **A: lib/sheets/** — loadBotLibrary() batchGet 8 แท็บ 1 call จาก SHEET_BOTLIB_ID + cache 60 วิ (TTL เดียว) ·
  resolveColumns หาคอลัมน์จากชื่อ header ไม่ใช่ index · all-or-nothing (ขาด header → null + log)
- **B: Orders header-driven** — append/list/mark หาจากชื่อ · cache header 60 วิ + invalidate เมื่อ field ไม่ครบ
- **3: Config/route/cron ผ่าน loader** — เลิก CSV URL · resolveFeatureSwitches: salesCore เช็ค SHEET_BOTLIB_ID
  (คอมมิตเดียวกับ getConfig — แยก = deploy กลางคัน salesCore=false บอทตาย) · ลบ lib/sheets.ts เดิม
- **4: selective injection (lib/agent/inject.ts)** — แก้ราก prompt 9357 tokens
  - Step: สารบัญทุกประตูเสมอ (เห็นทางเข้าทุกประตู) + เนื้อเต็มเฉพาะ ปัจจุบัน/ปลายทาง/entry-match/handoff
  - ปลายทาง parse "ไปประตูถัดไปเมื่อ": regex + exact ก่อน + prefix (S3→S3_TRANSFER+S3_COD) + หลายปลายทาง(·)
  - กำกวม (stage หา exact ไม่เจอ) = ยัด funnel ต้น ๆ (ยัดมากขึ้น ไม่ใช่โง่) · parse พลาด = funnel ถัดไป
  - handoff (funnel_stage=handoff) = lean (เข้าเมื่อ+ห้ามทำ+ตัวอย่าง) ตัดสมองการขาย · dynamic ไม่ hardcode H1-H4
  - FAQ: สารบัญทุกข้อ + เต็ม 3 ข้อ keyword match · action=handoff ไม่ยัดคำตอบ (กัน parrot)
  - header ไม่ครบ → fallback tabToText ทั้งก้อน (ยอม token เยอะ ดีกว่าตาบอด)

**เลื่อนไป Step 6:** validate stage ที่ AI ตอบ กับ enum (ตอนนี้ harness stage เป็น v1.2 · validate = churn ทับ Step 6)

**🔴 ยังไม่ปิดเคส MAX_TOKENS:** harness = scripted Gemini + char-proxy พิสูจน์แค่ "ลด prompt size ตามเป้า"
**รอยืนยัน finishReason จริงหลัง deploy** (หรือ HARNESS_REAL_GEMINI=1 + countTokens) — ห้ามเขียนว่า "หายแล้ว"

**ความฉลาดมาก่อน token:** ถ้า handoff เต็ม + กำกวมดัน >5000 → ยอม (log เตือน) ไม่ตัด brain ของประตูปัจจุบัน

### D-13 · gate require order line (สินค้า/จำนวน/ยอด) + push "ออเดอร์พัง"

**บั๊ก:** AI extract แค่ ชื่อ/ที่อยู่/เบอร์ (ไม่มี สินค้า/จำนวน/ยอด) · gate เช็คแค่ name/addr/phone
→ complete:true ทั้งที่ order line ว่าง → ชีตขึ้น "น้ำพริกปลาทู" เปล่า ไม่มี x/ยอด (finishReason STOP ไม่ใช่ MAX_TOKENS)

**แก้:** `evaluateOrderGate` base = shipping(ชื่อ+ที่อยู่+เบอร์) + product(สินค้า+จำนวน+ยอด) ·
missing แยกทีละช่อง · `brokenOrder` = จัดส่งครบ+เลือกจ่ายแล้ว แต่ order line ขาด → push ⚠️ แจ้งแอดมิน

**🔴 ต่างจาก D-11:** D-11 ตัด push ตอน "ที่อยู่ยังไม่มา" (เร็วไป) · D-13 push เฉพาะ "จัดส่งครบแล้วแต่ order line พัง"
(AI extract ตกหล่น) — คนละจังหวะ ไม่ทับกัน · reuse flag `paid_no_address_notified` กัน spam (ไม่เพิ่ม column)
> ⚠️ ท้าย D-13 เคยเสริม systemInstruction แก้ bug A (+110 tokens) — **ไม่ได้ผล** (ดู D-14) · gate (bug B) ยังถูก

### D-14 · bug A หาราก — **ไม่ใช่ schema/โค้ด · เป็นพฤติกรรม AI** (ห้ามเติม prompt ซ้ำ)

ตรวจ 4 จุดตามที่เจ้าของสั่ง — ถูกทั้งหมด: (1) responseSchema.order_data มีครบ 6 field ·
(2) `aiSentFields` = `Object.keys(orderData)` จริง ไม่ hardcode · (3) type `Record<string,string>` + parse ไม่ drop ·
(4) JSON example ครบ 6 · เพิ่มเทส `gemini-guard` พิสูจน์ 6 ช่อง parse ไม่ตก (commit 6ac4da9)
**สรุป:** AI มีค่า (ใส่ "440" ใน reply ได้) แต่เลือกไม่ใส่ order_data · เสริม prompt แล้วไม่ขยับ ⇒
**ห้ามเติม prompt** · ราก "ชัด" ต้อง log เทิร์นสั่งซื้อ (aiSentFields เทิร์น "เอา 5 ถ้วย" + catalog เข้า prompt จริงมั้ย) — ดู DIAG-LOG.md G2

### D-15 · 🔴 CONTRACT CHANGE — เอางานคำนวณเงินออกจาก AI (บังคับ C6 ด้วยโครงสร้าง) · **อนุมัติโดยเจ้าของ**

**บริบท:** แก้ prompt bug A แล้วล้มเหลว 3 รอบ (D-13 +110 tokens · 980c8a4 แยกนิยาม) · prod log ชี้ขาด:
`orderData-shape {"เบอร์":{"len":1,"digits":true}}` = AI เอา "5" จาก "5 ถ้วย" ยัดช่องเบอร์ · reply คำนวณเงินถูกทุกครั้งแต่กรอกฟอร์มผิดช่อง ⇒ **ปัญหาคือ AI ถือตัวเลขเงิน** ไม่ใช่ prompt ⇒ ย้ายงานคิดเงินไป Core (แก้ KI-02 เต็มรูป)

**เจ้าของอนุมัติเปลี่ยน contract (ห้ามเปลี่ยนกลับเอง):**
1. **order_data ใหม่:** `{ ชื่อ, ที่อยู่, เบอร์, items:[{sku, qty}] }` — **ตัดถาวร** สินค้า(ข้อความ)/จำนวน/ยอด
   - sku ต้องอยู่ใน CSV_Products + สถานะ=live · แมปไม่ได้ → items:[] + ถามลูกค้า ห้ามเดา · qty=ตัวเลขล้วน
   - แก้ responseSchema + description ทุก property + type + JSON example ให้ตรงกันหมด
2. **`lib/core/pricing.ts`** (pure · รับ rows เข้า ห้าม import LINE/Gemini/Sheets):
   `calculatePrice({items, paymentMethod}, promoRows, productRows, config) → {lines, subtotal, shippingFee, total, error, needsHandoff}`
   - โปรต่อ sku: ฐาน=โปร live+ในช่วงวันที่ "จำนวน" มากสุดแต่≤qty · ต่อหน่วย=ราคาโปร÷จำนวน · lineTotal=ราคาโปรฐาน+(qty−จำนวนฐาน)×ต่อหน่วย · `Math.ceil` ที่ระดับ line · ไม่มีโปร→ราคาปกติ×qty
   - ค่าส่ง: subtotal≥`ยอดขั้นต่ำส่งฟรี_บาท`→0 · ไม่ถึง→`ค่าส่ง_มาตรฐาน` · COD→+`ค่าส่ง_COD_เพิ่ม`
   - เพดาน qty รวมทั้งบิล = `floor(max(จำนวน ใน CSV_Promo live) × เพดานฯ)` เกิน→needsHandoff · ไม่มีโปร live เลย→needsHandoff ทุกออเดอร์ + log (ห้าม fallback เลขคงที่)
   - error≠null (sku ไม่รู้จัก/ไม่ live/qty≤0/โปรอ่านไม่ได้) → ห้ามเขียนชีต ห้ามพูดยอด → push แอดมิน
   - **ราคา/โปร/ค่าส่ง/เพดาน อ่านจากชีตทั้งหมด ห้าม hardcode**
3. **บอทพูดยอด:** Core ส่งบล็อก `<ยอดที่คำนวณแล้ว>` กลับเข้า prompt · บอทพูดได้เฉพาะตัวเลขในบล็อก ห้ามคิดเอง · ลบกฎ extract จำนวน/ยอด ที่ไม่ใช้แล้ว (token ลด=ผลพลอยได้)
4. **สรุปก่อนปิดต้องทวน 7 อย่าง:** ชื่อสินค้า·จำนวน·ยอด·วิธีจ่าย·ชื่อ·ที่อยู่·เบอร์
5. **ชีต 24 คอลัมน์ A–X เดิม:** I=lines→"น้ำพริกปลาทู x4" (หลายรายการคั่น " | ") · J=total · S=`JSON.stringify(items)` · T=shippingFee
   - 🟡 **G (จังหวัด) / H (รหัสไปรษณีย์) = เขียนค่าว่าง `""` เสมอ** (คอลัมน์ยังอยู่ในชีต · `appendOrderRow` ยัง map แต่ route ไม่ส่ง province/postalCode แล้ว) — **เป็นการตัดสินใจ ไม่ใช่บั๊ก**: ที่อยู่เก็บเป็นก้อนเดียวใน F ตามที่ตกลง (ระบบขนส่ง/แอดมินแยกจังหวัด/รหัสจากก้อนเอง) · ถ้าอนาคตต้องการ G/H = งานแยก (สูตรชีตดึงจาก F หรือ resolver)
6. **Gate:** COD ครบ = ชื่อ+เบอร์+ที่อยู่+items ไม่ว่าง+pricing error=null · ขาด→brokenOrder+push (พฤติกรรมเดิม)
7. **ส่วนลด:** ยังไม่ทำ · ขอลด→handoff H2 เสมอ บอทห้ามตอบราคาใหม่ · **อนาคต:** `price_override`+`override_by`+`override_reason` ที่ระดับออเดอร์ (ไม่ใช่คำพูดในแชท)

**ตัวเลขยืนยัน (NPT-10G):** 1=125·2=220·3=275·4=367·5=440·6=528·9=792·10=850·11=935 · เพดานปัจจุบัน 10×2=20 (เทส 20 ผ่าน·21→handoff)

**🔴 pre-step ค้าง (BLOCKED):** creds ใน `.env.test` = `dummy` (harness mock googleapis) → **อ่านหัวตารางจริงไม่ได้ในเครื่อง** · รอเจ้าของ paste header CSV_Products/CSV_Promo/CSV_Config ก่อนเขียนโค้ด (ห้ามเดาคอลัมน์)
**⚠️ ชื่อ config key ในบรีฟไม่ตรงกัน 2 ที่:** กฎ (j) เขียน `เพดานจำนวน_คูณโปรใหญ่สุด` · pre-step เขียน `เพดานจำนวนต่อออเดอร์_handoff` — ต้องยืนยันชื่อจริงจากชีต

---

## งานค้าง / Roadmap (ยังไม่ทำ — บันทึกกันลืม)

### นิยาม "จบเฟส 0 = เปิดขายได้จริง"
order flow ครบวง (รับออเดอร์→สลิป→gate→ชีต→push) **และ** ยอด/จำนวนถูก (bug A หาย) **และ**
claims ไม่ผิดกฎหมาย (พ.ร.บ.อาหาร) **และ** บอทไม่มั่วเรื่องสุขภาพ/ราคา · ครบ 4 ข้อนี้ = เปิดขายได้
> ตอนนี้ค้างที่ bug A (ยอด/จำนวน) + claims blocklist ยังไม่ทำ ⇒ **ยังไม่จบเฟส 0**

### รอบ 2a · ลด systemInstruction (แยกจากงานแก้บั๊ก · ห้ามทำปนกัน)
systemInstruction 15,309 chars ≈ 5,507 tokens (SYSTEM-PROMPT-BREAKDOWN.md) → เป้า ~2,500 ·
ตัดจุดซ้ำซ้อน (order_data ย้ำหลายรอบ · "ห้ามเดาราคา" 3 ที่ · image ซ้ำ) โดยไม่แตะ 🔴 ห้ามตัด ·
+ ย้าย 2 กฎสากล (extract order_data · ห้ามคิดราคา) ให้เป็น agent rule คงที่ ไม่ผูกกับ selective injection

### รอบ 2b · claims blocklist + ตั้งชื่อ "กฎ 10"
- claims blocklist (พ.ร.บ.อาหาร) — คำต้องห้ามโฆษณา (บำรุง/รักษา/ลด/หาย…) · ตอนนี้มีแค่ "ห้ามแต่งสรรพคุณ" กว้างๆ
- ตั้งชื่อ **กฎ 10 (ไม่มีข้อมูล = บอกตรงๆ + handoff)** ให้เป็นกฎในลิสต์ (ตอนนี้เป็นแค่เจตนากระจาย)
- (ดึงมาจาก Step 4/5 บางส่วน)

### ลำดับ Step หลังเปิดขาย
Step 2/3/5/6/7/8 = **หลังเปิดขายได้** (เฟส 0 จบก่อน) · KI-01 (`คำ_handoff` substring "PR") ยังรอ Step 4

### D-16 (ยังไม่ทำ) · resolver ตัวแปรชีตเต็มรูป
D-15 code เป็นเจ้าของแค่ 3 ตัวแปรเงิน ({สรุปรายการ}/{ยอดรวม}/{การชำระเงิน}) · ตัวแปรอื่นในชีต
({ชื่อสินค้า}/{เลข อย.}/{รูปสินค้า}/{ส่วนประกอบตามฉลาก}/{เลขพร้อมเพย์}/{ชื่อบัญชี}/{โปรโมชั่นทั้งหมด}/{นโยบายค่าส่ง}…)
ยังให้ AI เติมชั่วคราว (system.ts:105) · commit ถัดไป = resolver lookup จาก Products/Config/Promo แล้วเลิกให้ AI เติม (KI-06)

### D-17 · ท่าขายอยู่ในชีต · แยก "บอทเสนอ" จาก "ลูกค้ายืนยัน" (upsell/downsell)
- **หลักการถาวร:** ธรรมชาติการขาย (เมื่อไหร่แจกแจง/เสนอเพิ่ม · ประตูไหนเสนอได้ · ถ้อยคำ) อยู่ใน **CSV_Step** (เจ้าของแก้เองได้ไม่เรียก dev) · โค้ดให้แค่ **ตัวเลข + ตัวแปร** ({วิธีคิดยอด}/{ทางเลือกถัดไป} resolve แบบเดียวกับ {ยอดรวม}) · systemInstruction ใส่ได้แค่กฎสากล "ยอดมาจากตัวแปรระบบ ห้ามคิดเลข" · **ห้ามเขียนกฎท่าขายลง systemInstruction**
  - เจ้าของจะเพิ่มแถว S2_ODDQTY (จำนวนไม่ตรงโปร) ในชีตเอง · ความขัดแย้งกับ S2_DIRECT ("ห้าม upsell") เจ้าของจัดการในชีต โค้ดไม่รู้
- **`items_source` แยก bot_proposal จาก customer (§4):** บอทเสนอเอง → เก็บ `proposed_order` (คอลัมน์ Neon ใหม่) ห้าม merge/ห้าม pass2 · ลูกค้าสั่ง/ยืนยัน (customer) เท่านั้นที่ merge ลง pending · **downsell กลับยอดเดิมได้เองโดยไม่ต้องมี logic แยก** (pending ไม่เคยถูกแตะจากข้อเสนอ) · กฎเดิมยังอยู่: items ว่าง ≠ ยกเลิก
- **guard 2 (D-15) แก้ราก:** whitelist = regex ดึงตัวเลขจาก "บล็อกที่ inject ให้ pass 2" จริง (ทุกเลขจาก calculatePrice ตัวเดียว) ไม่ใช่ลิสต์ field เลือกมือ — เพราะเราสั่ง pass2 ให้ "แจกแจง" ตัวเลขในบล็อกเอง
- **🔴 จังหวะ upsell อนาคต** ต้องวางก่อนเขียนแถวลงชีต (ได้ที่อยู่ → เสนอ → ลูกค้าเลือก → เขียนแถว) เพราะแก้แถวที่เขียนแล้วต้องมี `order_id` (Step 2 ยังไม่ทำ)

### D-18 · 🔴 ถอย 2-pass → 1-pass · เส้นแบ่ง "AI คุย / โค้ดคุมเงิน" (north star)
**เส้นแบ่งถาวร:**
- **AI เป็นเจ้าของการคุยทั้งหมด** · เจ้าของเทรนผ่านชีต · **โค้ดห้ามบล็อก/แก้/แทรกสิ่งที่บอทพูด**
- **โค้ดเป็นเจ้าของ:** ยอดที่เขียนชีต + ยอดที่แจ้งแอดมิน + gate ครบ/ไม่ครบ (มาจาก `calculatePrice` เสมอ ไม่อ่านจาก reply)
- **กฎธุรกิจทุกข้ออยู่ในชีต** ห้าม hardcode ในโค้ด/prompt (เจ้าของแก้นโยบายเองได้ ไม่เรียก dev)
- ไม่มีข้อมูล/กฎในชีต = ไม่เดา → handoff (กฎ 10)

**ถอน 2-pass (commit 1):** ลบ needs_price_quote / items_source / proposed_order (schema+type+prompt+Neon) · ลบบอลลูน "ขอคิดยอด" · กลับ **1 Gemini call/เทิร์น** · AI พูดยอดเองได้ (จากตาราง/ตัวแปรที่ resolve)
- **guard 2 เปลี่ยนหน้าที่:** ไม่บล็อกคำตอบ — ส่งข้อความปกติเสมอ · ถ้าเลข "X บาท" ที่บอทพูด ∉ เลขที่ Core รู้จัก (catalog+ยอด) ทั้งที่ข้อมูลครบ → **ไม่ปิดออเดอร์ + push แอดมิน "บอทแจ้ง X · ระบบคำนวณ Y ขอยืนยัน"** (`extractBahtNumbers` เจาะเฉพาะเลขก่อน "บาท" กัน false-positive รหัสไปรษณีย์)
- **guard 5:** ตัวแปรราคาเหลือ {...} → log warn อย่างเดียว ไม่บล็อก (ยังไม่มี items = AI เติมเอง)
- `resolveRuntimeVars` (เติม template เจ้าของด้วยเลข Core) = เก็บไว้ · error-handling (image fallback/DEFAULT_REPLY/resume) = ไม่เกี่ยวราคา เก็บไว้

### D-19 · region routing (ลด prompt + แก้ข้าม S3 + แก้ MAX_TOKENS)
**ราก:** buildStepInjection เดิมใช้ AI stage · เทิร์น lead (stage="") = กำกวม → ยัด**ทุกประตู** early-funnel (ไม่มีเพดาน) + entry-match คำกว้าง → step 3,937 tokens → prompt 12,005 ชนเพดาน MAX_TOKENS → บอทตอบ "ขัดข้อง" แม้แค่ถามราคา
**แก้ (region routing · โค้ดตัดสิน funnel จาก pending ไม่พึ่ง AI stage):**
- `quoted = pending (ก่อน merge) มี items` = "สรุปยอดแล้ว" · quoted=false → region {lead,qualified,quoted} (S3 สรุปยอดเข้าถึงได้ **ไม่ข้าม**) · quoted=true → {awaiting_payment,awaiting_address,won} (S4)
- เต็ม **cap 4** · priority: match วิธีจ่ายเป๊ะ > ปลายทาง(nextWhen) > entry-match(≤2) > proximity · filter วิธีจ่ายอีกฝั่งออก (เว้นพูดถึง=เปลี่ยนใจ)
- ประตูข้าม (crossover: ไม่มีใครชี้มาใน nextWhen + ไม่ใช่ lead) + handoff = เต็มเฉพาะ entry-match · ไม่นับ cap · funnel_stage ว่าง → log เตือน
- fullSalesBlock ตัด "ทำไมสำคัญ" · ตัวอย่างชุดแรก · catalog ตัดคอลัมน์ไม่ใช้ตอนขาย · systemInstruction 5,844→~3,278 (รวมกฎซ้ำ · ตัวอย่างเดียว/กฎ · คง 🔴 extract items/C6/handoff/ทวนที่อยู่/ปิดท้ายข้อความ)
- 🔴 north star: ท่าขาย/ประตู อยู่ในชีต · โค้ดไม่ hardcode step_id · เจ้าของเพิ่มประตู/crossover ในชีตทำงานเอง

### D-20 · ลดภาระ AI ให้เหลือน้อยสุด (แก้ items หาย + thinking วน + placeholder มั่ว)
**ราก (จาก raw log):** เทิร์นเลือกจำนวน AI ต้องทำ 3 อย่างพร้อมกัน — หาแถวโปรพูดราคา + แมป qty→sku code + ใต้ "ห้ามคิดเลข" → thinking วน (candidates 4,079 ชนเพดาน) · items = optional ใน schema (ไม่มี nested required) → AI ข้าม · AI เติม placeholder ชื่อ/ที่อยู่/เบอร์ มั่ว (พฤติกรรม กรอกฟอร์ม)
**แก้ (หลักการ: AI แค่ "ฟังแล้วบอกว่าได้อะไร" · ที่เหลือโค้ดทำ):**
- **AI ส่งแค่ `items:[{qty}]`** (ตัด sku) · `resolveAiItems` ใส่ sku จากสินค้า live: **live ตัวเดียว→ใส่ให้ (อ่านชีต ไม่ hardcode)** · หลายตัว→log เตือน+[] (ไม่เดา · เผื่อสินค้าที่ 2) · รองรับหลายรายการ
- **AI ไม่คิด/ไม่ส่งยอด** — reframe prompt: บอกราคาจากตารางได้ตามธรรมชาติ ระบบคิดยอดบันทึกเอง ไม่ต้องเป๊ะ → ตัดความขัดแย้ง "ห้ามคิด vs ต้องแมป/คิด"
- **ช่องที่ลูกค้าไม่ให้ = เว้นว่าง ห้าม placeholder** (parse drop empty อยู่แล้ว · prompt ย้ำ) · schema คง optional
- pricing.ts กฎคำนวณ **ไม่แตะ** (ยังรับ {sku,qty})
- **harness:** `real-gemini.test.ts` (HARNESS_REAL_GEMINI=1 · จับ "AI ส่ง items จริง" ที่ scripted mock จับไม่ได้) · resolveAiItems (live เดียว/หลาย) · empty→drop · COD ครบวง (qty-only → ชีต 275)
> ⚠️ ยังไม่ยืนยัน thinking วนหายจริง — ต้องเทียบ candidatesTokenCount เทิร์น "3 ถ้วย" ก่อน/หลังใน production (ห้ามปิดเคสจนกว่าจะเห็น)

### D-21 · หลักการใหม่: ความถูกต้อง > token เสมอ · กู้ items (regression COMMIT 2)
**หลักการถาวร (เจ้าของยืนยัน):** ความถูกต้องของบอท > token ไม่มีข้อยกเว้น · prompt 7k-12k Gemini รับได้ · ที่พังคือ output ชนเพดานเพราะ AI คิดวน (candidates 4,079→213) ไม่ใช่ prompt โต · **ยกเลิกเป้า prompt<6000 · ยกเลิก assert token · ห้ามตัด prompt เพื่อประหยัด token อีก** · "จบสถาปัตย์" = แก้ Google Sheet อย่างเดียว (ทุก step รายงาน "เปลี่ยนได้เองผ่านชีต vs ยังต้อง dev")
**regression (จาก log):** COMMIT 2 (D-19) ย่อ order_data block → ตัดการเน้นย้ำ "4 ส่วนสำคัญเท่ากัน · ทุกเทิร์นใส่ทันที ไม่รอครบ/ปิดจบ/ยืนยัน" + sub-bullet → **AI เลิกใส่ items** (โมเดลต้านการใส่ array ต้องเน้นหนักถึงทำ · ย่อ=เลิก) · itemCount:0 ตั้งแต่ 11:25
**smoking gun placeholder:** ตัวอย่างในบล็อกมีเบอร์จริง "0912345678" (10 หลัก) → **AI คัดลอกทั้ง ชื่อ/ที่อยู่/เบอร์ จากตัวอย่าง** ใส่แม้ลูกค้ายังไม่ให้
**แก้:** กู้โครง order_data เน้นหนัก (แบบ COMMIT 1) + คง D-20 (items:[{qty}]) · คืน วิธีใช้ข้อมูล ราคาเวอร์ชันเต็ม · **แก้ด้วย property โมเดล (เลียนแบบตัวอย่าง) ไม่ใช่กฎ**: 2 ตัวอย่างสอนพฤติกรรม — A) พูดแค่จำนวน → order_data มีแค่ items · B) ให้ครบ → มีครบ (ค่าปลอมชัด "ก"/"0000000000" · เจอใน order_data จริง = จับได้ว่าลอก) + บรรทัดกำกับ "ห้ามคัดลอกค่า" · ยอมให้ system โต (3,278→3,711)
**harness:** real-gemini.test.ts assert เทิร์นแรก (ลูกค้ายังไม่ให้) → order_data ไม่มี ชื่อ/ที่อยู่/เบอร์ + ไม่มีค่าปลอม (จับการลอก) · scripted mock จับไม่ได้
> ⚠️ ถ้ากู้ prompt แล้ว real-gemini/prod ยังพัง = ไปดู region routing/step (COMMIT 2 เปลี่ยน · gate เสริม "เก็บ order" อาจหลุด cap 4) ไม่ปิดเคส

### Phase C · ลบ ENV ค้างใน Vercel
`SHEET_STEP_URL` `SHEET_FAQ_URL` `SHEET_CONFIG_URL` `SHEET_FOLLOW_URL` — โค้ดไม่อ่านแล้ว ลบทิ้งได้
