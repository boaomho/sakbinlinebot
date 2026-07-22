# SAKBIN — DECISIONS & KNOWN ISSUES

> บันทึกการตัดสินใจ + บั๊กที่รู้แล้วแต่ยังไม่แก้ (พร้อมเหตุผลว่าทำไมถึงยังไม่แก้)
> คู่กับ `STATUS.md` · `REPO-MAP.md` · `CLAUDE.md` (บรีฟ/contracts v1.5 เดิม ดูดเข้า 3 ไฟล์นี้แล้ว · ต้นฉบับอยู่ git history) · Follow feature → `FOLLOW-SPEC.md` `[UNBUILT]`

---

## Known Issues

### KI-01 · ✅ แก้แล้ว (Step 4 · D-26) — word-boundary match keyword ASCII · แก้ตอน Step 4 (รื้อ `คำ_handoff`)

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

### KI-02 · ✅ แก้แล้ว (Step 5 · D-27) — price guard ฝั่งโค้ด (โหมด เตือน/บล็อก)

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

**✅ ผลจริง (เจ้าของเทส · P0 ปิด):** เทิร์นแรก keys:["items"] rawItems:[{qty:3}] resolvedItems:["NPT-10Gx3"] · candidates **205 (จาก 4,079)** = thinking-loop หาย · ไม่ลอกตัวอย่าง · เทิร์นสุดท้าย complete:true missing:[] brokenOrder:false push 📦 ครบ · ชีต I/J/T ยืนยัน · DIAG_PROMPT_TOKENS ลบจาก Vercel แล้ว
> **บทเรียนถาวร (โมเดล):** โมเดลเชื่อ **ตัวอย่างมากกว่ากฎ** — ตัวอย่างใน prompt ต้องแสดง *พฤติกรรมที่ถูก* (รวมเคส "เว้นว่างเมื่อยังไม่รู้") ไม่ใช่แค่แสดงรูปแบบเต็ม · ค่าในตัวอย่างต้องเป็น **ค่าปลอมที่จับได้ถ้าถูกลอก** · แก้พฤติกรรมโมเดล = ใช้ตัวอย่าง ไม่ใช่เพิ่มกฎห้าม

### D-22 · Step 3 (จบ pricing): ยกวิธีคิด "เศษเกินชั้นโปร" ออกจาก hardcode → คุมด้วยชีต
**สโคป:** ก่อนแก้ pricing อ่านตัวเลขจากชีตครบแล้ว (4 คีย์ + Products/Promo) · เทสชี้ขาด 4 ถ้วย→367 ผ่านตั้งแต่ก่อนแตะโค้ด · เหลือพฤติกรรม hardcode = "วิธีคิดเศษที่เกินชั้นโปรฐาน" (เดิม interpolate `promoPrice/qty` ตายตัว)
**ทำ:** เพิ่ม CSV_Config `จำนวนที่ไม่มีโปร_คิดยังไง` · เจ้าของเคาะ **2 วิธี**:
- `เทียบโปรฐาน` (default · ว่าง/ไม่มี key ก็ได้อันนี้) → เศษ × ราคาต่อหน่วยโปรฐาน → 4 ถ้วย=**367**
- `ราคาปกติ` → เศษ × ราคาปกติต่อหน่วย → 4 ถ้วย=**370**
- ค่าอื่นที่พิมพ์มา(ไม่ว่าง) = misconfiguration → **error+handoff** (ห้ามเดาเงียบแบบ D-15)
**ทำไม default = พฤติกรรมเดิม ไม่ใช่ handoff แบบ 4 คีย์ตัวเลข:** คีย์ตัวเลข (ราคา/ค่าส่ง) ไม่มี "ค่าเริ่มต้นปลอดภัย" (เลขใดก็เป็นการมั่ว=hardcode) · แต่ "วิธี" มี default ปลอดภัย = พฤติกรรมเดิมที่พิสูจน์แล้ว → เลือก default ได้โดยไม่ hardcode ตัวเลข + กัน deploy แล้วบอทตายถ้าชีตยังไม่เพิ่มคีย์
**pure/ไม่แตะ AI:** โค้ดล้วน (AI ไม่คิดเงินอยู่แล้ว) · ไม่แตะ prompt/schema · resolver.test +5 (367/370/พิมพ์ผิด→handoff/ตรงชั้น=เท่ากัน) · 157 passed · tsc+build เขียว
**เปลี่ยนได้เองผ่านชีต vs ยังต้อง dev (หลัง Step 3):**
| เปลี่ยนผ่านชีต | ยังต้องแก้โค้ด (flag ไว้) |
|---|---|
| ราคาปกติ/โปร/ช่วงวัน/สถานะ (Products/Promo) | ค่า enum `live`/`COD` (สัญญา schema) |
| ยอดส่งฟรี · ค่าส่ง · COD เพิ่ม · เพดาน | ปัดเศษ `Math.ceil` |
| **วิธีคิดเศษเกินโปร (ใหม่)** | ถ้อยคำ {วิธีคิดยอด}/{ทางเลือกถัดไป}/{การชำระเงิน} (D-15 ให้อยู่โค้ด) |
| | upsell เฉพาะ sku เดียว |
> pricing "จบ" ในแง่ตัวเลข/นโยบายคิดเงิน · ที่เหลือ = ถ้อยคำ (D-15 ตัดสินให้อยู่โค้ด · ยกเป็น step แยกถ้าเจ้าของสั่ง) + enum/ปัดเศษ (ความเสี่ยงต่ำ เจ้าของไม่แตะ)

### D-23 · ปิด 2 ช่องโหว่ตอน price ล้ม (เจอระหว่างเทส Step 3 · ก่อนไป Step 4)
**ช่องโหว่ 1 — push แอดมินตอน priceHandoff ไม่ครบวงจร:** เดิม `priceStuck = items>0 && priceFailed` → แจ้งแอดมิน **เทิร์นแรก** (มีแค่ items ยังไม่มีชื่อ/ที่อยู่/เบอร์) แล้วเผา flag `paidNoAddressNotified` → ตอนข้อมูลครบจริง (priceOk:false) ไม่แจ้งซ้ำ = แอดมินไม่มีข้อมูลติดต่อลูกค้า ตามงานไม่ได้
- แก้: เพิ่ม `readyExceptPrice` ใน `evaluateOrderGate` (=complete โดยสมมติ priceOk=true · มี items+จัดส่ง/วิธีจ่าย/สลิปครบ) · route ใช้ `priceStuckReady = readyExceptPrice && priceFailed` แทน → แจ้ง**ตอนสรุปครบ**เท่านั้น + builder ใหม่ `buildPriceStuckAdminText` (ชื่อ/เบอร์/ที่อยู่/รายการ/วิธีจ่ายเต็ม เหมือน brokenOrder) · brokenOrder กับ priceStuckReady exclusive (itemsOk ต่างกัน)

**ช่องโหว่ 2 — บอทปิดจบ "บันทึกเรียบร้อย จัดส่งพรุ่งนี้" ทั้งที่ระบบไม่ได้บันทึก:** ราคาคำนวณไม่ได้ → ไม่เขียนชีต แต่ AI ยังพูดปิดการขาย = ลูกค้าเข้าใจผิดว่าสั่งสำเร็จ (เสียหายจริง)
- แก้ **ที่ state ไม่ใช่ guard** (โค้ดห้ามบล็อกคำพูด): `buildStateText(customer, priceStuck)` · เมื่อ pre-turn `preQuote!==null && !preQuote.ok` (มี items แต่ราคาล้ม) → เพิ่มบรรทัด `<สถานะลูกค้า>`: "⚠️ ยังบันทึกไม่ได้ — ระบบคำนวณยอดไม่สำเร็จ รอแอดมินตรวจยอด · ยังไม่ถือว่าสั่งซื้อสำเร็จ อย่าเพิ่งยืนยัน/แจ้งวันส่ง" → AI อ่านความจริงแล้วไม่สัญญาเอง · **ท่ารับมือ (ถ้อยคำ) เทรนเพิ่มในชีต Step ได้**
- pure/pattern: gate ยัง pure · เพิ่ม field ไม่แตะ branch เดิม · order-core +6 (readyExceptPrice ครบเคส + builder) · 163 passed · tsc+build เขียว
> ⚠️ state line เป็น "ความจริง" (ไม่ใช่กฎบล็อก) — ถ้าเจ้าของอยากปรับถ้อยคำท่ารับมือ ทำในชีต Step (โค้ดแค่ป้อน fact)

