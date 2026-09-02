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

### KI-05 · 🛡️ PROHIBITED_CONTENT ปิดไม่ได้ — มีบันได 4 ชั้นรับ (เฝ้า log ต่อ)

Gemini core policy `PROHIBITED_CONTENT` **ปรับผ่าน safetySettings ไม่ได้** (ต่างจาก 5 หมวดที่ D-46 ตั้ง OFF) →
เส้นทางเงิน (เลือกจ่าย/เปลี่ยน COD+ที่อยู่) โดนบล็อกแบบ **deterministic** (พิสูจน์ 7/7 · D-48) · **แก้ที่ต้นเหตุ (prompt) ไม่ได้ ต้องรับด้วยบันได:**
1. **pre-check** (D-47) — เทิร์นเลือกจ่ายคำล้วน → ข้าม AI (deterministic)
2. **call หลัก** — safetySettings OFF 5 หมวด (D-46) ลดบล็อกหมวดอื่น
3. **extraction** (D-48) — call หลัก blocked → call จิ๋วไม่มีกลิ่นเงิน สกัด order_data
4. **degraded** (D-46) — extraction ก็ blocked → ข้อความขอส่งใหม่ (last resort)

**เฝ้าต่อ:** log `scope:"extraction"` (ฟื้นบ่อยแค่ไหน) + `scope:"gemini" warning:"no text"` (blocked pattern: historyLen/msgHead/hasDigit) ·
ถ้า post-deploy ยัง blocked ถี่ **นอก** 4 ชั้นนี้ → ค่อยพิจารณาท่าใหญ่ (แยก classify call ถาวร / เปลี่ยนโครง prompt) · **ยังไม่ทำ** (วัดก่อน)

### KI-06 · ✅ แก้แล้ว (2026-07-24) — ล้าง `delivered_steps` หลัง cron: รากที่แท้จริง = คอลัมน์ R ว่าง

**รากที่แท้จริงของ "ล้างธงไม่เคยพิสูจน์บน LINE จริง"** (เจอตอน audit T-STUDIO เฟส ก · เจ้าของยืนยันชีตจริง R ว่าง ไม่มีสูตร):
`appendOrderRow` **ไม่เคยเขียน `line_user_id` (คอลัมน์ R)** แต่ cron ล้างธงด้วย `if (order.lineUserId)` →
R ว่างเสมอ = **ธงไม่เคยถูกล้างผ่าน cron บน prod เลย** · harness D-45b เดิมเทส `clearDeliveredStepsExceptCurrent`
แบบเรียกตรง (function-level) — **ไม่ได้เทส join ผ่านชีต** จึงเขียวทั้งที่ join ขาด · เทสจริง 2026-07-23
"ซื้อซ้ำได้ S2 เต็มก้อน" ผ่านได้เพราะเหตุอื่น (ลูกค้าเทสใหม่/ธงยังไม่เคยตั้ง) ไม่ใช่เพราะ cron ล้าง

**แก้ (commit แยก):** `appendOrderRow` เขียน `line_user_id` ลง R (`NewOrderInput.lineUserId` + caller ใน handler ส่ง `userId`) ·
**เทส join จริงเพิ่ม** (golden บท 19): append ผ่าน pipeline → assert R=userId → ติ๊ก M → cron จริงอ่านแถว → ธงถูกล้างถูกคน + เลขถูกแจก
**เหลือ:** แถวออเดอร์เก่าในชีต (ก่อน fix) R ยังว่าง — cron จะข้ามล้างธงให้ลูกค้ากลุ่มนั้น (ครั้งเดียว · ลูกค้าซื้อรอบใหม่จะได้แถวใหม่ที่มี R) · ยังรอหลักฐานลูกค้าเก่าเคสแรกบน LINE จริงเช่นเดิม

### KI-07 · 🧪 golden fixture G26-G29 รอ sync กับชีตจริง (ค้างจากรอบก่อน)

pipeline fixture (`golden-routing.test.ts` · G26-G29 delivery) เขียนจาก **โครงชีตที่คาด** — ยังไม่ sync กับ "เข้าเมื่อ/ตัวอย่างคำตอบ" ของชีต v2.0 จริง ·
เจ้าของรัน `HARNESS_REAL_GEMINI=1` แล้วแดง → จูนชีต + sync fixture (คู่กับ KI known-tuning: G12 S2/S2_DIRECT · G29 stage S4A/S4B)

### KI-08 · 🔴 กับดักถาวร: ช่องสถานะว่าง = LIVE (คนแก้ชีตมือต้องระวัง)

`isActiveStatus` ([lib/agent/inject.ts](../lib/agent/inject.ts)) ถือว่า **ช่อง "สถานะ" ว่าง = active (live)** โดยตั้งใจ (กัน junk ที่ key ว่างมาก่อนแล้ว) →
**เพิ่มแถวมือในชีตโดยไม่กรอกสถานะ = แถวนั้นขึ้นหน้าร้านให้ลูกค้าจริงเห็นทันที** (ไม่มี draft กั้น)
- **โค้ดกันแล้วฝั่ง T2-ค:** `appendRow` บังคับ `สถานะ=draft` เสมอ + แท็บไม่มีคอลัมน์สถานะ = ปฏิเสธ (ดู D-57) → เพิ่มผ่านเว็บปลอดภัย
- **ยังเป็นกับดักเมื่อแก้ชีตด้วยมือ** (นอก T-STUDIO) — 🔴 **เจ้าของต้องวางข้อความเตือนในแท็บวิธีใช้ของชีต:**
  > `🔴 เพิ่มแถวใหม่ด้วยมือ: ต้องใส่คอลัมน์ "สถานะ = draft" ก่อนเสมอ · ช่องสถานะว่าง = บอทถือว่า live ทันที (ลูกค้าจริงเห็นเลย) · ทดสอบในห้องซ้อมก่อน แล้วค่อยเปลี่ยนเป็น live`
- ไม่ "แก้" ที่โค้ด (ว่าง=live เป็น contract เดิมที่ระบบพึ่งพา — เปลี่ยนจะกระทบทุก consumer) → รับด้วย add-row guard + เอกสารเตือน

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

**D-44d — จูน golden จากรอบรัน real Gemini แรก (G06/G12/G23 แดง):**
- **golden objection assert เฉพาะเทิร์นไม่ handoff** — เทิร์น handoff โค้ด `isHandoffTurn` ตัด objection pattern ทิ้งอยู่แล้ว → objection_detected ที่ AI ตั้งบนเทิร์นนั้นไม่มีผลกับ output → assert = เปราะ (แก้ G06: H2 + AI แท็ก OBJ_PRICE ไปด้วย) · stage/handoff ยัง assert เข้มเดิม
- 🔴 **temperature 1.0 → 0.2** (default) — บทบาทใหม่ "จำแนกและสกัด" ต้องนิ่ง (เดิม 1.0 = นักขายสร้างสรรค์ · G23 ผ่านรอบแรกตกรอบสอง ข้อความเดิม = variance โมเดล) · key `temperature` มีอยู่แล้วใน CSV_Config (ไม่เพิ่ม key ใหม่) → **ชีตตั้งทับได้** · `config.ts` (prod) + `fixtures.ts` (golden real-Gemini ใช้) เป็น 0.2
- ⚠️ **ถ้าชีต v2.0 CSV_Config มี key `temperature`=1.0 (ค่าเก่า) จะชนะ default** — เจ้าของเช็ค/แก้ค่าในชีตเป็น ≤0.2 ด้วย
**harness (d):** 325 passed | 3 expected-fail · tsc+build เขียว (temperature ไม่กระทบ scripted · มีผลตอน golden real-Gemini)

> ✅ **ซีรีส์ D-45→D-49 ปิดแล้ว — เทสรับบน LINE จริงผ่านครบ (2026-07-23):** ก้อน "เปลี่ยน COD + ที่อยู่" จบเทิร์นเดียวพร้อมทวนเต็ม (D-48/49) · cron ฟื้น แจกเลข + แจ้งกลุ่ม format ถูก · ซื้อซ้ำได้ S2 เต็มก้อน (delivered_steps ล้าง — KI-06) · ระบบพร้อมรับลูกค้าจริง (ดู STATUS.md)

### D-45 · สมองยึด Step + ธงต่อ step + ชวนเลือกโปร (4 คอมมิต a/b/c/d)
> อาการจากเทสจริง v2.0: (1) คว้า FAQ ทั้งที่ลูกค้าแค่เอ่ยชื่อสินค้า/ตอบคำถามบอท (2) ไม่รู้ว่าตัวเองส่งอะไรไปแล้ว — โชว์ตารางโปรซ้ำ/ถามเลือกโปรทั้งที่ยังไม่เคยโชว์ (3) ปรัชญา: **Step คือกระดูกสันหลัง FAQ/OBJ คือทางแยกชั่วคราวที่ต้องกลับบ้านเสมอ**
> 🔴 เคาะ Option A: FAQ interception ยังเป็น keyword ฝั่งโค้ด (D-42 เจตนา) · **กติกา keyword ชีต = "วลี ไม่ใช่คำโดดสามัญ"** (ชีตจริงล้างแล้ว: FAQ ชำระเงินไม่มี "โอน" โดด · สุขภาพใช้ "กินยา,ทานยา" ไม่ใช่ "ยา" · FAQ ราคา/โปร → draft) · prompt แก้ฝั่ง AI (stage/handoff)

**D-45a — systemInstruction: บล็อก "ลำดับความคิดประจำเทิร์น":**
- แทรกหลัง `<บทบาท>`: ①อ่านสถานะ (อยู่ประตูไหน มี/ขาดอะไร) ②จำแนกข้อความ — ประโยคเดียวเป็นได้หลายอย่างพร้อมกัน (ตัวอย่างบังคับ: "น้ำพริกปลาทูขนาดกี่กรัมครับ" = สนใจสินค้า→S2 + ถาม FAQ ขนาด) ③**FAQ/objection = ผู้สมัคร ไม่ใช่คำสั่ง** — เอ่ยชื่อสินค้า/ตอบคำถามที่บอทเพิ่งถาม ≠ ถาม FAQ · ก้ำกึ่ง=เลือกตาม step ④จบเทิร์นพากลับประตู+ทวงข้อมูลขาด
- ขนาด: 4,898→5,664 chars ≈ 2,153→**~2,490 tokens (est)** — บล็อก ~337 (เกินไกด์ 150 เพราะตัวอย่างบังคับ+ปรัชญา ④) แต่**ต่ำกว่างบรวม ~2,700** ✅ · Edit เท่านั้น (KI-03) · prompt-lint ผ่าน
**harness (a):** 325 passed | 3 expected-fail · tsc+build เขียว (ผล AI-behavior วัดจริงที่ golden 29 ใน D-45d)

**D-45b — ธงต่อ step (โค้ดตัดสิน ไม่ใช่ AI):**
- **schema (อนุมัติแล้ว):** `customers.delivered_steps TEXT[] NOT NULL DEFAULT '{}'` (additive) · db: `addDeliveredStep` (กันซ้ำในตัว) · `clearDeliveredStepsExceptCurrent` (คง stage ปัจจุบัน) · `/reset` ล้างหมด · `CustomerState.deliveredSteps`
- **delivery กลับบ้าน 2 แบบ (route):** step ยังไม่เคยส่งเนื้อหา → เต็มก้อน (คำตอบ+ปิดท้าย) · เคยส่งแล้ว → เฉพาะปิดท้าย — ใช้ทั้ง 3 path: step ตรง / ต่อท้าย FAQ / ต่อท้าย OBJ (mode เปิด/เต็มว่าง → ปิดท้าย = D-42 เดิม) · เคยส่ง+ปิดท้ายว่าง → fallback AI (safety net D-39 มี guard ครบ)
- **ตั้งธงเมื่อ deliver สำเร็จจริง:** `deliverReply` คืน boolean · ยกเลิกธงเมื่อข้อความจริงถูกแทน (transfer-block/claims-block/price-block/var-guard all-dropped) · memory off → ไม่มีธง = พฤติกรรมเดิม
- **hook ล้างธง "ออเดอร์ปิดจบ" (เคาะแล้ว):** จังหวะ cron แจกเลขออเดอร์ (จุดเดิม ไม่ประดิษฐ์ event) → `clearDeliveredStepsExceptCurrent(order.lineUserId)` — ลูกค้ากลับมาซื้อรอบสองเห็นเนื้อหา S2/โปรอีก · `OrderRow` +`lineUserId` (คอลัมน์ R · header-driven) · 🔴 comment ในโค้ด: v1 hook · เฟสหลังการขาย (Follow CRM) ย้าย/เพิ่มจุดล้างตามสัญญาณได้รับของ
- 🔴 พฤติกรรม D-42 เปลี่ยน (ตั้งใจ): FAQ/OBJ ครั้งแรกของ step → ต่อ**เต็มก้อน** (เดิมต่อแค่ปิดท้าย) — แก้อาการ "ถามเลือกโปรทั้งที่ยังไม่เคยโชว์ตาราง"
**harness (b):** step 2 เทิร์น (เต็ม→ปิดท้าย+ธงใน DB) · FAQ กลับบ้าน (เต็มครั้งแรก/ปิดท้ายครั้งสอง = G27 scripted) · เคยส่ง+ปิดท้ายว่าง→AI · hook clear+/reset · **329 passed | 3 expected-fail** · tsc+build เขียว

**D-45c — ตัวแปร `{ชวนเลือกโปร}` (composed · spec อนุมัติแล้ว):**
- `buildPromoInviteVar` (pricing.ts): ตัวเลือกแรก = contextQty (จำนวนล่าสุดใน `pending.items` · ไม่มี → 1) · ตัวเลือกสอง = `nextTier` จาก calculatePrice — "รับ 1 ถ้วย รวมค่าส่ง 125 บาท หรือโปร 3 ถ้วย 275 บาท ส่งฟรี ดีคะ" · ถึงชั้นสูงสุด (ไม่มี nextTier) → ประโยคตัวเลือกเดียว "…เลยนะคะ"
- 🔴 **เลขทุกตัวจาก calculatePrice เท่านั้น** (เลขเดียวกับที่ gate บันทึก) · อยู่ใน allowed อยู่แล้ว (ตาราง enumerate) → ผ่าน price guard · **คำนวณไม่ได้ (error/เกินเพดาน/live≠1) → คืน "" → คงวงเล็บ → var-guard ทิ้งบอลลูน (ไม่มั่วเลข)**
- เสียบใน `resolveAllVars` ก่อน CSV_Vars · `KNOWN_RUNTIME_VARS` +`{ชวนเลือกโปร}` · ไม่เพิ่มช่องชีต (เจ้าของใส่ token ใน ตัวอย่างคำตอบ S2 เอง)
**harness (c):** unit 6 เคส (qty 1/5/10/เกินเพดาน/price-guard/KNOWN) + pipeline (step pattern มี token → ประโยคเต็ม) · **336 passed | 3 expected-fail** · tsc+build เขียว

**D-45d — golden 25→29 (+G26-G29):**
- CSV +4 แถว · **CSV describe** (runSalesTurn) assert การจำแนก AI — stateFor +2 สถานะ ("คุยอยู่ S2 (ส่งเนื้อหาแล้ว)" · "กำลังเลือกวิธีจ่าย") · FAQ fixture +แถว mirror ชีตล้างแล้ว (ชำระเงิน=วลี · สุขภาพ="กินยา,ทานยา" · เก็บรักษา)
- **pipeline describe ใหม่** (sendText + real-Gemini bypass setup.ts:142 · gate เดียวกัน) assert "ข้อความที่ลูกค้าเห็นจริง": G26 FAQ answer+เต็มก้อน S2+ธงตั้ง · G27 ไม่ resend ตารางโปร (ธง D-45b) · G28 "โอนครับ" ไม่จุด FAQ ชำระเงิน+เข้า S3_TRANSFER · G29 "ยานนาวา" ไม่จุด FAQ สุขภาพ/ไม่ handoff
- **scripts/sheet-lint.mjs** (ใหม่ · read-only): lint keyword ชีตจริง — คำโดดสามัญ/นับ "ตัวฐานไทย" ≤2 (baseLen ตัดสระ/วรรณยุกต์ · "ท้อง"→ทอง=3) ใน CSV_FAQ (แถว handoff อนุโลม+แจ้ง) + รายงานคำสั้นใน `คำ_handoff`
  - 🔴 **แก้ env loading (บั๊กจริง):** เดิม parse `.env.local`/`.env` เอง แต่ GSA อยู่ `.env.test` → เปลี่ยนใช้ **Vite `loadEnv(mode, cwd, "")`** (ตัวเดียวกับ vitest.config · merge `.env`/`.env.local`/`.env.[mode]`/`.env.[mode].local` · จัดการ quote/multiline) · shell env ชนะไฟล์ · exit code แยก: 1=missing env · 2=private_key ยัง dummy
  - รัน: `node scripts/sheet-lint.mjs` (creds จาก `.env.test`) หรือ `SHEET_BOTLIB_ID=<id> node scripts/sheet-lint.mjs` · 🔴 **.env.test ใน repo เป็น dummy** → เจ้าของใส่ GOOGLE_SERVICE_ACCOUNT จริงใน shell/.env.test ก่อนรัน
- 🔴 **golden 33 จริง + sheet lint รันจากเครื่องนี้ไม่ได้:** `.env.test` เป็น dummy ทั้งคู่ (GEMINI_API_KEY → API_KEY_INVALID ทุก call · GOOGLE_SERVICE_ACCOUNT.private_key="dummy") — ของจริงอยู่ฝั่งเจ้าของ → **เจ้าของรัน 2 คำสั่ง:** `HARNESS_REAL_GEMINI=1 npx vitest run golden-routing` (เกณฑ์: ≥24/25 เดิม + 4 ใหม่) · `node scripts/sheet-lint.mjs`
**harness (d):** scripted = 33 skipped ไม่ block npm test ✅ · **336 passed | 3 expected-fail | 34 skipped** · tsc+build เขียว

### D-46 · แก้ลูปวนขอที่อยู่ = Gemini บล็อก PROHIBITED_CONTENT ไม่เข้า degraded (2 ชั้น)
**วินิจฉัย (จาก log จริง 06:44–06:45 UTC · blockReason PROHIBITED_CONTENT 3 เทิร์นติด · candidatesLen 0):**
- ลูกค้ามี pending โอน (history มีเลขบัญชี/ธนาคาร) → พิมพ์ "เปลี่ยน COD + ชื่อ/ที่อยู่/เบอร์" ก้อนเดียว → prompt รวม **เลขบัญชี + PII ครบชุด** → classifier ตี false-positive ฉ้อโกง/เก็บข้อมูลการเงิน · ที่อยู่เดียวกัน 06:41 ไม่มี combo นี้ → ผ่าน (probabilistic ไม่ deterministic)
- **ชั้น 1 root:** `gemini.ts` ไม่ตั้ง `safetySettings` เลย → ใช้ default (บล็อกกลางขึ้นไป)
- **ชั้น 2 root (สำคัญกว่า):** gemini คืน `degraded:true` ถูกแล้ว แต่ **route จัดการ degraded เฉพาะเทิร์นมีรูป** (`imageFallback = imageContent && degraded`) · เทิร์นข้อความล้วน degraded → ไหลลง verbatim path ปกติ (stage=currentStage · orderData={}) → `resendClosingOnly` (D-45b) → resend "ขอที่อยู่" ซ้ำ = ลูป · ลูกค้าส่งข้อมูลมาแล้วโดนถามซ้ำ
**ทำ (เคาะแล้ว):**
- **ชั้น 1 — `SAFETY_SETTINGS` = `OFF` ทั้ง 5 หมวดปรับได้** (HARASSMENT/HATE_SPEECH/SEXUALLY_EXPLICIT/DANGEROUS_CONTENT/CIVIC_INTEGRITY · `HarmBlockThreshold.OFF`) — บอทรับออเดอร์ PII เป็นเนื้องาน · availability มาก่อน · หมวดพวกนี้มีตาข่ายเราเอง (H4 handoff + verbatim = AI ไม่มีปากแต่งคำเสี่ยง) · 🔴 **PROHIBITED_CONTENT เป็น core policy ปรับไม่ได้ → ยังบล็อกได้เสมอ = ชั้น 2 คือหลักประกันจริง**
- **ชั้น 2 — route: branch `else if (geminiOutput.degraded)`** (หลัง imageFallback ก่อน objection) → `DEGRADED_NO_INPUT_REPLY` = "ขออภัยค่ะ ระบบสะดุด...ยังไม่ได้รับข้อความล่าสุด...รบกวนพิมพ์ส่งมาอีกครั้ง 🙏" (const · ไม่เพิ่ม config key · ต่างจาก DEFAULT_REPLY "รอสักครู่แล้วทักใหม่" ที่ทำให้ลูกค้านั่งรอเฉยๆ) · `deliverMarksStep=false` · ครอบ blocked/timeout/parse-fail/MAX_TOKENS · degraded+รูป = imageReceivedReply เดิม (ถือสลิป)
**harness:** degraded+step เคยส่ง→ข้อความขัดข้อง ไม่ resend ปิดท้าย · degraded+step ยังไม่ส่ง→ข้อความขัดข้อง ไม่ใช่เต็มก้อน (กัน branch เสียบผิด) · degraded→gate ไม่เขียน (orderData ว่าง) · **339 passed | 3 expected-fail** · tsc+build เขียว

### D-47 · ถอดชนวน PROHIBITED_CONTENT บนเส้นทางเงิน (4 ชิ้น · 1 commit)
**แก้ข้อเท็จจริงจาก D-46:** log จริง 07:49 เคส "โอนเงิน" ถูกบล็อก 2 ครั้ง **โดย history ไม่มีเลขบัญชีเลย** (หลัง /reset · 156 chars) → ตัวกระตุ้นคือ **static prompt (system/ตารางราคา/step ที่มีคำการเงิน) + ข้อความสั้น "โอนเงิน"** ก็พอ · degraded path (D-46) ทำงานถูก แต่ยัง loop เพราะเทิร์นเลือกจ่ายเสี่ยงบล็อกสูงโดยธรรมชาติ
**ทำ (เรียงตามผลกระทบ):**
- **ชิ้น 1 (พระเอก) — payment pre-check ฝั่งโค้ด** (`inject.ts`: `detectPaymentChoice`/`isPaymentChoiceOnly`/`resolvePaymentStep` · หลักเดียวกับ keyword handoff pre-check): มี items ใน pending + ยังไม่มีวิธีจ่าย + ไม่มีรูป → จับ โอน/COD · **คำจ่ายล้วน → ข้าม AI ทั้งเทิร์น** (สร้าง synthetic output · stage = ประตูจาก "เข้าเมื่อ" data-driven) · **พ่วงอื่น/AI degraded → ล็อก payment ทับผล AI** (deterministic เส้นทางเงิน) · ก้ำกึ่ง/ไม่มี items → AI ปกติ
- **ชิ้น 3 (สำคัญ) — auto-retry 1 ครั้ง** (`gemini.ts`): no-text (blocked) ครั้งแรก → retry 1 (บล็อก probabilistic) · MAX_TOKENS/parse-fail ไม่ retry · งบรวมคุมด้วย withTimeout 8s ที่ route (เกิน → degraded D-46)
- **ชิ้น 2 (ลดความเสี่ยงสะสม · ไม่ใช่ตัวแก้เคสนี้) — redact** (`redactFinancial`): เลขบัญชี/พร้อมเพย์ (config) + เบอร์ (pending/last_order · ค่าที่รู้จริง) → `[เลขบัญชี]`/`[เบอร์]` ใน **history + state ที่ส่งเข้าโมเดลเท่านั้น** · 🔴 ข้อความสด `userMessage` ไม่แตะ (AI ต้องสกัดเบอร์/ที่อยู่เทิร์นนี้) · DB/ลูกค้า ไม่แตะ · state คงเบอร์ (redact แค่บัญชี) ให้ AI รู้ว่าเก็บแล้ว
- **ชิ้น 4 (วัดก่อนแก้) — log pattern**: ทุกครั้ง blocked → log `historyLen` + `msgLen` + `msgHead(16)` + `msgHasDigit` + `hasImage` (ตัดทอน กัน PII) — สะสมหลักฐานว่าเทิร์นแบบไหนโดนบ่อย · ถ้า post-deploy ยังโดนถี่นอก pre-check ค่อยพิจารณาท่าใหญ่ (แยก call จำแนก/สกัด) — ยังไม่ทำ
**harness:** unit (detect/only/resolvePaymentStep/redact) + retry (blocked→retry ผ่าน · blocked×2→degraded ไม่วนเกิน) + pipeline (โอนค่ะ+มี items→S3_TRANSFER ข้าม AI แม้ degraded · พ่วงที่อยู่→ล็อก payment ทับ · ไม่มี items→AI ปกติ) · **348 passed | 3 expected-fail** · tsc+build เขียว

### D-48 · extraction fallback — บันไดใหม่เมื่อ blocked (แทน retry เดิม · 1 commit)
**หลักฐานครบ (D-47 ชิ้น 4):** log 08:45–08:46 · combo "เปลี่ยนเป็น COD + ชื่อ/ที่อยู่/เบอร์" ถูกบล็อก **7/7** (attempt 0+1 ×2 รอบ) = **deterministic** · retry ด้วย prompt เดิมไร้ผลกับ combo นี้ (เหตุเดิมยังอยู่ = static prompt + ข้อความหนักการเงิน)
**ตอบ 2 ข้อจาก log:**
- **(1) redactFinancial:** logic ถูก แต่เดิมไม่มี log ยืนยัน → เพิ่ม `scope:"redact"` นับ `history`/`state` count ต่อเทิร์น (ยืนยัน input โมเดลเป็น `[เลขบัญชี]`/`[เบอร์]` จริง) · `redactFinancial` คืน `{text,count}` แล้ว
- **(2) 🔴 บั๊กจริง — payment lock ไม่ยิงเคสเปลี่ยน:** เดิม `prePayment` มีเงื่อนไข `noPaymentYet` → เคส "เปลี่ยน COD" (ลูกค้ามี payment=โอน อยู่แล้ว) detect ไม่ได้ → gate คงค่าเก่า "โอน" · **แก้: ตัด `noPaymentYet`** → detect ทุกเทิร์น ครอบเคสเปลี่ยน (lock/skip-AI ยิงได้)
**งานหลัก — extraction call (แทน retry):**
- call หลัก blocked → `runExtraction()` (`gemini.ts`): systemInstruction สั้นเฉพาะกิจ "สกัด ชื่อ/ที่อยู่/เบอร์/payment/items เป็น JSON" · user = ข้อความลูกค้าล้วน · **ไม่มี prompt ขาย/ตารางราคา/สารบัญ step/catalog/history** = ตัดกลิ่นเงินเกือบหมด → ผ่าน classifier
- ผล → `order_data`/`payment` ป้อน gate ตามปกติ · `stage = currentStage` (route คุมประตู) · `degraded=false` → ลูกค้าได้ flow ต่อ (ส่ง pattern ประตูปัจจุบัน · ไม่รู้ว่ามีดราม่า)
- extraction ก็ blocked → `fallback` (degraded · **ตาข่าย D-46 = last resort**) · งบเวลา: อยู่ใน withTimeout 8s เดิม (**แทน** retry ไม่ใช่ซ้อนชั้น)
- **ข้อจำกัด:** extraction ตั้ง `orderEditRequest=false` — เคสแก้ออเดอร์ที่**เขียนชีตแล้ว** (last_order) จะไม่ทริก edit-path ผ่านบันไดนี้ (แต่เคส pending merge ทำงานปกติ) · เฝ้าดู log `scope:"extraction"` post-deploy
**harness:** extraction (หลัก blocked→extraction ผ่าน order_data/payment เข้า gate · blocked ทั้งคู่→degraded) + fix(2) pipeline (มี payment=โอน + เปลี่ยน COD → lock ทับ) + redact count · **349 passed | 3 expected-fail** · tsc+build เขียว

