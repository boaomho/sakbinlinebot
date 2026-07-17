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

### D-07 · เบอร์: มือถือ 10 หลัก · เบอร์บ้าน 9 หลัก

สเปกรอบแรกเขียนขัดกันเอง: "โอน: แค่ 10 หลัก (เบอร์บ้าน/ออฟฟิศผ่าน)" — **เป็นจริงพร้อมกันไม่ได้**
เพราะเบอร์บ้านไทย = `02` + 7 ตัว = **9 หลักเสมอ** ⇒ กฎ 10 หลักบล็อกเบอร์บ้านทุกเบอร์

**เคาะ:** `sanitizePhone` รับ **9–10 หลัก** · `isMobilePhone` = 10 หลัก + ขึ้นต้น 06/08/09
- COD → ต้องมือถือ (ขนส่งต้องโทร) = เงื่อนไขเดียวที่ block COD
- โอน → 9–10 หลักผ่าน (เบอร์บ้าน/ออฟฟิศได้)

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