### D-24 · C6 เต็มรูป: ยัด "ตารางราคาสำเร็จรูป" ให้บอทหยิบเลข (เลิกให้บอทคำนวณ)
**อาการ (จากเทส 3 รอบ):** ระบบคิด 367/370 ถูก แต่บอทพูดผิดคนละแบบทุกรอบ (A: 370 ใช้ราคาเต็มแทนเรทโปร · B: 410 บวกค่าส่งทั้งที่ถึงเกณฑ์ส่งฟรี) · guard 2 จับได้ complete=false ไม่เขียนชีต (ทำงานถูก) แต่ออเดอร์ไม่ผ่านสักรอบ
**ราก:** catalog เดิมยัดแค่ชั้นโปร (1/3/5/10) · 4 ถ้วยไม่มีในตาราง → บอทต้องคิดเอง · โค้ดรู้คำตอบ (calculatePrice) แต่ไม่บอกบอท = C6 ("โค้ดคำนวณ ยัดสำเร็จรูป บอทแค่อ่าน") ยังไม่เต็ม
**หลักฐานตัดสินทางแก้:** รอบ C บอทอธิบายวิธีคิด**ถูกเป๊ะ** ("โปร 3 ถ้วย 275 + อีก 1 ถ้วย = ...") แต่หยิบเลขเศษผิด (95 แทน 91.67) → **LLM เข้าใจ logic แต่ปัดเศษ/ทศนิยมไม่แม่น** = ต้องให้**คำตอบ** ไม่ใช่สอนวิธี
**แก้ (catalog injection ยัด 2 ส่วน):**
1. **ตารางผลลัพธ์ทุกจำนวน** (`buildPriceTable` ใน pricing.ts) — enumerate qty 1..เพดาน เรียก `calculatePrice` **ตัวเดียวกับ gate** ทุกแถว → เลขที่บอทเห็น = เลขที่ระบบบันทึกเป๊ะ · เปลี่ยน config → ตารางเปลี่ยนตาม ไม่ deploy · **แทนตารางโปรดิบเดิม** (ไม่ยัด 2 ตารางซ้อน) · calculatePrice ล้ม → ไม่ยัดตาราง + สั่ง handoff (ตรงกับ priceStuck)
2. **วิธีคิด (จากชีต)** — `readConfigDescription(CSV_Config, "จำนวนที่ไม่มีโปร_คิดยังไง")` อ่านคอลัมน์คำอธิบาย (เจ้าของแก้ → บอทพูดตาม · graceful ถ้าว่าง)
3. **กฎ prompt** (system.ts §วิธีใช้ข้อมูล): "หยิบยอดจากตารางราคา ห้ามคำนวณ/บวก/ลบ/คูณ/ปัดเศษเอง · วิธีคิดใช้อธิบายลูกค้าเท่านั้น ห้ามคิดเลข"
**ข้อจำกัด (ต้องรู้ก่อนต่อยอด):** ตาราง enumerate ได้เพราะ **สินค้า live ตัวเดียว**
- P2 live (ต.ค.) → ยัดตารางต่อ sku (โค้ดทำ per live sku แล้ว) · ถ้าอยาก selective เฉพาะที่ลูกค้าพูดถึง ค่อยเสริม
- **ตะกร้าผสมหลาย sku → ต้องเปลี่ยนเป็น function calling** (AI เรียก tool `calculatePrice(items)` เอง) — ต่างจาก 2-pass ที่ถอยไป เพราะ **AI ตัดสินใจเรียกเอง** ไม่ใช่โค้ดบังคับ 2 รอบ · **ทำเมื่อมีสัญญาณจริง ไม่ทำเผื่อ**
**harness:** ตารางที่ยัดมาจาก calculatePrice จริง (ไม่ mock) · inject.test เปลี่ยน config→ตารางเปลี่ยน (367→370) · resolver.test invariant ทุกแถว = calculatePrice(qty) · 172 passed · tsc+build เขียว

### D-25 · งานเล็กก่อน Step 4: /reset ล้าง handoff + log · resolve ตัวแปรโอนเงิน + guard ร้ายแรง
**บั๊ก /reset ไม่ล้าง handoff:** เทส E (25 ถ้วย) → บอทถูก handoff → เทสถัดไปบอทเงียบสนิท ไม่มี log = เข้าใจผิดว่า Vercel ล่ม เสียเวลา debug
- แก้: `resetCustomerMemory` ล้าง `human_mode/human_mode_since/resume_notice_pending` ด้วย (เปลี่ยนจากเดิมที่ตั้งใจไม่แตะ — /reset เป็นคำสั่งเทสต์ ปิดตอนขายจริง จึงปลอดภัย) · เพิ่ม log `bot-silent-human-mode` (silentMinutes + วิธีคืนบอท) ตอน return เงียบ
**config เลขบัญชี (เจ้าของ rename ชีตแล้ว):** CSV_Config `เลขพร้อมเพย์`→`เลขที่บัญชี`=0132644225 · CSV_Step `{เลขพร้อมเพย์}`→`{เลขที่บัญชี}` (ค่าจริงเป็นเลขบัญชีกสิกร ไม่ใช่พร้อมเพย์)
- โค้ด **resolve เอง** (ไม่พึ่ง AI): `resolveTransferVars(text, config)` แทน `{เลขที่บัญชี}`/`{ชื่อบัญชี}`/`{ธนาคาร}` จาก config.raw + alias `{เลขพร้อมเพย์}`→ค่าเลขที่บัญชี (กันหน้าต่างเปลี่ยนผ่าน) · แทนเฉพาะค่าไม่ว่าง
- 🔴 **guard ร้ายแรง (ต่างจากราคาที่แค่ log warn):** `unresolvedTransferVars` เหลือค้าง (config ขาด/ว่าง) → **ห้ามส่งข้อความจริง** (ลูกค้าเห็น "โอนเข้า {เลขที่บัญชี}" = โอนไม่ได้ + เสียเครดิต) → ส่งข้อความพักสายปลอดภัยแทน + push แจ้งแอดมิน (`transfer-vars-unresolved`)
- config.ts ไม่ต้องแก้ — config.raw มีทุก key จากชีตอยู่แล้ว · resolver อ่าน raw ตรง ๆ
- resolver.test +5 (resolve/alias/ว่าง→บล็อก/ไม่มีตัวแปร) · 176 passed · tsc+build เขียว
> ยังไม่เทส (เจ้าของจะจูนข้อความ Step ทีหลัง) · ตัวแปรโอนเงินตอนนี้ resolve ฝั่งโค้ด — ต่างจาก {ชื่อสินค้า} ฯลฯ ที่ AI ยังเติมเอง

### D-26 · Step 4: handoff word-boundary (KI-01) + กฎ 10 + claims blocklist + apply-not-parrot
**4a · KI-01 แก้แล้ว:** `checkHandoffKeywords` — keyword ASCII ล้วน → word-boundary (`\b`) · คำไทย (ไม่มีช่องว่าง) → substring เดิม · `"PR"` เลิกชน promotion/express/price · ปลด landmine comment expect-fail บท 12 · handoff.test ใหม่
**4b · กฎ 10 ตั้งชื่อในลิสต์:** เพิ่มข้อ 10 ใน `<ขั้นตอนการตอบ>` (ไม่รู้/ไม่มีข้อมูล → บอกตรงๆ + handoff · **สุขภาพ/แพ้อาหาร/ผลต่อโรค = handoff เสมอ**) + เพิ่มใน `<เงื่อนไขส่งต่อแอดมิน>` · CLAUDE.md 9→10 ข้อ
**4c · claims blocklist (พ.ร.บ.อาหาร) — prompt + code guard (เจ้าของเลือก defense-in-depth):**
- prompt: guardrail ห้ามอ้างสรรพคุณเชิงยา + อ้างอิงลิสต์จาก config
- code: `findBannedClaims(text, banned, exceptions)` — **match วลี ไม่ใช่คำเดี่ยว** (กัน "รักษา" ชน "วิธีเก็บรักษา" แบบ KI-01) · **คำยกเว้นชนะ** (วลีต้องห้ามที่เป็นส่วนของวลียกเว้นในข้อความ → ไม่นับ)
- CSV_Config 3 คีย์: `คำต้องห้าม_โฆษณา` (วลี), `คำยกเว้น_โฆษณา`, `โหมดคำต้องห้าม`=`เตือน`(default·ส่ง+log+push)/`บล็อก`(ไม่ส่ง+พักสาย+push) — เจ้าของสลับโหมดในชีตเอง ไม่ deploy
- log จับได้: วลีที่ชน + ข้อความเต็ม (bot reply ไม่ใช่ PII ลูกค้า · เจ้าของตัดสิน false positive)
**4d · apply-not-parrot:** prompt <วิธีใช้ข้อมูล> — เรียบเรียง/ประยุกต์ข้อเท็จจริงได้ (เช่น "3 ถ้วยกี่กรัม"→30g) **แต่ตัวเลข/ข้อเท็จจริงห้ามเพี้ยน** · ตัวอย่างคำตอบ = แนวน้ำเสียง ไม่ใช่บทท่อง · ไม่มีข้อมูล = handoff (กฎ 10) · ใช้กับ Step/FAQ/objection/ตัวอย่าง
**เทส:** handoff.test (word-boundary) · resolver.test (findBannedClaims วลี+ยกเว้น) · claims-mode.test (เตือน→ส่ง · บล็อก→พักสาย · ยกเว้น→ไม่จับ · จาก config จริง) · 4c code guard บล็อกคำพูดได้เฉพาะโหมด "บล็อก" (ต่างจาก D-18 — ความเสี่ยงกฎหมาย เจ้าของอนุมัติ)
**เปลี่ยนผ่านชีต vs dev:** `คำ_handoff`/`คำต้องห้าม_โฆษณา`/`คำยกเว้น_โฆษณา`/`โหมดคำต้องห้าม`/FAQ rows/Step = ชีต · ตรรกะ word-boundary + กลไก guard + กฎเหล็ก = โค้ด