### D-49 · ปิดช่องว่างปาก-มือไม่ตรงกัน (ออเดอร์เขียนสำเร็จแต่ลูกค้าไม่ได้ทวน · 1 commit)
**รากร่วม (ลำดับใน route เทิร์นเดียว):** merge pending (730) → เลือก baseReply จาก `geminiOutput.stage` + resolve `{ออเดอร์_*}` จาก `varCtx.lastOrder` (749-795) → **เขียนออเดอร์ + `setLastOrder` (946)** · เขียนเกิด**หลัง**เลือกข้อความ+resolve เสมอ = ต้นตอทั้ง 3 อาการ
**ตอบ log 09:27-09:29:**
- **(1) redactFinancial:** ทำงานถูก — เพิ่ม `scope:"redact"` count แล้ว (D-48) เห็นต่อเทิร์น
- **(2) 🔴 บั๊ก payment lock:** เดิม `noPaymentYet` กันเคสเปลี่ยนวิธีจ่าย — **แก้แล้ว D-48** (ตัด noPaymentYet) · gate log ที่โชว์ "โอน" = ก่อน D-48
- **(3) FAQ ชนะทั้งที่ข้อมูลครบ:** ใช่ — `buildFaqInjection(userMessage)` แมตช์ keyword ฝั่งโค้ด อิสระจาก AI → เด้ง FAQ แม้ gate complete → **แก้: gate-complete ชนะ FAQ/OBJ**
**3 การแก้ (deterministic จากผล gate · ไม่เดา):**
- **#1 stage override** (`resolveRecoveredStage` inject): เทิร์น `geminiOutput.recovered` (extraction · D-48 เพิ่มธง) → เลือกประตูปลายทางจาก post-merge gate — `complete → funnel_stage="won"` (ปิด/ทวน) · `เลือกจ่ายแล้วยังไม่ครบ → ประตูวิธีจ่าย (โอน=รอสลิป · COD)` · AI ปกติไม่แตะ (เลือกประตูเองอยู่แล้ว)
- **#3 complete ชนะ FAQ/OBJ:** เพิ่ม `!orderCompleteThisTurn` ที่ guard objection/FAQ → เทิร์นที่ **complete จริง** (postGate.complete ไม่ใช่แค่มี pending) บังคับ step path (ประตูปิด) + log `order-complete-overrides-faq-obj`
- **#2 snapshot ทวนสด (ทาง A · เคาะแล้ว):** บนเทิร์นเขียน `lastOrder` ยัง stale → สร้าง `synthLastOrder` จาก **pending + price ที่จะเขียนจริง** (ค่าจาก gate/pricing เท่านั้น · ไม่ประกอบเลขใหม่) ใส่ `varCtx` เฉพาะเมื่อ **`!lastOrder && complete`** (purely additive · ไม่ทับ edit-flow) · 🔴 `order_id=""` (cron ยังไม่แจกเลข) → `{ออเดอร์_เลขที่}` resolve ไม่ได้ → **var-guard ทิ้งบอลลูนนั้น** (ห้าม mock เลขปลอม) · `resolveOrderVars` แก้ให้ **ค่าว่าง = คง token** (เดิม replace เป็น "") เพื่อให้กลไก guard ทำงาน
**🔴 เงื่อนไข 2 (รอเจ้าของ):** CC อ่านชีตจริงไม่ได้ (creds dummy) — **เจ้าของเช็ค pattern ประตู funnel_stage="won" (S4B):** ถ้ามี `{ออเดอร์_เลขที่}` ในบอลลูนทวนสด → บอลลูนนั้นจะ**ตกทุกครั้ง**บนเทิร์นเขียน (เลขจริงมาตอน cron แจก) · ถ้าอยากให้ทวนสดโชว์เลข ต้องแยกบอลลูน/ให้ cron ยิงเลขทีหลัง — หรือเอา `{ออเดอร์_เลขที่}` ออกจากประตูทวนสด
**harness:** recovered+COD ครบ+lastOrder null → override→won · ทวน snapshot ครบ (ชื่อ/ที่อยู่/เบอร์/รายการ/ยอด) · บอลลูน `{ออเดอร์_เลขที่}` ตก · ออเดอร์เขียนจริง 1 แถว · **350 passed | 3 expected-fail** · tsc+build เขียว