### D-27 · Step 5: Objections/Examples injection + objection_detected + KI-02 price guard + apply-not-parrot
**5a Objections:** `buildObjectionInjection(rows, userMessage, cap)` — keyword match คอลัมน์ "ลูกค้าพูดแบบไหนบ้าง" → ยัดเต็มแถว (ความกังวลจริง+หลักการตอบ+ห้ามทำ) สูงสุด `จำนวนข้อโต้แย้งที่ยัดเข้า prompt`(2) · สารบัญ id+ชื่อ ทุกแถวเสมอ · schema เพิ่ม `objection_detected` (STRING) → route log คู่ code-match (หา keyword ที่ยังไม่อยู่ในชีต) · prompt: **ประกอบคำตอบเอง ห้ามลอกคำ** · header ไม่ครบ/ว่าง → "" (เจ้าของยังไม่เติมชีต ไม่ crash)
**5b Examples:** `buildExampleInjection(rows, stepId, objectionIds, cap)` — match step_id/objection_id สูงสุด `จำนวนตัวอย่างที่ยัดเข้า prompt`(3) · prompt: **เลียนสไตล์ ห้ามลอกคำ · ตัวเลขยึดของจริง**
**5c:** กฎ prompt "ห้ามสรุปยอด/ปิดการขายก่อนลูกค้าตัดสินใจ" (ยังไม่เลือก/มีข้อโต้แย้ง → ตอบ+ขจัดกังวล+นำพา ก่อน)
**5d KI-02 price guard (โหมด เตือน/บล็อก · เจ้าของเลือก · เหมือน claims):**
- `buildAllowedPriceStrings(products, promo, config, payment, now)` — allowed ครอบ: (1) **เฉพาะคอลัมน์ราคา** ของ Products/Promo (ราคาปกติ/โปร/ประหยัด/ค่าส่ง/ยอดจ่าย) — 🔴 ไม่กวาดทั้งแถว (กัน "200 มล."/sku/อย./วันที่ ปลอมเป็น allowed) (2) ตารางคำนวณทุก qty (3) derived ต่อหน่วย floor/round/ceil (440÷5=88)
- `findBadPrices(text, allowed)` — เลข "X บาท" (extractBahtNumbers) ที่ไม่อยู่ใน allowed · route: `โหมดราคาผิด`=เตือน(default·ส่ง+log+push)/บล็อก(พักสาย+push) · log: เลขชน+ข้อความเต็ม+allowed sample
- guard 2 เดิม (order-scoped เทียบ Core) คงไว้ ไม่ทับ · **allowed กว้างไว้ก่อน** (หลุด=พิตช์ถูกโดนบล็อก แย่กว่าพูดผิดนานๆ)
**เทส:** inject.test (objection/example match+cap+empty) · resolver.test (allowed 285/275/88/35 in · 200/28 out · findBadPrices) · price-guard.test (เตือน→ส่ง · บล็อก→พักสาย+push · พิตช์ถูก 285/275→ไม่บล็อก · บท 12 injection) · claims/handoff เดิม · **204 passed | 4 expected fail** (บท 12 ย้ายไป price-guard.test เขียว · เหลือ บท 2/3/5/6 = real-Gemini/keyword sheet) · tsc+build เขียว
**KI-01+KI-02 ปิดครบ** · **เปลี่ยนผ่านชีต:** `จำนวนข้อโต้แย้ง/ตัวอย่างที่ยัดเข้า prompt` · `โหมดราคาผิด` · CSV_Objections/Examples rows · CSV_Config

### D-28 · cleanHeader strip emoji/สัญลักษณ์ (Step 5 ไม่เคยทำงาน — header ไม่ตรง) + ชื่อ header ตรงชีต
**อาการ:** เทส Step 5 ผ่าน (ไม่ regression) แต่ log เผย Objections/Examples ถูกปิดทั้งก้อน — header ไม่ตรง: `หลักการตอบ ⭐` (emoji), Examples ชีตใช้ `คำตอบที่ดี` แต่โค้ดคาด `ตัวอย่างคำตอบที่ดี` = พิสูจน์แค่ "ไม่ regression" ไม่ได้พิสูจน์ว่า injection ใช้ได้
**แก้ (ถาวร · ครั้งที่ 3 ที่ header matching พัง — วงเล็บ → substring PR → emoji):**
- `cleanHeader` ตัด emoji/สัญลักษณ์ (⭐🔴⚠️✅❌●▪ + variation selector + ZWJ) ก่อนเทียบ — ใช้ **blacklist ช่วง emoji** (1F000-1FAFF/2190-21FF/2300-27BF/2B00-2BFF/FE00-FE0F/200D) ไม่ใช่ whitelist · 🔴 whitelist รอบแรกตัด `+` ใน "สินค้า+จำนวน" (Orders) พังทั้ง orders/golden → เปลี่ยนเป็น blacklist กันตัดเครื่องหมายที่ header ใช้จริง (+/-/฿)
- ชื่อ header ตรงชีต v1.5: Examples `คำตอบที่ดี` (ไม่ใช่ ตัวอย่างคำตอบที่ดี) · Objections nameCol = `ชื่อข้อโต้แย้ง` (startsWith "ชื่อ")
- แก้ที่ `cleanHeader` ที่เดียว → ครอบทุกแท็บ (Step/FAQ/Objections/Examples/Products/Promo/Orders ผ่าน resolveColumns)
**harness กันซ้ำ:** cleanHeader.test (emoji/วงเล็บ/ช่องว่างซ้อน/ชื่อปกติไม่แตะ) · inject.test ใช้ header จริง (emoji ⭐ + วงเล็บ + คอลัมน์เกิน) → resolve ได้ · 208 passed · tsc+build เขียว
> เจ้าของจะเทสด้วย CSV_Objections/Examples จริง (กรอกแล้ว): objection match→ประกอบเอง · example→น้ำเสียงคล้ายไม่ลอก · log aiDetected vs codeMatched · baseline "3 ถ้วยกี่กรัม" ไม่ถอยหลัง

### D-29 · Step 2: order_id idempotency (source of truth = Neon ไม่ใช่ชีต)
**สถานะก่อนแก้:** ลำดับ (col A · เลขวิ่งโชว์กลุ่ม) = cron แจกตอนคอนเฟิร์ม `nextOrderNumber` **atomic แล้ว** (ไม่แตะ) · order_id (col Q) **ยังไม่ทำเลย** (ว่าง · ไม่มี generator/dup-check) · idempotency เดิมพึ่ง clearPendingOrderAndSlip หลังเขียน = **เปราะ** (append ok แต่ clear ล้ม → retry เขียนซ้ำ)
**ทำ:**
- `generateOrderId(prefix, now, suffix?)` (pure · core/orders.ts) → `SKB-YYYYMMDD(ไทย)-xxxxxx` · **prefix จากชีต** `รหัสนำหน้าออเดอร์` (default SKB) · โครงสร้าง key ไม่ใช่กฎธุรกิจ
- สร้าง+เก็บใน `PendingOrder.order_id` (Neon JSONB) **ตอน items แรกเข้า** (mergePendingOrder set ครั้งเดียว ไม่ทับ) → **เสถียรข้าม retry**
- เขียนลง col Q ตอน appendOrderRow
- 🔴 **dup-check ที่ Neon** (ไม่อ่านชีต — quota): ตาราง `orders_written(order_id PK)` · `isOrderWritten`/`markOrderWritten` · **แยก 2 สถานะ**: "มี order_id ใน pending" = แค่สร้าง (append อาจล้ม) ≠ "อยู่ใน orders_written" = เขียนสำเร็จ · เช็ค dup จากสถานะหลังเท่านั้น
- runOrderGate: isOrderWritten → skip (retry หลัง clear ล้ม) · append ok → markOrderWritten → clear → push · **append throw → ไม่ mark ไม่ clear → retry เขียนใหม่ (ออเดอร์ไม่หาย)**
> เหตุผลสถาปัตย์: Sheets = output layer (แอดมินอ่าน) · Postgres = source of truth ของ state ที่ตัดสินใจ (เจ้าของยืนยัน)
**harness (ครอบเคสที่บท 7 เดิมไม่ครอบ · failAppend toggle + orders_written จริง):** A) append ok+clear ล้ม→retry→ไม่ซ้ำ · B) append throw→retry→เขียนใหม่ · C) clear ok+ซ้ำ→ไม่ซ้ำ · generateOrderId unit (วันไทย/prefix/สุ่ม) · 214 passed · tsc+build เขียว
**เปลี่ยนผ่านชีต:** `รหัสนำหน้าออเดอร์` · `เลขออเดอร์_รีเซ็ตทุกวัน` (มีแล้ว) · format key + dup logic = โค้ด

### D-30 · Bug: บอทสัญญาว่าบันทึกแล้ว/แจ้งวันส่ง ทั้งที่ข้อมูลไม่ครบ (ขยาย D-23 ครอบ "ข้อมูลขาด")
**อาการ:** COD ลูกค้าให้ชื่อ+ที่อยู่ (ไม่ให้เบอร์) เทิร์นเดียว → บอทสรุปออเดอร์เต็ม + "จัดส่งพรุ่งนี้" ไม่ขอเบอร์ · gate ถูก (complete=false, missing=[เบอร์], ไม่เขียน) แต่บอทไม่รู้ความจริง เลยพูดเหมือนปิดสำเร็จ → ลูกค้าคิดว่าสั่งเสร็จ ออเดอร์หายเงียบ
**ราก:** D-23 เตือนเฉพาะ priceStuck (ราคาคำนวณไม่ได้) ไม่ครอบ "ข้อมูลขาด"
**แก้ที่ state ไม่ใช่ guard (โค้ดไม่บล็อกคำพูด · ป้อน fact):** `buildOrderStateWarning(pending, gate)` (pure) — เจตนาซื้อแล้ว (มี items + เลือกวิธีจ่าย) + ยังไม่ครบ + missing ไม่ว่าง → บรรทัด `<สถานะลูกค้า>`: "⚠️ ออเดอร์ยังไม่ถูกบันทึก · ยังขาด: X · อย่ายืนยันว่าบันทึกแล้ว อย่าแจ้งวันจัดส่ง — ขอเฉพาะที่ขาด(บอลลูนเดียว)" · route คำนวณ preGate จาก pending ก่อน merge · **กฎเดียวครอบทุกชุดที่ขาด** (ไม่ไล่เคส) · field ครบแต่ราคาล้ม → priceStuck จัดการแยก (else)
**harness (order-core · ทุกชุด):** COD+ที่อยู่→[ชื่อ,เบอร์] · +ชื่อ→[เบอร์] · +เบอร์→[ชื่อ] · ชื่อ+เบอร์ไม่มีที่อยู่→[ที่อยู่] · ครบ3→null · ไม่มี items/ยังไม่เลือกจ่าย→null (ไม่ nag) · 220 passed · tsc+build เขียว
**เปลี่ยนผ่านชีต:** ท่าพูด/ถ้อยคำที่บอทใช้ตอบตอนขาด = ชีต Step (โค้ดแค่ป้อน fact + missing)

### Bug 2 (handoff loop) · วินิจฉัยแล้ว — เป็น AI semantic ไม่ใช่แท็กค้าง (รอเจ้าของเคาะวิธีแก้)
handoff ทุก path (edit/AI-semantic/keyword) ตั้งแค่ `human_mode=true`(+resume_notice) **ไม่มีแท็ก** · เปิดบอท/auto-return ตั้ง `human_mode=false` เท่ากัน (ไม่มีแท็กต้องล้าง) · reconcileWaitTags = เฉพาะ รอโอน/รอที่อยู่ (คนละระบบ) → **ไม่ใช่แท็กค้าง** · ตัวการ: AI re-trigger `order_edit_request=true` (state ค้าง `hasWrittenOrder=true` + ประวัติยังมีบริบทแก้ + บอทไม่มีทางรู้ว่า "แอดมินแก้จบแล้ว") → วนซ้ำ · **รอ log `handoff_reason`/`order_edit_request` ยืนยัน + เจ้าของเคาะทิศแก้**

### D-31 · Plan B: ลูกค้าแก้ออเดอร์ที่เขียนแล้ว → แก้แถวเดิมด้วย order_id (ไม่ handoff · แก้ Bug 2)
**เจ้าของตัดสิน flow ใหม่ (แทนหน่วงเขียนชีต):** เขียนชีตทันทีเหมือนเดิม · ลูกค้าแก้หลังเขียน + M(คอนเฟิร์ม)≠TRUE → แก้แถวเดิม · M=TRUE (ของไปแพ็ค) → handoff
**Bug 2 หายเพราะ:** เดิม hasWrittenOrder=true + order_edit → handoff เสมอ (วนไม่จบ) · ใหม่ → แก้ชีต ไม่ handoff · "ถูกต้องครับ/ขอบคุณ" (ไม่มีค่าใหม่) → `no_change` → ไม่แก้ ไม่ push ไม่ handoff
**ทำ:**
- ORDERS_HEADER +Y `แก้ไขล่าสุด` +Z `แก้ไขกี่ครั้ง` (26 คอลัมน์ A–Z · **header-driven ยืนยัน**: appendOrderRow/listPendingOrders ใช้ `columnLetter(max(cols))` ไม่ hardcode index · ยืดได้เอง)
- `updateOrderRow(orderId, changes, now)` (orders.ts) — หาแถวจาก Q(order_id) · M=TRUE→`confirmed` · หาไม่เจอ→`not_found` (ห้ามเขียนแถวใหม่) · แก้เฉพาะ field ที่ **มีค่าใหม่ต่างจริง** (ว่าง/เท่าเดิม=ไม่นับ กัน Y/Z เพิ่มจากยืนยันเฉยๆ) · Y ต่อท้ายประวัติ (ไม่ทับ) · Z +1 · คืน `{status, changed[]}`
- `buildOrderEditAdminText` (pure) · `customers.last_order_id` + `setLastOrderId` (จำ order_id หลังเขียน → แก้แถวเดิมได้) · CustomerState.lastOrderId
- route order_edit: build changes จาก order_data (ชื่อ/ที่อยู่/เบอร์ + items→ราคาถ้ามี payment) → updateOrderRow → updated:push edit · confirmed/not_found:handoff · no_change:เงียบ
- **ไม่แตะ:** pricing/gate/เขียนครั้งแรก/push แอดมินครั้งแรก/cron/orders(📦) · ไม่ทำ cron/หน่วง
- config `หน่วงเขียนชีต_นาที` = **ไม่ใช้แล้ว** (Plan B ไม่หน่วง) → เจ้าของลบแถวในชีตได้ · โค้ดไม่อ่าน
**harness:** order-edit.test — updateOrderRow unit (updated/confirmed/not_found/no_change/Y ต่อท้าย/Z+1/หลายฟิลด์) + route scenario (แก้ก่อน M→แก้+push ไม่ handoff · ถูกต้องครับ→เงียบ · M=TRUE→handoff) · sheet-layout/golden range A:X→A:Z · **229 passed** · tsc+build เขียว
> เหลือเคสแก้**หลัง** M=TRUE (handoff ถูกต้องแล้ว) · Bug 2 กรณีนั้นถ้ายังวน ค่อยดูทีหลัง (เคสน้อย)

### D-32 · บอทจำออเดอร์ที่เขียนแล้ว (last_order) → แก้บางส่วน/ทวน/routing S_EDIT+X2 (รากเดียว)
**ราก:** หลังเขียนชีต pending=null (D-29 ถูก) → บอทลืมออเดอร์ → 3 อาการ: แก้บางส่วนไม่ได้ · ทวนไม่ได้ · โยนกลับต้นกรวย · แก้ที่ราก = ให้จำ **last_order** (แยกจาก pending · ไม่รื้อ D-29)
**เก็บ last_order:** หลัง appendOrderRow สำเร็จ → `setLastOrder(snapshot: order_id/ชื่อ/ที่อยู่/เบอร์/items/total/payment)` ใน `customers.last_order` (JSONB) + `last_order_locked` · clear ตอน /reset · lock (`setLastOrderLocked`) ตอน updateOrderRow พบ M=TRUE
**3 อาการหายด้วย:**
1. **แก้บางส่วน (บั๊ก):** state inject "ออเดอร์ที่บันทึกแล้ว [id]: ชื่อ/ที่อยู่/เบอร์/รายการ/ยอด" → AI มีที่อยู่เก่าครบ → prompt สั่งส่ง **field เต็มก้อน** (ประกอบเก่า+ที่แก้ · เช่น "บ้านเลขที่ 21" → "21 ถนนเจริญกรุง...เต็ม") · 🔴 กันพัง: ที่อยู่ใหม่สั้น < 40% ของเดิม → `updateOrderRow` **ไม่ทับ** + `suspect` → push แอดมิน (อย่าเขียนที่อยู่ผิด)
2. **ทวน (เปิดทางชีต):** 🔴 **ตัวแปรใหม่** `resolveOrderVars` — `{ออเดอร์_ชื่อ}` `{ออเดอร์_ที่อยู่}` `{ออเดอร์_เบอร์}` `{ออเดอร์_รายการ}` `{ออเดอร์_ยอด}` `{ออเดอร์_เลขที่}` (resolve ใน stepText+outReply · เจ้าของอ้างในแถว S_EDIT)
3. **routing (เปิดทางชีต):** 🔴 **สัญญาณใหม่** `buildStepInjection({signals})` — `order_editable` (มี last_order + M≠TRUE) / `order_confirmed_locked` (M=TRUE) · ประตูที่ "เข้าเมื่อ" มี token ตรงสัญญาณ → ยัดเต็มเสมอ (ไม่ hardcode step_id · เจ้าของคุมว่า S_EDIT/X2 ใช้สัญญาณไหน) · ไม่โยนกลับ PRE_QUOTE เมื่อมี last_order
**Bug 2 ยังหาย:** "ถูกต้องครับ" (order_data ว่าง) → no_change → ไม่แก้ ไม่ push ไม่ handoff (เทสยืนยัน)
**ไม่แตะ:** D-29/gate/pricing/เขียนครั้งแรก/push แอดมินครั้งแรก/M=TRUE handoff/เนื้อ CSV_Step
**harness:** order-edit (last_order snapshot/lock · ที่อยู่สั้น→suspect · เต็มก้อน→updated) · inject (signals→S_EDIT/X2) · resolver (resolveOrderVars) · Bug 2 no_change · 237 passed · tsc+build เขียว
> 🔴 **เจ้าของอ้างในชีต:** ตัวแปร `{ออเดอร์_ชื่อ/ที่อยู่/เบอร์/รายการ/ยอด/เลขที่}` · สัญญาณ (ใน "เข้าเมื่อ") `order_editable` / `order_confirmed_locked`