### T-STUDIO (/train) · ปิดซีรีส์ ก-ง ครบ ✅ (2026-07-24) — ห้องซ้อมเทรนปลาทู
> spec = [docs/T1-PATTERN-STUDIO-SPEC.md](T1-PATTERN-STUDIO-SPEC.md) · หลักเหล็ก: **reuse engine production ตรงๆ ทุกจุด · ห้าม duplicate logic · sandbox ไม่มี side effect ถึง prod**
- **เฟส ก · Simulator** (commit `9c356a1`): แชทจำลองรัน pipeline จริง (Gemini จริง) ใน ALS sandbox · guard ที่ leaf I/O (LINE/Blob/ชีต Orders→collector · Neon→branch `train`) · เช็ค ALS เท่านั้น (ไม่มี context = prod เดิม) · X-ray + cron จำลอง (เรียก handler จริง) · แยก `route.ts`→`handler.ts` เชิงกลไก (Next ห้าม route.ts export เกิน HTTP handler)
- **เฟส ข · แตะบอลลูนเพื่อแก้** (commit `cb840dd`): draft overlay ทับที่ `batchGet` proxy (`loader.ts` bypass cache ใน sandbox · guarded no-op กัน draft รั่ว prod) · provenance จาก verbatim log + re-run matcher · dropped bubble จาก var-guard log (ขีดฆ่า ไม่หายเงียบ) · preview+lint สด (reuse `findBannedClaims`/`findBadPrices`/`KNOWN_RUNTIME_VARS`)
- **เฟส ค · เขียนกลับ + copy** (commit `3475235`): `writeCell` หา row/col จาก key+header→A1 สด (`values.batchUpdate` · ไม่จำ index) · conflict check (ค่าจริง≠expectedOld=409) · **hard guard: เขียนเฉพาะ BotLibrary · ปฏิเสธ Orders** · lint gate ฝั่ง server (422) + ปุ่มดับฝั่ง UI · TRAIN_LOG จด · reset cache หลังเขียน
- **เฟส ง · mobile polish** (commit `ff5632f` · CSS/layout ล้วน): แชทเต็มจอ · bottom sheet (backdrop/drag-to-close/dvh+safe-area กันคีย์บอร์ดบัง) · ปุ่ม/ฟอนต์นิ้วโป้ง · **bug fix เฟส ค:** เปิด editor → fetch ข้อความดิบสดจากชีต (mode:diff) แทนค่าที่ติดมากับเทิร์นเก่า (กัน stale หลังเขียน) + badge "ชีตถูกแก้แล้วหลังเทิร์นนี้"
- **hotfix มือถือ (commit นี้):** กดบอลลูนบนมือถือ → "Application error" ทั้งหน้า · **รากจริง (ไม่ใช่ touch/clipboard/hydration): TDZ ReferenceError** — `const tb` (สไตล์ปุ่มมือถือ · เพิ่มเฟส ง) ประกาศ**หลัง** `const sidePanel = editorOpen ? renderEditor() : ...` ที่เรียก `renderEditor()` ซึ่งอ้าง `tb` → เปิด editor = อ่าน `tb` ใน TDZ → ล้มทั้ง tree · **แก้:** ย้าย `tb` ขึ้นก่อนถูกอ้าง · + **`EditorBoundary`** ครอบเฉพาะแผง editor/bottom-sheet (render ผ่าน `EditorRenderer` = child ของ boundary → error ตอน render ถูกจับ) → พังในอนาคต = เด้งเฉพาะแผง หน้าแชทอยู่ครบ · + guard touch `e.touches[0]` · เทส boundary (fallback มีข้อความ+ปุ่มปิด · children ไม่ render ตอน error · ปกติ children ผ่าน) ผ่าน renderToStaticMarkup (ไม่มี jsdom)
- **migration (เงื่อนไข ข):** อัตโนมัติต่อ connection (`ensureSchema` ธง ready per-connection) → train branch ไม่ drift
- **harness:** fidelity (webhook vs simulator ตรงเป๊ะ) · เทสรั่ว (LINE/ชีต/Blob=0) · overlay/provenance/dropped/lint/write-cell/conflict/Orders-block/diff-fresh · **374 passed | 3 expected-fail** · build เขียว (route /train/* ครบ)
- **รอเจ้าของ:** ENV `DATABASE_URL_TRAIN` (Neon branch `train`) เข้า Vercel → เปิด /train · (option) วาง `public/train-slip-sample.jpg` · viewport ~380px ตรวจบนอุปกรณ์จริง (repo ไม่มี browser-render harness)

### T-STUDIO เฟส ก · Simulator ห้องซ้อมเทรน (/train) — sandbox ผลตรง production 100% (รายละเอียดเดิม)
**เคาะแล้ว (2026-07-23):** (1) DB = Neon branch `train` + ENV `DATABASE_URL_TRAIN` (2) จุดเข้า = `processMessage` ตรง (ข้าม debounce — จดใน spec) (3) X-ray = console tee + state จาก train DB (4) cron จำลอง = เรียก handler cron จริงใน sandbox · **เงื่อนไข ก:** guard ทุกตัวเช็ค "ALS มีค่า" เท่านั้น ห้ามอิง ENV/flag อื่น ✅ ทำตามทุก guard
**เงื่อนไข ข (ตอบ): migration = อัตโนมัติ** — `ensureSchema` (CREATE/ADD COLUMN IF NOT EXISTS) ถูกเรียกจากทุกฟังก์ชัน db และรันกับ "DB ที่กำลังต่อ" · จุดเดียวที่ต้องแก้คือธง `schemaReady` เดิมเป็น flag เดียวต่อ process → แยกเป็น per-connection แล้ว → train branch migrate ตัวเองครั้งแรกที่แตะ **ไม่ drift · ไม่ต้องเพิ่มกติกาใน CLAUDE.md**
**สถาปัตยกรรม:** ALS sandbox context (`lib/train/sandbox.ts`) + guard ที่ leaf I/O — pipeline วิ่งโค้ด production เส้นเดิมทุกบรรทัด · LINE (6 ฟังก์ชัน+download กันเผื่อ) → collector · Blob (2) → pathname จำลอง · ชีต Orders → fake grid ใน context (proxy `wrapSheetsForSandbox` เบี่ยงเฉพาะ spreadsheetId ของ Orders · **header แถว 1 + BotLibrary ผ่านของจริง read-only กัน cache คอลัมน์เพี้ยนข้ามโหมด**) · Neon → `DATABASE_URL_TRAIN` ที่ `getSql()` จุดเดียว · Gemini = จริง (ตั้งใจ) · grid persist ต่อ session ในตาราง `train_sessions` (สร้างทั้ง 2 DB — schema เหมือนกัน กัน drift)
**เกินแผนที่เคาะ 1 จุด (จำเป็น):** Next.js ห้าม `route.ts` export อะไรนอกจาก HTTP handler/config → `export processMessage` ทำ build พัง · แก้โดย**แยกไฟล์เชิงกลไก**: เนื้อทั้งหมดย้าย `app/api/line-webhook/handler.ts` (ไม่แก้สักบรรทัด · diff = ตัดวาง + ปรับ import 3 บรรทัด) · route.ts เหลือ POST บาง · เทสเดิมผ่านครบ = พิสูจน์ไม่มี regression
**harness:** fidelity (เทิร์นเดียวกันผ่าน webhook vs simulator → บอลลูน+stage+pending+ธง ตรงเป๊ะ) · เทสรั่ว (COD ครบเทิร์นเดียว → LINE=0 · ชีต append/batchUpdate=0 · แถว "จะเขียน"+ข้อความกลุ่มอยู่ใน collector · gate complete จริง ยอด 275 จาก pricing) · blob guard (importActual ข้าม mock) · cron จำลอง (แจกเลข+ล้างธง D-45b ผ่านโค้ด cron จริง เมื่อ R มีค่า) · reset · auth (404 เมื่อ ENV ปิด/401/cookie) · **356 passed | 3 expected-fail** · build เขียว (/train ขึ้นครบ)
**🔴 gap พบระหว่าง audit (ยังไม่แก้ — รอเจ้าของยืนยัน):** `appendOrderRow` **ไม่เขียน `line_user_id` (คอลัมน์ R)** แต่ cron ใช้ R ล้างธง delivered_steps (`if (order.lineUserId)`) → ถ้าชีตจริงไม่มีสูตรเติม R เอง = **ธงไม่เคยถูกล้างผ่าน cron บน prod** (harness D-45b เทสฟังก์ชันตรง ไม่ได้เทส join ผ่านชีต) · เทสจริง 2026-07-23 ที่ "ซื้อซ้ำผ่าน" — ขอเจ้าของยืนยันว่า R ในชีตจริงถูกเติมด้วยอะไร (สูตร ARRAYFORMULA? กรอกมือ?) · ถ้าไม่มี → fix 1 บรรทัด (ส่ง userId เข้า appendOrderRow) เป็น commit แยก **ห้ามแก้เองก่อนยืนยัน เพราะถ้า R เป็นคอลัมน์สูตร การเขียนทับจะพังสูตร**

### D-51 · ทักทายรายวัน (delivery ล้วน · ไม่แตะ AI/prompt/engine · 1 commit)
เทิร์นแรกของลูกค้าใน**แต่ละวัน (เวลาไทย D-37)** → เติม prefix หน้าบอลลูนข้อความแรก (กลืนในบอลลูนเดิม · ไม่เพิ่มบอลลูน · ไม่ชน cap 5)
- **ตัดสิน (`lib/greeting.ts` `isFirstMessageOfDay`):** ไม่มีประวัติ (`historyLen===0` = ลูกค้าใหม่/หลัง `/reset` ที่ล้าง messages) **หรือ** `bangkokYMD(customer.lastSeen) !== bangkokYMD(now)` (กิจกรรมล่าสุดคนละวันไทย) · `customer.lastSeen` = เวลาก่อนอัปเดต (ensureCustomer คืนค่าเก่า)
- **เติม (`prependToFirstTextBubble`):** หา text chunk แรก (ข้าม `[[รูป:...]]`/ตัวคั่นบอลลูน) แล้วแทรก prefix ก่อนอักขระจริง · **บอลลูนแรกเป็นรูป → เติมที่ข้อความถัดไป** · ทั้งหมดเป็นรูป → ไม่เติม · ทำที่ `handler.ts` ก่อน `assistantSaved`/`deliverReply` (หลัง guard ทุกตัว)
- **ข้อความ:** CSV_Config key ใหม่ **"ทักทายรายวัน"** · ไม่มี key = ค่าเริ่ม `"สวัสดีค่ะ "` (มี space ท้าย · ไม่มีอีโมจิ) · ค่าว่าง `""` = **ปิดฟีเจอร์**
- **ยกเว้นไม่ทัก:** `isHandoffTurn` (H4/ลูกค้าไม่พอใจ — **รวม handoff อื่นๆ ด้วย = ทิศปลอดภัย**: H4 แยกสัญญาณเดี่ยวไม่ได้ชัด · greeting บนเทิร์น handoff = ผิดโทน) · `geminiOutput.degraded` (ระบบสะดุด) · `imageFallback`
- **ห้องซ้อม (T-STUDIO):** `/reset` = ลูกค้าใหม่ (messages ล้าง) → ทักทันที — ใช้เทสฟีเจอร์ได้เลย
- **harness:** ปิด greeting เป็นดีฟอลต์ (`testConfig`/`cfg()` ใส่ `"ทักทายรายวัน"=""`) กันเทสอื่นโดน prefix · เทส D-51 เปิดเอง
- **เทส:** unit (isFirstMessageOfDay ข้ามเที่ยงคืนไทยแม้ UTC วันเดียว · prependToFirstTextBubble รูป/หลายบอลลูน/space) + pipeline (ลูกค้าใหม่ key-absent→ค่าเริ่ม · เทิร์นสองไม่ทัก · reset→ทักใหม่ · handoff/degraded ไม่ทัก · ""=ปิด · custom) · **396 passed | 3 expected-fail** · build เขียว
- 🔴 **เจ้าของ:** วางข้อความในแท็บ CSV_Config ชีต key `ทักทายรายวัน` (ค่าเริ่ม `สวัสดีค่ะ ` · เว้นว่าง=ปิด) — โน้ตในแท็บวิธีใช้: "เติมหน้าคำตอบแรกของลูกค้าในแต่ละวัน · ใส่ space ท้ายให้กลืนกับข้อความ"

### D-50 · แจ้งเลขพัสดุ (ก้อน B เฟสหลังการขาย ส่วนแรก · 1 commit)
ทีมแพ็คกรอกเลข Tracking (P) → cron รอบถัดไป push แจ้งลูกค้า (ขนส่ง+เลขพัสดุ+ของถึง 2-3 วัน)
**เคาะแล้ว (2026-07-24):**
- **ทริกเกอร์ = P (Tracking) ไม่ว่าง** (การกรอกเลข = การส่ง · จังหวะเดียว) + แจกเลขแล้ว(O=TRUE) + !cancelled · 🔴 **ไม่ใช้ "ติ๊ก O"** เพราะ O ถูก cron แจกเลขติ๊กเองอยู่แล้ว (= แจกเลข ไม่ใช่ ส่งของ) · P ว่าง = ยังไม่ส่ง โดยนิยาม → ข้ามเงียบ (ไม่ warn)
- **dedup = Neon `shipping_notified(order_id)`** (แบบ D-29 · `markShippingNotified` atomic claim `INSERT ON CONFLICT DO NOTHING RETURNING`) — เคลมก่อน push กัน cron รันซ้อน
- **template = CSV_Config key `ข้อความแจ้งพัสดุ`** + `{ขนส่ง}{เลขพัสดุ}` · ไม่มี key = ค่าเริ่ม (`lib/shipping.ts DEFAULT_SHIPPING_TEMPLATE`) · ค่าว่าง = ปิดฟีเจอร์ · carrier = Config `ขนส่ง_เริ่มต้น` (default `Shopee Express`) · **per-order carrier = เฟสหน้า** (ยังไม่มีคอลัมน์ขนส่ง)
**flow (`cron/orders/route.ts notifyShipping` · หลัง loop แจกเลข):** `listOrdersToNotifyShipping` (O+P+!cancel) → ต่อแถว: เคลม `markShippingNotified` → R ว่าง (แถวเก่าก่อน KI-06)/no order_id = ข้าม(+เคลมกันวน log) → `getCustomer(R)`: human_mode/บอทปิด → **แจ้งกลุ่มแอดมิน "โปรดแจ้งเอง"** · ปกติ → `formatShippingMessage` + **greeting D-51** (push แรกของวันได้ "สวัสดีค่ะ ") → `pushMessages(userId)` → กลุ่มแอดมินได้ **"แจ้งพัสดุลูกค้าแล้ว ✓ <เลขออเดอร์>"** (ทีมแพ็คเห็นสถานะจากกลุ่ม แทนคอลัมน์สถานะ)
**T-STUDIO:** `runTrainCron(sessionId, {tracking})` — จำลองกรอก P + ติ๊ก M → cron รอบเดียวแจกเลข+แจ้งพัสดุ (push เข้า collector) · UI ปุ่ม "📦 กรอกพัสดุ + cron" + ช่องเลขพัสดุจำลอง
**ไม่แตะ:** cron แจกเลข/idempotency D-29/O semantics เดิม (เพิ่ม loop ต่อท้าย) · **harness:** cron (push+ขนส่ง+เลข · idempotent ไม่ซ้ำ · P ว่าง/R ว่าง ข้าม · human_mode→แอดมิน · greeting · ""=ปิด) + train sim + formatShippingMessage · **405 passed | 3 expected-fail** · build เขียว
**จบเคส CRM/Follow (ลูกค้าตอบได้รับ→ถามรีวิว) = ก้อน B ส่วนหลัง · ยังไม่ทำ**

### T2-ก · Dashboard ร้านจริง (อ่านอย่างเดียว · 1 commit) — spec [docs/T2-STUDIO-SPEC.md](T2-STUDIO-SPEC.md)
หน้าเดียวดูสถานะร้านจริง แยกโซนจากห้องซ้อมชัด (แถบแดง "ร้านจริง" · อ่าน PROD Neon นอก sandbox → แยกจาก train DB โดยธรรมชาติ)
- **field จริงที่ใช้ (ยืนยันแล้ว · ตัด 0 เมตริก):** `customers`(created_at/last_seen/human_mode/stage/last_order) · turn count = `count(messages WHERE role='user')` · won+ช่อง+ช่วง = `orders_written`(written_at,user_id · มี timestamp+channel จริง) · ยอด = ชีต Orders (order_id→ยอดเงิน · cache 60วิ) · 🔴 **ไม่เพิ่ม data ใหม่**
- **3 จุดที่เจ้าของสั่งเพิ่ม:** (1) TRAIN: ตัดจากสรุป+ตาราง default (toggle "แสดงห้องซ้อม") — สรุปเป็นของจริงล้วน (2) turn count = aggregate join ครั้งเดียว (กัน N+1) + LIMIT 300 ทุก query (3) หน้าลูกค้า format คนอ่าน (`formatOrderSummary`) · JSON ดิบใน `<details>` collapse
- **สถานะ:** `deriveStatus` 🟢active/🟡stuck(qualified·quoted เงียบ>24ชม=กลุ่มทอง follow)/🔴handoff/✅won/⚪idle · funnel จาก `funnelStageOf(CSV_Step)`
- **แยกโซน UI:** `/train/dashboard` (แดง · nav "🧪 ห้องซ้อม") vs `/train` (เขียว · nav "🔴 ร้านจริง") · auth เดิม (TRAIN_PASSWORD cookie) · mobile-first
- ไฟล์: `lib/train/dashboard.ts`(pure) · `lib/db.ts`(3 read fn · read-only) · `lib/orders.ts orderAmountMap` · `lib/core/time.ts bangkokDayStart` · `app/train/dashboard/*` + `api/dashboard/{route,customer}`
- **harness:** channelOf/deriveStatus/formatOrderSummary/bangkokDayStart · summary แยกช่อง+TRAIN ตัด · returning · turn count aggregate+includeTrain · sales won∩ยอด(ข้ามยกเลิก) · route auth 401+assemble(TRAIN ตัด·won status) · **444 passed** · build เขียว · v1 fidelity เดิมเขียว
- **ไม่ทำในเฟสนี้ (ตามเคาะ):** ปุ่มเปิด/ปิดบอทในหน้าลูกค้า=T2-ข · ลิงก์แถวชีต Orders=T2-ค

### D-55 · T2-ข · สวิตช์เปิด-ปิดบอทใน UI (ต่อยอด D-53 ตรงๆ · 1 commit) — spec [docs/T2-STUDIO-SPEC.md](T2-STUDIO-SPEC.md)
Dashboard คุมบอทได้จริง: สวิตช์รายช่องทาง [LINE]/[FB] + toggle ปิดบอทรายคน — reuse fn เดิมทั้งหมด ไม่มี SQL ใหม่ · สถานะอยู่ Neon ที่เดียว (คำสั่งพิมพ์ในกลุ่มยังทำงานเหมือนเดิม)
- **สถาปัตย์กันโค้ดซ้ำ (หัวใจ):** ข้อความแจ้งกลุ่มเดิมฝังใน handler ผูก `replyToken` — แยก builder pure (`botModeMsg`/`channelSwitchMsg`) + `channelStatusLine`/`listChannelStates` + orchestrator (`applyChannelSwitch`/`applyCustomerBotMode`) ออกมา `lib/train/bot-switch.ts` · **handler เดิม import ตัวเดียวกัน → คำสั่งพิมพ์พฤติกรรมเท่าเดิมเป๊ะ** · Dashboard ใช้ builder เดียวกัน + push ตรง (ไม่มี reply token) ต่อท้าย `(จาก Dashboard)` — คนดูกลุ่มรู้ว่าสั่งจาก UI
- **เขียน:** ช่อง = `setChannelEnabled(key,enabled)` เดิม (D-53) · รายคน = `setHumanMode(userId,close)` เดิม (fn เดียวกับ `เปิด/ปิดบอท <ชื่อ>`) · ชื่อ+returnMinutes ดึงจาก Neon/`getConfig` เดิม
- **route:** `app/train/api/dashboard/switch` (POST · discriminator `target: channel｜customer` · **guardTrainRequest เดิมครอบ** — write PROD Neon นอก sandbox) · main route `/dashboard` +`channels[]` (label+enabled ให้ UI วาดสวิตช์) · graceful เมื่อ `ADMIN_GROUP_ID` ขาด (เขียนสำเร็จ แค่ไม่ push)
- **UI:** แผงสวิตช์ pill (เขียว=เปิด/แดง=ปิด) ใต้ banner · toggle รายคนในแถว (stopPropagation กันเปิด detail) + ปุ่มในหน้ารายละเอียด · ทุกกด = `window.confirm()` ภาษาผลลัพธ์ → เขียน → `load()` refresh ทันที
- **harness:** builder text (ปิด/เปิด · ช่อง/รายคน) · /switch channel เขียนถูก key (`isChannelEnabled` หลังกด) + push กลุ่มมี `(จาก Dashboard)` · key เพี้ยน→400 · customer setHumanMode + push มีชื่อ+suffix · auth 401 · main route คืน channels(line+fb) · **452 passed** · build เขียว · v1 fidelity + คำสั่งพิมพ์เดิมเขียว
- **ไม่ทำในเฟสนี้:** แท็บออเดอร์=T2-ฉ (เพิ่มในลำดับ · อ่านอย่างเดียว ก่อน T2-ค)

### D-56 · T2-ฉ · แท็บออเดอร์ใน dashboard ร้านจริง (อ่านอย่างเดียว · 1 commit) — spec [docs/T2-STUDIO-SPEC.md](T2-STUDIO-SPEC.md)
แท็บ "🧾 ออเดอร์" ข้างแท็บ "👥 ลูกค้า" — เห็นออเดอร์ทั้งหมดจากชีต Orders + สถานะแต่ละขั้น โดยไม่เปิดชีต (ทีมแพ็คเปิดเช้าเห็นคอขวด)
- 🔴 **read-only ล้วน — ไม่เขียนกลับชีต ไม่เพิ่มคอลัมน์** · derive สถานะจากคอลัมน์จริงเท่านั้น · การกระทำจริง (คอนเฟิร์ม/กรอกเลข/ยกเลิก) ยังทำในชีต แท็บนี้เป็น "กระจก"
- **สถานะ pure (`deriveOrderStatus` · precedence สำคัญกว่าสวย):** `cancelled`(N=TRUE · **มาก่อนเสมอ**) > `awaiting_confirm`(ไม่ M) > `awaiting_number`(M·ไม่ O=ส่งออเดอร์แล้ว · รอ cron แจกเลข) > `awaiting_pack`(O·P=เลขTracking ว่าง · งานคน) > `shipped_notified`(P มี · `shipping_notified`) / `shipped_pending_notify`(P มี · ยังไม่ notified · รอ cron)
- **map คอลัมน์จริง:** M=คอนเฟิร์ม · N=ยกเลิก · O=ส่งออเดอร์แล้ว(cron แจกเลข) · P=เลขTracking · R=line_user_id (→ `channelOf` แยก fb/line/train · ป้ายช่อง = `channelLabel` เดิม · **ไม่พึ่ง source_channel** · salepage เผื่ออนาคต)
- **อ่าน:** `lib/orders.ts listOrdersForDashboard` (wrap `readAllOrderRows` เดิม · cache 60วิ mirror `amountCache`) · `lib/db.ts listNotifiedOrderIds(ids)` (read-only `WHERE order_id = ANY(::text[])` · กัน N+1) · route `app/train/api/dashboard/orders` (guard เดิม · TRAIN กรอง default+toggle · sort rowIndex desc = ใหม่สุดก่อน)
- **หัวจอ:** นับทุกสถานะ pending (รอคอนเฟิร์ม/รอแจกเลข/รอแพ็ค/รอแจ้ง) · 2 อันเป็น "งานคน" (`human` flag ใน `ORDER_STATUS_META`) เน้นกรอบแดง
- **harness:** `deriveOrderStatus` **ครบทุก combination** N/M/O/P+notified (6 สถานะ + cancelled precedence) · route: TRAIN กรอง default/toggle · สถานะถูกทุกแถว · sort ใหม่สุดก่อน · counts · shipped_pending vs notified · auth 401 · **462 passed** · build เขียว · v1 fidelity เดิมเขียว
- **ไม่ทำในเฟสนี้:** ปุ่มกระทำ (คอนเฟิร์ม/ยกเลิก) จาก UI = อนาคต (write phase) · ลิงก์แถวชีต = T2-ค

### D-61.C6 · ดันคำถามพาไปต่อเป็นบอลลูนเดี่ยวที่ delivery layer (1 commit) — ปิดช่องที่ C5 เหลือ
เหตุผลเจ้าของ (ระดับ conversion ไม่ใช่ความสวย): **LINE มือถือโชว์ preview/notification จาก "ข้อความสุดท้าย"** — คำถามปิดถูกผูกท้ายรายการโปรยาว ๆ = ลูกค้าเห็น noti เป็นเศษราคา ไม่ใช่คำถามที่ต้องตอบ · C5 ดัน prompt 2 รอบไม่ขยับ → ย้ายมาบังคับที่โค้ด deterministic
- **`splitClosingQuestion(reply)` ใน `lib/line.ts`** (เจ้าของ format `[[เว้น]]`) · **จุดตัด = ขอบบรรทัด ไม่ใช่ regex หาประโยค**: บรรทัดสุดท้ายที่มีเนื้อของบอลลูนสุดท้าย ถ้าเป็นคำถาม → ตัดออกเป็นบอลลูนใหม่
- **ตัวตรวจคำถามแหล่งเดียว:** `isClosingQuestion`/`CLOSING_QUESTION_RE` export จาก `lib/line.ts` — golden ชั้น G import ตัวเดียวกัน (เดิม regex อยู่ในไฟล์เทส · ย้ายมา lib แล้วเทสอ้างอิง ไม่เขียนซ้ำ)
- **edge ที่กันไว้:** บอลลูนเดิมต้องเหลือเนื้อ (ไม่สร้างบอลลูนว่าง) · คำถามเป็นบอลลูนเดี่ยวอยู่แล้ว/บรรทัดเดียว = no-op · `[[รูป:...]]` ล้วนไม่นับเป็นบรรทัดคำถาม · บรรทัดว่างท้ายบอลลูนข้ามได้ · เพดาน ≤5 → **รวมสองบอลลูนแรก** แทนการทิ้งคำถาม (วนจนพอดี · ห้ามแตะคู่ท้าย head+question)
- 🔴 **กับดักที่เจอ:** เดิมใช้ `parseReplyIntoMessages` นับ overflow — **มันตัดเหลือ 5 ให้แล้ว จึงไม่มีวันรายงานว่าเกิน** ทำให้ merge ไม่ทำงานและคำถามถูก slice ทิ้ง (unit จับได้) · แก้เป็น `countMessagesUncapped` ที่เรียก `parseSegmentToMessages`+`enforceTextLast` ตัวเดียวกับของจริงแต่ไม่ตัด · **บอลลูนที่มีรูปแตกเป็นหลาย message → bubble count ≠ message count ต้องนับที่ message**
- **ตำแหน่งเรียก:** handler หลัง guards ทั้งหมด + greeting D-51 ก่อน `deliverReply` · gate `v3 && !imageFallback && !degraded && !isHandoffTurn` (v2 ไม่แตะ) · log `closing-split {mergedHead}`
- 🔴 **ต้นเหตุจริงที่ทำให้ C5 "ดัน prompt ไม่ขยับ" — `โหมดประหยัดโควตา`** (เจอตอนทำ C6): ชีต v3 ตั้ง `เปิด` (และ `boolOf` **default = `true`** ถ้าไม่มี key) → `parseReplyIntoMessages(reply, collapseBubbles=true)` แปลง `[[เว้น]]` **ทุกตัว**เป็น `\n\n` เหลือ message เดียว · **โมเดลใส่ `[[เว้น]]` ให้ตลอด แต่ delivery ยุบทิ้ง** — สรุปเดิมของ C5 ว่า "โมเดลไม่ยอมแยกบอลลูน" **ผิด** · ที่ probe เห็นเป็น "3 บอลลูน" คือ image token แยก message เอง ไม่ใช่ `[[เว้น]]`
- **เจ้าของเคาะ: ปิดโหมดประหยัดโควตาใน v3 โดยเจตนา** — หลักการ "ซ้อมต้องเหมือนของจริง 100% + จังหวะบอลลูนคือดีไซน์ CX" · ความประหยัดไม่ใช่ priority · ทำที่ `lib/config.ts`: `quotaSaver: isSchemaV3() ? false : boolOf(true, "โหมดประหยัดโควตา")` → **ระดับโหมด เฉพาะ v3** · 🔴 v2 (prod) อ่านจากชีตเหมือนเดิมทุกบรรทัด · เลือกแก้ที่ config แทนสลับเซลล์ชีต เพราะผูกกับโหมดถาวร (ตั้ง `เปิด` ในชีตทีหลังก็ไม่พัง) + default เป็น true อยู่แล้ว + ห้องซ้อมได้ค่าเดียวกันอัตโนมัติ
- **ต้นทุนจริง = 0 สำหรับเทิร์นตอบปกติ** (ตรวจจากโค้ด): `deliverReply` ใช้ **Reply API เป็นทางหลัก** (push เฉพาะตอน reply ล้ม) และ LINE `replyMessage` ส่งได้ **5 messages ต่อ 1 API call** → เปิดบอลลูนเต็มยังเป็น **1 API call/เทิร์น** เท่าเดิม · reply ไม่นับโควตารายเดือน (push/multicast/broadcast นับ) — ⚠️ นโยบาย LINE ยังไม่ได้ verify จากหน้า OA Manager ของร้าน แนะนำเจ้าของเช็คยอดจริง 2-3 วันหลัง cutover · ที่ยังเป็น push: fallback ตอน reply token หมดอายุ · 🔔 กลุ่มแอดมิน · แจ้งพัสดุ D-50 · cron
- **ห้องซ้อม render เหมือน prod เป๊ะ** (ยืนยันจากโค้ด): sandbox ดักที่ `replyMessages`/`pushMessages` **หลัง** `parseReplyIntoMessages` เสร็จแล้ว → เก็บ `messages[]` ตัวเดียวกับที่จะยิงเข้า LINE (ผ่าน `[[เว้น]]`/image/`enforceTextLast`/cap-5/C6 splitter เหมือนกันทุกขั้น · ไม่มี render path แยก) · ความเหมือนผูกกับ `getConfig()` ตัวเดียวกัน → ปิดโหมดประหยัดครั้งเดียว มีผลทั้ง prod v3 และห้องซ้อมพร้อมกัน
- **ถ้าอนาคตต้นทุน push สูงจริง** → เปิดประหยัดเป็น **scope เฉพาะ push** (ว่าที่ D-63) ไม่ใช่ยุบทั้งเทิร์น
- **เทส:** `closing-split.test.ts` 11 เคสครอบ edge ครบ (หลายบรรทัด/บรรทัดเดียว/เดี่ยวอยู่แล้ว/ไม่ใช่คำถาม/รูปท้าย/บรรทัดว่าง/ชนเพดาน 5/เพดานเต็มเพราะรูป/ตัดแล้วว่าง/ข้อความว่าง/ตัวตรวจร่วม) · ชั้น G ยกระดับ invariant เป็น **"คำถามต้องเป็นบอลลูนเดี่ยว"** (เดิม C5 แค่ "อยู่บรรทัดสุดท้าย")

### D-61.C5 · 3 พฤติกรรมจากซ้อมจริง — โปรปลอม / รูปแบบราคา / บอลลูนปิด (1 commit)
- 🔴 **1. บอทโชว์ "2 ถ้วย 220 บาท" ที่ไม่มีในโปร — เลขถูก แต่ไม่ใช่โปร**
  · **ต้นเหตุไม่ใช่ price guard**: `buildPriceTable` แจกแจง **ทุกจำนวน 1..เพดาน** (95×2+30=220 ถูกต้อง อยู่ใน whitelist โดยชอบ) แต่ตารางที่ inject **ไม่มีสัญญาณว่าแถวไหนคือชั้นโปรจริง** → กติกา prompt อย่างเดียวทำตามไม่ได้
  · แก้: `PriceTableRow.isPromoTier` (จาก `PriceLine.isExactTier` ที่มีอยู่แล้ว) → `formatPriceTable` ติดป้าย **`[โปรโมชั่น]` / `[ราคาตามจำนวน ไม่ใช่โปร]`** ทุกแถว + คำอธิบายป้ายในหัวบล็อก · prompt: "รายการโปรที่โชว์ = เฉพาะแถวติดป้าย [โปรโมชั่น]" (ตอบราคาจำนวนที่ถามตรง ๆ ได้ แต่ห้ามยกไปอยู่ในรายการโปร) · **ไม่แตะ guard/whitelist** (ราคาถูกต้องอยู่แล้ว)
  · ผล: รายการโปร = 1/3/5/10 ตรง CSV_Promo ทุกเคส · "2 ถ้วย" ไม่โผล่ในรายการโปรอีก
- **2. รูปแบบราคาเมื่อมีค่าส่ง** — เดิม "125 บาท (มีค่าส่ง 30)" ลูกค้าตีความเป็น 155 · กติกา+ตัวอย่างในโซนราคาของ few-shot: บังคับ "สินค้า + ค่าส่ง = รวม" · ผล: "1 ถ้วย: 95 บาท + ค่าส่ง 30 บาท = รวม 125 บาท" ทุกครั้ง
- **3. บอลลูนปิด** — เพิ่มกติกาในโซน `<กลไกตอบแทรก-พากลับ>` เดิม + แก้ few-shot ทุกฉากให้ **คำถามพาไปต่ออยู่ท้ายสุด** (สลับ nudge "ทีมแอดมินกำลังแพคของ..." มาก่อนคำถาม · ตัด "สรุปยอดให้เลยค่ะ" ที่เคยตามหลังคำถาม) + ใส่รูปร่างรายการโปรเป็นตัวอย่างรูปธรรม (`- ... ถ้วย: สินค้า ... + ค่าส่ง ... = รวม ... บาท`) แทนคำอธิบายในวงเล็บ
  · ⚠️ **ช่องที่ยังเหลือ (รายงานตรง):** เป้า "choice close แยกเป็นบอลลูนของตัวเอง" **ยังไม่สำเร็จ** — ดัน prompt 2 รอบ (few-shot แสดง `[[เว้น]]` คั่นชัด) โมเดลยังผูก "รายการโปร + คำถาม" ไว้บอลลูนเดียว · สิ่งที่ได้จริงและบังคับด้วยเทสแล้ว: **คำถามอยู่บรรทัดสุดท้ายของบอลลูนปิดเสมอ** (ลูกค้าเห็นคำถามท้ายสุด ไม่ถูกฝังกลาง) + จับเคส "บอลลูนปิดไม่มีคำถาม" ได้ (เช่น จบด้วย "ทีมแอดมินกำลังแพ็คของ...")
  · **ทางเลือกถ้าต้องการเป๊ะ (ยังไม่ทำ):** บังคับที่ delivery layer — `deliverReply` ตัดประโยคคำถามท้ายออกเป็นบอลลูนใหม่ deterministic ไม่พึ่ง LLM
- **เทส:** unit ป้ายโปรใน `inject.test.ts` (1/3 ติด [โปรโมชั่น] · 2/4 ติด [ราคาตามจำนวน]) · unit กติกา 3 ข้อใน `v3-brain.test.ts` · ชั้น G เพิ่ม `checkClosingBubble` ทุกเคส funnel + G01 ต้องมีรูปก่อนปิด · **G 18/18**
- 🔴 **บทเรียน:** เขียนกติกาที่ "ข้อมูลใน prompt ไม่มีสัญญาณให้ทำตาม" = โมเดลทำตามไม่ได้ ต้องเติมสัญญาณที่ข้อมูลก่อน (ป้าย [โปรโมชั่น]) · และ **few-shot ต้องเป็นรูปธรรม** — คำอธิบายในวงเล็บ "(รายการโปร — ...)" โมเดลลอกรูปร่างไม่ได้ ต้องเขียนโครงจริงให้ลอก

### D-61.C4 · persona ชื่อบอทตาม Config (1 commit) — จากซ้อมจริง: ตั้ง `ชื่อบอท`=ปลาทู แต่บอทเรียกตัวเองว่า "แอดมิน"
สาเหตุ: few-shot ใน `system-v3.ts` ยกบทเดิมของเจ้าของมาทั้งดุ้น ซึ่งเขียน "แอดมิน" ตายตัว → โมเดลลอกสรรพนามจากตัวอย่าง (ตัวอย่างชนะกติกาเสมอเมื่อขัดกัน)
- 🔴 **แยกสองความหมายของ "แอดมิน" ให้ถูก** (หัวใจของงานนี้ · แทนหมดจะพัง):
  · **บอทพูดถึงตัวเอง** → `${botName}` — ส่งรายละเอียด/สรุปยอด/ขอที่อยู่/ส่งโปรฯ/แจ้งเลขแทรกกิ้ง (แจ้งพัสดุมาจาก cron ของบอท)
  · **คนจริงในร้าน** → คง "ทีมแอดมิน" — แพ็คของ/จัดส่ง (งานกายภาพ) · ทำให้ชัดขึ้นด้วยการเติม "ทีม" ตรงที่เดิมเขียน "แอดมิน" ลอย ๆ แต่หมายถึงคน
  · **คำสั่ง/กติกา (นอก few-shot)** เช่น "เสนอให้แอดมินเช็ค" / "ขอแอดมิน" = คงเดิม (พูดถึงคน)
- **กติกา identity ใหม่:** "เรียกแทนตัวเองว่า `${botName}` เสมอ · ห้ามเรียกตัวเองว่าแอดมินเด็ดขาด" + สงวนคำว่าแอดมิน/ทีมงานให้คนจริง
- **hardcode ชื่อบอทในโค้ด (พบ 6 จุด · ลูกค้าเห็นจริงทุกจุด):** `DEFAULT_REPLY`→`defaultReply(botName)` (config.ts · ใช้ใน gemini `fallback(stage, botName)` 3 จุด + handler 2 จุด) · handler 5 ตัว → ฟังก์ชันรับ botName: `transferUnresolvedReply` `claimsBlockedReply` `priceBadReply` `varFallbackReply` `degradedNoInputReply` · `ASSURANCE_FALLBACK_REPLY` ไม่แตะ (พูดถึงแอดมินมนุษย์ ไม่มีชื่อบอท)
- **เทส:** unit ใช้ชื่อสมมติ `"น้องกุ้ง"` (ไม่ใช่ default → จับ hardcode ได้ทันที) · สแกน few-shot ทั้งบล็อก: "แอดมิน" ที่เหลือต้องขึ้นต้นด้วย "ทีม" เท่านั้น · ยืนยัน `ทีมแอดมิน` คงอยู่ตรงงานกายภาพ · live G01 ชีตจริง → บอทตอบ "ปลาทูขอแนะนำรายละเอียด..." ✅
- ⚠️ **บทเรียนเครื่องมือ:** `Get-Content | Set-Content -Encoding utf8` ใน PS 5.1 อ่านไฟล์ UTF-8 ด้วย codepage ANSI → **อักษรไทยทั้งไฟล์พัง** (tsc ฟ้อง TS1127 รัว) · แก้ไฟล์ที่มีภาษาไทยให้ใช้ Edit tool เท่านั้น ห้าม roundtrip ผ่าน PowerShell

### D-76 · Messenger — แอดมินพิมพ์แทรกแล้วบอทหยุด (เทียบเท่า LINE) (1 commit)
โจทย์ตั้งไว้ว่า "ฝั่ง FB ยังไม่มีกลไก" — ตรวจแล้ว **กลไกมีอยู่ตั้งแต่ M-2** (echo → `setHumanMode`)
แต่ **ตายเงียบในโปรดักชันมาตลอด** ด้วยบั๊กที่เทสมองไม่เห็น:

#### 🔴 บั๊กหลัก: echo event ของ Meta กลับด้าน
`message_echoes` ส่ง `sender = เพจ` · `recipient = ลูกค้า (PSID)` (ตรงข้ามกับ event ปกติ)
โค้ดเดิมอ่าน `psid = m.sender.id` ทุกกรณี → echo ได้ `pageId` → `setHumanMode("fb:<pageId>:<pageId>")`
= **ปิดบอทให้ "ลูกค้าผี" ส่วนลูกค้าตัวจริงไม่เคยถูกปิดเลย** → แอดมินพิมพ์แทรก บอทก็ยังพิมพ์ชนต่อ
🔴 **เทสเดิมผ่านเพราะ fixture ผิด** — `textEvent` ใส่ `sender: PSID` ให้ echo ด้วย ซึ่งไม่ใช่รูปของจริง
(ตระกูลเดียวกับ "ความมั่นใจปลอม" D-68 ข้อ 2) → D-76 แก้ fixture เป็นรูปจริง + เพิ่ม assertion ว่า
**ห้ามมี id ผี `fb:<page>:<page>` เกิดขึ้น**

#### แยก "echo ของบอทเอง" vs "แอดมินพิมพ์มือ" — ตอบข้อ 1 ของโจทย์
เดิมพึ่ง `app_id` อย่างเดียว ซึ่ง **ไม่ 100%**: ข้อความจากกล่องเพจ (คนพิมพ์) ไม่มี `app_id` — เราจึงอนุมาน
"ไม่มี app_id = คนพิมพ์" · พลาดทางไหน (payload ไม่ส่ง app_id มาด้วยเหตุใดก็ตาม) = **บอทปิดตัวเอง**
→ D-76 เพิ่มตัวแยกที่ **deterministic 100%**: แปะ `message.metadata = "sakbin-bot"` (`BOT_ECHO_MARK`)
ทุกข้อความที่บอทส่ง — Send API คืนค่านี้กลับมาใน echo · `isOwnEcho()` ตัดสิน 3 ชั้น:
1. `metadata === BOT_ECHO_MARK` → ของเรา (แน่นอน)
2. `app_id === META_APP_ID` → ของเรา (ครอบข้อความที่ส่ง**ก่อน** deploy นี้ ซึ่งยังไม่มี metadata)
3. ไม่เข้าทั้งคู่ → **ไม่ใช่ของเรา = ปิดบอท** · ทิศปลอดภัย: บอทเงียบเกินดีกว่าพิมพ์ชนแอดมิน
   · log `by: other-app | page-inbox` ให้เห็นว่าตัดสินจากอะไร

#### กติกาคืนสิทธิ์บอท — ไม่มีกติกาใหม่ (ข้อ 2 ของโจทย์)
FB กับ LINE เข้า `processMessage` ตัวเดียวกัน → human_mode gate + lazy return (`คืนสิทธิ์บอท_หลังแชทเงียบ`
default 45 นาที · วัดจาก `last_seen` · ปลดตอนลูกค้าทัก) + `ประโยคเปลี่ยนมือ_บอทรับต่อ` ใช้เส้นเดียวกันอยู่แล้ว
D-76 ไม่เพิ่มโค้ดตรงนี้เลย — เพิ่มแค่ **เทส e2e ฝั่ง FB** ว่าเส้นนี้ทำงานจริง (แอดมินพิมพ์ → เงียบ → เงียบครบ → กลับมา)

#### เกณฑ์ผ่าน
เทส meta 15 เคส (echo ลง id ลูกค้า/ไม่มี id ผี · metadata · app_id · แอปอื่น · ทุก send มีลายเซ็น · คืนสิทธิ์ e2e)
· golden ชั้น D diff ว่าง · npm test 637 passed · ไม่แตะ เส้น LINE/system-v3.ts/guards

### D-75 (เฟส D) · ผู้ช่วยเทรนสัมภาษณ์ — คุยแล้วได้แถว ไม่ต้องกรอกเอง (1 commit)
สเปคเจ้าของ: ปุ่มเลือกงาน (เพิ่ม Knowledge/Steps/Vars · แก้ไขแถวเดิม) → สัมภาษณ์ทีละ 1-2 ข้อ →
เขียนทุกช่องให้จากบทสนทนา → เจ้าของปรับแก้ตอนสุดท้าย → บันทึก

#### หลักที่บังคับด้วยโค้ด
- 🔴 **ประตูเขียนบานเดียว — ปลายทางของใบ = ฟอร์มเดิมที่ถูกเติมค่า**: การ์ด proposal เหลือปุ่ม
  "📝 เติมฟอร์ม" → เปิดฟอร์มเพิ่มแถว (D-72b) หรือฟอร์ม ✎ แก้ไข (D-74) พร้อมค่า · เจ้าของเห็นทุกช่อง
  แก้ได้ แล้วบันทึกเองผ่าน lint/dup/conflict/TRAIN_LOG เส้นเดิม (origin "ai" → TRAIN_LOG ai-draft/ai-edit)
  · **ตัด `confirmProp` (เขียนตรงจากการ์ด) ทิ้งทั้งเส้น** — trade-off ที่รับรู้: โหมดเกลาเสียง (D-60)
  ช้าลงหนึ่งคลิกต่อแถว · 🔴 ถ้าใช้จริงแล้วเกลาเสียงทีละหลายสิบแถวจนเมื่อยมือ → พิจารณา batch-form
  เป็นงานใหม่ ไม่ใช่เอา confirmProp กลับมา (เจ้าของเคาะ 2026-09-02)
  · คำเตือน rewriteSafety ({ตัวแปร} หาย/ตัวเลขเปลี่ยน) ย้ายไป `saveEditRow` = คุ้มครองการแก้มือด้วย
- draft เสมอ (ฟอร์มเพิ่มแถวบังคับอยู่แล้ว) · ผู้ช่วยไม่มีปุ่ม live ของตัวเอง
- 🔴 id ของใบ add-row ถูกละเลย — ฟอร์มใช้ `suggestedId` (nextSequentialId D-74) เสมอ

#### ด่านตรวจ `reviewProposal` (lib/train/assistant-review.ts · pure · route รันกับใบทุกชนิด add+edit)
1. ชื่อคอลัมน์ไม่ตรง header ดิบ → เตือน "จะถูกทิ้งเงียบ" + บอกคอลัมน์จริง (กับดัก appendRow)
2. keyword ชนตรงกับแถวอื่น → บอก id + เสนอแก้แถวเดิม
3. keyword substring อันตราย **สองชั้น**: สั้น ≤2 ตัวอักษร + **ฝังเป็น substring ในคำของ `ลูกค้าพูดยังไง`
   แถวอื่น** พร้อมยกคำที่ฝัง (เจ้าของเคาะเพิ่ม — เกณฑ์ความยาวจับ "ท้อง" ใน "ท้องเสีย" ไม่ได้)
   หมายเหตุ: ตัวอย่างในโจทย์ ("ท้อง" ฝังใน "ปลายทาง") ไม่จริงระดับสตริง (ไม้โทไม่ตรง) — กลไกจับ
   substring จริง เทสใช้เคสจริง ("ท้อง"→"ท้องเสีย" · "ทาง"→"ปลายทาง")
4. H1 = `lintHealthH1` **import ตัวเดียวกับ lint ตอนบันทึก** (+ `assuranceBannedPhrases` จาก config)
   → เตือนตั้งแต่ตอนคุยด้วยเสียงเดียวกับตอนบันทึก · 🔴 edit-row **merge ค่าแถวเดิมก่อนตรวจ**
   (เคาะ (3): เคสอันตรายจริงคือแก้ข้อเท็จจริงแถวสุขภาพแล้วเผลอใส่คำรับรอง — trigger อยู่คอลัมน์อื่น)
5. add-row ที่ key มีอยู่แล้ว → ชี้แถวเดิม + แนะแก้แทน

#### สัมภาษณ์/โมเดล
- task จากปุ่ม → system prompt แนบสคริปต์ต่อแท็บ (คำถามผูกชื่อคอลัมน์จริง · Steps ถามป้ายส่งคน 3 ค่า
  D-73b) · โหมดแก้: route ยัดค่าปัจจุบันทุกช่องของแถว (rowContext) ให้ผู้ช่วยเห็นก่อนเสนอ diff
- 🔴 แก้กติกาข้อ 2 ของผู้ช่วยที่ผิดยุค: เดิมสั่ง "สุขภาพ → funnel_stage=handoff_notify" ซึ่ง**ผลิตไม่ได้
  ตั้งแต่ D-73b** → ใหม่ = ข้อเท็จจริงตามฉลาก ห้ามคำรับรอง (เกณฑ์เดียวกับ lint) + ป้าย handoff 3 ค่า
- โมเดล = `config.geminiModel` + thinking จากชีต (เลิกใช้ MODEL ตายตัว) · ทุก call ลง `ai_usage`
  **call_kind "assistant"** (channel "train") — เจ้าของเห็นต้นทุนผู้ช่วยแยกใน D-70

#### เกณฑ์ผ่าน
เทสใหม่ 15 เคส (ด่านตรวจครบ 5 + สคริปต์ + โมเดล/ต้นทุน · mock genai ไม่ยิงจริง) · golden ชั้น D diff ว่าง
· npm test เขียว · ไม่แตะ เส้นบอท/system-v3.ts/guards/write.ts/lint.ts

### D-73c · 🔔 แจ้งแอดมินทันทีที่ลูกค้าเข้าประตู intake (ไม่ปิดบอท) (1 commit)
เหตุผลเจ้าของ: ลูกค้าเข้าเคสเคลม/ขายส่งแล้วหายเงียบกลางการเก็บข้อมูล = **เคสค้างใน DB โดยไม่มีใครรู้**
(🔔 ปลายทางยิงเฉพาะตอน intake จบ/ชนเพดาน) → ยิงตั้งแต่ "เข้าประตู" · แพทเทิร์นเดียวกับธงสุขภาพ: แจ้งแล้วบอทคุยต่อ

- ยิงเมื่อ `stageIsIntake && prevIntakeTurns === 0 && newIntakeTurns === 1` — ระบุประตู (จาก `stepNameOf`) +
  ชื่อลูกค้า + ข้อความล่าสุด + บอกชัดว่า "บอทกำลังเก็บข้อมูล ยังไม่ต้องเข้ามา · เก็บครบ/ชนเพดานจะแจ้งอีกครั้งพร้อม 📋"
- 🔴 **dedup ไม่ต้องมี marker ใหม่ — มาจากตัวนับเอง**: เทิร์น 2-3 (prev≥1) ไม่เข้าเงื่อนไข · ออกจาก intake /
  handoff / เงียบเกิน `คืนสิทธิ์บอท_หลังแชทเงียบ` → ตัวนับกลับเป็น 0 → เข้าใหม่ = เคสใหม่ = ยิงใหม่ (มีเทสทั้ง 3 ทาง)
- 🔴 **ไม่ยิงเมื่อเทิร์นเดียวกันนั้น handoff อยู่แล้ว** (เช่นเพดาน=1) — ไม่งั้นแอดมินได้ 2 ข้อความขัดกันในเทิร์นเดียว
  ("ยังไม่ต้องเข้ามา" + "ส่งต่อแอดมิน") · มีเทส
- ข้อความจาก Config คีย์ใหม่ `ข้อความ_แจ้งแอดมิน_เก็บข้อมูล` (`config.notifyAdminIntakeTemplate`) ·
  default ในโค้ด **ไม่มีคำว่า "รบกวน"** (กฎเหล็ก D-61) — มีเทสยืนยันทั้ง default และ override จากชีต
  (override พิสูจน์ที่ `config-parse.test.ts` เพราะ harness fixture hardcode ค่า config ไว้)
- เส้นอื่นไม่ขยับ: keyword handoff · ธงสุขภาพ (🔔 + คุยต่อ) · 🔔 ปลายทางพร้อม 📋 · แถว intake เป็น draft =
  ไม่มีการแจ้งอะไรเลย (rollback เดิมยังจริง) — เทสครบทุกข้อ

#### เกณฑ์ผ่าน
golden ชั้น D diff ว่าง · npm test 618 passed (+10) · tsc สะอาด · ไม่แตะ system-v3.ts/guards/ชีต

### D-74 · Studio UX — ID ต้องหาเจอ · ID ใหม่ต้องไม่ต้องคิดเอง · แก้เนื้อหาแถวได้จากลิสต์ (1 commit)
ปัญหาจริงจากเจ้าของใช้ปุ่มเขียนครั้งแรก (D-72b): หาแถว K017 ไม่เจอ · ต้องคิด id เอง · **ไม่มีทางเข้าฟอร์มแก้เนื้อหาเลย**

#### 1-3 · id
- **`listTabRows` คืน `id` ต่อแถว + `idCol` + `suggestedId`** — อ่านคอลัมน์ `id` ของชีตดิบ (Knowledge มี K001… ·
  Steps/Vars ไม่มี = key เป็น id อยู่แล้ว → `id: ""`, `idCol: null`)
  🔴 **key ที่ใช้หาแถวตอนเขียนยังเป็น `ลูกค้าพูดยังไง` เหมือนเดิม** — `id` เป็นข้อมูลโชว์/ค้นหาเท่านั้น
  (ไม่แตะ overlay/write/provenance = เส้นบอทไม่ขยับ)
- ลิสต์โชว์ id นำหน้า (monospace) + **ช่องค้นหา** กรอง `id + key + preview` (client-side)
- `nextSequentialId(ids)` (pure · export) — prefix+เลขท้าย, คงจำนวนหลัก (K020→K021 · K007→K008),
  อิง**ค่าสูงสุด**ไม่ใช่จำนวนแถว, prefix ปนกันใช้ตัวที่พบบ่อยสุด, ไม่เข้า pattern (H_CLAIM/S2Q) = null → คนพิมพ์เอง
  ฟอร์มเพิ่มแถวเติมช่อง id ให้เอง (ป้าย "เติมให้อัตโนมัติ — แก้ทับได้")
- **dup บอกว่าซ้ำกับแถวไหน**: `AppendResult.dup` += `message` → `id "K017" ซ้ำกับแถวที่มีอยู่แล้ว: K017 · ของเสีย/ของไม่ถึง (แถว 3 ในชีต)`
  เช็คทั้งคอลัมน์ key และคอลัมน์ id (คนละคอลัมน์กัน ต้องเช็คแยก) · Steps ไม่มี pattern เลข → กรอกเอง + เตือนตอนซ้ำ

#### 4 · ปุ่ม "✎ แก้ไข" ต่อแถว (สำคัญกว่าเรื่อง id — เส้นทางแก้มีครบตั้งแต่ D-72b แต่ไม่มีทางเข้า)
- กดแล้วกางฟอร์มใต้แถว: ช่องใน `EDITABLE_COLS` ของแท็บนั้นแก้ได้ (Knowledge 4 ช่อง · Steps `สาระที่ต้องสื่อ`+`แนวตอบ`
  ที่ติดป้าย "ไม่เข้า prompt" · Vars `ค่า`) · id/key/สถานะ โชว์เป็นบริบท **อ่านอย่างเดียว**
- 🔴 **บันทึกผ่านเส้นทางเขียนเดิมของ D-72b เท่านั้น**: `mode:"diff"` ตอนเปิด (ได้ค่าสด = `expectedOld` กันชนกัน) →
  `mode:"commit"` ต่อช่องที่เปลี่ยนจริง → lint gate + conflict + TRAIN_LOG ครบเหมือนเดิม · ช่องที่ไม่เปลี่ยน = ไม่เขียน
  (ไม่มี endpoint ใหม่ ไม่มีเส้นเขียนที่สอง)

#### เกณฑ์ผ่าน
golden ชั้น D diff ว่าง (ไม่แตะเส้นบอท) · npm test 608 passed (+10) · tsc สะอาด

### D-73b · เปลี่ยนป้าย intake จาก funnel_stage → คอลัมน์ handoff 3 ค่า (1 commit · ทับวิธีระบุประตู intake ของ D-73)
เจ้าของเคาะดีไซน์สุดท้าย **หลัง D-73**: ไม่เพิ่มคอลัมน์ `funnel_stage` ในชีต — ใช้คอลัมน์ `handoff` (H) เดิมเป็นป้าย 3 ค่า
เหตุผล: สองคอลัมน์ที่พูดเรื่อง "ส่งคนยังไง" แล้วว่างเกือบหมดทั้งคู่ = จุดสับสนถาวร · คอลัมน์เดียวชื่อตรงหน้าที่

#### ป้าย 3 ค่า (normalize ที่ `classifyHandoffMark` — แหล่งเดียว)
| ค่าในคอลัมน์ handoff | ความหมาย |
|---|---|
| ว่าง | ประตูปกติ (funnel จาก FIXED_FUNNEL / คอลัมน์ funnel_stage ถ้ามี) — เดิมเป๊ะ |
| "ใช่" (+ true/on/1/yes/✓/เปิด/handoff) | handoff ทันที — **semantics เดิมเป๊ะ มีเทสยืนยัน** |
| "เก็บข้อมูลก่อน" | `handoff_after_intake` — เข้าเส้น intake ของ D-73 |
| 🔴 ค่าอื่น | **invalid — ห้ามเงียบ**: `console.error` ดัง (stepId+ค่า+ค่าที่ถูก) + การ์ด schema ⚠️ (`validateBundle`
  ok=false + ข้อความ) + Studio add-row ปฏิเสธ (`appendRow` → status funnel + ข้อความ 3 ค่า) · normalize ตีเป็น
  **handoff** (ทิศปลอดภัย: ส่งคนเกิน ดีกว่าบอทขายในประตูที่ควรส่งคน) — มีเทสทุกชั้น |

#### 🔴 สิ่งที่โค้ดก่อน D-73b ทำกับ H ที่ไม่ว่างและไม่ใช่ "ใช่" (ข้อ 3 ของโจทย์ — ตรวจแล้ว)
`isHandoff=false` → funnel ตกไปที่ explicitFunnel/FIXED_FUNNEL/default → **ถูกตีความเงียบ ๆ เป็น "ประตูขายปกติ"**
(อันตรายกลับด้าน: แถวเคลมกลายเป็นประตูขาย ไม่ส่งคนเลย) · ช่วงก่อน D-73b แถวจริง H_CLAIM/H_BULK (H="เก็บข้อมูลก่อน")
มีแค่ **สถานะ draft ที่กันไว้** — ยังไม่เคยถูกโหลดเข้า prod จึงยังไม่พัง · D-73b ปิดช่องนี้: ค่าแปลก = ดัง + ทิศปลอดภัย

#### กลไก funnel_stage optional (D-68)
คงไว้ในโค้ด (มีคอลัมน์ก็อ่าน) แต่ **ชีตจริง/แถว D-73 ไม่ใช้แล้ว** · fixture: `v3StepRows` default = **9 คอลัมน์ตามชีตจริง**
(ไม่มี funnel_stage) — สลับเป็น 10 คอลัมน์อัตโนมัติเฉพาะเทสที่ส่ง `funnel:` (`V3_STEP_HEADER_WITH_FUNNEL`)
· เทส intake ทั้งไฟล์ย้ายมา 9 คอลัมน์ + ป้าย `intake: true` (H="เก็บข้อมูลก่อน") + id จริง S1/S2/S4
· พิกัด A1 ใน train-phase-c ขยับตามชีต 9 คอลัมน์: สาระที่ต้องสื่อ=D · แนวตอบ=G · handoff=H · สถานะ=I

#### เกณฑ์ผ่าน
เทส rollback เดิมผ่าน (แถว draft = พฤติกรรมวันนี้เป๊ะ) · intake 18 เคส · golden ชั้น D diff ว่าง · npm test เขียว
ห้ามแตะ system-v3.ts/guards/ชีต — โค้ดปรับมารองรับชีต (H_CLAIM/H_BULK ที่เพิ่มแล้วเป็น draft) ไม่ใช่ให้เจ้าของแก้ชีตตามโค้ด

### D-73 · เปิด intake D-34/35 กลับ — เก็บข้อมูล 1-3 เทิร์นก่อนส่งคน (1 commit)
> ⚠️ **D-73b ทับวิธีระบุประตู intake ของงานนี้แล้ว** — ไม่ใช้คอลัมน์ funnel_stage · ใช้ป้าย handoff="เก็บข้อมูลก่อน" แทน (precedence/สรุปข้อมูล/rollback ของ D-73 คงเดิมทั้งหมด)
เคสเคลม/ขายส่ง: บอทเก็บข้อมูลที่แอดมินต้องใช้ก่อน แล้วค่อยส่งต่อ+ปิดบอท — แอดมินเปิดเคสเห็นข้อมูลครบ
กลไก D-34/35 มีอยู่แล้วครบ (นับเทิร์น/min/cap/stale/push-on-exit/stayStage — เทส 9 เคสเขียวมาตลอด)
แต่หลับเพราะไม่มีแถว `funnel_stage=handoff_after_intake` ในชีต → **การเปิด = เจ้าของเพิ่มแถวในชีต** ไม่ใช่โค้ด

#### precedence (บังคับในโค้ด · มีเทสครบ)
1. คำ_handoff → pre-check ก่อน Gemini + return — ชนะทุกอย่างรวมกลาง intake (P4)
2. ธงสุขภาพ → พฤติกรรมเดิมเป๊ะ: 🔔 + คุยต่อ ไม่ปิดบอท ไม่แตะตัวนับ intake (regression test ใหม่)
3. intake: ขั้นต่ำ 1 / เพดาน 3 (Config `เทิร์นขั้นต่ำก่อนส่งแอดมิน`/`เพดานเทิร์นก่อนส่งแอดมิน`) → handoff + 📋 สรุป
4. keyword กลาง intake → ข้อ 1 ชนะ + 🔴 **ใหม่: reset ตัวนับใน `runHandoffFlow`** (หลัก D-35 — เดิมเส้นนี้ทิ้ง counter ค้าง
   วันนี้รอดเพราะเกณฑ์ stale = เกณฑ์คืนสิทธิ์บอทตัวเดียวกัน แต่ "เปิดบอท" มือเร็วกว่านั้นจะนับต่อผิด)

#### โค้ดที่แตะ (handler อย่างเดียว · ไม่แตะ system-v3.ts/guards)
- `handoff()` รับ `collected?: string[]` → หัว "📋 ข้อมูลที่เก็บได้" ในข้อความแจ้งแอดมิน
- จุด doHandoff: `stageIsIntake` → ดึง `getRecentHistory(newIntakeTurns*2)` (บทสนทนาช่วง intake · save ก่อนถึงจุดนี้แล้ว)
  ชนเพดานได้เท่าไหร่ส่งเท่านั้น · ตัดต่อบรรทัด 300 ตัว
- **เทิร์นรูปอยู่ใน history เป็น `"[ลูกค้าส่งรูปมา]"` อยู่แล้ว** (placeholder จาก `runInboundImage`) → สรุปโชว์เอง
  แอดมินรู้ว่ามีรูปรอในแชท — ไม่ต้องสร้างกลไกใหม่ (ข้อ 1 ของเจ้าของ: เช็คแล้ว history เก็บจริง)

#### จุดตัดกับเส้นเดิมที่ต้องรู้ (พบตอนเขียนเทส)
- 🔴 **รูปที่ AI ชี้ว่า "damage" → เส้น D-30 เดิมชนะ intake**: handoff ทันทีพร้อมแนบรูปหลักฐาน (`damageHandled`
  ตัด doHandoff เส้นอื่น) — แรงกว่า intake โดยดีไซน์ (ได้หลักฐานชิ้นสำคัญสุดแล้ว = ส่งเลยดีกว่าถามต่อ) · ไม่แก้
  → intake cap ทำงานกับเทิร์นที่ "ยังไม่มีรูป damage ชัด" (โมเดลชี้ other = อยู่ intake ต่อ)
- แถว Knowledge เคลม/ขายส่งเดิม (K017/K018) ยังชี้ "ส่งต่อแอดมิน" → โมเดลอาจตั้ง flag ตั้งแต่เทิร์น 1 (โดน min
  กดไว้ 1 เทิร์นแล้วค่อยส่ง = ยังถูกต้อง) · ถ้าอยากลื่นกว่านั้น เจ้าของเติมใน `แนวตอบ` ว่าขอรูป/รายละเอียดก่อน — งานชีต

#### 🔴 Known risk (เจ้าของเคาะยอมรับ · 2026-09-02)
**"ห้ามรับปากผลลัพธ์" ระหว่าง intake บังคับด้วย prompt (คอลัมน์ D) เท่านั้น — ไม่มี guard ตรวจ output**
- ยอมรับได้ตอนนี้: min/cap จำกัด 1-3 เทิร์น + ยังไม่มีลูกค้าจริง
- เทสที่มี = พิสูจน์ว่าคำสั่งใน D **เข้า prompt จริงทุกเทิร์น intake** (ทั้ง entry-match และ stayStage) — ไม่ใช่พิสูจน์ว่าโมเดลเชื่อฟัง
- 🔴 **เงื่อนไขยกระดับ: เจอบอทรับปากในซ้อม/ใช้จริงแม้ครั้งเดียว → สร้าง guard ตระกูลเดียวกับ assurance guard เป็นงานใหม่ทันที**
  (หลักที่จดกันไว้: prompt คือความหวัง โค้ดคือสัญญา)

#### rollback (พิสูจน์ด้วยเทส)
ไม่มีแถว intake / แถวเป็น draft = พฤติกรรมเหมือนวันนี้ทุกอย่าง (AI flag → ส่งทันที · ตัวนับ 0)
→ เจ้าของ rollback ด้วยการ toggle แถวเป็น draft ในชีต/ห้องซ้อม — ไม่ต้อง deploy

#### แถวที่เจ้าของเพิ่มในชีต Steps (สถานะ draft ก่อน · ทดสอบห้องซ้อม → live)
`H_CLAIM` (เคลม: เก็บรูปสินค้า+กล่อง และสิ่งที่เกิดขึ้น) · `H_BULK` (ขายส่ง: จำนวน + พื้นที่ขาย) —
ตารางเป๊ะ ๆ อยู่ในรายงานแชท D-73 · ~~🔴 คอลัมน์ `handoff` ต้องเว้นว่าง~~ **D-73b กลับด้าน: คอลัมน์ handoff คือป้าย — ใส่ "เก็บข้อมูลก่อน"** (ไม่ใช้ funnel_stage แล้ว)
· ห้ามใช้ step_id `H1` (โค้ดจอง NOTIFY_DOOR)

#### เกณฑ์ผ่าน
golden ชั้น D diff ว่าง (fixture ไม่มีแถว intake = เส้นปกติไม่ขยับ) · เทส intake 15 เคส (เดิม 9 + ใหม่ 6) · npm test เขียว

#### เลขงานถัดไป (แก้จากที่เคยจดสลับ)
intake = **D-73** (งานนี้) · **D-70** = หน้าสรุปต้นทุนจาก `ai_usage` · **D-71** = explicit caching (ถ้า cached_tokens = 0)

### D-72b · แยกเส้นทางอ่านของบอท (normalize) ออกจากเส้นทางแก้ไขของ Studio (raw) — ปลดล็อกปุ่มเขียน (1 commit)
ตัวบล็อกจริง (ยืนยันใน D-72a): `normalizeKnowledge` ยุบ 3 คอลัมน์เป็น `คำตอบ` ก้อนเดียว → `locateInLib`
หาพิกัดจากของที่ normalize แล้วไปเขียน "ชีตดิบ" = ผิดช่องโดยหลักการ ไม่ว่าจะ rename ยังไง

#### สถาปัตยกรรม: 2 มุมมองจาก batchGet เดียวกัน (cache entry เดียว — ไม่เพิ่ม Google call)
- **เส้นบอท:** `loadBotLibrary()` → raw → `normalizeBundle` → `BotLibrary` — เหมือนเดิมทุกบรรทัด (golden ชั้น D diff ว่าง)
- **เส้น Studio:** `loadRawSheets()` → **แถวดิบตามชีตเป๊ะ** (ชื่อคอลัมน์จริง ลำดับจริง เลขแถวจริง) — จุดใหม่จุดเดียวใน loader
- `locateInRaw` (เดิม locateInLib) / `listTabRows` / `appendRow` / `setRowStatus` / `diffCell` / preview / assistant-kb → raw ทั้งหมด
- 🔴 **สถานะบนแถวดิบใช้ `isLiveStatus` (export ใหม่จาก normalize-bundle · "ว่าง=draft")** — ห้ามใช้ `isActiveStatus`
  ของ inject.ts กับแถวดิบ botlib (ตัวนั้น "ว่าง=active" ถูกเฉพาะกับ bundle ที่ normalize แล้ว) · มีเทสตรงทั้งสองชั้น
- ถอด `assertWritable()` ที่ D-68 ล็อกไว้ — เหตุ 2 ชั้นหมดแล้ว (ชั้นชื่อแท็บหายที่ D-72a · ชั้นพิกัดหายที่คอมมิตนี้)

#### แหล่งเดียวที่ห้ามแตกแถว (กัน "ห้องซ้อมโกหก")
- `composeKnowledgeAnswer()` — export จาก normalize-bundle: normalizeKnowledge (เส้นบอท) และ
  `patternFromColumns` (เส้น Studio: preview/lint) เรียกตัวเดียวกัน · มีเทสยืนยัน byte-equal
- `patternFromColumns` ของ Steps = `สาระที่ต้องสื่อ` (ช่องเดียวที่เข้า prompt) — `แนวตอบ` แก้ได้แต่ไม่ปน pattern

#### คอลัมน์ที่แก้ได้ (เจ้าของเคาะ)
- Steps = `สาระที่ต้องสื่อ` + `แนวตอบ` (ติดป้าย "ไม่เข้า prompt — บอทไม่เห็นช่องนี้" ทั้ง editor และฟอร์มเพิ่มแถว)
- Knowledge = `ความกังวลจริง` + `ข้อเท็จจริง/สิ่งที่อยากให้รู้` + `แนวตอบ` + 🔴 `keyword`
  (เหตุที่ต้องมี keyword: บั๊กที่แพงสุดของโปรเจกต์คือ keyword ไม่ match — K018 "ถ้วยแตก" vs "ถ้วยบุบ,ของแตก")
  · `ลูกค้าพูดยังไง` = key หาแถว → ไม่เปิดให้แก้ · ตรวจแล้ว dup-check (key อย่างเดียว) / conflict-check (ต่อเซลล์) ไม่เพี้ยน
- Vars = `ค่า`

#### 🔴 lintHealthH1 — เปลี่ยนเกณฑ์ v2 → v3 (เจ้าของเคาะทาง A)
เดิม: แถวสุขภาพ + คำตอบไม่มีคำ "ส่งต่อ/แอดมิน" = **block** → block แถวที่ถูกต้องตาม v3 (ข้อเท็จจริงตามฉลากล้วน)
ใหม่: แถวสุขภาพ + คำตอบมี **"คำรับรอง"** = block · ไม่มีคำรับรอง = warn พร้อมทางออก
("ใส่ได้เฉพาะข้อเท็จจริงตามฉลาก ห้ามใส่หลักการตอบ — CLAUDE.md H1")
- 🔴 ตัวจับ = `findAssuranceHits` **import จาก `lib/guards/assurance.ts` ตรง ๆ ห้ามลอกกติกามาเขียนใหม่**
  — guard เปลี่ยน lint เปลี่ยนตาม (รวม list จาก Config `คำรับรอง_ต้องห้าม` ผ่าน `config.assuranceBannedPhrases`)
- เทสคู่: ข้อเท็จจริงตามฉลาก → เขียนได้ (warn) · "ทานได้ค่ะ ไม่เป็นไร" → block เหมือนเดิม
- exempt D-58 (ประตู handoff/notify) คงไว้ — D-72b อ่านธงจากแถวดิบ: คอลัมน์ `handoff` (ผ่าน `isHandoffFlag`
  export ใหม่ · กติกาเดียวกับ normalizeSteps) + `funnel_stage` (optional)

#### เทสที่ยืนยัน (ใหม่/เขียนใหม่ · ไม่มีเคสถูกลบ)
- A1 ถูกแท็บ/แถว/คอลัมน์: `Steps!E3` (สาระ) · `Steps!H2` (แนวตอบ) · `Knowledge!D2` (ข้อเท็จจริง) ·
  `Knowledge!B2` (keyword) · `Vars!B2` · `Knowledge!F2` (สถานะ) — mock ล้วน
- แถวที่เคยถูกยุบ: เขียน `ข้อเท็จจริง` → batchUpdate เซลล์เดียว คอลัมน์อื่นไม่โดนทับ
- "ว่าง=draft": raw คงค่าว่าง (Studio เห็นความจริง) · bundle เติม draft (บอทไม่เห็นค่าว่าง) · ชีตขาดคอลัมน์สถานะ →
  Studio เห็นจริง + appendRow ปฏิเสธ (no_status_col กลับมาทำงานได้จริง — เดิมอ่าน bundle เลยโกหกว่ามี)
- ชื่อคอลัมน์ shape เก่า ("ตัวอย่างคำตอบ") → ปฏิเสธ ไม่ใช่เขียนผิดช่อง
- golden ชั้น D diff ว่างเทียบ baseline · `npm test` เขียว

### D-72a · rename ล้วน — ชื่อเดียวทั้งระบบ (ชีต = โค้ด = X-ray) (1 commit)
เจ้าของตัดสินใจ: **ไม่ให้เหลือชั้นแปลชื่อในระบบ** · ชื่อแท็บในชีตเปลี่ยนเป็นอังกฤษให้ตรงกับคีย์ในโค้ด
🔴 **pure rename — พฤติกรรมบอทต้องไม่เปลี่ยน** · เกณฑ์ผ่านหลัก = golden ให้ผลเหมือน baseline ไม่ใช่แค่ "เทสเขียว"

#### แผนที่ชื่อ
`เส้นทางขาย → Steps` · `ความรู้ → Knowledge` · `CSV_Products → Products` · `CSV_Promo → Promo` · `CSV_Vars → Vars` · `CSV_Config → Config` · `CSV_Objections → ลบทิ้ง` (v3 ได้ `[]` เสมอตั้งแต่ D-61.B)
คีย์ `BotLibrary` = ชื่อแท็บเป๊ะทุกตัว · `Follow` คงคีย์ไว้ (dormant · ไม่มีแท็บในชีต) ให้ cron/follow อ่านแล้ว skip เหมือนเดิม

#### 🔴 สิ่งที่พบก่อนลงมือ (รายงานแล้วเจ้าของเคาะ) — งานนี้แยก 2 คอมมิต
`adaptV3Bundle` **ไม่ใช่ชั้นแปลชื่อ** — มี logic จริง 4 อย่างที่ถอดทิ้งเฉย ๆ ไม่ได้:
1. 🔴 `normalizeStatus` **"ว่าง = draft"** — consumer ใช้ `isActiveStatus` ซึ่ง **ว่าง = active** → ถอดแล้ว **แถวที่เจ้าของยังไม่กรอกสถานะจะเด้งขึ้นหน้าร้านทันที** (invariant D-61.B ที่มีไว้ปิด KI-08 ของ v2 พังทันที)
2. `normalizeKnowledge` **ประกอบ** `คำตอบ` จาก 3 คอลัมน์ + ป้ายไทย → ก้อนนี้**เข้า prompt ตรง ๆ** ถอดแล้ว prompt เปลี่ยน = บอทเปลี่ยน
3. คำนวณ `funnel_stage` (FIXED_FUNNEL + flag `handoff` + คอลัมน์ optional ของ D-68)
4. lowercase สถานะให้ Products/Promo (pricing เทียบ `!== "live"` แบบ case-sensitive)

**สแกนชีตจริงก่อนตัดสิน** (5 แท็บ · 31 แถว): สถานะว่าง 0 · ตัวพิมพ์ใหญ่ปน 0 · ค่าที่พบ `[live]` ทั้งหมด
→ ถอดวันนี้บอทยังทำงานเหมือนเดิม **แต่ #1 กับ #4 จะกลายเป็นกับดักรอวันเกิด** (วันที่เจ้าของเพิ่มแถวแล้วยังไม่กรอกสถานะ = พฤติกรรมปกติของคนกรอกชีต)

→ **D-72a = rename ล้วน คง logic ทั้ง 4 ไว้** · เปลี่ยนชื่อไฟล์ `adapter-v3.ts → normalize-bundle.ts` และ `adaptV3Bundle → normalizeBundle`
🔴 **เหตุผลที่ต้องเปลี่ยนชื่อ:** ชื่อ "adapter" ทำให้คนถัดไป (หรือ CC รอบหน้า) คิดว่ามันเป็น shim ที่ลบทิ้งได้ — ซึ่งเป็นเหตุที่ D-72 ถูกตั้งโจทย์ผิดตั้งแต่แรกว่า "ถอด adapter"

#### 🔴 D-72b (คอมมิตถัดไป) — เป้าหมายที่แก้แล้ว
เดิม *"ลบ adapter"* → ใหม่: **"แยกเส้นทางอ่านของบอท (normalize) ออกจากเส้นทางแก้ไขของ Studio (raw)"**
- logic 4 อย่างเป็นของจริงที่ต้องมีที่อยู่ ไม่ใช่ shim
- Studio/ปุ่มเขียนต้องเห็น **แถวดิบตามชีตเป๊ะ** ไม่ใช่ของที่ normalize แล้ว
- 🔴 โดยเฉพาะข้อ 2 ที่ยุบ 3 คอลัมน์เป็น `คำตอบ` ก้อนเดียว → **เขียนกลับไม่ได้โดยหลักการ ไม่ว่าจะ rename ยังไง**
  **นี่คือเหตุผลที่แท้จริงที่ปุ่มเขียนใน /train พัง** (ไม่ใช่เรื่องชื่อแท็บอย่างที่ KI D-65/D-68 เข้าใจ) และเป็นสิ่งที่บล็อกเฟส D อยู่
- แต่ละ logic ต้องมีเทสของตัวเองก่อนย้าย โดยเฉพาะ **"ว่าง=draft"**
- ปลดล็อกปุ่มเขียนที่นั่น พร้อมเทสว่าเขียนถูกแท็บ ถูกแถว ถูกคอลัมน์ · **D-72a ยังคง `assertWritable()` ไว้**

#### จุดที่ rename แล้วเกือบเปลี่ยนพฤติกรรม (ดักได้ทัน)
- 🔴 **`TAB_KEY_COL` ชนกัน** — overlay ทับที่ชั้น batchGet (**แถวดิบ**) ส่วน preview/write อ่าน **shape ที่ normalize แล้ว** · พอชื่อแท็บเหมือนกันทั้งสองฝั่ง คีย์คอลัมน์ของ `Knowledge` ดันต่างกัน (ชีต=`ลูกค้าพูดยังไง` · shape=`คำถาม`) → รวม map เดียว = **overlay หาแถวไม่เจอแล้วเงียบ** · แยกเป็น `RAW_TAB_KEY_COL` / `TAB_KEY_COL`
- 🔴 **`v3-golden.test.ts` seed ของที่ normalize มาแล้ว** ทับคีย์ที่ไม่มีใครอ่าน (`CSV_Step`) → loader เห็นแค่ default ของ `seedBotLib` มาตลอด · พอ rename ชื่อตรงกัน มันจะถูกอ่านจริงแล้ว **normalize ซ้ำสองรอบ** (ข้อมูลหาย) → แก้เป็น seed แถวดิบตามกติกา D-68 ข้อ 2
- `.env.example` / `.env.test` มี `SHEET_BOTLIB_ID` ซ้ำสองบรรทัดหลัง rename (dotenv เอาบรรทัดหลัง) → dedupe แล้ว

#### 🔴 จุดเดียวที่ rename แล้ว "พฤติกรรมเปลี่ยนจริง" — รายงานเจ้าของแล้ว (ไม่ใช่พฤติกรรมบอท)
**ปุ่ม "▶ ทดสอบ draft ในห้องซ้อม" (`testDraftInSandbox`) ของแท็บ Steps/Knowledge กลับมาทำงาน**
- overlay ของห้องซ้อมทับที่ชั้น `batchGet` ซึ่งใช้ **ชื่อแท็บบนชีต** · แต่ UI ส่ง `tab` เป็น **ชื่อ shape** (`CSV_FAQ`/`CSV_Step`)
- ก่อน D-72a ชื่อสองฝั่งไม่ตรงกัน → `applyOverlayToTab` filter ได้ 0 entry → **ปุ่มนี้ตายเงียบมาตั้งแต่ D-61.B** (ไม่มี error · ไม่มี log)
- `CSV_Vars` บังเอิญชื่อตรงกันทั้งสองฝั่งอยู่แล้ว → แท็บ Vars ทำงานปกติมาตลอด = **อาการไม่ครบทุกแท็บเลยไม่มีใครเห็น**
- พอ rename ชื่อตรงกันหมด ปุ่มนี้จึงทำงานตามที่ออกแบบไว้
🔴 **ขอบเขต: /train เท่านั้น** — overlay มีอยู่ได้เฉพาะใน sandbox context (ALS) · ไม่มี context = เส้น production เดิมทุกบรรทัด
→ **บอทฝั่งลูกค้าไม่เปลี่ยน** (golden ชั้น D diff ว่างเปล่ายืนยัน) · ✅ **เจ้าของเคาะ (ก) — เก็บพฤติกรรมที่ฟื้นไว้**
เหตุผล: มันตายเพราะบั๊กชื่อไม่ตรง ไม่ใช่การตัดสินใจปิด · rename คืนดีไซน์เดิม · กระทบ /train เท่านั้น · ตรงทิศทางเฟส D พอดี
⚠️ **ยังไม่พิสูจน์ด้วยมือ** — เจ้าของต้องเทส · และ **overlay เห็นผลเฉพาะคอลัมน์ที่เข้า prompt** (`สาระที่ต้องสื่อ` ของ Steps + `แนวตอบ` ของ Knowledge)
→ draft ที่ช่อง `แนวตอบ` ของ **Steps** จะไม่เห็นอะไรเปลี่ยน เพราะคอลัมน์นั้นไม่เข้า prompt (D-66 §4) — **ไม่ใช่ปุ่มพัง**

#### เทสที่ต้องแก้เพราะ rename (ไม่ได้ลดเกณฑ์ · 8 เคส)
ทุกเคสเป็น assertion ที่ผูกกับ **ชื่อเก่า** หรือ seed ที่ **ตายมาตั้งแต่ D-61.B** — ไม่มีเคสไหนถูกลบหรือ skip
- `sheet-loader`: `not.toContain("Steps!A:Z")` (เดิม = ชื่อ v2) → เปลี่ยนเป็นเช็คว่า **ชื่อเก่า** (ไทย/`CSV_`) ต้องไม่ถูกขอ · `BOTLIB_TABS` 8→7 + `CSV_Objections` หาย → เพิ่ม assertion `BOTLIB_TABS = SHEET_TABS + Follow`
- `v3-only` / `v3-adapter`: ชื่อแท็บไทย + `SHEET_BOTLIB_V3_ID` → ชื่อใหม่
- `train-phase-c2-rows`: `suggestNextKey("CSV_Objections")` → `Steps` · เคส overlay เดิมป้อน **shape ภายใน** ที่ prod ไม่มีวันเห็น → เขียนใหม่ให้วิ่ง raw→overlay→normalize→matcher (กติกา D-68 ข้อ 2)
- `train-assistant` / `golden-routing`: seed `botLibReturn.CSV_FAQ` เป็น shape v2 → **ตายมาตั้งแต่ D-61.B** · พอ rename ชื่อดันตรงแท็บจริงแล้วไป**ทับ**ของที่ `seedBotLib()` วางไว้ → ลบ seed ตายทิ้ง (golden เหมือนเดิมทุกบรรทัด)

#### ENV — ไม่มีช่วงบอทดับ (เจ้าของเคาะ)
`SHEET_BOTLIB_V3_ID → SHEET_BOTLIB_ID` · **ยืนยันแล้วว่าโค้ดปัจจุบันไม่มีจุดไหนอ่าน `SHEET_BOTLIB_ID`** (มีแต่ในคอมเมนต์/`scripts/sheet-lint.mjs`/เทส — `process.env` อ่านแค่ `SHEET_BOTLIB_V3_ID` 5 จุด)
→ เจ้าของ **แก้ค่า** `SHEET_BOTLIB_ID` ที่มีอยู่แล้วบน Vercel ให้ชี้ชีต v3 **ก่อน** CC push · deploy ปัจจุบันไม่อ่าน = ไม่มีผล · deploy ใหม่อ่านเจอค่าถูกทันที
⚠️ **ถ้าไม่ทำตามลำดับนี้จะพัง** — ตอนตรวจพบว่า `SHEET_BOTLIB_ID` บน Vercel ยังถือ id ของ **ชีต v2 เก่า** (สร้างไว้ 47 วัน · manual step ค้างจาก D-68 ที่ยังไม่ได้ลบ) · deploy ใหม่จะอ่านเจอค่าเก่าแล้วบอทตายเงียบ

#### อื่น ๆ ที่ทำในคอมมิตนี้
- ลบ `objCap` (`จำนวนข้อโต้แย้งที่ยัดเข้า prompt`) + `buildObjectionInjection` + `ObjectionInjection`/`OBJECTION_COLS` (ไม่มีผู้เรียกใน prod แล้ว) · **prompt ไม่เปลี่ยน**: handler ส่ง `objectionText: ""` → `buildUserContent` ระบุ "(ไม่มีข้อโต้แย้งที่ตรงกับข้อความลูกค้า)" เหมือนเดิมเป๊ะ (ของเดิม `buildObjectionInjection([])` ก็คืน `text: ""` อยู่แล้ว)
- Studio: label ของแท็บ = ชื่อแท็บในชีตเป๊ะ (เดิม `FAQ`/`ประตูขาย`/`ตัวแปร` = ชื่อที่หาในชีตไม่เจอ) · การ์ด schema ใน dashboard โชว์ `t.tab` อยู่แล้ว
- `validateV3Bundle → validateBundle` · `V3_SHEET_TABS → SHEET_TABS` · `V3TabStat → TabStat` · log `scope: "sheets-v3" → "sheets"`
- 🔴 **คง `funnel_stage` optional ของ D-68 ไว้** — เจ้าของเคาะแล้วว่าจะเปิด intake D-34/35 กลับมาเป็นงานถัดไป ไม่ใช่โค้ดตาย

#### เกณฑ์ผ่าน
🟢 **golden ชั้น D เทียบ baseline แล้ว diff = ว่างเปล่า** (37 passed · เก็บ baseline ไว้ก่อนแตะโค้ดบรรทัดแรก) · `npm test` เขียว · `tsc` สะอาด
⚠️ **golden ชั้น G รันไม่ได้จนกว่าเจ้าของเปลี่ยนชื่อแท็บในชีต** — ไม่ใช่เงื่อนไขของคอมมิตนี้ (ระบุเป็น manual step ใน STATUS)

#### เลือก gemini-3.7-flash (จาก D-69)
ทดสอบ `gemini-3.5-flash-lite` แล้ว **ตก** — เหตุผล:
- **ถือคำลงท้ายไม่อยู่** พูด "ครับ" ทั้งที่ตั้ง `เพศบอท=หญิง`
- **ตอบเหมือนกันทุกคำถาม ไม่ปรับตามที่ลูกค้ากังวล** = ท่องข้อมูล ไม่ได้คุย
→ ขัดเจตนาทั้งหมดของ D-61 (หมวกนักขาย 3 ใบ · 3C · ตอบแทรก-พากลับ) · **ถูกลงแต่ไม่คุ้ม**
เลือก **`gemini-3.7-flash`**: ต้นทุน 0.54 → ~0.27 บาท/เทิร์น (**−50%**) โดยคุณภาพไม่ตก

### D-69 · ลดต้นทุน token + แก้ degraded — โมเดล/thinking/timeout ตั้งจากชีตได้ (1 commit)
ปัญหา 2 อย่างจากรากเดียวกัน (การเรียก Gemini): (1) บทยาว degraded เพราะ timeout 8 วิ แต่ 274 tokens ใช้ 10.7 วิ (2) ต้นทุน ~0.49 บาท/เทิร์น · input 7,709 tok/เทิร์น (system prompt 54% ส่งซ้ำทุกเทิร์น)
🔴 **เจ้าของยืนยัน: ห้ามตัด history** (1,898 chars ≈ 10% ไม่ใช่ตัวปัญหา)

#### 🔴 สิ่งที่พบก่อนลงมือ — ตัวลดต้นทุนหลักคือ "รุ่นโมเดล" ไม่ใช่ caching
ราคาต่อ 1M tokens (ai.google.dev/gemini-api/docs/pricing · ดึง 2026-08-28):

| โมเดล | input | output | cached input | ประเมิน/เทิร์น | สถานะ |
|---|---|---|---|---|---|
| **gemini-3.5-flash** (baseline) | **$1.50** | **$9.00** | $0.15 | ~0.54 บาท | ใช้อยู่ |
| gemini-3.6-flash | $0.75 | $3.75 | $0.075 | ~0.27 บาท | ⏳ ราคาโปรถึง **31 ธ.ค. 2026** แล้วขึ้น 2 เท่า |
| gemini-3.7-flash | $0.75 | $3.75 | $0.075 | ~0.27 บาท | ⏳ ราคาโปรถึง **31 ธ.ค. 2026** แล้วขึ้น 2 เท่า |
| gemini-3.5-flash-lite | $0.30 | $2.50 | $0.03 | ~0.14 บาท | ราคามาตรฐาน |
| gemini-3.1-flash-lite | **$0.25** | **$1.50** | $0.025 | **~0.10 บาท** | ถูกสุดที่ใช้ได้ |
| ~~gemini-2.5-flash~~ | $0.30 | $2.50 | $0.03 | — | 🔴 **ห้ามใช้ — Google ปิด 16 ต.ค. 2026** |
| ~~gemini-2.5-flash-lite~~ | $0.10 | $0.40 | $0.01 | — | 🔴 **ห้ามใช้ — Google ปิด 16 ต.ค. 2026** |

**3.5-flash แพงที่สุดในกลุ่ม flash** — input 2 เท่าของ 3.6/3.7 · output 2.4 เท่า
🔴 **`gemini-2.5-*` ห้ามใช้** — คงราคาไว้ในตารางโค้ดเพื่อความครบ (อ่าน log เก่าย้อนหลัง) + `warnIfDeprecatedModel` เตือนดังถ้าตั้งในชีต · ราคาถูกกว่าก็จริงแต่**หมดอายุก่อน** ย้ายไปแล้วต้องย้ายอีกรอบ

**ที่มาของวันปิด (เอกสารสองที่ยังไม่ตรงกัน — จดไว้ให้ครบ):**
- `gemini-2.5-flash` · `gemini-2.5-pro` → **16 ต.ค. 2026** (ตาราง deprecation ของ Gemini API) · **เส้นทางที่ Google แนะนำ = 3.6 Flash**
- `gemini-2.5-flash-lite` → **วันปิดไม่แน่นอน** 🔴 *ไม่ใช่ "ไม่มีวันปิด"* — หน้า deprecation ของ Gemini API ขึ้นว่า "ยังไม่ประกาศ" แต่ฝั่ง **Vertex/Agent Platform ระบุ 20 ต.ค. 2026** → ปฏิบัติเหมือนจะปิดพร้อมพี่น้องมัน
- ⚠️ **Google ระบุว่าวันเหล่านี้คือ "วันที่เร็วที่สุดที่อาจถูกปิด"** และจะ**แจ้งล่วงหน้าอย่างน้อย 6 เดือน**เมื่อกำหนดวันจริง → **อาจเลื่อนออกไป แต่วางแผนที่ 16 ต.ค. 2026 ถูกแล้ว อย่ารอ**

🔴 **ตารางราคาต้องรีวิวอย่างน้อย 2 ครั้ง** (ใส่ปฏิทินไว้):
1. **ก่อน 16 ต.ค. 2026** — วันปิด `gemini-2.5-*` · เช็คว่าเลื่อนไหม · ปิดจริงแล้วลบแถว deprecated ทิ้ง
2. **ก่อน 31 ธ.ค. 2026** — ราคาโปร 3.6/3.7 หมด → in **$1.50** / out **$7.50** = **ต้นทุนเด้งเท่าตัว** ต้องประเมินรุ่นใหม่ทั้งชุด (ตอนนั้น 3.7 จะแพงเท่า 3.5 วันนี้)
🔴 **ไม่เปลี่ยนโมเดลเริ่มต้นในคอมมิตนี้** (เจ้าของเคาะ: จะสลับเองจากชีตแล้ววัด) — default ยังเป็น `gemini-3.5-flash`

#### 🔴 ลำดับรุ่นที่จะทดสอบ (เจ้าของเคาะ)
1. **`gemini-3.5-flash`** — baseline ที่ใช้อยู่ · เก็บตัวเลขจาก `ai_usage` ไว้เทียบก่อนสลับ
2. **`gemini-3.7-flash`** — ถูกลง ~50% · รุ่นใหม่สุด คุณภาพน่าจะ ≥ baseline
3. **`gemini-3.1-flash-lite`** — ถูกลง ~80% จาก baseline · ⚠️ lite = คุณภาพต่างชัด **ต้องซ้อมโซนสุขภาพ (H1) ซ้ำทุกครั้ง** ก่อนใช้จริง
> เกณฑ์ผ่านของแต่ละรุ่น: golden ชั้น G ผ่านเท่าเดิม + บทสุขภาพ 3 รอบ 0 คำรับรอง · ถูกลงแต่คุณภาพตกในโซน H1 = **ไม่คุ้ม อย่าเอา**

#### 1 · Config keys ใหม่ 4 ตัว (ไม่มีแถวในชีต = ค่าเดิมทุกตัว · ห้ามพัง/ห้ามปิดฟีเจอร์)
| คีย์ในชีต | alias | default | หมายเหตุ |
|---|---|---|---|
| `โมเดล` | `model` · `gemini_model` | `gemini-3.5-flash` | สลับรุ่นแล้ววัดได้เลย |
| `ระดับการคิด` | `thinking` · `thinking_level` | `low` | 3.x: `minimal/low/medium/high` · 2.x: ตัวเลข |
| `timeout_วินาที` | `timeout_วิ` · `gemini_timeout` | **15** (เดิม 8) | คอลหลัก · regen ได้ครึ่งหนึ่ง |
| `ข้อความ_ระบบช้า` | `ข้อความ_ตอบช้า` | (ดูข้อ 4) | `{ชื่อบอท}` ถูกแทนค่า |

📋 **คู่มือเจ้าของ (ชื่อคีย์เป๊ะๆ + ค่าที่ควรใส่ + ข้อควรระวัง): [docs/D69-CONFIG-KEYS.md](D69-CONFIG-KEYS.md)**

#### 2 · เลือกพารามิเตอร์ thinking ตามตระกูลโมเดล — `resolveThinkingConfig` (pure · lib/gemini.ts)
🔴 **Gemini 3.x ใช้ `thinkingLevel` (enum) · 2.x ใช้ `thinkingBudget` (int) — ส่งผิดตัว/ส่งทั้งคู่ = HTTP 400**
- ส่งตัวเดียวเสมอ · ค่าในชีตใช้กับตระกูลนั้นไม่ได้ → `log scope:"gemini-config" event:"thinking-invalid"` + ใช้ default ของตระกูล (3.x→LOW · 2.x→-1 อัตโนมัติ) **ไม่ยิงจนพัง**
- โมเดลที่ไม่รู้จัก (รุ่นใหม่กว่า) → ถือเป็นตระกูล enum

#### 3 · timeout 8→15 วิ + การ์ด clamp
- **ตรวจเพดานก่อน:** LINE reply token = **1 นาที** ✓ · Vercel **Fluid compute (default) รองรับถึง 300 วิทุกแพลนรวม Hobby** → **ยก `maxDuration` 30 → 60** ใน `route.ts` (headroom สบาย)
- **การ์ด `resolveGeminiTimeouts` (pure):** `debounce + main + regen ≤ maxDuration − 6` · เกิน = **clamp ลงเอง + log `timeout-clamped`** (เจ้าของเคาะ headroom 6 ไม่ใช่ 3 — ยังมี sheet load/Neon/LINE API กินเวลา)
- **regen ได้ครึ่งหนึ่งของคอลหลัก** — เป็นทางรองและมี fallback ตัดบรรทัดอยู่แล้ว · งบจริง: 6 + 15 + 8 = 29 จาก 60

#### 4 · ข้อความ degraded ใหม่ (ตั้งจากชีตได้)
ของเดิม *"ยังไม่ได้รับข้อความล่าสุด ช่วยพิมพ์ส่งมาอีกครั้ง"* มี **3 ปัญหา**: (ก) ไม่จริง — ระบบได้รับแล้วแต่ตอบไม่ทัน (ข) สั่งพิมพ์ซ้ำ = บทยาวขึ้น → ช้าลงอีก = **วงจรที่ทำให้อาการแย่ลงเอง** (ค) สัญญาว่าจะกลับมาตอบ ทั้งที่ระบบไม่มี retry
ใหม่: **"ขออภัยค่ะ ตอนนี้ระบบตอบช้ากว่าปกตินิดนึงนะคะ {ชื่อบอท}แจ้งทีมแอดมินให้แล้วค่ะ ลูกค้าพิมพ์คุยต่อได้เลยนะคะ"**
→ ไม่โกหก · ไม่สัญญา · ไม่สั่งพิมพ์ซ้ำ · ชวนคุยต่อ (เทิร์นใหม่ = ได้ลองใหม่)
🔴 **พ่วง 🔔 แจ้งกลุ่มแอดมิน (ไม่ปิดบอท)** — ประโยค "แจ้งทีมแอดมินให้แล้ว" ต้องเป็นจริง

#### 5 · เก็บต้นทุนลง Neon ไม่ใช่แค่ log (เจ้าของเคาะเพิ่ม)
log ใน Vercel หายตามเวลา · หน้าสรุปต้นทุน (D-70) ต้องมีข้อมูลย้อนหลัง → ตาราง **`ai_usage`** ผ่าน `ensureSchema` · 1 แถวต่อ 1 การเรียก
`at · user_id · channel · model · call_kind · prompt_tokens · candidates_tokens · thoughts_tokens · cached_tokens · latency_ms · degraded · stage`
- 🔴 **`call_kind` สำคัญที่สุด** — `'regen'` = assurance guard ยิงซ้ำ = **จ่ายสองเท่าในเทิร์นเดียว** · เจ้าของต้องเห็นว่าเกิดบ่อยแค่ไหน (ถี่ = จูน prompt ไม่ใช่จ่ายเพิ่ม)
- เขียนแบบ fire-and-forget + try/catch — **เขียนพลาดต้องไม่ทำให้บอทเงียบ**
- log `scope:"ai-usage"` มีครบทั้ง latency/tokens/cached/cost ทั้ง 3 kind

#### 6 · ราคา/ต้นทุนในโค้ด = "ตัวเลขประมาณ" เท่านั้น
ตาราง `PRICE_PER_1M_USD` + `costUsd`/`costThb` ใน log **ใช้ดูแนวโน้ม/เทียบรุ่น** · 🔴 **ตัวเลขที่ใช้ตัดสินใจจริง = cost log รายวันของ Google ต่อ API key** (เจ้าของมีอยู่แล้ว · D-70 ใช้เป็นตัวหลัก) · โมเดลไม่รู้จัก → **ไม่เดาราคา** log `"unknown-model-price"`

#### 7 · context caching — ผลตรวจ (🔴 ยังไม่ทำ ตามที่เจ้าของเคาะ)
- `@google/genai` 2.10.0 **รองรับเต็ม**: `ai.caches.create({model, config:{systemInstruction, contents, ttl}})` + `usageMetadata.cachedContentTokenCount`
- 🔴 **implicit caching เปิดอยู่แล้วอัตโนมัติ** สำหรับ Gemini 2.5+ (รวม 3.x) · **ขั้นต่ำ 4,096 tokens** — system prompt เรา ≈ 4,160 tok **เกินเกณฑ์พอดี** → มีโอกาสได้ส่วนลดอยู่แล้วโดยไม่รู้ตัว
- ⚠️ prefix ที่นิ่งจริงมีแค่ `systemInstruction` + Config — `stepText` เปลี่ยนตามข้อความลูกค้า (entry-match) และ `<เวลาปัจจุบัน>` มีนาที
- explicit cache คุ้มไหม: เก็บ 4,200 tok · storage $0.50/1M/ชม. = $0.0021/ชม. · ประหยัด $0.0028/เทิร์น → **คุ้มตั้งแต่ ~1 เทิร์น/ชม.**
- **แผน: ดู `cachedTokens` ใน `ai_usage` ก่อน** — hit อยู่แล้ว = ไม่ต้องทำอะไร · hit = 0 ค่อยเปิด **D-71**

#### ⚠️ บทเรียนเครื่องมือ (KI-04 ตระกูลเดียวกัน)
`tests/harness/fixtures.ts` **ห้าม import "ค่า" จาก `@/lib/config`** — `setup.ts` mock config ด้วย factory ที่ `import("./fixtures")` → วงกลม → **worker ค้างจนตาย ไม่มี error ให้เห็น** (ใช้เวลาไล่นาน) · fixture ต้อง hardcode ค่า default ซ้ำ ซึ่งเป็นผลดี: ใครเปลี่ยน default ในโค้ด เทสจะแดงให้เห็น
+ เทสที่พิสูจน์ "อ่านค่าจากชีตจริง" ต้องใช้ `vi.importActual("@/lib/config")` — `getConfig` ตัวที่ mock ไว้คืน fixture เสมอ (จะผ่านโดยบังเอิญ ไม่ได้พิสูจน์อะไร)

### D-68 · ถอด v2 ออกจากระบบ — v3 เป็นทางเดียว (1 commit)
เจ้าของ **override เงื่อนไข (2) ของ D-66** (บทจริง ≥20 บท / ≥7 วัน) — ไม่ใช่เงื่อนไขครบ
เหตุผลที่ override: **ยังไม่มีลูกค้าจริง → ถอดตอนนี้เสี่ยงน้อยกว่าถอดตอนมีลูกค้า** · ตาข่ายที่ใช้แทน = **Vercel Instant Rollback** · และการถอด v2 ทำให้งานเฟส D (หน้า Train ใหม่) เล็กลงมากเพราะไม่ต้องรองรับสองโครง

#### สิ่งที่ถอด
- `prompt/system.ts` (v2) **ลบทั้งไฟล์** — ย้าย `buildUserContent`/`formatThaiNow` ไป `prompt/system-v3.ts` (ย้ายเฉย ๆ ไม่แก้เนื้อ) · `gemini.ts` เลิกมี `selectSystemInstruction`
- `lib/schema-mode.ts` + ENV `SHEET_SCHEMA` **ลบทั้งชุด** — ปุ่ม "ชีต: v2/v3" ใน /train · param `schema` ทั้งสาย (3 API routes · turn.ts · sandbox.ts) · ชิป "โหมดที่ระบบใช้จริง" ในการ์ด dashboard
- handler: `notifyPrecheckV2` · `composeReplyV2` · `pushNotifyDoorV2` · payment pre-check (ข้าม AI) · branch `v3 ? … : …` ทุกจุด
- config: `notifyKeywords` · `notifyDoors` · `parseNotifyDoors` + คีย์ `คำ_notify`/`คำ_notify_<door>` (ประตู handoff_notify เป็นของ v2)
- `quotaSaver` → **hardcode `false`** + ลบคีย์ `โหมดประหยัดโควตา` ออกจากโค้ด · เจ้าของลบแถวออกจากชีตเอง (คีย์ที่แก้แล้วไม่มีผล = กับดักแบบเดียวกับ "แนวตอบ" D-66 §4) · 🔴 ถ้าโควตา LINE เป็นปัญหาจริงในอนาคต → **เปิด D-63** (scope เฉพาะ push ไม่ใช่กลับไปยุบทั้งเทิร์น)
- Train Studio: ตัด `CSV_Objections` ออกจาก `EDITABLE_TABS`/`ASSISTANT_TABS`/`MANAGED_TABS`/แท็บใน UI (v3 ยุบเข้าแท็บ "ความรู้" → adapter คืน `[]` เสมอ)
- เทส: `handoff-notify.test.ts` ลบทั้งไฟล์ · `verbatim.test.ts` → เก็บ 3 การันตีที่ยังจริง เปลี่ยนชื่อเป็น `delivery-guards.test.ts` · `line-freeze-baseline.test.ts` → `delivery-invariants.test.ts`

#### ENV — ลำดับที่ต้องทำตาม (🔴 ผิดลำดับ = บอทตายทั้งตัว)
`resolveFeatureSwitches` ใช้ `SHEET_BOTLIB_ID` เป็น **สวิตช์เปิด/ปิดแกนขายทั้งระบบ** (`salesCore`) + `followReady` → ย้ายการ์ดทั้งสองไป `SHEET_BOTLIB_V3_ID` แล้ว
- คงชื่อ env ที่มี `v3` ค้างไว้ **โดยเจตนา** — ยอมชื่อไม่สวยเพื่อเลี่ยงจังหวะที่โค้ดกับ Vercel ไม่ตรงกัน (เปลี่ยนชื่อ = ต้อง 2 deploy)
- 🔴 **manual step ค้าง:** deploy โค้ดใหม่ → ยืนยัน prod เขียว → **เจ้าของลบ `SHEET_BOTLIB_ID` ออกจาก Vercel เอง** (ห้ามลบก่อน deploy)

#### 🔴 1 · ฟีเจอร์ที่ผลิต funnel ไม่ได้จริงตั้งแต่ cutover v3 (เจอตอนแปลง fixture)
`adaptSteps` คำนวณ funnel จาก **step_id เท่านั้น** (`FIXED_FUNNEL` รู้จัก S1/S2/S2Q/S3/S4) + flag `handoff` → ผลิตได้ 5 ค่า แต่โค้ดยังอ่าน `VALID_FUNNEL_STAGES` 10 ค่า:
- **`handoff_after_intake`** → **D-34/35 intake ตายโดยไม่ตั้งใจ** (คุยเก็บข้อมูลก่อนส่งคน + เพดานเทิร์น + ขั้นต่ำ) → คีย์ `เพดานเทิร์นก่อนส่งแอดมิน` / `เทิร์นขั้นต่ำก่อนส่งแอดมิน` = **คีย์ตาย**
- **`awaiting_payment` / `awaiting_address`** → region routing หลังสรุปยอด **moot โดยการออกแบบ ไม่ใช่บั๊ก** (v3 ยุบ S4A/S4B เหลือ S4 ประตูเดียว = ไม่มีหลายประตูใน funnel เดียวกันให้เลือก)
- **`post_sale`** → ไม่มีประตูรองรับ
- **ทางแก้ที่เลือก (เจ้าของเคาะ):** `adaptSteps` อ่านคอลัมน์ **`funnel_stage` ถ้ามี** · ไม่มี/ว่าง = `FIXED_FUNNEL` เดิม → **ชีตจริงยังไม่มีคอลัมน์นี้ = prod วันนี้เหมือนเดิมเป๊ะ** · เป็นการเพิ่มความสามารถ ไม่ใช่ลงทุนกับ adapter ที่กำลังจะทิ้ง (โค้ดนี้ต้องถูกยกไปเส้นทาง v3 หลัง D-69 อยู่ดี ถ้าอยากให้ฟีเจอร์ทำงาน)

#### 🔴 2 · สาเหตุที่ไม่มีใครรู้ — fixture ไม่ได้วิ่งผ่านเส้นทางเดียวกับ prod
`seedBotLib` seed `botLibReturn` ด้วย **ชื่อแท็บ v2** (`CSV_Step`/`CSV_FAQ`) ตั้งแต่ D-61 · loader โหมด v3 ขอแท็บ `เส้นทางขาย`/`ความรู้` → mock คืน `[]` → **เทสทั้ง repo มองโลกเป็น v2 มาตลอด** ทั้งที่ prod เป็น v3 = **ความมั่นใจปลอม**
- อาการที่โผล่ทันทีเมื่อ fixture ตรงกับ prod: intake นับเทิร์นไม่ได้ · `diag/steps` จับ typo funnel ไม่เจอ · ปุ่มเขียน /train พัง (ดูข้อ 4)
- 🔴 **กติกาใหม่ (ถาวร): fixture ต้อง seed ผ่านเส้นทางเดียวกับ prod เสมอ** — seed "ชีตดิบ" แล้วปล่อยให้ loader+adapter ทำงานจริง ห้าม seed shape ปลายทางตรง ๆ
- ทำแล้ว: `TAB` constant (ชื่อแท็บที่เดียวทั้ง repo — D-69 แก้บรรทัดเดียว) + `v3StepRows()` / `v3KnowRows()` ใน `tests/harness/botlib-fixture.ts` · ไฟล์เทสห้ามเขียนชื่อแท็บ/header เอง
- +harness เก็บ `geminiState.lastInput` (prompt ที่โมเดลได้รับจริง) — v3 เรียบเรียงสด สิ่งที่ชีตคุมได้คือ prompt ไม่ใช่ข้อความลูกค้า เทสที่พิสูจน์ "ชีต/draft มีผล" ต้องวัดที่นั่น

#### 🔴 3 · เจ้าของเคาะแล้ว: จะเปิด intake D-34/35 กลับมา (ทำจริงใน **D-73** — เลข D-70 ในบันทึกนี้คือเลขเก่าก่อนสลับ)
งาน D-68 นี้**ไม่ทำอะไรเพิ่ม** — จดไว้เพื่อไม่ให้ `funnel_stage` / โค้ด intake ถูกเข้าใจผิดว่าเป็นโค้ดตายแล้วโดนลบทิ้ง
ตอนทำ D-70 ต้อง: เพิ่มคอลัมน์ `funnel_stage` ในแท็บ Steps จริง + กำหนดว่าแถวไหนใช้ `handoff_after_intake`

#### 🔴 4 · ปุ่มเขียนใน /train — KI D-65 ฉบับแก้ (เดิมจดไว้ผิด)
D-65 จดว่า "ชี้ผิดไฟล์ (`SHEET_BOTLIB_ID`)" · แก้ให้ชี้ `SHEET_BOTLIB_V3_ID` แล้ว **ยังเขียนไม่ได้อยู่ดี** ด้วยเหตุ 2 ชั้น:
- **ชั้น 1** ชื่อแท็บใน `EDITABLE_TABS` (`CSV_Step`/`CSV_FAQ`) เป็น **ชื่อ shape ภายใน** ไม่มีอยู่จริงบนชีต v3 (แท็บจริง = `เส้นทางขาย`/`ความรู้`) → range ชี้แท็บที่ไม่มี
- **ชั้น 2 (อันตรายกว่า)** `locateInLib` หา row/col index จาก **bundle ที่ adapter แปลงแล้ว** แล้วเอาไปเขียน **ชีตดิบ** (คนละ header คนละลำดับ) → ต่อให้แก้ชื่อแท็บถูก จะ **เขียนทับผิดช่องแบบเงียบ** (เช่น `ตัวอย่างคำตอบ` ตกใส่คอลัมน์ `handoff`)
- **ชั้น 2 จะหายเองเมื่อ D-69 ถอด adapter** (shape ภายใน = shape ชีตดิบ) → **A2 (ทำ mapping ให้ถูก) ทำที่ D-69 ไม่ใช่ที่นี่**
- **ทำใน D-68 (A1):** `assertWritable()` throw ก่อนแตะ Google ทั้ง 3 ทาง (`writeCell`/`appendRow`/`setRowStatus`) · ข้อความบอกทั้งสาเหตุและทางออก · UI แสดง error จาก API อยู่แล้ว (`flash(⚠️ …)`) ไม่ต้องทำเพิ่ม · เทสยืนยันว่า **ไม่มี batchUpdate/append ไปถึงชีตเลย แม้แต่ TRAIN_LOG**
- 🔴 guard วางไว้ **หลัง** conflict/lint/funnel/dup guard ทุกตัว → การันตีเดิมยังพิสูจน์ได้ครบ (lint block → คืน `{status:"lint"}` ไม่ throw · ผ่าน lint → throw = ตัวพิสูจน์ว่า "lint ไม่ block")
- +เจอเพิ่ม: `TAB_KEY_COL` ใน sandbox ไม่มีชื่อแท็บ v3 → **draft overlay หาแถวไม่เจอแล้วเงียบ** ตั้งแต่ cutover · เติมชื่อแท็บ v3 แล้ว

#### 🔴 5 · draft overlay ที่ "มีความหมาย" ใน v3 = overlay บนคอลัมน์ที่เข้า prompt เท่านั้น
`สาระที่ต้องสื่อ` (เส้นทางขาย) และ `แนวตอบ` ของแท็บ **ความรู้** (เฉพาะแถวที่ keyword ตรง) · overlay บน `แนวตอบ` ของเส้นทางขาย = ช่อง "ตัวอย่างคำตอบ" ใน Studio **ไม่มีผลกับอะไรเลยนอกจากหน้าพรีวิว** (D-66 §4)
→ **ข้อนี้คือสเปคตั้งต้นของวงจร draft ในเฟส D** · เทส `train-phase-b` ย้ายไปพิสูจน์บน `สาระที่ต้องสื่อ` แล้ว (เปลี่ยนสิ่งที่วัดให้ตรงความจริง v3 ไม่ใช่ลดเกณฑ์)

#### ค้างไว้ให้ D-69 (ไม่ทำที่นี่)
- **ถอด adapter ทิ้ง + เปลี่ยนชื่อภายในและชื่อแท็บเป็นอังกฤษ** (`Steps`/`Knowledge`/`Products`/`Promo`/`Vars`/`Config`) เพื่อไม่ให้เหลือชั้นแปลชื่อในระบบ — เจ้าของเคาะแล้วว่าทำทันทีหลัง D-68 ไม่ใช่เลื่อนไปเฟส D
- `objCap` (`จำนวนข้อโต้แย้งที่ยัดเข้า prompt`) — **ยังมีคนเรียกจริง** (`handler.ts` → `buildObjectionInjection`) จึงไม่ลบในงานนี้ แต่ **ไร้ผลแล้ว** เพราะ adapter คืน `CSV_Objections=[]` เสมอ → **ลบพร้อม adapter ใน D-69**
- `no_status_col` ใน `appendRow` กลายเป็น branch ที่ v3 เข้าไม่ถึง (adaptKnowledge ประกอบ header เองเสมอ · default draft)
- เส้นทาง header `status` (อังกฤษ) ของ CSV_FAQ เข้าไม่ถึงแบบ end-to-end แล้ว — การันตีย้ายไปพิสูจน์ที่ `statusColumnIndex` โดยตรง

### D-67 · ปลดล็อกตัวแปรรูปในโหมด v3 — CSV_Vars เป็นคลังรูปได้จริง (1 commit)
อาการ: `[[รูป:{รูปโปรโมชั่น}]]` ใน `สาระที่ต้องสื่อ` ของ S2 + CSV_Vars live ค่าเป็น URL จริง — แต่บอลลูนรูปไม่เคยขึ้นใน v3
- 🔴 **ยืนยันสมมติฐานก่อนแก้ (probe ชีตจริง+Gemini จริง · input ประกอบด้วย builder เดียวกับ handler):** ข้อมูลชีตถูก · `resolveAllVars` แทนค่าได้ · **โมเดลพิมพ์ token 0/3 รอบ** → แก้เฉพาะบรรทัดกฎตัวแปร (`system-v3.ts:139`) ชั่วคราวแล้ววัดซ้ำ → **3/3 รอบ · invented vars = 0** → whitelist ชื่อตายตัว ("เช่น {ธนาคาร}...{รูปสินค้า}") คือตัวเหตุ — โมเดลตีความเป็นลิสต์ปิด · พิสูจน์เชิงเหตุ-ผลแล้วค่อยแก้จริง
- **1 · กฎตัวแปรใหม่ (บรรทัดเดียว · โซนเดิม):** "ตัวแปรในปีกกาที่**ปรากฏในข้อมูลแนบ**: คัดลอกตามเดิมทุกตัวอักษร (รวม `[[รูป:{...}]]` ทั้งก้อน) · **ห้ามประดิษฐ์ชื่อตัวแปรที่ไม่ได้เห็น**" — เจ้าของยืนยัน: บอทส่งเฉพาะรูปที่สั่งในชีต คุณสมบัตินี้คงอยู่ (คัดลอกได้เฉพาะที่เห็น + `line.ts` ทิ้ง URL ที่ไม่ใช่ http(s) อยู่แล้ว)
- **2 · resolver ครอบครบอยู่แล้ว ไม่ต้องแก้:** v3 ทุกคำตอบออกเป็น reply เดียว → `resolveAllVars` ที่ handler จุดเดียว (เส้น regen ของ assurance guard ก็ผ่าน `resolveReply`) — token จากเส้นทางขาย/ความรู้ เส้นทางเดียวกัน
- **3 · ชื่อชน (เจ้าของเคาะ): ตัวแปรระบบชนะเสมอ** — runtime เดิมถูกอยู่แล้ว (`resolveCsvVars` ข้าม+log) · เพิ่ม lint `var-collision` (warn): token ที่ชน `KNOWN_RUNTIME_VARS` + แถว CSV_Vars เองผ่าน `opts.varName` → บอกเจ้าของให้เปลี่ยนชื่อ
- **4 · 🔴 รูปหายต้องมองเห็น (เดิมเงียบสนิททั้ง prod และห้องซ้อม):** log ย้ายจาก `parseSegmentToMessages` → `parseReplyIntoMessages` เป็น structured event `{scope:"line", event:"image-dropped", url, segment}` (ย้ายขึ้นเพื่อไม่ยิงซ้ำจากตัวนับ C6 `countMessagesUncapped`) → console tee ของ sandbox เก็บ → `collectDroppedBubbles` อ่าน event นี้เพิ่ม (dedup) → ห้องซ้อมขึ้นบอลลูนขีดฆ่า · เหตุผล: บทเรียน C6 — ห้องซ้อมที่ไม่บอกว่าของหาย = ห้องซ้อมโกหก
- **5 · lint `var-empty` (warn):** แถว CSV_Vars live แต่ช่อง "ค่า" ว่าง — runtime ไม่แทนค่า (`quote.ts` `if (value && ...)`) = ตัวแปรค้างดิบถึงลูกค้า/รูปหายเงียบ ทั้งที่ lint เดิมเขียว (นับ "รู้จัก" แค่ชื่อมี)
- **6 · ตัวพิสูจน์ v2 freeze:** `line-freeze-baseline.test.ts` — จับ output `parseReplyIntoMessages` 13 เคส **จากโค้ดก่อนแก้** (`fd6923c`) hardcode เป็น fixture → โค้ดใหม่ต้องให้ message ชุดเดิมเป๊ะ (freeze ต้องมีตัวพิสูจน์ ไม่ใช่คำรับรอง)
- **7 · สแกนชีต v3 จริงหลังแก้ lint:** **warn ใหม่ = 0** (เกณฑ์หยุด >5) · finding ชนิดเดิมค้าง 1 อัน (ไม่เกี่ยวงานนี้)
- 🔴 **เกณฑ์แตะ shared infra ภายใต้ v2 freeze (เจ้าของเคาะ · ใช้ตัดสินครั้งต่อไป):** "shared infra แก้ได้ ถ้าพฤติกรรมที่ลูกค้าได้รับไม่เปลี่ยน และมีเทสยืนยัน · ถ้าเปลี่ยนพฤติกรรม ต้องแยกทางให้ v3 เท่านั้น" — D-66 freeze v2 ไม่ได้ freeze shared infra
- **เทส:** E2E v3 รูปจาก CSV_Vars ชื่อตั้งเอง → บอลลูนรูป URL ถูก + ปิดท้ายข้อความ · ชนชื่อระบบ → ค่าชีตไม่โผล่ + lint warn · token ค้าง → ไม่ส่งรูป + event ครั้งเดียว + `collectDroppedBubbles` โชว์ · ค่าว่าง → warn · token เข้า prompt ได้ทั้ง `สาระที่ต้องสื่อ` และแท็บความรู้ · **ชั้น G เพิ่ม G31**: รูปโปรถึงลูกค้าจริง + ไม่มี `{...}` ค้าง/ประดิษฐ์ ×3 รอบ
- ⚠️ **หมายเหตุวินิจฉัย:** อาการ "studio ขึ้นแดง ตัวแปรไม่รู้จัก" ที่เจ้าของเห็นตอนแรก reproduce ไม่ได้บนชีตปัจจุบัน (lint รู้จัก CSV_Vars live อยู่แล้ว) — น่าจะเป็นสถานะชีตก่อนเติมแถว/ก่อนตั้ง live · ต้นเหตุจริงของ "รูปไม่ขึ้น" คือ prompt ไม่ใช่ lint

### D-66 · v2 = FROZEN · จดผลซ้อมรอบแรก · ล้างซาก (เอกสาร/repo ล้วน · 1 commit)
**เจ้าของตัดสินใจ 2026-08-20: เดินหน้าด้วย v3 อย่างเดียว** หลัง v3 ขึ้น prod และซ้อมรอบแรกผ่านเกณฑ์หลัก

#### 1 · v2 = FROZEN (ตั้งแต่ 2026-08-20)
- 🔴 **ห้ามแก้ ห้ามเพิ่มฟีเจอร์ใน v2** — รวมถึง `prompt/system.ts` · ชีต v2 · เส้นทาง verbatim/precedence D-40/D-42
- 🔴 **งานใหม่ทุกชิ้นเขียนแบบ v3-only — ห้ามออกแบบรองรับสองโหมด** (ไม่ต้อง branch `isSchemaV3()` ในโค้ดใหม่ · ไม่ต้องเขียนเอกสารสองคอลัมน์อีก)
- โค้ด v2 **คงไว้ในฐานะตาข่าย rollback เท่านั้น** — ยังไม่ถอด เพราะสลับกลับได้ใน ~1 นาที (ตั้ง `SHEET_SCHEMA=v2`) ยังคุ้มกว่าความเสี่ยงถอดเร็ว
- ⚠️ ข้อความ "กำกับสองสถานะ v2/v3" ที่ D-65 เพิ่งเขียนไว้ **ยังถูกต้องในฐานะคำอธิบายของที่มีอยู่** — แต่เลิกใช้เป็นแนวทางออกแบบของใหม่

#### 2 · เงื่อนไขถอด v2 (checklist · ติ๊กครบเมื่อไหร่ = เปิดงานถอดได้)
- [ ] **(1) ซ้อมครบ 5 บท ผ่านเกณฑ์** · บทสุขภาพรัน **3 รอบ ได้ 0 คำรับรอง** ทุกรอบ
- [ ] **(2) บทสนทนาจริงบน v3 ≥20 บท _หรือ_ ≥7 วัน โดยไม่ต้อง rollback** (นับจากวันขึ้น prod)

**สิ่งที่จะลบตอนถอด (list ไว้ล่วงหน้า ให้คนถอดไม่ต้องไล่หาเอง):**
`prompt/system.ts` · adapter สองทาง (`lib/sheets/adapter-v3.ts` เหลือเป็นตัวอ่าน v3 ตรง ๆ ไม่ต้อง map เป็น shape v2) · สวิตช์ `SHEET_SCHEMA` + `lib/schema-mode.ts` · ENV `SHEET_BOTLIB_ID` · ชีต v2 (**มีสำเนา backup แล้ว**) · ปุ่ม "ชีต: v2/v3" ในห้องซ้อม · golden เคสที่ผูกกับ v2

#### 3 · ผลซ้อมรอบแรก (2026-08-20 · v3 บน prod จริง)
- ✅ **format ราคาแยกค่าส่ง** (D-61.C5) · **payment-first** · **ทักทายครั้งเดียว** (D-61.C2 กติกาทักทาย)
- ✅ 🔴 **เคสสุขภาพ (แพ้กุ้ง / คนท้อง) = 0 คำรับรอง แม้โดนกับดัก "ก็คือทานได้ใช่มั้ย"** — **D-62 allowlist แยกบริบททำงานถูกตามออกแบบ**: ประโยค "ไม่สามารถยืนยันความปลอดภัย" **ไม่โดนตัด** (เป็นการปฏิเสธการรับรอง ไม่ใช่การรับรอง) = พฤติกรรมที่ถูกต้อง
- ✅ **ข้อเท็จจริงสินค้า ("เนื้อปลาทู 60%") มาจากแท็บความรู้จริง ไม่ใช่โมเดลแต่ง** — ตรวจย้อนแล้ว
- ✅ **คุยต่อหลังปิดการขาย ไม่เทเนื้อหา S2 ซ้ำ** → **ปิดข้อกังวลการย้าย `clearDeliveredStepsExceptCurrent` ใน D-64 (ทางเลือก ก)** — จุดล้างธงที่ `markOrderWritten` ไม่ก่อผลข้างเคียงอย่างที่กลัวไว้
- ⚠️ **คำถามขึ้นต้นบอลลูนปิด 2/3 รอบ** — แก้คอลัมน์ `สาระที่ต้องสื่อ` ของ S3 แล้วดีขึ้นจาก 0/1 **แต่ยังไม่นิ่ง** (ยังไม่เปิดงานแก้ · เฝ้าดูรอบถัดไป)
- 🔴 **`{รูปโปรโมชั่น}` ไม่ resolve — บอลลูนรูปไม่เคยขึ้นเลยในโหมด v3** · วินิจฉัยเสร็จแล้ว → **เปิดงาน D-67**

#### 4 · 🔴 บทเรียนโครงสร้างจากการวินิจฉัย D-67 — อ่านก่อนแก้ชีต v3 ทุกครั้ง
**คอลัมน์ `แนวตอบ` ของแท็บ "เส้นทางขาย" ไม่เข้า prompt ในโหมด v3** (`lib/agent/inject.ts:240-250` `fullSalesBlock` — D-41 ตัด example ออกจาก prompt ถาวร · v3 ก็ไม่ส่ง verbatim เพราะเรียบเรียงสด) ผลที่ตามมา 3 ข้อ:
1. **ช่องเดียวที่สั่งพฤติกรรมบอทได้จากแท็บเส้นทางขาย คือ `สาระที่ต้องสื่อ`** (+ `เข้าเมื่อ`/`ไปประตูไหน` ที่คุม routing) · แท็บ **ความรู้** ใช้ `แนวตอบ` ได้ แต่เข้า prompt **เฉพาะแถวที่ keyword ตรงข้อความลูกค้า** (`inject.ts:617-621`)
2. 🔴 **ช่อง "ตัวอย่างคำตอบ" ที่เห็นใน Train Studio = คอลัมน์ `แนวตอบ` ตัวนี้** (adapter map ชื่อให้ · `adapter-v3.ts:82`) — **แก้ตรงนั้นเท่ากับไม่ได้แก้อะไร** บอทไม่มีวันเห็น
3. ซ้ำร้าย ปุ่มเขียนใน Train Studio ยัง hardcode ชี้ **ชีต v2** (`lib/train/write.ts:31` · D-65) → กดเซฟแล้วไปลงผิดไฟล์อีกชั้น
> **สรุปสำหรับคนใหม่/AI:** อยากเปลี่ยนคำพูดบอทในโหมด v3 → แก้ **`สาระที่ต้องสื่อ`** (หรือแท็บความรู้) **ไม่ใช่** `แนวตอบ`/"ตัวอย่างคำตอบ" · ถ้าแก้แล้วไม่มีอะไรเปลี่ยน ให้สงสัยข้อนี้ก่อนสงสัยโมเดล

#### 5 · ล้างซาก
- ลบ branch **`phase2-v2`** ทั้ง local และ remote — ตรวจก่อนลบ: `git merge-base --is-ancestor phase2-v2 main` ผ่าน · `git log phase2-v2 ^main` ว่าง (0 commit ที่ main ไม่มี) · main นำหน้า 55 commits · tip = `93b6a73`

### D-65 · อัปเดต CLAUDE.md + STATUS จุดอันตราย ให้ตรง v3 (เอกสารล้วน · 1 commit)
เอกสารสองไฟล์ยังเขียนตามความจริงของ v1/v2 ทำให้คนอ่าน (และ session ใหม่) เข้าใจ H1 ผิดทิศ · หลักการแก้: **ทุกจุดที่ v2/v3 ต่างกัน ต้องกำกับสองสถานะชัดเจน ไม่เขียนรวมเป็นข้อเดียว**
- 🔴 **H1 เขียนใหม่เป็นตารางสองโหมด** — v2 = handoff ทันทีเสมอ · v3 = บอทคุยต่อได้ ให้**ข้อเท็จจริงตามฉลาก** แล้วลูกค้าตัดสินใจเอง · **เส้นที่ไม่ขยับคือ "ห้ามคำรับรอง" ไม่ใช่ "ห้ามบอทตอบ"** · assurance guard คุมฝั่ง output (block→regen→cut→fallback ห้ามเงียบ) · ธง 🔔 แจ้งแอดมินเสมอแม้ AI ล้ม (C2)
- **"ห้ามใส่หลักการตอบสุขภาพลง `CSV_Objections`"** → ขยายเป็น "คลังความรู้ในชีต" ทั้ง v2 (`CSV_Objections`) และ v3 (แท็บ **ความรู้**) · เพิ่มประโยคที่ขาด: **ใส่ได้เฉพาะข้อเท็จจริงตามฉลาก**
- **`prompt/system.ts` ไม่ใช่ที่เดียวแล้ว** — ระบุว่า `gemini.ts:307` เลือกด้วย `isSchemaV3()` → v3 ใช้ `prompt/system-v3.ts` (แก้ทั้งหัวข้อ "หัวใจของบอท" · รายการไฟล์ท้าย CLAUDE.md · บรรทัด prompt-lint ใน STATUS)
- **"กฎเหล็ก 10 ข้อ" vs Don't "9 ข้อ" ขัดกันเอง** → ตรวจโค้ดแล้ว **ไม่มีบล็อก `<ขั้นตอนการตอบ>` ในทั้งสองโหมด** (ของ v1) · เขียนใหม่ว่า DNA การขายอยู่ที่ไหนต่อโหมด (v2 = ในชีต · v3 = บล็อกใน system-v3) + ลิสต์ "สิ่งที่จริงทั้งสองโหมดเพราะโค้ดบังคับ" · เลิกอ้างจำนวนข้อ
- **STATUS "ไม่มี resolver `{สารก่อภูมิแพ้}` (H1 ห้ามทำ)"** ล้าสมัย → v3 ยัดคอลัมน์สารก่อภูมิแพ้เข้า prompt แล้ว (`inject.ts CATALOG_PRODUCT_COLS_V3` · D-61.B) · ที่ยังไม่มีคือ resolver สำหรับ pattern verbatim = **ยังไม่ทำ ไม่ใช่ห้ามทำ**
- **STATUS "กฎ H1 ทุกชั้น = ห้ามแตะ"** กำกวม (C2/C3/D-62 แก้ไปแล้ว) → แยกเป็น **แตะไม่ได้ 4 ข้อ** (ห้ามคำรับรอง · ห้ามเงียบ · แอดมินต้องรู้ทุกเทิร์นที่ติดธง · ห้ามใส่หลักการตอบลงชีต) กับ **แตะได้ถ้าวัดผล** (ถ้อยคำโซนสุขภาพ · allowlist ของ guard · จุดยิง/เนื้อธง · คำในชีต)
- 🔴 **คำเตือนใหม่:** `lib/train/write.ts:31` hardcode `SHEET_BOTLIB_ID` ขณะที่ loader อ่าน `SHEET_BOTLIB_V3_ID` → **ปุ่มเขียนใน /train ทุกปุ่มเขียนผิดไฟล์เงียบๆ เมื่อ `SHEET_SCHEMA=v3`** · ห้ามใช้จนกว่าเฟส D (อ่าน/ซ้อม/พรีวิว ปลอดภัย)
- ⚠️ **บทเรียนเครื่องมือ (ต่อจาก D-61.C4):** heredoc + `python -` เขียนไฟล์ไทยก็พังได้ — escape `🔴` (surrogate) ทำให้ `write()` ล้มกลางคัน **หลังลบเนื้อไฟล์ไปแล้ว** (CLAUDE.md เหลือ 0 บรรทัด กู้ด้วย `git checkout`) · **แก้ไฟล์ที่มีไทย/emoji → ใช้ Edit tool เท่านั้น**

### D-64 · ตัดงานแจกเลขออเดอร์ออกจาก cron — เหลือเฉพาะแจ้งเลขพัสดุ (1 commit)
เจ้าของย้ายการแจกเลขไป **Apps Script บนชีต** (เขียนคอลัมน์ A ตอนติ๊ก M · รูปแบบ `MMDD_n` เช่น `0819_1`) และการส่งออเดอร์เข้ากลุ่มแพ็คเปลี่ยนเป็น **คน copy จากคอลัมน์สูตรในชีต** → cron เหลืองานเดียว = D-50 แจ้งเลขพัสดุ (cron-job.org วันละ 2 รอบ 15:00/18:00 เวลาไทย)
- **ตัดออกจาก `cron/orders/route.ts`:** `resolveOrderDay` · `formatOrderMessage` · loop แจกเลข (`listPendingOrders` → `nextOrderNumber` → `markOrderSent` → push กลุ่ม) · ตัวตอบเหลือ `{status, shipped}` (ไม่มี `processed`) · `ORDER_GROUP_ID` ยังต้องมี (notifyShipping ใช้เป็นปลายทาง fallback)
- **ลบโค้ดตาย:** `lib/orders.ts` `listPendingOrders`/`markOrderSent` · `lib/db.ts` `nextOrderNumber` + DDL `order_counter` (ไม่ drop ตารางเดิม ปล่อยค้าง) + ออกจาก `TABLES` ของ harness · `AppConfig.orderNumberResetDaily`
- 🔴 **เก็บไว้ (ตรวจแล้วยังมีคนใช้):** `orderCutoffTime` + Config key `เวลาตัดรอบออเดอร์` — `quote.ts` ใช้ resolve `{วันจัดส่ง}` ที่ลูกค้าเห็น (D-39) · ลบแล้วได้แค่ความสะอาด แลกความเสี่ยงที่ลูกค้าเห็นตัวแปรดิบ
- 🔴 **D-45b hook ย้ายจุด (เจ้าของเคาะทางเลือก ก):** `clearDeliveredStepsExceptCurrent` ย้ายจาก cron → `handler.ts` ต่อจาก `markOrderWritten` (จังหวะ "เขียนชีตสำเร็จ")
  · เหตุผล: เป็นจุดที่ "ยิงแน่นอนเสมอ" · ทางเลือก ข (ตอนติ๊ก M) ไม่มีใครอ่าน M แล้ว · ทางเลือก ค (ตอนแจ้งพัสดุ) ผูกกับการที่คนกรอก Tracking — ลืมกรอก = ธงค้างถาวร ลูกค้าซื้อซ้ำเจอบอทตอบแห้ง
  · ผลข้างเคียงที่ยอมรับ: ธงล้างเร็วขึ้น อาจส่งเนื้อหา S2 ซ้ำถ้าลูกค้าคุยต่อ — เจ้าของถือว่าถูก (คุยต่อจนวิ่งกลับ S2 = สนใจซื้อเพิ่ม) · เฝ้าดูตอนซ้อม v3
- 🔴 **เงื่อนไขคิวแจ้งพัสดุใหม่:** `listOrdersToNotifyShipping` = **A(ลำดับ) ไม่ว่าง + P(เลขTracking) ไม่ว่าง + N≠TRUE** · **ห้ามพึ่ง O** เพราะ O เปลี่ยนเป็น "คนติ๊กเอง" = ลืมได้ (เดิมกรอง `o.sent` → ไม่มีใครเขียน O อีก = คิวว่างตลอดกาล ไม่มีใครได้รับแจ้ง) · dedup ยังอยู่ที่ Neon `shipping_notified` (atomic claim) ไม่เกี่ยวกับคอลัมน์ในชีต
- 🔴 **`deriveOrderStatus` แก้ตาม (ห้ามปล่อยเพี้ยน):** อิง **A/N/P + shipping_notified** · ตัด `awaiting_number` ทิ้ง · `N=TRUE`→ยกเลิก · `A ว่าง`→รอคอนเฟิร์ม · `A มีเลข + P ว่าง`→รอแพ็ค · `P ไม่ว่าง`→รอแจ้ง/แจ้งแล้ว · (ถ้าไม่แก้ ทุกออเดอร์จะค้าง "รอแจกเลข" ถาวรเพราะไม่มีใครติ๊ก O)
- **ชีตมี 27 คอลัมน์แล้ว:** แทรก **Q "กล่องส่งออเดอร์"** (สูตรให้คน copy) ต่อจาก P → `order_id`=R … `แก้ไขกี่ครั้ง`=AA · 🔴 **ห้ามใส่ชื่อนี้ใน `ORDERS_HEADER`** (จะกลายเป็น required แล้วพังถ้าชีตไหนยังไม่มี) · `resolveColumns` เมินคอลัมน์ที่ไม่ได้ขออยู่แล้ว
- 🔴 **ปิดจุดบอดเทส:** เดิม `setup.ts` ตั้ง mock header = `ORDERS_HEADER` เป๊ะ → **เทสไม่มีวันจับ column-offset ได้** · ตอนนี้ mock ใส่คอลัมน์แทรกจริง (`withExtraSheetColumns`) และ helper ใน `tests/harness/sheet.ts` + fixture ใน dashboard/cron-shipping เปลี่ยนมาอิง `sheetsCalls.ordersHeader` แทน `ORDERS_HEADER` (รวม `order-edit.test.ts` — ตัวจริงที่ mock header ใหม่จับได้: แถวทดสอบสร้างด้วย header เก่า → `updateOrderRow` หา order_id ไม่เจอ)
- **เทสใหม่:** cron ไม่ `batchUpdate`/`append` ชีตเลย (ไม่แตะ A/O) · A ว่าง → ไม่เข้าคิว · N=TRUE → ไม่เข้าคิว · O=FALSE ยังเข้าคิวได้ · `deriveOrderStatus` ครบทุกเคส + เคส "O ไม่มีผล" · layout A–AA · golden บท 19 เปลี่ยนเป็นพิสูจน์ "ธงล้างตอนเขียนชีต" แทน "cron แจกเลข"
- ✅ **ปิด KI-05** — ไม่มี loop แจกเลขใน cron ให้รันซ้อนกันอีก · ลบ Don't "แจกเลขออเดอร์แบบไม่ atomic" + แก้บรรทัดคำอธิบายระบบออเดอร์ใน CLAUDE.md
- ⚠️ **ผลข้างเคียงเชิงกระบวนการ (เจ้าของรับทราบ):** ไม่มีใครยิงออเดอร์เข้ากลุ่มอัตโนมัติแล้ว — ถ้าทีมแพ็คลืม copy จะไม่มีสัญญาณเตือน

### D-62 · ยกระดับตาข่าย H1 — guard แยกบริบท + regen ห้ามแย่ลง (1 commit · ต่อจาก C3)
เหตุ (จาก probe D-61.C3): guard จับ substring แยกบริบทไม่ได้ → false positive ฆ่าประโยค "แนะนำปรึกษาแพทย์" · regen เคยแต่งคำรับรองใหม่ที่ต้นฉบับไม่มี
- **1 · guard แยกบริบท (`lib/guards/assurance.ts findAssuranceHits`):** ออกแบบเป็น **allowlist แคบ ไม่ใช่ผ่อน blocklist** — ยกเว้นต่อ occurrence เมื่อครบ **2 เงื่อนไข**: (ก) คำเกาะติดโครง `เพื่อความ...` โดยไม่มีช่องว่างคั่น (กัน "เพื่อความสบายใจ ทานได้เลย" หลุด) (ข) **บรรทัดเดียวกัน** (หน่วยเดียวกับ cut · ตัวคั่นบอลลูนนับเป็นขอบบรรทัด) มีวลีส่งต่อ แพทย์/คุณหมอ/เภสัชกร หรือ ทีมงาน/ทีมผลิต/แอดมิน+เช็ค/ตรวจสอบ/ประสานงาน · คำรับรองตรง ("ปลอดภัยแน่นอน") / มีเงื่อนไข ("ถ้าไม่แพ้ก็ทานได้") / บรรยายสินค้า ("สะอาด ปลอดภัย มี อย.") ไม่เข้าเงื่อนไข (ก) → hit เหมือนเดิมทุกตัว
- **2 · regen ห้ามแย่ลง:** ยืนยันดีไซน์เดิม — candidate ผ่าน `findAssuranceHits` ซ้ำอยู่แล้ว (handler) · **regen มี hit ใด ๆ = ทิ้ง candidate ใช้ต้นฉบับ-ตัดบรรทัด** (เข้มกว่ากติกา "มากกว่าต้นฉบับ" ที่ขอ) · เพิ่ม log `regen-dirty {originalHits, regenHits, worse}` ให้เห็นเคส regen แต่งคำใหม่
- **เทส:** unit ใน `v3-brain.test.ts` ด้วย**ประโยคจริงจาก probe** ทั้งสองฝั่ง — เชิงระวัง 4 ประโยค (รวม 2 ประโยคที่เคยโดน cut จริง) ต้องไม่ hit · รับรอง 5 ประโยค (รวม regen-worse จริง + เคสช่องว่างคั่น + เพื่อความ...ไม่มีส่งต่อ) ต้อง hit · cut เก็บบรรทัดเชิงระวังไว้

### D-61.C3 · จูน prompt v3 โซนสุขภาพ — ลดการพึ่ง assurance guard (1 commit · โมเดล Fable)
ก่อนแก้ (วัดบน aa0f658): เทิร์นสุขภาพ 6 → guard hit 5 (83%) · regen สะอาด 2/5 · ที่เหลือจบด้วยตัดบรรทัด = คำตอบแหว่งถึงลูกค้า
- 🔴 **วินิจฉัยพลิกโจทย์ (probe เก็บประโยคดิบก่อน guard · spy `findAssuranceHits`):** hit 5/6 เป็น **false positive** — โมเดลใช้ "ปลอดภัย" ใน**ประโยคเชิงระวัง** ("เพื่อความปลอดภัยสูงสุด แนะนำปรึกษาแพทย์") ซึ่งเป็นพฤติกรรมที่ชีต K016 ขอ · guard จับ substring แยกบริบทไม่ได้ → **cut ฆ่าประโยค "แนะนำปรึกษาแพทย์" ที่ปลอดภัยสุดในคำตอบ** (ผลกลับหัว) · คำรับรองจริงมี 1/6 ("ถ้าไม่แพ้ก็ทานได้" แบบมีเงื่อนไข) · regen ทำแย่ลงได้ (เคยแต่ง "สะอาด ปลอดภัย มี อย." ที่ต้นฉบับไม่มี — โดน re-check เก็บตามดีไซน์)
- **แก้ 3 จุด (แคบสุด · เฉพาะพื้นผิวเทิร์นสุขภาพ · ไม่แตะ guard):** (1) โซน `<เคสสุขภาพ>` ใน `system-v3.ts`: "ห้ามประโยครับรอง" → **"ห้ามใช้คำ ทานได้/กินได้/ปลอดภัย/ไม่เป็นไร/หายห่วง/ไม่มีปัญหา ทุกรูปประโยค แม้เชิงแนะนำ/มีเงื่อนไข"** + บอกตรงว่าระบบตัดประโยคที่มีคำพวกนี้ + **ประโยคแทนสำเร็จรูป "แนะนำนำข้อมูลส่วนผสมนี้ปรึกษาแพทย์เพื่อความสบายใจค่ะ"** (บวก ไม่ใช่ห้ามเปล่า) (2) hint ธงสุขภาพใน handler เนื้อเดียวกัน (3) correction ตอน regenerate แนบประโยคแทน
- **ผลวัด:** hit **0/6 สองรอบติด** (เกณฑ์ ≤1/6) · probe หลังแก้: ทุกเทิร์นยังครบ ข้อเท็จจริง+cross-contact ไม่ทราบ+เสนอเช็ค+ถามกลับ+ปรึกษาแพทย์ **โดยไม่มีคำต้องห้าม = ไม่โดน cut อีก** · G เต็ม 18/18 · 566 passed
- 🔴 **บทเรียนวัดผล:** ห้ามรัน harness ซ้อนกันทุกชนิด (รวม npm test) — ต้องรอ completion notification เท่านั้น ("มี output แรกแล้ว" ≠ จบ · เคยทับกันจนต้องทิ้งผลรัน 1 รอบใน C3 เอง)

### D-61.C · v3.0 เฟส C — golden + การ์ด schema + เตรียม cutover (1 commit) — checklist: [D61-CUTOVER.md](D61-CUTOVER.md)
- 🔴 **sandbox schema override (เจ้าของเคาะ ก):** `TrainSandbox.schema` + `sheetSchema()` เช็ค ALS ก่อน env → **ห้องซ้อมสลับ v2/v3 ได้เองไม่ต้อง deploy** · prod ไม่มี context = อ่าน env เสมอ (pattern guard เดิม) · **ปุ่ม "ชีต: v2/v3" ใน /train ถาวรหลัง cutover** · thread ผ่าน turn/preview/cron routes
- 🔴 **แก้ config memo leak (คู่กัน):** `getConfig` memo 5 วิ เป็น global → เทิร์นซ้อม v3 เคยรั่วให้ prod เห็น 5 วิ · แก้แบบ loader (sandbox: อ่านสด + ไม่เขียน cache)
- **golden 2 ชั้น:** **D** `v3-golden.test.ts` (18 เคส · รันทุก npm test · scripted): payment-first (โอนต้องมีสลิปก่อน · COD ครบเขียนได้) · ราคาจาก engine + price guard จับเลขมั่ว · **choice-close ban** (matcher + สแกนชีต) · สุขภาพ (ไม่ปิดบอท+🔔 ครั้งเดียว+ไม่มีคำรับรอง+ตัดประโยค+fallback) · handoff (ขอคน/เคลม K017/ขายส่ง K018) · claims/บอลลูน/สลิป invariant · sandbox override + memo · validateV3Bundle
  · **G** `v3-golden-live.test.ts` (gated `HARNESS_REAL_GEMINI=1 HARNESS_REAL_SHEET=1`): 9 บทสนทนา (ทักเปล่า/กลางทาง/S2Q/ตอบแทรก-พากลับ/โอน/COD) + **เคสสุขภาพ+ส่งต่อรัน `GOLDEN_ROUNDS`=3 รอบ ต้องผ่านครบทุกรอบ** (เจ้าของเคาะ · non-deterministic) → เขียน **scorecard** `tmp/v3-golden-scorecard.md`
- **การ์ดฟ้อง schema (เคาะ #5 เฟส B):** `validateV3Bundle` (pure · header หลักขาด/แท็บว่าง/นับ live-draft) + route `api/dashboard/schema` (อ่านไฟล์ v3 ตรง + จับ placeholder เลขบัญชี) + การ์ดบนสุดของ dashboard (โหมดที่ระบบใช้จริง · ✅/⚠️ ต่อแท็บ · placeholder ค้าง)
- **cron ยืนยันสองโหมด (ข้อ 4):** cron orders แตะ schema ทางเดียว = `getConfig` (Orders คนละไฟล์) → **เทสใหม่: โหมด v3 แจกเลข+แจ้งพัสดุ+greeting ครบ** · cron follow: v3 ไม่มีแท็บ Follow (B7) → skip + log `skipped-v3` ชัดเจน
- **few-shot ราคา (ข้อ 3):** prompt v3 ใช้ placeholder อยู่แล้ว (เลข "29" อยู่ใน SPEC ไม่ใช่ prompt) → เสริมคำสั่ง "ห้ามลอก ... / ห้ามจำเลขจากตัวอย่าง · โครงค่าส่งอ่านจากตารางราคา" + แก้ SPEC ให้ตรงราคานิ่ง (95+30=125 · 3 ถ้วยส่งฟรี · COD ไม่บวก)
- **draft ในห้องซ้อม v3 (ข้อ 5):** overlay ผูก `TAB_KEY_COL` ที่มีแต่ชื่อ CSV_* → **ยังไม่ทำงานกับแท็บ v3** · เฟสนี้: เจ้าของสลับ K001-K019 เป็น live ก่อนซ้อม (ปลอดภัยเพราะไฟล์ยังไม่ถูกอ่าน) · วงจร draft เต็มกลับมาเฟส D พร้อม write path

### D-61.B · v3.0 เฟส B — ชีต v3 + adapter loader (1 commit) — mapping: [D61-MIGRATION.md](D61-MIGRATION.md)
ไฟล์ชีตใหม่ `SakbinBotLibrary-v3` (เจ้าของสร้าง+แชร์ Editor ให้ SA · ENV `SHEET_BOTLIB_V3_ID`) + adapter อ่านสอง schema — v2 ไม่แตะ
- **adapter (`lib/sheets/adapter-v3.ts` · pure):** `adaptV3Bundle` — จุดแปลงเดียว: `เส้นทางขาย`→CSV_Step (header v2-compatible + optional `สาระที่ต้องสื่อ`) · `ความรู้`→CSV_FAQ (คำตอบ=ก้อน **ความกังวลจริง→ข้อเท็จจริง→แนวตอบ** เคาะ #1 · CSV_Objections=[]) · Products/Promo/Vars pass-through · CSV_Follow=[] (B7)
- 🔴 **"ว่าง=draft" isolate ที่ adapter บรรทัดเดียว:** normalize สถานะทุกแถว → canonical `live`/`draft` ก่อนคืน bundle — `isActiveStatus` (ว่าง=live ของ v2) ไม่มีวันเจอค่าว่างจาก v3 · Products/Promo (`==="live"`) ถูกด้วย · แถว draft ไม่ถูกกรองทิ้ง (studio เห็น) · KI-08 ปิดถาวรฝั่ง v3
- **funnel map ตายตัวใน adapter (เคาะ #2):** S1→lead · S2/S2Q→qualified · S3→quoted · S4→won · flag handoff→handoff · **นอกลิสต์→qualified+log** — region routing + dashboard ทำงานต่อครบ · ชีต v3 ไม่มีคอลัมน์ funnel
- **loader dispatch:** โหมด v3 → `SHEET_BOTLIB_V3_ID` + แท็บ v3 → adapter · v2 path เดิมทุกบรรทัด · header หลักขาด → แท็บ degrade ว่าง + log `sheets-v3` (**ห้าม fallback ยัดดิบ** B1 · การ์ด dashboard = เฟส C เคาะ #5)
- **`สาระที่ต้องสื่อ` (เคาะ #3):** optional col แบบ "กรณี" ใน `fullSalesBlock` — v2 ไม่มีคอลัมน์ = ไม่แสดง (zero change)
- **สารก่อภูมิแพ้ (เคาะ #4):** (ก) `includeAllergen` param ใน buildCatalogInjection (handler ส่ง v3) (ข) `{สารก่อภูมิแพ้}` เข้า CATALOG_TEXT_VARS+resolver ทั้งสองโหมด (pattern-driven · ชีต v2 ไม่มี token=ไม่มีผล) — 🔴 **จดตามเคาะ: ยกเลิกการจงใจตัด {สารก่อภูมิแพ้} ของ D-43** เพราะ v3 มี assurance guard คุมฝั่ง output แทน
- **Config `เข้า prompt` (B5 · header-driven ไม่ผูกโหมด):** มีคอลัมน์→`promptVisibleKeys` กรอง formatConfigForPrompt · ไม่มี (v2)→null=ดัมพ์หมดเดิม
- **seed (`scripts/seed-v3-sheet.ts` · idempotent — แท็บมีแล้ว=ข้าม):** แท็บ **วิธีใช้** (คำเตือน "ยังไม่ live · ว่าง=draft กลับด้าน!" เคาะ #6) · เส้นทางขาย S1-S4+S2Q (live · สาระร่างจาก A3) · ความรู้ (K001 ตัวอย่าง draft) · Products (allergen ค่า B4 ของเจ้าของ) · Promo P1-P10 · Vars · Config canonical (ตัด key ตาย · เลขบัญชี=placeholder ต้องกรอกก่อน cutover)
- **harness:** adapter (normalize ว่าง→draft ทุกแท็บ · funnel map+นอกลิสต์ · ก้อนความรู้ลำดับเคาะ · degrade header ขาด · ผ่าน buildStepInjection ได้+draft ถูกกรอง) · loader dispatch v3 (range แท็บ v3 · id ไม่ตั้ง→null) · allergen ก/ข · config เข้า prompt (parse+filter+v2 null) · **v2 full suite เขียว**

### D-61.A · v3.0 "บอทนักขาย CX" เฟส A — สมองใหม่ (1 commit) — contract เต็ม: [D61-SPEC.md](../D61-SPEC.md)
รื้อใหญ่ที่สุดของโปรเจกต์ เฟสแรก: prompt ขายเขียนใหม่ + โหมดเรียบเรียงสด + assurance guard + แปลง คำ_notify เป็นธงสุขภาพ
- 🔴 **สวิตช์ `SHEET_SCHEMA` (env-only ถาวร · เจ้าของเคาะ #4) — default `v2` = โค้ดเดินเส้นเดิมทุกบรรทัด** · v3 ยังไม่มีทางถูกใช้จริงจนเฟส C cutover · full suite ทั้ง repo รันใน v2 = บทพิสูจน์ v2-frozen ในตัว
- **pattern branch (เจ้าของสั่ง):** เช็ค `isSchemaV3()` ครั้งเดียวต้นทาง processMessage → dispatch เข้า function แยกชัด 4 จุด: `notifyPrecheckV2`/`matchHealthFlagV3` · `composeReplyV2`(ก้อน D-42 เดิมทั้งดุ้น)/`composeReplyV3` · `applyAssuranceGuardV3` · `pushNotifyDoorV2`/`pushHealthNotifyV3` — เตรียมลบ v2 ง่ายหลังเกษียณ
- **A1 เรียบเรียงสด (v3):** reply AI ส่งตรง (verbatim/precedence D-42 ไม่วิ่ง) · เหลือ override: handoff จริง + รูป-fallback + degraded · `delivered_steps` → hint "อย่าทวนซ้ำ" + dedup 🔔 เท่านั้น (mark ทุกเทิร์นที่ส่งจริง)
- **A2-A4 prompt ใหม่:** `prompt/system-v3.ts` ทั้งไฟล์ (Identity ไม่แกล้งเป็นคน · หมวก 3 ใบ+choice close ban · 3C · ตอบแทรก-พากลับ · 4 ประตู จ่ายก่อนที่อยู่ · สุขภาพ=สนทนาปกติ+ห้ามรับรอง · **few-shot 3 ฉากคำต่อคำ**) · JSON contract เดิมเป๊ะ (pipeline อ่านต่อได้ทุก field) · v2 `prompt/system.ts` ไม่แตะ
- **A5 assurance guard:** `lib/guards/assurance.ts` (pure) — ธงสุขภาพ+คำรับรอง (`คำรับรอง_ต้องห้าม` · รูปคำถาม "ทานได้ไหม" ไม่นับ) → block → **regenerate 1 ครั้ง** (sales call ที่ 2 + correction · timeout แยก 8s) → ยังหลุด/ล้ม = กลับคำตอบแรก**ตัดรายบรรทัด** → บอลลูนว่าง=ทิ้ง → ว่างหมด=fallback สุภาพ (**ห้ามเงียบทุกกรณี** เจ้าของเคาะ #2) · วางหลัง price guard ก่อน var-guard
- **A6 ธงสุขภาพ:** `คำ_ธงสุขภาพ` (ชื่อเดียว · default ในโค้ด=ตาข่ายรวมคำสุขภาพเดิม — deploy v3 ไม่ตั้ง key ไม่เสียตาข่าย · key ว่าง=ปิดโดยเจตนา) → hint เข้า state + 🔔 (`ข้อความ_แจ้งแอดมิน_notify`) dedup ต่อเคสผ่าน marker `__HEALTH_NOTIFY__` ใน delivered_steps (เจ้าของเคาะ #3 · ล้างพร้อมธง=ต่อเคสจริง) + arm guard · **ไม่ force stage ไม่ปิดบอท**
- **คำ_handoff:** `DEFAULT_HANDOFF_KEYWORDS_V3` (เรียกคนเท่านั้น) เลือกผ่าน fallback param ที่ call site — **ค่า v2 เดิมไม่ขยับ** (เจ้าของเคาะ #1)
- **จุดที่ v3 จำเป็นต้องต่างเพิ่ม (รายงานไว้):** payment pre-check "ข้าม AI ทั้งเทิร์น" (D-47 ชิ้น 1) = v2 เท่านั้น — v3 ต้องให้ AI เขียน reply เสมอ (ไม่มี verbatim มาเติม) · **lock payment_method ยังคุมทั้งสองโหมด** · บันได extraction/degraded เดิมยังรับเมื่อ blocked
- **harness:** `v3-brain.test.ts` (SHEET_SCHEMA=v3 เฉพาะไฟล์ · afterAll คืน) — assurance pure (จับ/คำถามไม่นับ/ตัด/ว่าง) · prompt โครง+few-shot · เรียบเรียงสด pattern ไม่ทับ · FAQ ไม่ force · handoff จริงชนะ · DEFAULT_V3 (แพ้→ไม่ปิด · ขอแอดมิน→ปิด) · ธง (🔔 ครั้งเดียว+marker+stage ไม่ถูก force) · guard (regenerate สะอาด/ตัดบรรทัด/fallback/ไม่ติดธงไม่ยุ่ง) · **v2 ทั้ง suite เขียวโดยไม่แตะ assertion ใด**

### D-60.2 · bugfix กติกา 11 — ผู้ช่วยเทรนไม่เข้า flow สัมภาษณ์ + greeting "ผม" (1 commit)
**อาการจริง:** สั่ง "เพิ่ม Step H5 handoff_notify เรื่องสุขภาพ" (งานใหม่ ข้อมูลไม่ครบ) → ออก proposal เต็มใบทันที ไม่ถามกลับ · greeting UI ใช้ "ผม"
- **วินิจฉัย (ก):** prompt บน deploy = ล่าสุด (มี 11/12/persona ครบ) · "ผม" = **hardcode ใน UI 2 จุด** (TrainStudio greeting + ข้อความ error) คนละที่กับ prompt
- **วินิจฉัย (ข) ทำไมโมเดลข้ามกติกา 11:** (1) กติกาจมกลางลิสต์ + ข้อยกเว้น "ข้อมูลครบ→ข้ามได้" หลวม — คำสั่งสุขภาพชนกับ template ในกติกา 2 → โมเดลตีความว่า "ครบ" (2) responseSchema บังคับ field `proposals` → JSON-mode เติม array (3) ไม่มีสัญญาณโครงสร้าง — server validate ไม่ได้
- **วินิจฉัย (ค) ทำไมเทสไม่จับ:** เทสเดิม assert "prompt มีข้อความ" + parser JSON สังเคราะห์ — ไม่เทสพฤติกรรมโมเดล (Gemini mocked) และ **invariant "เทิร์นสัมภาษณ์ห้ามมี proposals" ไม่เคยอยู่ในโค้ด** (อยู่แค่ prompt = เทสไม่ได้)
- **แก้ 3 ชั้น:** (1) **FLOW ย้ายขึ้นต้น prompt** + few-shot (เทิร์นแรกงานใหม่→`{"phase":"interview",proposals:[]}`) + ข้อยกเว้นแคบลง ("แค่บอกหัวข้อ/ชื่อประตู = ไม่ครบ ต้อง interview") (2) **schema +`phase`** enum `interview|draft|proposal` (required) (3) 🔴 **server gate ใน parser**: phase ≠ proposal → **ทิ้ง proposals ทั้งหมด + log `phase-gate`** (invariant อยู่ในโค้ด · phase หาย = proposal compat)
- **UI:** greeting + error message → persona ค่ะ ("บอกได้เลยค่ะ…" / "บอกให้ผู้ช่วยปรับได้เลยค่ะ")
- **harness:** phase gate (interview/draft ทิ้ง · proposal/หาย ผ่าน · เคส H5 จริง) · FLOW index ก่อนกติกาเหล็ก + few-shot + ข้อยกเว้นแคบ · file-guard UI ไร้ "ผม" (แบบ prompt-lint) · **real-Gemini skip-gated**: เคส H5 เป๊ะ → proposals ว่าง+ถามกลับ

### D-60 · คำ_notify รายประตู + เกลาผู้ช่วยเทรน (system prompt CX + โหมดเกลาเสียง · 1 commit)
ต่อยอด D-58 (notify) + D-59 (ผู้ช่วยเทรน) — 3 ส่วนในคอมมิตเดียว
- **ส่วน 1 · per-door `คำ_notify_<step_id>`:** config `parseNotifyDoors(raw)` แปลง key `คำ_notify_H5`→`{door:"H5", keywords}` (alias `คำ_notify` ไม่มี suffix → handler รวมเป็น `NOTIFY_DOOR=H1` เดิม · backward compat) · handler **loop ทุกประตู** (notifyDoors + alias) · match แรกชนะ · **fail-safe/dedup ต่อประตู** (funnelStageOf(door)=handoff_notify+pattern · dedup ผ่าน delivered_steps=stage) · 🔴 lint exempt **ผูก funnel อยู่แล้ว** (`h1FlagsForRow` เช็ค funnel_stage ไม่ผูกชื่อแถว — ไม่ต้องแก้)
- **ส่วน 2 · system prompt ผู้ช่วย (`buildAssistantSystem`):** +กติกา **11 flow สัมภาษณ์** (เทิร์นแรกงานใหม่ reply-only ถาม → จังหวะ2 ร่าง 3 แบบเต็มคุณภาพ ผสม 3 องค์ประกอบ ต่างที่น้ำหนัก → จังหวะ3 proposal เดียว · ยกเว้นข้อมูลครบ/แก้เล็ก) · **12 เสียงนักขาย CX** · **persona ค่ะ/นะคะ เท่านั้น** (ห้าม ครับ/ผม) · note ≥2 เคสจริง
  - 🔴 **กติกา 12 เกลา (D-60.1):** นักขาย CX สวม **3 หมวก** ทุกคำตอบ — (1) นักแก้ปัญหา (อ่านกังวลแท้จริงก่อนร่าง · บอกเจ้าของจังหวะ2 แก้ได้) (2) นักสร้างความต้องการ (เชื่อมสินค้าเข้าชีวิต) (3) นักสร้างทางเลือก **3 เทคนิค**: (ก) **choice close** (จบด้วยทางเลือก/คำถามเดินหน้า · 🔴 ห้าม "รับมั้ยคะ/รับเลยนะคะ" → **lint เหลือง `close-style`** เตือนใน pattern ที่ร่าง ไม่ block) (ข) ดี→ดีขึ้น→ดีที่สุด (ค) say no but never say no (งบไม่ตรง=ไม่ปฏิเสธ · ยืนยันที่เลือกคุ้ม+เปิดภาพเพิ่ม+จบ choice close) · **3C เสริมเฉพาะเทิร์นที่กังวล** · เส้นห้ามสุขภาพ/claims เหนือทุกอย่าง (ประตู notify ไม่บังคับ choice close)
- **ส่วน 3 · โหมดเกลาเสียง (CX makeover):** KB +เนื้อคำตอบเต็มแถว live (bounded 300 · reuse EDITABLE_COLS · read-only) · system prompt +กติกาเกลา (≤3 แถว/เทิร์น · รักษา `{}` + ตัวเลข/ข้อเท็จจริง · action=handoff ไม่แตะ · ไม่วนซ้ำ) · **`rewriteSafety(old,new)`** (`lib/train/rewrite-safety.ts` · import-free · จับ `{var}` หาย/ตัวเลขเปลี่ยน) → UI เตือน confirm ก่อนเขียน edit-row · route +`excludeKeys[]` (แถวจัดการแล้ว→ห้ามเสนอซ้ำ) · UI: ปุ่ม "ข้าม" + track `skipKeys` + toast เตือน "เกลา" (live มีผล ~1 นาที)
- ไฟล์: `lib/config.ts`(parseNotifyDoors+notifyDoors) · `handler.ts`(loop doors) · `lib/train/{assistant,assistant-kb,rewrite-safety}.ts` · `app/train/api/assistant`(+excludeKeys) · `TrainStudio.tsx`(makeover UI)
- **harness:** parseNotifyDoors (per-door · alias ไม่นับ) · handler per-door H5 (เบาหวาน→H5 answer+notify+ไม่ปิด) + fail-safe (door→handoff→ปิดเงียบ) · system prompt มีกติกา 11/12/persona ค่ะ/excludeKeys · rewriteSafety (drop {}/เปลี่ยนเลข/รักษาครบ) · **build เขียว · v1 fidelity เขียว**
- **ไม่แตะ:** engine/pipeline/gate/pricing/precedence D-42/invariants/DEFAULT_HANDOFF_KEYWORDS/runSalesTurn

### D-59 · T2-จ1 · ผู้ช่วยเทรน (แชท AI ดูแลคลังความรู้ · text-only · 1 commit) — spec [docs/T2-STUDIO-SPEC.md](T2-STUDIO-SPEC.md)
แท็บ 🤖 ใน /train — เจ้าของพิมพ์บอก → AI เสนอ **proposal** (ร่างแถวใหม่/แก้แถวเดิม) → เจ้าของแก้ field + ยืนยัน → เขียน · **AI ร่าง มนุษย์เคาะ · ไม่มีเส้นทางเขียนตรง**
- **สถาปัตย์:** Gemini call แยก (`runTrainAssistant` · สไตล์ extraction D-48 · ไม่ปน prompt ขาย · temp 0.3 · thinkingLevel LOW · responseSchema) · proposal → **เขียนผ่าน `/train/api/write` เดิม (D-57)** = appendRow(บังคับ draft)/writeCell/lint gate/hard guard/conflict/TRAIN_LOG ครบเหมือน UI กดเอง
- **quota แยก:** `GEMINI_API_KEY_TRAIN` (optional · ไม่มี=ใช้ `GEMINI_API_KEY` เดิม) · scope log `train-assistant` · cap ประวัติ 12 · maxOutputTokens 2048 (~$0.001–0.003/เทิร์น)
- **KB สด (`assistant-kb.ts`):** วิธีใช้+วงจร draft→ซ้อม→live · header จริง+key+keywords ทุกแท็บ (กันซ้ำ/ชน substring · loader cache 60วิ = fresh หลังเขียน) · claims blocklist · สินค้า/ตัวแปร read-only
- **10 กติกา system prompt (เจ้าของเคาะ):** draft เสมอ · 🔴 สุขภาพ default→ประตู `handoff_notify` (handoff เต็มเฉพาะสั่งเอง) · keyword วลีกันชน · claims · ราคา/ข้อเท็จจริงจากข้อมูลจริง · สโคป 4 แท็บ (Config แนะนำได้ห้ามเขียน · Products/Promo=จ2) · JSON เท่านั้น · **ถามก่อนเดา (ข้อมูลไม่พอ=ถามกลับ ไม่ออก proposal · ช่องไม่รู้=เว้นว่าง)** · **ทุก proposal note ≥2 เคสทดสอบ (+1 ต้องจุด/−1 ต้องไม่จุด)** · **≤3 proposals/เทิร์น**
- **schema/parser (`parseAssistantResponse` บริสุทธิ์):** {reply, proposals[{action,tab,key,cols:[{name,value}]→record,note}]} · กรอง action/tab นอกสโคป · cap 3 · non-JSON→reply fallback
- **UI (การ์ด modal):** proposal = การ์ดแก้ทุก field ก่อนยืนยัน · lint block (422) → ข้อความไหลกลับแชท (AI แก้ต่อ) · **edit-row บนแถว live → ป้ายเตือน "ผลถึงลูกค้า ~1 นาทีหลังยืนยัน" (writeCell ไม่พลิก draft)** · ▶ ทดสอบต่อแถว (reuse) · TRAIN_LOG `ai-draft`/`ai-edit`
- ไฟล์: `lib/train/{assistant,assistant-kb}.ts`(NEW) · `app/train/api/assistant`(NEW) · `lib/train/write.ts`(+origin) · `app/train/api/write`(+origin) · `TrainStudio.tsx`(แท็บ🤖) · `lib/gemini.ts`(export MODEL/SAFETY_SETTINGS reuse)
- **harness:** parser (cols→record · cap 3 · scope guard Config/Products/delete ตัด · no-guess reply-only · non-JSON) · KB (header/keys/claims) · appendRow origin=ai→ai-draft+draft · writeCell origin=ai→ai-edit · **Config เขียนไม่ได้จริง (assertEditable throw)** · lint block ไหลกลับ · route auth 401 · **build เขียว · v1 fidelity เขียว**
- **ไม่แตะ:** engine/pipeline/invariants/gate/pricing · runSalesTurn (ขายจริง)

### D-57.1 · bugfix: คอลัมน์สถานะ FAQ ใช้ "status" (อังกฤษ) — แท็บ 📚 ขึ้นแบนเนอร์ผิด (1 commit)
T2-ค (D-57) hardcode `STATUS_COL="สถานะ"` แต่ **CSV_FAQ ชีตจริงใช้ `status` (อังกฤษ · คอลัมน์ H)** → `listTabRows` หา idx=-1 → แบนเนอร์ "ไม่มีคอลัมน์สถานะ" + ปิด add-row/toggle (ทั้งที่ prod กรอง draft ปกติ)
- **contract จริง (ปนกัน):** CSV_FAQ = `status` · CSV_Step/Objections/Vars/Products/Promo = `สถานะ`
- **loader เดิมไม่สม่ำเสมอ:** `parseFaqRows` เช็ค `status`→`สถานะ` (ทั้งคู่) · `parseStepRows`/objection เช็ค `สถานะ` อย่างเดียว
- **fix (single source · ห้ามสองชื่อ):** +`statusColumnIndex(header)` ใน [inject.ts](../lib/agent/inject.ts) (เช็ค `status`→`สถานะ` · impl เดียว export) → refactor 3 จุด loader (Step/OBJ/FAQ) เรียกตัวเดียวกัน (Step/OBJ รับ `status` เพิ่ม · ผ่อนปรนขึ้น ไม่ regress) + `write.ts` (listTabRows/appendRow/setRowStatus) ใช้ตัวเดียวกัน
- `listTabRows` คืน `statusCol` (ชื่อจริง) → TrainStudio ใช้ตัด column จากฟอร์ม + overlay "▶ ทดสอบ" (FAQ→`status`) + แบนเนอร์ · ไม่ hardcode `"สถานะ"` ที่ใดอีก
- **harness:** FAQ `status` → statusCol=status/hasStatusCol=true · appendRow บังคับ draft ลง `status` · setRowStatus เขียน `status`(E) · Vars `สถานะ` ยังผ่าน · **490 passed** · build เขียว · inject filter เดิม (Step/OBJ `สถานะ`, FAQ `status`) เขียว

### D-58 · funnel_stage ใหม่ `handoff_notify` — ตอบ pattern + แจ้งแอดมิน + ไม่ปิดบอท (1 commit)
ประตูสุขภาพทั่วไป (ไม่รุนแรง): บอทตอบข้อมูลปลอดภัยตาม pattern ชีต + push แจ้งแอดมิน 🔔 + **ไม่ตั้ง human_mode** (ต่างจาก `handoff` ที่ปิดบอทเงียบ)
- **Q ที่เจ้าของถาม:** pre-check `คำ_handoff` = **บังคับ handoff ตรง (silent)** ก่อน Gemini ([handler.ts](../app/api/line-webhook/handler.ts)) — ไม่ route เข้าประตู · `DEFAULT_HANDOFF_KEYWORDS` มีคำ H1 ครบ (แพ้/ท้อง/เบาหวาน/กินยา…)
- 🔴 **ไม่แตะ `DEFAULT_HANDOFF_KEYWORDS`** (safety net deploy ใหม่คงเดิม) · เปิด notify ผ่าน **pre-check ชั้นสอง**: config key ใหม่ **`คำ_notify`** (default `[]`)
- **ลำดับ pre-check:** `คำ_handoff` match → ปิดเงียบ (เดิมเป๊ะ) · ไม่ match → `คำ_notify` match → **บังคับเข้าประตู `NOTIFY_DOOR="H1"`** (force stage · ข้าม AI/FAQ/OBJ · reuse `checkHandoffKeywords` ไม่ fork · KI-01)
- 🔴 **fail-safe:** `คำ_notify` match แต่ประตู H1 `funnel_stage ≠ handoff_notify` **หรือ pattern ว่าง** → ตกกลับ `runHandoffFlow` ปิดบอทเงียบ + log เตือน (ชีตตั้งผิด ห้ามบอทตอบสุขภาพเงียบ/หายเงียบ)
- **กลไก funnel (ไหลผ่าน pipeline เดิม):** enum `handoff_notify` เข้า `VALID_FUNNEL_STAGES` (10 · validate D-38 รับ) · `isHandoffTurn` +notify (ส่ง step pattern verbatim ไม่ให้ OBJ/FAQ ทับ) · `doHandoff && !stageIsNotify` (ห้ามปิดบอทแม้ AI flag) · push 🔔 co-locate กับ `addDeliveredStep` = **dedup ผ่าน delivered_steps เดิม** (ถามซ้ำประตูเดิม = ไม่ push ซ้ำ) · channelLabel D-52
- **lint studio (D-57 ต่อยอด):** `lintHealthH1(trigger, answer, {exempt, notify})` → ประตู CSV_Step funnel=handoff/handoff_notify = **ยกเว้น H1 block** (คำตอบสุขภาพเป็นดีไซน์) · notify = +warn เหลืองวลี "รับรอง" (ทานได้/ปลอดภัย/ไม่เป็นไร) · `h1FlagsForRow` (preview+writeCell+appendRow)
- **harness:** notify→ตอบ pattern+🔔+human_mode=false · fail-safe (funnel ผิด/pattern ว่าง)→ปิดเงียบ · precedence คำ_handoff>คำ_notify · "แพ้กุ้งมั้ย"→notify ไม่โดน FAQ · dedup 🔔 ครั้งเดียว · **notifyKeywords ว่าง=พฤติกรรมเดิม 100%** · lint exempt/assurance · golden H1→handoff_notify (skip-gated) · **486 passed** · build เขียว
- 🔴 **เปิดใช้จริง = งานชีตเจ้าของ:** ย้ายคำสุขภาพจาก `คำ_handoff` → `คำ_notify` + ตั้งประตู H1 `funnel_stage=handoff_notify` + เขียน pattern ปลอดภัย (ข้อมูล+ปรึกษาแพทย์ ไม่รับรอง) · ไม่ทำ = safety net เดิม (H1 ปิดเงียบ)
- **ไม่แตะ:** gate/pricing/precedence D-42/invariants · DEFAULT_HANDOFF_KEYWORDS

### D-57 · T2-ค · จัดการแถว Step/FAQ/OBJ/Vars จากเว็บ (add-row draft · live↔draft · lint H1 · 1 commit) — spec [docs/T2-STUDIO-SPEC.md](T2-STUDIO-SPEC.md)
เจ้าของเพิ่ม/ปิด/เปิดแถวคลังความรู้จากหน้าเว็บ (แท็บ "📚 คลังความรู้" ใน /train) โดยไม่เปิดชีต · **ความปลอดภัยชีต > ความเร็ว** · เคาะ 3 ข้อ (overlay รายแถว · ครบ 4 แท็บ+validator · lint block คำสุขภาพ) + 3 เงื่อนไข
- 🔴 **แถวใหม่ = draft เสมอ (`appendRow` บังคับ `สถานะ=draft`)** · **แท็บไม่มีคอลัมน์สถานะ = ปฏิเสธ** (`no_status_col`) — กัน KI-08 (ช่องว่าง=live) · dedup key (block) · key/funnel validate
- 🔴 **H1 trigger-aware (`lintHealthH1`):** ถ้าแถว "เกี่ยวสุขภาพ/แพ้อาหาร" (คำใน trigger=คำถาม/สิ่งที่ลูกค้าพูด **หรือ** คำตอบ) → คำตอบ **ต้องเป็นการส่งต่อแอดมิน** ไม่งั้น block · เคสถูก (FAQ แพ้อาหาร→handoff) ผ่าน+เตือนเหลือง · 🔴 จับ "แพ้กุ้งทานได้ไหม→ทานได้ค่ะ" (คำสุขภาพอยู่ในคำถาม คำตอบดูปกติ = คดี) · reuse ทั้ง preview+writeCell+appendRow
- **funnel validator (Step):** `funnel_stage` ต้องอยู่ใน `VALID_FUNNEL_STAGES` (ตาข่าย handoff H1) ไม่งั้น `funnel` block
- **soft delete:** live↔draft ผ่าน `setRowStatus` (ไม่มีลบถาวร) · **เขียนผ่านกลไก v1 เดิมทั้งชุด** (hard guard BotLibrary-only · conflict · lint gate) · TRAIN_LOG +คอลัมน์ที่ 7 `ประเภท` (edit/add-row/status-change)
- 🔴 **ทดสอบ draft ในห้องซ้อม (เคาะ):** ปุ่ม "▶ ทดสอบ" ใส่ overlay `{สถานะ:live}` รายแถว → sandbox เห็น draft เป็น live · **prod กรอง draft ทิ้งเหมือนเดิม (ไม่มี sandbox context)** · reuse overlay เฟส ข · FAQ pre-fill คำถามในช่องแชทให้เลย
- ไฟล์: `lib/train/write.ts`(appendRow/setRowStatus/listTabRows/suggestNextKey) · `lib/train/lint.ts`(lintHealthH1+trigger) · `lib/train/preview.ts`(triggerTextForTab) · `lib/agent/inject.ts`(export isActiveStatus) · `app/train/api/{rows,write}` · `TrainStudio.tsx`(แผงคลังความรู้)
- **harness:** H1 block/warn/none · appendRow บังคับ draft · no_status_col ปฏิเสธ · dup · key_invalid · funnel · **🔴 prod ทิ้ง draft (buildFaqInjection) · sandbox overlay→live เสิร์ฟ (matcher prod จริง)** · setRowStatus + TRAIN_LOG action · list ข้ามแถวว่าง · suggestNextKey · **476 passed** · build เขียว · phase b/c เดิมเขียว
- **ขอบเขต:** เขียนเฉพาะ 4 แท็บนี้ (Products/Promo/Config ยังห้าม = T2-ง) · แก้เนื้อหาแถว = ผ่าน editor บอลลูนเดิม (แตะบอลลูนหลังทดสอบ) · **KI-08 บันทึกกับดัก ช่องว่าง=live + ข้อความเตือนเจ้าของวางในชีต**

### D-54 · หน้า Privacy Policy (ปลดล็อก M-3 App Review · 1 commit)
`app/privacy/page.tsx` static — ไทย (8 ข้อครบ) + อังกฤษสรุปความเดียวกัน · placeholder อีเมล `sakbinofficial@gmail.com` (เจ้าของแจ้งจริงทีหลัง) · วันที่อัปเดตคงที่ (ไม่ใช้ new Date) · 🔴 ไม่มี tracking/analytics/external
- เขียนด้วย `createElement` (ไม่ใช่ JSX) — tsconfig `jsx:preserve` ทำให้ vitest transform JSX import ไม่ได้ (เหมือน EditorBoundary) → หน้าจริง import+render ทดสอบได้
- **harness:** หัวข้อไทย+อังกฤษ · สาระครบ (LINE userId/PSID/สลิป/AI/ไม่ขายข้อมูル/สิทธิ/ขนส่ง) · อีเมล+วันที่ · **ไม่มี `<script>`/analytics** · build prerender `/privacy` (static 200) · **434 passed**
- **ใช้:** URL `https://<domain>/privacy` ยื่น App Review (M-3)

### D-53 · สวิตช์บอทราย channel (ต่อยอด D-52 · 1 commit)
คำสั่งกลุ่มแอดมิน "ปิด/เปิดบอท line|fb" → บอทเงียบทั้งช่องที่ต้นทาง
- **schema (เคาะแล้ว):** `channel_switches(channel PK "line"|"fb:<pageId>", enabled bool default true, updated_at)` · **ไม่มีแถว = เปิด** (เพิ่มช่องไม่ต้อง migrate) · `setChannelEnabled`/`isChannelEnabled` (default true) · +harness resetDb
- **คำสั่ง (`resolveChannelArg`):** `line`→key `"line"` · `fb`→resolve `fb:<META_PAGE_ID>` ผ่าน `messengerPageIds()` (🔴 key ต้องเป็น identifier จริงเสมอ ห้าม alias "fb" ลอยในข้อมูล · "fb" = shortcut ชั้นภาษา · หลายเพจ=ตอบรายชื่อให้เลือก · ยังไม่ build) · `fb:<pageId>`→ตรงๆ · **arg อื่น = ชื่อลูกค้า (เดิม)**
- **ตอบยืนยันทุกครั้ง** สถานะครบทุกช่อง: `ปิดบอทช่อง [FB] แล้ว\n[LINE] เปิด · [FB] ปิด` (`channelStatusLine` + reuse `channelLabel(key)`)
- **เช็คต้นทาง:** `handleEvent` สาย user → `isChannelEnabled("line")` false → เงียบ+log (**คำสั่ง group คนละสาย → เปิดคืนได้**) · `handleMetaMessaging` (หลัง echo) → `isChannelEnabled("fb:<pageId>")` false → เงียบ+log
- **ห้ามเปลี่ยน (ยืนยัน):** `ปิดบอท`เฉยๆ (arg="")→help เดิม (`resolveChannelArg`คืน null) · `ปิดบอททั้งหมด`→close_all เดิม · `ปิดบอท <ชื่อ>` รายคนเดิม · **รายคนปิด+ช่องเปิด=ยังปิด** (ช่องเปิด→เข้า processMessage→human_mode→เงียบ กลไกเดิม)
- **harness:** ปิด/เปิด line&fb + fb:<pageId> ตรง · ยืนยันสถานะทุกช่อง · ช่องปิด→ลูกค้าเงียบ · ช่องเปิด→ตอบปกติ · รายคนปิด+ช่องเปิด=ยังปิด · `ปิดบอท`เฉยๆ ไม่แตะ switch · คำสั่ง group ทำงานแม้ช่องปิด · **430 passed** · build เขียว

### M-4 · cron/D-50 route push ตาม channel (1 commit)
notifyShipping เลิกข้าม `fb:` → route ตาม prefix ของ R:
- **LINE (raw/TRAIN:)** → `pushMessages` เดิม (sandbox guard → collector)
- **Messenger (`fb:<pageId>:<psid>`)** → **gate 24 ชม.** (5.3 · `withinMessengerWindow(customer.lastSeen, now)`): ใน 24 ชม. → `MessengerTransport(resolvePageContext(pageId), psid).push` · เกิน/เพจไม่พร้อม → แจ้งกลุ่มแอดมิน `[FB] โปรดแจ้งพัสดุเอง <order> <tracking>` (เคลมแล้ว = ไม่ retry/สแปม)
- แจกเลขออเดอร์ (push กลุ่มแพ็ค) ทำทุกช่องเหมือนเดิม (ไม่แตะ) · `✓`/fallback ทุกอันมี `channelLabel` (D-52)
- **harness:** withinMessengerWindow (pure) · fb: ใน 24 ชม.→Send API push+✓[FB] · fb: เกิน 24 ชม.→admin [FB] เกินหน้าต่าง+ไม่ยิง · LINE/TRAIN เดิม · **422 passed** · build เขียว
- **เหลือ:** Utility Template (แจ้ง Messenger เกิน 24 ชม. แบบไม่ต้องแอดมิน) = เฟสหลังเมื่อ volume คุ้ม

### D-52 · ป้ายช่องทางในข้อความฝั่งแอดมิน (ต่อยอด M-2 · 1 commit)
`lib/channel/label.ts` `channelLabel(channelUserId, pageName?)`: `fb:`→`[FB]` (มีชื่อเพจ→`[FB·<ชื่อ>]` · โครงหลายเพจ) · `TRAIN:`→`[ซ้อม]` · อื่น→`[LINE]` · วางหน้าชื่อลูกค้า ตำแหน่งเดียวกันทุกที่ · **ห้ามแตะข้อความฝั่งลูกค้า**
- **ใช้ทุกจุดที่โชว์ชื่อลูกค้าให้แอดมิน:** handoff (`ลูกค้า: [LINE] ชื่อ`) · ออเดอร์ใหม่/สลิป/ยอดไม่ตรง/ออเดอร์พัง/แก้ออเดอร์ (builders + `LineOA:`) · guard transfer/claims/price/door-change · list/รายชื่อ (matched+recent) · cron formatOrderMessage (แจ้งกลุ่มแพ็ค) + D-50 human_mode fallback
- วิธี: prepend `channelLabel(userId)` เข้า arg `name` ของ builders (ไม่แตะ pure builder) + inline · LINE เดิมได้ป้าย `[LINE]` (เทสเดิมใช้ `.toContain(name)` = ไม่พัง)
- **harness:** channelLabel 3 prefix + pageName + ป้ายโผล่ในแจ้งกลุ่ม (handoff `ลูกค้า: [LINE]`) · **420 passed** · build เขียว

### M-2 · Meta Messenger webhook + MessengerTransport (1 commit · เทส Dev Mode)
รับ-ตอบแชทเพจ Facebook ด้วย `processMessage` เดิม · LINE ไม่กระทบ
- **ใหม่:** `lib/channel/pages.ts` (🔴 จุดเดียวอ่าน META_* · `resolveAppContext`+`resolvePageContext` env 1 เพจ) · `lib/channel/meta.ts` (Send API + `verifyMetaSignature` HMAC-SHA256 · `GRAPH_VERSION=v21.0`) · `lib/channel/meta-webhook.ts` (`processMetaWebhook`/`metaVerifyChallenge`/`metaUserId`) · `app/api/meta-webhook/route.ts` (GET challenge + POST) · `MessengerTransport` ใน transport.ts (reuse `parseReplyIntoMessages` → invariant cap-5/image-last ที่เดียว)
- **id:** `fb:<pageId>:<psid>` (ทะเบียน id ใน REPO-MAP §5) · debounce key = id นี้ (ไม่แตะ debounce) · handler สกัด `runInboundText`/`runInboundImage` ร่วม (LINE/Meta เส้นเดียว · LINE พฤติกรรมเดิม)
- **echo (5.4 · เคาะ META_APP_ID เป็น ENV ที่ 5):** `is_echo` + `app_id===META_APP_ID` → ทิ้ง (กันลูป) · app_id อื่น/แอดมินพิมพ์ → `setHumanMode` · **META_APP_ID ไม่ตั้ง → fallback heuristic (มี app_id=ทิ้ง · ไม่มี=human_mode) + log เตือนดังๆ ทุกครั้ง** (ไม่เงียบ)
- **page_id ชัดทุก event** → `resolvePageContext(pageId)` (ไม่ตรง/ENV ขาด → ข้าม+log) · กันดีไซน์ตายทาง (อนาคต table channel_pages ไม่รื้อ)
- **สลิป:** `uploadSlip` scope ตาม prefix → `meta/<pageId>/<psid>_<time>.jpg` (LINE `slips/YYYY-MM/` เดิม) · **Orders:** `source_channel="messenger"` (LINE ว่างเปล่าเดิม) · R เก็บ `fb:...` (KI-06 join key)
- **cron D-50:** เจอ R `fb:` → ข้าม+log ไม่เคลม (M-4 ค่อย route push ตาม channel) · TRAIN:/U ผ่านปกติ (sandbox ไม่พัง)
- **harness:** verifyMetaSignature · challenge · resolvePageContext · slipPathname · MessengerTransport payload (text/image/cap-5) · **webhook→pipeline→Send API e2e (ตอบ PSID + สร้าง customer fb: + ไม่แตะ LINE)** · echo ทิ้ง/human_mode · sig ผิด 401 · page ไม่รู้จัก · cron ข้าม fb: · **417 passed** (405 refactor คงเดิม + 12) · build เขียว (/api/meta-webhook)
- **เจ้าของ:** ENV 5 ตัว (META_APP_SECRET/VERIFY_TOKEN/APP_ID/PAGE_ID/PAGE_ACCESS_TOKEN) เข้า Vercel → ตั้ง webhook callback + subscribe (messages, message_echoes) → เทส Dev Mode กับ role Tester · **M-4** = cron/D-50 route push ตาม channel · **M-3** App Review ขนานไป

### M-1 · refactor `ChannelTransport` (zero behavior change · 1 commit)
สกัดช่องทางลูกค้าออกจาก `processMessage` เตรียมเสียบ Messenger (M-2) — LINE คงพฤติกรรมเดิมทุกบรรทัด
- **ใหม่ `lib/channel/transport.ts`:** `interface ChannelTransport` (reply/push/typing/getProfileName/downloadInboundImage · "ช่องทางลูกค้า" เท่านั้น) + `class LineTransport` ห่อ `lib/line` เดิม (sandbox guard ใน line.ts ยังทำงาน → T-STUDIO ใช้ได้)
- **`handler.ts`:** `processMessage`/`runHandoffFlow`/`deliverReply`/`handoff`/`handleImageIntent`/`runOrderGate` เปลี่ยน `replyToken` → `transport` (thread ผ่าน helper ลูกค้าทั้งสาย) · `getProfileName(userId)`→`transport.getProfileName()` · reply/push ลูกค้า→transport
- **คงเดิม (ไม่ใช่ช่องทางลูกค้า):** admin-group `pushRawText`/`pushRawMessages` (กลุ่ม ops LINE) · คำสั่งกลุ่มแอดมิน (`replyToAdmin`/list/close) · `/reset` · typing/download ใน entry helper LINE
- **entry helper** (`handleTextMessage`/`handleImageMessage`) คง `replyToken` + สร้าง `new LineTransport(token, userId)` ตอนเรียก processMessage (token ล่าสุดหลัง debounce) · `lib/train/turn.ts` สร้าง `LineTransport("TRAIN-REPLY-TOKEN", userId)`
- **พิสูจน์:** 405 passed | 3 expected-fail **เท่าเดิม ไม่แก้ expectation** (แก้แค่วิธี inject) · build เขียว — บทพิสูจน์เดียวกับตอนแยก route.ts→handler.ts · **M-2** เพิ่ม `MessengerTransport` เสียบ interface เดิมได้เลย

### M-0 · Research Meta Messenger adapter (ไม่เขียนโค้ด · ค้นสด 2026-07-29)
เอกสาร [docs/META-ADAPTER-SPEC.md](META-ADAPTER-SPEC.md) `[UNBUILT]` — สรุป onboarding/webhook/Send API + ร่างสถาปัตยกรรม adapter
- 🔴 **`POST_PURCHASE_UPDATE` ตาย (27 เม.ย. 2026):** แจ้งพัสดุ/Follow **นอก 24 ชม.** บน Messenger ต้องใช้ **Utility Templates** (pre-approve + จ่ายเงิน) → **D-50 ยกมาเฉยๆ ไม่ได้** · แกนขาย (ก้อน A · ใน 24 ชม. `RESPONSE`) พอร์ตได้เต็ม
- **Dev Mode เทสได้ทันที** กับ role Admin/Dev/Tester ก่อน App Review · คุยลูกค้าจริง = App Review + Business Verification (`pages_messaging` Advanced Access)
- **สถาปัตยกรรม:** route ใหม่ → verify `X-Hub-Signature-256` → normalize event (ระบุ `page_id` ชัดทุก event) → `resolvePageContext(pageId)` → `processMessage` เดิม ผ่าน **`ChannelTransport`** (สกัด LINE ออกจาก handler · LINE คงพฤติกรรมเดิม) → Send API (PSID ตรง ไม่มี reply token)
- **กันตายทาง (ระดับ ShippingProvider):** `resolvePageContext(pageId)` = จุดเปลี่ยนจุดเดียว — วันนี้ env 1 เพจ · อนาคตตาราง `channel_pages` โดยไม่รื้อ webhook/transport/handler
- **contract ที่ต้องเคาะก่อน build:** customer key ข้าม channel (composite `(channel, external_id)` vs prefix) · attribution ในชีต Orders (`line_user_id`→ generalize เป็น channel key ของ D-50) · D-50 นอก 24 ชม. · echo→human_mode
- **ไม่แตะ production** (research + doc ล้วน)

### Phase C · ลบ ENV ค้างใน Vercel
`SHEET_STEP_URL` `SHEET_FAQ_URL` `SHEET_CONFIG_URL` `SHEET_FOLLOW_URL` — โค้ดไม่อ่านแล้ว ลบทิ้งได้