### D-33 · handoff รวมศูนย์ประตูเดียว + footer มาตรฐาน + guard กันหลุด + code-guarantee funnel_stage
**ก่อนแก้ (ยืนยันด้วย grep · `triggerHandoff`/cooldown ที่บรีฟอ้าง ไม่มีอยู่จริง):** handoff กระจาย 5 จุด · `setHumanMode(userId,true)` 5 ที่ · แจ้งแอดมิน 2 จุดใช้ pushHandoffNotice · 3 จุด (เคลม/order_edit×2) bespoke ไม่มี footer
**ทำ:**
- สร้าง `handoff(userId, switches, {reason, userMessage?, attachImage?})` — **จุดเดียว**ที่เรียก `setHumanMode(true)` + push แอดมิน + **footer เสมอ** "🔴 บอทปิดการทำงานกับลูกค้ารายนี้แล้ว · รอแอดมินรับช่วง (เปิดคืน: เปิดบอท [ชื่อ])" (ต่อท้าย reason · reason เปลี่ยนแค่หัวข้อ) · `attachImage` = แนบรูปเคลม ไม่หาย · fold pushHandoffNotice
- แปลง 5 จุด: keyword(runHandoffFlow คง reply แยก) · AI-semantic · เคลม/damage(+รูป) · order_edit confirmed(X2) · not_found
- 🔴 **X2 nuance คง:** ปิดเฉพาะ `confirmed`(M=TRUE) · `order_editable`(ก่อน M=TRUE) ไม่เรียก handoff = แก้เองในแชท (S_EDIT ไม่ regression)
- **push ไม่ปิดบอท ไม่ผ่าน handoff (ไม่มี footer):** 📦 ออเดอร์ใหม่ · ✏️ แก้ก่อน M=TRUE · 💰 สลิป · ⚠️ broken/priceStuck/claims/price/transfer/suspect · applyBotMode(คำสั่งแอดมิน)
- 🔴 **guard (lint · handoff-guard.test):** `await setHumanMode(userId,true)` มีได้จุดเดียว + ต้องอยู่ในบล็อก handoff() → เพิ่ม push handoff นอกประตู = harness แดง
- 🔴 **code-guarantee (D-33):** `funnelStageOf(CSV_Step, geminiOutput.stage)==="handoff"` → โค้ดเรียก handoff() **เอง** ไม่รอ AI ตั้ง flag (ตาข่าย 2 ชั้น · H1 สุขภาพ/แพ้อาหาร พลาด=เสี่ยง พ.ร.บ.อาหาร) · เฉพาะ funnel_stage=handoff (S_EDIT=won/X2=post_sale ไม่ชน) · **เพิ่มแถว funnel_stage=handoff ในชีต = การันตี handoff จากชีตล้วน**
**การเพิ่ม handoff (บันทึกตามคำขอ):** (ก) ตามเนื้อหา → เพิ่มแถว funnel_stage=handoff ในชีต (AI ตั้ง flag + โค้ดการันตี 2 ชั้น · ไม่แตะโค้ด) · (ข) ตามสถานะระบบ → เรียก `handoff(reason)` ในโค้ด ห้าม push เอง
**2 บอลลูนซ้อนตอน handoff:** (1) `botResumeMessage` จาก `resume_notice_pending` (arm ตอนเข้า human_mode · fire ตอน auto-return แล้วเจอข้อความ · prepend ผ่าน withResume) (2) ข้อความประตู (reply AI/runHandoffFlow) — เกิดเคส "แอดมินดูแล→บอทกลับ→ลูกค้าพิมพ์→re-handoff" · เจ้าของยุบทีหลังตอนเทรนได้
**harness:** handoff-flow (5 ทาง+footer · เคลมรูปแนบ · funnel_stage การันตี · 📦 ไม่มี footer) · handoff-guard (setHumanMode true จุดเดียว) · order-edit (✏️ ก่อน M=TRUE ไม่มี footer · X2 มี footer) · 245 passed · tsc+build เขียว
> ไม่แตะ: logic เงื่อนไข handoff · gate/pricing/order-edit/M=TRUE detection · เนื้อ CSV_Step

### D-34 (C1) · funnel_stage=handoff_after_intake — บอทคุยเก็บข้อมูลก่อนค่อยส่งคน
**(commitment guard ตัดทิ้ง — ประตูเคลมตั้ง คิดเอง=ปิด พูดตามชีตเป๊ะ = ไม่ต้อง guard ซ้ำ · intake_summary+business-hours = C3 รอแก้บั๊กเวลา UTC)**
- **ประตูคุยได้ (inject.ts):** const `HANDOFF_AFTER_INTAKE` + validStages · inject **fullSalesBlock** (ไม่ใช่ lean) · `stayStage` (=customer.stage) → คงประตู intake ข้ามเทิร์น **additive ไม่ล็อก** (ประตูขายยังยัด · AI ย้ายออกได้อิสระ · D-18) · `stepNameOf` (ชื่อประตูสำหรับ push)
- **defer-handoff + เพดาน (route):** `intake_turns` (db · นับต่อเนื่อง · reset เมื่อออก) · `funnelStageOf(stage)==="handoff_after_intake"` → **ไม่** handoff ทันที · handoff เมื่อ (ก) AI ตั้ง handoff=true (คุยครบ) (ข) เกิน `เพดานเทิร์นก่อนส่งแอดมิน`(default 3) — ผ่านประตูรวม `handoff()` (footer มาเอง)
- **ขอคุยแอดมิน = keyword pre-check เดิม** (รันก่อน Gemini) → handoff ทันทีแม้ยังไม่ถึงเพดาน
- 🔴 **push-on-exit:** เคยอยู่ intake (prevIntakeTurns>0) แล้วย้ายประตูออก (ไม่ handoff) → `pushRawText` "⚠️ ลูกค้าเพิ่งคุยเรื่อง [X] เปลี่ยนไป [Y]" · **≠ handoff** (ไม่ปิดบอท ไม่ footer · บอทขายต่อ) · reuse pushRawText · edge เดียว (intake_turns reset = ไม่ push ซ้ำ) · 📦 กับ push-on-exit คนละข้อความ ไม่ตีกัน
- คง funnel_stage=handoff (ทันที D-33) + guard ไม่ regression
> 🔴 **เจ้าของต้องรู้:** คำ trigger เข้า intake **ห้ามซ้ำกับ `คำ_handoff`** (เช่น "ของเสีย" อยู่ใน DEFAULT_HANDOFF_KEYWORDS → keyword pre-check ปิดบอทก่อนเข้า intake) · ถ้าอยากคุยก่อน ใช้คำอื่นใน "เข้าเมื่อ" หรือเอาคำนั้นออกจาก `คำ_handoff`
> config: `เพดานเทิร์นก่อนส่งแอดมิน` (default 3) · **harness:** handoff-intake (เข้า→ไม่ handoff · เกินเพดาน→handoff · keyword→ทันที · AI flag→handoff · pivot→push-on-exit ไม่ footer · 📦ไม่ตีกัน · funnel_stage=handoff ไม่ regression) · inject (stayStage additive) · **255 passed** · tsc+build เขียว

### D-35 · แก้บั๊ก C1: intake handoff เทิร์นแรก (AI flag ข้ามการถาม) — เพิ่ม "ถามขั้นต่ำ"
**บั๊ก:** ในประตู handoff_after_intake · AI ตั้ง handoff=true เอง (บทพูด "ส่งต่อแอดมิน") ตั้งแต่เทิร์นแรก → โค้ดเห็น flag → handoff ทันที ข้ามเพดาน = **ประตู intake ไม่เคยถามก่อนเลย = ไร้ความหมาย**
**แก้:** config `เทิร์นขั้นต่ำก่อนส่งแอดมิน` (default 1) · **เพิกเฉย AI flag จนถามครบขั้นต่ำ** — `intakeMinReached = newIntakeTurns > intakeMin` (🔴 strict `>`: เทิร์น 1..min = ถาม · handoff เทิร์นที่ min+1 · default 1 → เทิร์น 1 ถามเสมอ เทิร์น 2+ ยอม flag)
- `intakeHandoff = intakeCapReached || (geminiOutput.handoff && intakeMinReached)` — เพดาน = ตาข่ายแข็ง (handoff แน่นอน · ไม่พึ่ง min) · flag = ยอมหลังถามครบ
- non-intake (funnel_stage=handoff/AI flag ประตูปกติ) = handoff ทันทีเหมือนเดิม (D-33 ไม่ regression)
- "ขอคุยแอดมิน" = keyword pre-check (ก่อน Gemini) → override ทันที ไม่ต้องรอถาม
> min ควร < cap (min=ต้องถาม · cap=คุยได้มากสุด) · **harness:** AI flag เทิร์นแรก→ไม่ handoff · เทิร์น 2+flag→handoff · keyword เทิร์นแรก→ทันที · funnel_stage=handoff→ทันที · 255 passed · tsc+build เขียว

### D-36 · แก้บั๊ก C1 (จริง): intake_turns ค้างข้ามเซสชัน → handoff เทิร์นแรก
**log ฟันธง:** `prevIntakeTurns=7` (funnelStage เข้า intake ถูก · newIntakeTurns=8>min1 → AI flag ปิดทันที) = counter สะสมข้ามเซสชัน ไม่เคย reset
**ราก (ตอบ 3 ข้อ):**
1. reset-on-exit (D-34) ทำงานเฉพาะตอน pivot ไปประตูขาย · เคส เคลม→handoff→human_mode→auto-return→เคลมอีก **วนใน intake↔human_mode ไม่เคย pivot** → ไม่ reset · แถม human_mode = return early ไม่ประมวลผล = ไม่ update counter
2. 🔴 **ขาด reset ตอน handoff** — `persistIntakeTurns = doHandoff && stageIsIntake ? 0 : newIntakeTurns` (เคลมจบ → เริ่มนับใหม่) · ย้าย doHandoff มาคำนวณก่อน memory block เพื่อ reset ได้
3. 🔴 **timeout** — `intakeStale = เงียบ ≥ adminSilenceReturnMinutes` → prevIntakeTurns=0 (เคสเข้า intake แล้วหายกลางคัน ไม่ handoff ไม่ pivot · reuse config เดิม ไม่เพิ่มคีย์)
+ `/reset` ล้าง intake_turns=0 ด้วย
> **Q2 (reset ตอน handoff) = ตัวหลักแก้บั๊กที่รายงาน · Q3 (timeout) = ปิด edge "เข้า intake แล้วทิ้ง" · /reset = เทสต์** → ครอบเคสจริงครบ
**harness:** reset ตอน handoff → intake_turns=0 · timeout (setLastSeenAgo 60นาที) → นับใหม่ (1 ไม่ใช่ 2) · 257 passed · tsc+build เขียว · log `handoff-decision` คงไว้ (มี persistIntakeTurns/intakeStale)

### D-37 · เวลาไทยฐานเดียว `lib/core/time.ts` + แก้บั๊กคอลัมน์ B (UTC→ไทย)
**บั๊ก:** Orders คอลัมน์ B (วันที่) = `new Date().toISOString()` → UTC "…Z" (เขียนตอน D-15 · ก่อนมี bangkokStamp ตอน D-31) · logic +7 shift **กระจาย 5 จุด**
**ผลกระทบ (แคบกว่าที่กลัว):** order_id date / เวลาตัดรอบ (cron) / วันส่ง (formatThaiNow) = **Bangkok อยู่แล้ว ✅** · B **ไม่เคยถูกอ่านกลับเป็น logic** (listPendingOrders ไม่ parse วันที่) → กระทบแค่แอดมินเห็นเวลาผิดในชีต
**ทำ (refactor ไม่เปลี่ยนพฤติกรรม · เฉพาะ B เปลี่ยน UTC→ไทย):**
- `lib/core/time.ts` (pure · inject now): `bangkokShift` · `bangkokDateTime`("YYYY-MM-DD HH:MM" · B/Y) · `bangkokYMD`("YYYY-MM-DD" · promo/ตัดรอบ) · `bangkokYMDCompact`("YYYYMMDD" · order_id)
- ย้าย **5 จุด** มาใช้ helper (ค่าเดิมเป๊ะ): `formatThaiNow`(prompt) · `nowInBangkok`(cron→`bangkokShift`) · `toBangkokYMD`(pricing→`bangkokYMD`) · `generateOrderId`(→`bangkokYMDCompact`) · `bangkokStamp`(Y→`bangkokDateTime`)
- 🔴 **แก้ B:** orders.ts `วันที่: bangkokDateTime()` (รูปแบบเดียวกับ Y) · go-forward เท่านั้น (ข้อมูลเก่า=เทส)
> **กันเพี้ยนถาวร:** +7 อยู่ที่เดียว · จุดใหม่ (business-hours C3) ใช้ helper นี้ · **harness:** time.test (4 helper · ข้ามวัน UTC→ไทย) · order_id/promo/Y ค่าเดิม · sheet-layout B = ไทย ไม่มี T/Z · **261 passed** · tsc+build เขียว

### D-38 (Step 6) · validate funnel_stage ตอนโหลด (จับ typo ชีตทันที · visibility ไม่ auto-แก้)
**ก่อน:** funnel_stage ผิด = `console.warn` ต่อ turn (spam · log แค่ stepId) · แถวโหลดแต่ region/handoff-guarantee/intake เงียบ = พังเงียบ (H1 typo → ตาข่าย พ.ร.บ.อาหาร หาย)
**ทำ:**
- `validateStepFunnelStages(rows) → BadFunnelStage[]{stepId, value, severity}` (inject.ts · pure) · `VALID_FUNNEL_STAGES` (9: region 7 + handoff 2) · 🔴 typo กลุ่ม handoff (มี "handof"/"intake") = **severity high** (ตาข่ายหาย อันตรายสุด) เด่นกว่าประตูขาย
- เรียก **ตอนโหลดชีต** (loader · ครั้งเดียวต่อ cache-refresh ไม่ spam) → `console.error` (ไม่ใช่ warn) พร้อม **value+stepId+allowed** · ย้าย warn ต่อ turn ออกจาก buildStepInjection
- 🔴 **fail-safe: คงแถว (ไม่ skip/remap)** — skip=ประตูหาย · remap=กลบ typo · งานนี้คือ visibility คนแก้=เจ้าของ
- **diag endpoint** `GET /api/diag/steps` (auth CRON_SECRET · read-only · ไม่แตะ state) → เจ้าของยิงหลังแก้ชีต → คืนแถวผิด JSON ทันที (ไม่ต้องรอ cache/ลูกค้า)
**นอก scope (ยืนยันไม่ทำ):** dangling "ไปประตูถัดไปเมื่อ" step_id · referential check — งานอนาคต
**harness:** validateStepFunnelStages (value+severity · handoff typo=high · ถูก→ว่าง · แถวยังโหลด) · diag endpoint (401 ไม่มี auth · คืนแถวผิด+auth · ถูก→ok) · 269 passed · tsc+build เขียว

### D-39 (Phase2 #1) · คอลัมน์ `คิดเอง` (เปิด/ปิด) + verbatim path (ชั้น③ "ตอบ pattern เป๊ะ")
**ปัญหา:** บอทพูด pattern แต่ละ step ไม่ครบ/ไม่ตรง (ยังไม่แจ้งโปรก็ถามรับโปรไหน) — AI เรียบเรียงเองทุกเทิร์น เจ้าของคุมคำเป๊ะไม่ได้
**ขอบเขต:** ทำเฉพาะชั้น③ · **ไม่ทำชั้น②** (ไม่บังคับลำดับ step · AI เลือก step อิสระตามข้อมูลเดิม D-18)
**ทำ:**
- คอลัมน์ `คิดเอง` (optional) ใน **CSV_Step** + **CSV_Objections** · `ปิด`=verbatim (ส่ง "ตัวอย่างคำตอบ" เป๊ะ · แทนตัวแปรอย่างเดียว) · ว่าง/`เปิด`=AI เรียบเรียง (เดิม) · 🔴 ไม่มีคอลัมน์=ทุกประตูเปิด (ชีตเดิมไม่ regression)
- **verbatim path** ที่จุด `baseReply` (route · หลัง Gemini): AI ยังเลือก step + สกัด order_data + handoff เสมอ (ชั้น①) · โหมดปิด = **ทิ้งแค่ reply ที่ AI แต่ง** แทนด้วย pattern ชีต → ไหลเข้า resolver/guard/deliver เดิม (reuse ครบ) · **ไม่ประหยัด token** (ยังเรียก AI · แค่ไม่ใช้ reply)
- **precedence:** objection ปิด(มี pattern) ชนะ step · 🔴 เปิด/ไม่มี pattern → **ไม่บังคับชนะ** (ปล่อย AI เดิม · บังคับชนะโดยไม่มี pattern = ไม่ได้ประโยชน์)
- **gate/handoff/order ไม่แตะ** — คุมแค่ข้อความที่ส่ง
- **safety net:** (1) ปิด+ตัวอย่างว่าง → fallback AI + log (กันเซตปิดลืมกรอก) · (2) 🔴 **var-guard** (`dropUnresolvedVarBubbles` · quote.ts) ทั้งโหมดเปิด/ปิด: ตัวแปร "ที่รู้จัก" (`KNOWN_RUNTIME_VARS`=pricing+transfer+order · **ไม่ใช่ `{` ทุกตัว**) ค้าง → ทิ้งบอลลูนนั้น + log · เหลือว่างหมด → ปิด fallback AI / เปิด พักสาย+log หนัก
- 🔴 เลิกเรียก guard 5 (`hasUnresolvedPricingVars` log-only "ปล่อยผ่าน") — var-guard คุมแทน (log+ทิ้ง ครอบ pricing+order) · คงฟังก์ชัน (ยังมีเทส)
**harness:** verbatim.test 20 เคส (parseThinkMode/stepVerbatim/dropUnresolvedVarBubbles/objection.verbatim pure + pipeline: ปิด→ชีต+แทนตัวแปร · เปิด/ว่าง→AI · ปิด+ว่าง→fallback · ตัวแปรค้าง→ทิ้งบอลลูน · objection ปิดชนะ/เปิดไม่ชนะ · ปิด+gate/handoff ยังทำงาน) · 289 passed · tsc+build เขียว
**ค้างต่อ (Phase2 ถัดไป):** S2/X2 ยังไม่เซตปิด (เจ้าของเซตในชีตเองเมื่อพร้อม) · ชั้น② (บังคับลำดับ) ถ้าเจ้าของต้องการภายหลัง = design decision (ขัด D-18)

### D-39B (Phase2 #1 ต่อ) · verbatim ส่งไม่ครบ → resolver รวม pass เดียว (post-process เท่ากับ AI reply)
**บั๊กที่เจอ (log จริงโหมดปิด):** `[[แยก]] {ชื่อสินค้า}... {โปรโมชั่นทั้งหมด}` ส่งดิบ — verbatim reuse แค่ 3 resolver (15 token) แต่ตัวแปรที่เจ้าของใช้จริงหลายตัว **AI เคยเติมเองจาก catalog** (ไม่มี code resolver) · พอตัด AI (verbatim) → ทะลุ · + `[[แยก]]` ไม่เคยถูก parse (delivery รู้จักแค่ `[[เว้น]]`)
**ราก:** "verbatim = AI reply ต่างแค่แหล่งข้อความ" — จริง แต่ post-process ต้อง **ครบ** · จุด merge (`baseReply`) ถูกแล้ว · ปัญหาคือ **resolver เองไม่ครบ** (AI แค่บังหน้าให้)
**ทำ (แก้รอบเดียว · ครอบปัจจุบัน+อนาคต):**
- 🔴 `resolveAllVars(text, ctx)` (quote.ts) = **pass เดียว** แทนขั้น resolve เดิม — ลำดับ R1(เงิน)→R2(บัญชี)→R3(snapshot) **คงเดิมเป๊ะ** (AI mode ไม่ regression) + Group X ต่อท้าย · **AI reply(เปิด)+verbatim(ปิด) เรียกตัวเดียวกัน** → ตัวแปรใหม่เพิ่มที่นี่ที่เดียว ผ่านทั้ง 2 path
- **Group X ที่เพิ่ม (9 token):** catalog `{ชื่อสินค้า}{วิธีเก็บรักษา}{โปรโมชั่นทั้งหมด}`(pricing.ts · สินค้า/promo live) · pending `{ชื่อ}{ที่อยู่เต็ม}{เบอร์}{การชำระเงินใหม่}`(quote.ts · **pending ปัจจุบัน** ไม่ใช่ snapshot) · time `{วันจัดส่ง}`(time.ts `bangkokDeliveryDay` · เวลาตัดรอบ→วันนี้/พรุ่งนี้)
- 🔴 **กับดักชื่อ (comment ชัด):** `{ชื่อ}`(pending) ≠ `{ออเดอร์_ชื่อ}`(snapshot) · `{การชำระเงินใหม่}`(X1 เปลี่ยนวิธีจ่าย) ≠ `{การชำระเงิน}`(R1)
- **`[[แยก]]` = alias `[[เว้น]]`** ใน `parseReplyIntoMessages` (line.ts · แยกบอลลูนทั้งคู่) · รูป `[[รูป:URL]]`/`\n\n`/enforceTextLast ทำใน deliverReply อยู่แล้ว (verbatim ได้ฟรี)
- var-guard: `KNOWN_RUNTIME_VARS` ขยายเป็น 6 กลุ่ม (+catalog/pending/delivery) · resolve ไม่ได้ (ว่าง/cutoff พัง) → ทิ้งบอลลูน + log (ชื่อตัวแปร+stage · visibility แบบ Step 6)
- **CSV_Vars** (ตัวแปรข้อความเจ้าของนิยามเอง · ไม่พึ่ง dev) = **เฟสถัดไป** (เฟสนี้ทำ Group X ระบบก่อน)
**harness:** allvars.test (catalog/pending/delivery/bangkokDeliveryDay/resolveAllVars/parseReply [[แยก]]+รูป+\n · AI-parity ไม่มี token→ไม่แตะ) + verbatim Group X pipeline (catalog+[[แยก]]แยกบอลลูน · pending 2 เทิร์น · delivery · resolver ไม่ครบ→ไม่ส่งดิบ) · เขียวทั้งหมด · tsc+build เขียว

### D-39B2 (Phase2 #1 ต่อ) · verbatim รวม 2 ช่อง (ตัวอย่างคำตอบ + ปิดท้าย)
**ทิศทางเจ้าของ:** Phase2 = บอทเข้าใจบริบท (ชั้น①) + ตอบตามเจ้าของเป๊ะ (คิดเอง=ปิด) · เทรนละเอียดผ่าน **2 ช่องนี้ทุก step**
**ก่อน:** verbatim ดึงแค่ "ตัวอย่างคำตอบ" (`stepVerbatim` คืน `{mode,example}`) · "ตัวอย่างประโยคปิดท้าย" ไม่ถูกส่งโหมดปิด (โหมดเปิดใช้เป็นไกด์ AI ใน `fullSalesBlock` injection · ไม่แตะ)
**ทำ (แบบ 1 · ปิดท้าย=บอลลูนแยกอัตโนมัติ):**
- `stepVerbatim` คืน `{mode, pattern}` · `pattern = joinVerbatimParts(example, closing)` = 2 ช่องคั่น **`[[แยก]]` อัตโนมัติ** (เจ้าของไม่ต้องพิมพ์เอง)
- ข้ามช่องว่าง: ปิดท้ายว่าง → แค่คำตอบ · คำตอบว่าง+ปิดท้าย → แค่ปิดท้าย · 2 ช่องว่าง → fallback AI (ไม่มีบอลลูนเปล่า/`[[แยก]]` เกิน)
- ทั้ง pattern ผ่าน `resolveAllVars` + `[[แยก]]`/`[[รูป]]`/`\n`/cap 5 เดิม (ทำที่ route/deliver เหมือน AI reply) · คำตอบมี `[[แยก]]` เอง + ปิดท้าย → ปิดท้ายเป็นบอลลูนสุดท้าย
- **CSV_Objections ไม่มีช่องปิดท้าย** → objection verbatim ใช้ช่องเดียว (`ตัวอย่างคำตอบ`) ตามเดิม
**harness:** stepVerbatim join (2 ช่อง/ปิดท้ายว่าง/คำตอบว่าง) + pipeline (2 ช่อง→2 บอลลูน · ปิดท้ายว่าง→แค่คำตอบ · คำตอบว่าง→แค่ปิดท้าย · คำตอบมี [[แยก]] เอง+ปิดท้าย→3 บอลลูน) · โหมดเปิดไม่ regression · tsc+build เขียว

## P2-REBUILD v2.0 (branch `phase2-v2` · brief `docs/P2-REBUILD-BRIEF.md`)
> เจตนา: AI ไม่เขียนข้อความถึงลูกค้าอีกต่อไป (สถาปัตยกรรม) — เหลือ 4 งาน: เลือก step · จับ objection/FAQ · สกัด order_data · ตัดสิน handoff · ทุกคำจากชีต (pattern) + resolver · engine เดิม (gate/pricing/resolver/harness) ห้ามรื้อ

### D-40 · verbatim = default ของทั้งระบบ (flip `parseThinkMode`)
**ก่อน (D-39):** ไม่มีคอลัมน์ `คิดเอง`/ค่าว่าง = **เปิด** (AI เรียบเรียง) · **v2.0:** ชีตตัดคอลัมน์ `คิดเอง` ทิ้ง → ต้อง flip
**ทำ:** `parseThinkMode` (inject.ts) — ว่าง/ไม่มีคอลัมน์/ไม่รู้จัก = **ปิด (verbatim)** · เฉพาะ `เปิด/true/on/1/ใช่/yes` = เปิด (override รายแถวถ้าคอลัมน์กลับมา)
- `stepVerbatim`/`joinVerbatimParts`/`resolveAllVars`/var-guard/objection precedence/safety-net (2 ช่องว่าง→fallback AI) — **คงเดิมทั้งหมด**
**blast radius:** วัดแล้ว = **verbatim.test เท่านั้น** (5 เคส · blank เดิมคาด เปิด → ปิด) · อีก 25 ไฟล์เขียว (default seedBotLib header ไม่ valid→stepVerbatim null→AI · fixture อื่น example ว่าง→fallback AI · ไม่ regression)
**harness:** verbatim.test 29 passed · (full suite + build ดูคอมมิต)

### D-41 · schema v2.0 (breaking · contract = `docs/BOTLIB-V2-HEADERS.txt`)
**verify #1 (สเตปแรก):** ✅ `resolveColumns` เรียก `headerRow.map(cleanHeader)` → header มีวงเล็บ ("เข้าเมื่อ (สัญญาณจากลูกค้า)"/"ตัวอย่างคำตอบ (บอลลูน)") `stripKeyAnnotation` ตัดให้ตรง required — **ไม่พังเงียบ**
**ทำ:**
- **loader:** `BOTLIB_TABS` ตัด `CSV_Examples` เพิ่ม `CSV_Vars` (คง 8) · `BotLibrary` type ตาม
- **CSV_Step:** `STEP_COLS` required = เฉพาะโค้ดอ่าน (step_id/funnel_stage/ชื่อประตู/เข้าเมื่อ/ไปประตูถัดไปเมื่อ/ต้องเก็บข้อมูล/ตัวอย่างคำตอบ/ปิดท้าย) · ตัด brain (ความรู้สึก/ทำไมสำคัญ/หลักการนำพา/ห้ามทำ/คิดเอง) · เพิ่มอ่าน `กรณี` optional · **`fullSalesBlock`/`leanHandoffBlock` = routing เท่านั้น** (ตัด example/brain ออกจาก prompt → ประหยัด token)
- **CSV_Objections:** ตัด หลักการตอบ/ห้ามทำ · full-block = concern เท่านั้น (AI ใช้จำแนก objection_detected) · pattern verbatim = "ตัวอย่างคำตอบ (บอลลูน)"
- **CSV_FAQ:** status filter (คอลัมน์ `status`) · (faq_id key เตรียม T1)
- **CSV_Promo:** สลับลำดับ (ค่าส่ง/ยอดจ่าย/ประหยัด) — pricing header-driven จึงทน (verify: calculatePrice/buildAllowedPriceStrings อ่านชื่อ ไม่ใช่ index)
- **status filter ทุกแท็บ** (`isActiveStatus`): live/เปิด/ว่าง = ใช้ · draft/ปิด = ทิ้ง (Vars strict live = D-43)
- **ลบ Examples ทั้งระบบ** (answer B): `buildExampleInjection`/`EXAMPLE_ANSWER_COL`/config key `จำนวนตัวอย่างที่ยัดเข้า prompt` · param `exampleText` + `<ตัวอย่างน้ำเสียง>` จาก gemini.ts/prompt/system.ts/route.ts
**gotcha ที่เจอ:** test helper `step()` เติม สถานะ placeholder "S1-สถานะ" → status filter ตัดทุกแถว → parse null → fallback · แก้ helper default สถานะ="live"
**harness:** fixtures v2.0 (Promo reorder + CSV_Vars +draft row) · inject.test/gemini-guard/resolver/real-gemini อัปเดต · **310 passed | 4 expected-fail** · tsc+build เขียว

### D-42 · FAQ เข้า verbatim path เดียวกัน
**ทำ:** `buildFaqInjection` คืน `{text, verbatim}` · verbatim = FAQ แรก `action=answer`+มีคำตอบ · **`action=handoff` → verbatim=null เสมอ** (ห้ามส่งช่องคำตอบ · v1.5) · `stepClosing(rows, stepId)` helper
- **precedence (route baseReply):** 🔴 **handoff > objection pattern > FAQ answer > step pattern** · `isHandoffTurn` = AI handoff / funnel=handoff / handoff_after_intake → **ตัด objection+FAQ ออก** (ปล่อย step pattern = ข้อความประตูส่งต่อ/intake)
- FAQ answer = `joinVerbatimParts(คำตอบ, stepClosing(stage ที่ AI เลือกเทิร์นนี้))` — ปิดท้าย step ปัจจุบัน (วกกลับ funnel) · ข้ามช่องว่าง
- ผ่าน resolveAllVars + var-guard + deliver เดิม (FAQ answer มี {var} = D-43 resolve)
**harness:** buildFaqInjection.verbatim (answer/handoff→null) + pipeline (FAQ answer+ปิดท้าย 2 บอลลูน · ปิดท้ายว่าง→1 บอลลูน · handoff turn→ไม่แทรก FAQ · action=handoff→ตกไป step) · **314 passed** · tsc+build เขียว

### D-43 · ขยาย resolver (catalog/config/composed/CSV_Vars)
**ทำ (เพิ่มใน `resolveAllVars` ที่เดียว + `KNOWN_RUNTIME_VARS`):**
- **catalog** (pricing.ts · สินค้า live ตัวแรก): `{เลข อย.}{ส่วนประกอบตามฉลาก}{ราคาต่อหน่วย}` · `{รูปสินค้า}`=**URL ดิบ** (ชีตใส่ `[[รูป:{รูปสินค้า}]]` เอง · รูปว่าง→ตัด wrapper ทิ้ง+log · บอลลูนข้อความยังส่ง) · `{โปรแนะนำ}`=ข้อความโชว์โปร live ประหยัดสูงสุด (เสมอ→จำนวนน้อย) · 🔴 **ไม่ทำ `{สารก่อภูมิแพ้}`** (ช่องแอดมิน · H1)
- **config** (quote.ts): `{ค่าส่ง_มาตรฐาน}{ยอดขั้นต่ำส่งฟรี_บาท}` (ตรง) · `{นโยบายค่าส่ง}`=ประกอบ "ค่าส่ง {X} บาทค่ะ สั่งครบ {Y} บาท ส่งฟรีเลยค่ะ" (🔴 ไม่รองรับ COD เพิ่ม)
- **CSV_Vars** (แท็บใหม่): `loadLiveVars` โหลดเฉพาะ สถานะ=live + ชื่อมีปีกกา (กรอง draft/แถวกติกา) · `resolveCsvVars` — 🔴 **ชื่อชนตัวแปรระบบ (KNOWN) → ข้าม+log (ระบบชนะ)** · resolve ท้ายสุด
- 🔴 **`buildAllowedPriceStrings` เพิ่มเลข config** (ค่าส่ง/ยอดขั้นต่ำ/COD) → `{นโยบายค่าส่ง}` (30/275) ไม่โดน price-guard ทิ้ง · CSV_Vars ยังผ่าน claims+price guard ปกติ
- `AllVarsContext` +`varsRows` · route ส่ง `lib.CSV_Vars`
**harness:** allvars D-43 (catalog ใหม่/รูปว่าง→ตัด/โปรแนะนำ/config/นโยบายค่าส่ง+price-guard/loadLiveVars draft/collision ระบบชนะ) + pipeline verbatim (CSV_Var+นโยบายค่าส่ง ไหลผ่าน) · **323 passed** · tsc+build เขียว
**+ กติกาถาวรใหม่:** จบ D-xx/phase → อัปเดต `STATUS.md` ในคอมมิตเดียวกัน (เพิ่มใน CLAUDE.md "เวลาแก้โค้ด")

### D-44 · routing S_UNKNOWN + หด คำ_handoff + systemInstruction v2.0 + golden tests (3 คอมมิตย่อย a/b/c)
**D-44a — หด `DEFAULT_HANDOFF_KEYWORDS` + S_UNKNOWN routing:**
- `DEFAULT_HANDOFF_KEYWORDS` (handoff.ts) หดเหลือ **19 คำ ตรงชีต v2.0 คำต่อคำ**: ขอแอดมิน/คุยกับคน/คุยกับแอดมิน/เจ้าของ/ฟ้อง + H1 สุขภาพ (แพ้/ภูมิแพ้/แพ้กุ้ง/แพ้อาหารทะเล/แพ้ปลา/กลูเตน/ท้อง/ตั้งครรภ์/ให้นม/เบาหวาน/ความดัน/โรคไต/ผู้ป่วย/กินยา) · **ตัด** ร้องเรียน/ของเสีย/ของไม่ตรงปก/ขายส่ง/แฟรนไชส์/สื่อ/PR/wholesale → เข้า H2-H4 (intake · บอทถามก่อนส่งคน) · ตรรกะ match คงเดิม (KI-01 word-boundary สำหรับ ASCII · ไทย substring)
- **S_UNKNOWN** = แถวชีต funnel=handoff — โค้ดรองรับผ่าน D-33 อยู่แล้ว (การันตี handoff แม้ AI ไม่ตั้ง flag) + D-40 ส่ง pattern verbatim · เทส scripted พิสูจน์ code-path (กฎให้ AI เลือก = D-44b prompt)
- ปลด `.fails` บท 2 (แพ้กุ้ง → keyword handoff) — เขียวจริงแล้วตามที่ไฟล์ออกแบบไว้
- ⚠️ **สังเกต (แจ้งเจ้าของ · ไม่แก้เอง):** "ท้อง" substring ชนคำประสม เช่น "ท้องฟ้า"/"ท้องเสีย" → pre-check handoff ทันที · ทิศ false-positive = ส่งหาคน (ปลอดภัย) แต่ "ท้องเสีย" (เคส H3 เคลม) จะถูกดักก่อนเข้า intake — ถ้าไม่ต้องการ ให้แก้คำในชีต (`คำ_handoff`) ไม่ใช่โค้ด
**harness (a):** handoff.test rewrite (H1 8 สำนวน · คำที่ตัด 5 คำไม่ดัก · KI-01 ผ่าน configured · default 19 คำ) + S_UNKNOWN pipeline (pattern 2 บอลลูน + footer + human_mode) · **325 passed | 3 expected-fail** · tsc+build เขียว

**D-44b — systemInstruction v2.0 ("จำแนกและสกัด" ไม่ใช่ "นักขาย"):**
- rewrite `buildStaticSystemInstruction` ทั้งก้อน (Edit เท่านั้น · KI-03): บทบาท = ระบบจำแนก+สกัด · ประกาศชัด "ไม่ได้เขียนข้อความถึงลูกค้า" · งาน 4 อย่าง (stage/objection/order_data/handoff)
- **ขนาด: 12,529 → 4,898 chars ≈ 5,507 → ~2,153 tokens (est ratio จากที่วัดจริง) = ลด 61% · ต่ำกว่าเป้า <2,500** ✅
- **คงห้ามตีความใหม่ (ครบ):** order_data 6 ช่อง (bug A: ใส่ทันที/qty≠เบอร์/ที่อยู่ก้อนดิบ/ห้าม placeholder/แก้=เต็มก้อน) · C6 ห้ามคำนวณราคา (prompt-lint คุม — จับได้จริงตอน rewrite แล้วเติมกลับ) · กัน injection ทั้งบล็อก · H1=handoff เสมอ · สลิปอ่านไม่ชัด=slip · JSON ทุก field เดิม (reply=fallback)
- **เพิ่ม:** กฎเลือก S_UNKNOWN (ไม่ match/นอกเรื่อง/ไม่มีข้อมูล + handoff=true · กฎ 10) · FAQ → คง stage ประตูขาย (ให้ stepClosing วกกลับถูกประตู D-42) · intake → เลือกประตูโดยไม่ตั้ง flag (ระบบคุมจังหวะ D-34)
- **ตัด:** ทุกบล็อกสอนแต่งคำ/โทน/สำนวน/จังหวะ (บับเบิลสุดท้าย=ข้อความ → `enforceTextLast` โค้ดคุมอยู่แล้ว · วันจัดส่ง → resolver D-43 · วกกลับ funnel → stepClosing D-42)
- rewrite `SYSTEM-PROMPT-BREAKDOWN.md` ทั้งไฟล์ตรง v2.0
**harness (b):** prompt-lint + gemini-guard เขียว (lint จับ order_data example + C6 ตอน rewrite — ตาข่ายทำงานจริง) · **325 passed | 3 expected-fail** · tsc+build เขียว

**D-44c — golden routing tests (จบ phase โค้ด):**
- `tests/scenarios/golden-routing.test.ts` — table-driven จาก `docs/golden-routing-cases.csv` **25 เคส** (parse CSV ตอนรัน · แก้ CSV = แก้เทส) · assert เฉพาะ **stage / objection_detected / handoff** — 🔴 ไม่ assert ข้อความ (คำพูด = ชีต)
- gate `HARNESS_REAL_GEMINI=1` + `GEMINI_API_KEY` (pattern เดียวกับ real-gemini.test) · scripted mode = **skip 25 เคสอัตโนมัติ ไม่ block npm test** ✅
- fixture จำลองชีต v2.0 (step routing cols 15 ประตู + objections 7 id + FAQ) — 🔴 ชีตจริงแก้ "เข้าเมื่อ/กรณี" → sync fixture เมื่อเทสแดง
- เกณฑ์ handoff: AI flag **หรือ** ประตู funnel=handoff/handoff_after_intake (CSV หมายถึง "เคสจบที่คน" — intake ถึงมือคนผ่านจังหวะ D-34 ไม่ใช่ flag เทิร์นแรก)
- `stateFor()` map "สถานะก่อนหน้า" 9 แบบ → stateText/history/signals (order_editable/order_confirmed_locked ครบ)
**harness (c):** **325 passed | 3 expected-fail | 26 skipped (golden 25 + real-gemini 1)** · tsc+build เขียว → **จบ P2-REBUILD ฝั่งโค้ด (D-40..D-44)** · เหลือ: เจ้าของสลับชีต v2.0 + รัน golden ด้วย real Gemini + merge main

### Phase C · ลบ ENV ค้างใน Vercel
`SHEET_STEP_URL` `SHEET_FAQ_URL` `SHEET_CONFIG_URL` `SHEET_FOLLOW_URL` — โค้ดไม่อ่านแล้ว ลบทิ้งได้
