# STATUS — SakbinAdvBot ("ปลาทู")

## 🟢 ทิศทางปัจจุบัน (D-73c · 2026-09-02) — อ่านก่อนอย่างอื่น
- 🔴 **v3 = ทางเดียวแล้ว · v2 ถูกถอดออกหมด (D-68)** — ไม่มี `SHEET_SCHEMA` · ไม่มี `prompt/system.ts` · ไม่มี verbatim/`คำ_notify`/ปุ่มสลับชีตใน /train · **rollback = Vercel Instant Rollback** ไม่ใช่สวิตช์ในโค้ด
  (override เงื่อนไข (2) ของ D-66 โดยเจตนา — ยังไม่มีลูกค้าจริง ถอดตอนนี้เสี่ยงน้อยกว่า · เหตุผลเต็ม → DECISIONS D-68)
- 🟡 **ฟีเจอร์ที่เคยตายเงียบ (เจอใน D-68):** `handoff_after_intake` เปิดกลับแล้วใน **D-73** (โค้ดพร้อม · รอเจ้าของเพิ่มแถวในชีต) · ที่ยังหลับ: `awaiting_payment`/`awaiting_address` (moot โดยดีไซน์ v3) · `post_sale`
- 🟢 **ปุ่มเขียนใน /train เปิดแล้ว (D-72b) + ใช้งานได้จริง (D-74)** — ลิสต์โชว์ id นำหน้า + ช่องค้นหา · ฟอร์มเพิ่มแถวเติม id ให้เอง
  (K020→K021) · id/key ซ้ำ = ปฏิเสธพร้อมบอกว่าชนแถวไหน · 🔴 **ปุ่ม "✎ แก้ไข" ต่อแถว** (เดิมมีแต่ toggle live/draft = ไม่มีทางเข้าฟอร์มแก้)
  บันทึกผ่านเส้นทางเดิมของ D-72b เท่านั้น (diff→commit · lint/conflict/TRAIN_LOG ครบ)
- **D-72b เสร็จแล้ว (2026-09-02)** — แยกเส้นทาง raw/normalize + ปลดล็อกปุ่มเขียน · รายละเอียด DECISIONS D-72b
- **D-69 เสร็จ ✅** — โมเดล/ระดับการคิด/timeout/ข้อความระบบช้า **ตั้งจากชีตได้** (ไม่มีแถว = ค่าเดิม) · timeout 8→15 วิ + การ์ด clamp · `maxDuration` 30→60 · degraded ไม่โกหก/ไม่สั่งพิมพ์ซ้ำ + 🔔 แจ้งแอดมิน · **ตาราง `ai_usage` เก็บต้นทุนทุกการเรียก** (call_kind main/regen/extraction)
  🔴 **เจ้าของทำต่อ:** เพิ่ม 4 แถวใน CSV_Config — **ชื่อคีย์+ค่าที่ควรใส่อยู่ใน [docs/D69-CONFIG-KEYS.md](docs/D69-CONFIG-KEYS.md)** แล้ว **ลองสลับ `โมเดล` เป็น `gemini-3.7-flash`** — ถูกกว่า 3.5 ครึ่งหนึ่ง (input $0.75 vs $1.50 · output $3.75 vs $9.00) แล้ววัดจาก `ai_usage` + cost log ของ Google
  ⚠️ ราคา 3.6/3.7 เป็นโปรถึง 31 ธ.ค. 2026 · **caching ยังไม่ทำ** — ดู `cached_tokens` ใน `ai_usage` ก่อน (implicit เปิดอยู่แล้ว ขั้นต่ำ 4,096 tok) · hit = 0 ค่อยเปิด D-71
- **D-72a เสร็จ ✅** — 🔴 **ชื่อเดียวทั้งระบบ: ชีต = โค้ด = X-ray** (`Steps`/`Knowledge`/`Products`/`Promo`/`Vars`/`Config`) · ไม่มีชั้นแปลชื่ออีก · `adapter-v3.ts → normalize-bundle.ts` (ยังมี logic จริง 4 อย่าง ไม่ใช่ shim) · ลบแท็บ `Objections` + `objCap` · ENV → `SHEET_BOTLIB_ID`
  🟢 **golden ชั้น D เทียบ baseline แล้ว diff ว่างเปล่า** (pure rename พิสูจน์แล้ว)

  🔴 **ลำดับ deploy — เจ้าของทำเอง (ผิดลำดับ = บอทตายเงียบ):**
  1. เจ้าของ **ทำสำเนาไฟล์ชีตไว้ก่อน**
  2. **ก่อน CC push:** แก้ค่า ENV `SHEET_BOTLIB_ID` บน Vercel ให้เป็น **id ของชีต v3** (ค่าเดียวกับ `SHEET_BOTLIB_V3_ID`) + **ลบ `SHEET_SCHEMA`**
     · ⚠️ ตอนนี้ `SHEET_BOTLIB_ID` ยังถือ id ของ**ชีต v2 เก่า** (ค้างจาก D-68) — deploy ใหม่จะอ่านเจอค่านี้ทันที
     · deploy ปัจจุบันไม่อ่าน key นี้ → แก้ค่าตอนนี้ไม่มีผลกับบอทที่รันอยู่ = **ไม่มีช่วงดับ**
  3. CC push → รอ Vercel Ready
  4. 🔴 **เปลี่ยนชื่อแท็บ 6 อันทันที** (`เส้นทางขาย→Steps` · `ความรู้→Knowledge` · `CSV_Products→Products` · `CSV_Promo→Promo` · `CSV_Vars→Vars` · `CSV_Config→Config`) + เปลี่ยนชื่อไฟล์เป็น `SakbinBotLibrary`
     · ⚠️ **บอทดับช่วงนี้ ~1-2 นาที** — ยอมรับได้ ยังไม่มีลูกค้าจริง
     · 🔴 **ห้ามสลับ 3↔4:** พอ deploy เสร็จ โค้ดจะขอแท็บ `Steps`/`Knowledge` ที่ยังไม่มีในชีต → bundle ว่าง → บอทตาย
       **prod จะไม่มีทางเขียวจนกว่าจะเปลี่ยนชื่อแท็บ** (ที่เคยเขียนว่า "หลัง prod เขียว ค่อยเปลี่ยนชื่อแท็บ" = ผิด)
  5. ทักบอทเทส + เช็คการ์ด schema ในหน้า dashboard + รัน golden ชั้น G
  6. prod เขียวแล้ว → **ลบ `SHEET_BOTLIB_V3_ID` ทิ้ง**

  🟡 **ปุ่ม "▶ ทดสอบ draft ในห้องซ้อม" ฟื้นแล้ว (ผลพลอยได้ของ rename) — ยังไม่พิสูจน์ด้วยมือ เจ้าของต้องเทส**
  · เดิมตายเงียบตั้งแต่ D-61.B เพราะ UI ส่งชื่อ shape (`CSV_FAQ`/`CSV_Step`) แต่ overlay ทับที่ชั้น batchGet ซึ่งใช้ชื่อแท็บบนชีต → filter ได้ 0 entry
  · `CSV_Vars` บังเอิญชื่อตรงกันอยู่แล้ว → แท็บ Vars ทำงานปกติมาตลอด = อาการไม่ครบทุกแท็บเลยไม่มีใครเห็น · กระทบ **/train เท่านั้น** (overlay อยู่ใน sandbox ALS)
  · 🔴 **overlay เห็นผลเฉพาะคอลัมน์ที่เข้า prompt** = `สาระที่ต้องสื่อ` (Steps) + `แนวตอบ` (Knowledge)
    → draft ที่ช่อง **`แนวตอบ` ของ Steps จะไม่เห็นอะไรเปลี่ยน เพราะคอลัมน์นั้นไม่เข้า prompt (D-66 §4) — ไม่ใช่ปุ่มพัง**
- **D-72b เสร็จ ✅** — 🔴 **ปุ่มเขียนใน /train เปิดแล้ว** (ปิด KI D-65/D-68): แยก 2 มุมมองจาก batchGet เดียว —
  เส้นบอท `loadBotLibrary()` (normalize · เหมือนเดิมทุกบรรทัด) · เส้น Studio `loadRawSheets()` (แถวดิบตามชีตเป๊ะ)
  · เขียน/พรีวิว/ผู้ช่วยเทรน หาพิกัดจากแถวดิบ · `composeKnowledgeAnswer` แหล่งเดียว (normalize = preview)
  · คอลัมน์แก้ได้: Steps `สาระที่ต้องสื่อ`+`แนวตอบ`(ป้าย "ไม่เข้า prompt") · Knowledge 3 คอลัมน์+`keyword` · Vars `ค่า`
  · 🔴 lintHealthH1 เกณฑ์ v3: block เฉพาะ "คำรับรอง" (`findAssuranceHits` ตัวเดียวกับ guard) — ข้อเท็จจริงตามฉลากเขียนได้แล้ว
  · ⚠️ **ยังไม่พิสูจน์ด้วยมือบนชีตจริง — เจ้าของเทสหลัง deploy** (แก้เซลล์ → ดูชีตจริงว่าลงถูกช่อง + TRAIN_LOG มีแถว)
- **D-73 + D-73b เสร็จ ✅ (ฝั่งโค้ด)** — เปิด intake D-34/35 กลับ: precedence 4 ข้อบังคับในโค้ด+เทสครบ · handoff จาก
  intake แนบ "📋 ข้อมูลที่เก็บได้" (เทิร์นรูป = "[ลูกค้าส่งรูปมา]") · keyword handoff reset ตัวนับ
  🔴 **D-73b: ป้ายประตู intake = คอลัมน์ `handoff` 3 ค่า** (ว่าง=ปกติ · "ใช่"=ส่งทันที · "เก็บข้อมูลก่อน"=intake)
  — ไม่ใช้คอลัมน์ funnel_stage แล้ว (ชีตจริง 9 คอลัมน์) · ค่าพิมพ์ผิด = error ดัง + การ์ด schema ⚠️ + ตีเป็น handoff (ทิศปลอดภัย)
  · แถว `H_CLAIM`/`H_BULK` ในชีตเป็น draft อยู่ → **เจ้าของซ้อมในห้องซ้อม (ปุ่ม ▶ draft) แล้วค่อยสลับ live**
  🔔 **D-73c: แจ้งแอดมินตั้งแต่ "เข้าประตู" ด้วย (ไม่ปิดบอท)** — กันเคสลูกค้าหายเงียบกลางเก็บข้อมูลแล้วไม่มีใครรู้
  · ยิงครั้งเดียวต่อรอบ (dedup จากตัวนับ 0→1) · ข้อความตั้งจากชีตคีย์ `ข้อความ_แจ้งแอดมิน_เก็บข้อมูล`
  · rollback = toggle กลับ draft (พิสูจน์ด้วยเทส ไม่ต้อง deploy) · ⚠️ known risk "ห้ามรับปากผลลัพธ์" คุมด้วย prompt
  เท่านั้น — เจอบอทรับปากแม้ครั้งเดียว → ยกระดับเป็น guard ทันที (DECISIONS D-73)
- **เหลือทำตอนนี้:** **D-70** (หน้าสรุปต้นทุนจาก `ai_usage`) → **D-71** (explicit caching ถ้า cached_tokens=0) · ซ้อม **บท 2 / 4 / 5** · เฝ้าอาการ "คำถามขึ้นต้นบอลลูนปิด" (ยังไม่นิ่ง)
- **D-67 เสร็จ ✅** — ตัวแปรรูป CSV_Vars ใช้ได้จริงใน v3: ต้นเหตุคือ **whitelist ชื่อตัวแปรใน prompt** (`system-v3.ts:139`) ไม่ใช่ resolver (พิสูจน์ก่อน/หลัง 0/3→3/3 บนชีต+Gemini จริง) · กฎใหม่ = "คัดลอกตัวแปรที่**เห็นในข้อมูลแนบ**ทุกตัวอักษร ห้ามประดิษฐ์" → เจ้าของตั้งชื่อรูปใน CSV_Vars ได้ไม่จำกัด · +lint `var-collision`/`var-empty` (warn · สแกนชีตจริง = 0 warn ใหม่) · +รูปหาย log `image-dropped` + ห้องซ้อมโชว์ขีดฆ่า · +`delivery-invariants.test.ts` (เดิม line-freeze-baseline) ล็อกพฤติกรรมชั้นส่งจริง · **เกณฑ์ shared infra ใต้ freeze → DECISIONS D-67**
- 🔴 **แก้ชีต v3 ให้ถูกช่อง:** คอลัมน์ที่เข้า prompt = **`สาระที่ต้องสื่อ`** (เส้นทางขาย) + `แนวตอบ` ของ **ความรู้** (เฉพาะแถว keyword ตรง) · **`แนวตอบ` ของเส้นทางขาย = ช่อง "ตัวอย่างคำตอบ" ใน Train Studio → ไม่เข้า prompt แก้แล้วไม่มีผล** (D-66 §4)

## 🔴 D-61 · v3.0 "บอทนักขาย CX" — รื้อใหญ่ (contract: [D61-SPEC.md](D61-SPEC.md) · โมเดล Fable)
- **เฟส A (สมองใหม่) เสร็จ ✅** บน `main` — สวิตช์ `SHEET_SCHEMA` (env-only · default **v2 = พฤติกรรมเดิม 100%**) · prompt v3 (`prompt/system-v3.ts` · หมวก 3 ใบ/3C/ตอบแทรก-พากลับ/4 ประตู/few-shot เจ้าของ) · เรียบเรียงสด (verbatim/precedence ไม่วิ่งใน v3) · ธงสุขภาพ `คำ_ธงสุขภาพ` (hint+🔔 dedup `__HEALTH_NOTIFY__`+ไม่ปิดบอท) · assurance guard (block→regenerate 1→ตัดบรรทัด→fallback · ห้ามเงียบ) · `DEFAULT_HANDOFF_KEYWORDS_V3` (v2 เดิมไม่ขยับ)
- **เฟส B (ชีต v3 + adapter) เสร็จ ✅** บน `main` — adapter จุดเดียว (`adapter-v3.ts`): map แท็บ (เส้นทางขาย→Step · ความรู้→FAQ รวม OBJ) + **normalize สถานะ "ว่าง=draft" isolate ที่ adapter** + funnel map ตายตัว · loader dispatch `SHEET_BOTLIB_V3_ID` · `สาระที่ต้องสื่อ`/สารก่อภูมิแพ้ เข้า prompt (v3) · Config `เข้า prompt` header-driven · seed script idempotent (แท็บวิธีใช้+คำเตือน) · mapping: [docs/D61-MIGRATION.md](docs/D61-MIGRATION.md)
- 🔴 **เจ้าของหลัง seed:** เปิดไฟล์ v3 ตรวจ — แท็บวิธีใช้/เส้นทางขาย/Config · **กรอกจริง: เลขที่บัญชี·ชื่อบัญชี·ธนาคาร (ยัง placeholder) + คำต้องห้าม_โฆษณา + รูปสินค้า URL** ก่อน cutover
- **เฟส C (golden + การ์ด schema + เตรียม cutover) เสร็จ ✅** บน `main` — **ปุ่ม "ชีต: v2/v3" ในห้องซ้อม** (sandbox override ต่อ session · prod ไม่กระทบ · ถาวร) + แก้ config memo leak · golden 2 ชั้น (D 18 เคสรันทุก npm test · G gated real Gemini+ชีตจริง → scorecard) · การ์ดสุขภาพชีต v3 ใน dashboard · cron ยืนยันสองโหมด · **checklist วันสลับ: [docs/D61-CUTOVER.md](docs/D61-CUTOVER.md)**
- **C1 ปลดล็อก golden ชั้น G เสร็จ ✅** บน `main` — เดิม `HARNESS_REAL_SHEET` ถูกอ่านแค่ที่ **gate ของเทส** ไม่มีใครเอาไปปิด mock → `setup.ts` mock `googleapis` ไม่มีเงื่อนไข → loader ได้ bundle ว่าง → **ชั้น G รันไม่ผ่านบนทุกเครื่อง** (ไม่ใช่ปัญหา env) · แก้: flag=1 → `values.batchGet` + `getConfig` ยิงของจริง · 🔴 **ชีต Orders (`get`/`append`/`batchUpdate`) ยัง mock เสมอ** + client จริงขอ scope `readonly` (เทสเขียนชีตจริงไม่ได้) · flag ปิด = พฤติกรรมเดิม 100% (560 passed) · +`tmp/` เข้า .gitignore · +`GEMINI_API_KEY_TRAIN` เข้า REPO-MAP §5/.env.example
- **C2 ปิด 3 ช่องจาก scorecard เสร็จ ✅** บน `main` — (1) 🔴 **`pushHealthNotifyV3` ย้ายออกจากบล็อก `deliverMarksStep`** — เดิมเทิร์นที่ AI ล้ม/ส่งไม่ถึง = แอดมิน**ไม่รู้เลย**ว่ามีคนถามเรื่องแพ้อาหาร (H1) · ตอนนี้แจ้งเสมอ แยก 2 แบบ: ตอบแล้ว=เนื้อจาก Config · **ยังไม่ตอบ=🔴 ด่วน (เนื้อในโค้ด)** · dedup marker เดิมคุมทั้งคู่ (2) `DEGRADED_NO_INPUT_REPLY` ตัดคำ "รบกวน" (3) invariant "รบกวน" เข้า golden ทั้ง D+G + สแกนแนวตอบในชีต (S01) + เข้าลิสต์คำห้ามใน `prompt/system-v3.ts` + **กติกาทักทาย** (เปิดบทใหม่=ทักเสมอทุกประตู · ต่อเนื่อง=ห้ามทักซ้ำ · ทักทาย**ไม่เปลี่ยนประตู**)
- **golden ชั้น G = 18/18 ✅** (วัดบน `aa0f658` · ชีตจริง+Gemini จริง · เคสเสี่ยง 3 รอบ) · ทักทายซ้อน "สวัสดีค่ะสวัสดีค่ะ" หายหมด · `npm test` **566 passed**
- **C3 จูน prompt โซนสุขภาพ เสร็จ ✅** บน `main` — วินิจฉัยพลิกโจทย์: hit 83% ส่วนใหญ่เป็น **false positive** (โมเดลใช้ "ปลอดภัย" เชิงระวัง "เพื่อความปลอดภัย แนะนำปรึกษาแพทย์" · guard จับ substring แยกบริบทไม่ได้ → cut ฆ่าประโยคปรึกษาแพทย์ = ผลกลับหัว) · แก้ 3 จุดเฉพาะพื้นผิวเทิร์นสุขภาพ: ห้าม "คำ" (ไม่ใช่แค่ประโยค) + **ประโยคแทนสำเร็จรูป "แนะนำนำข้อมูลส่วนผสมนี้ปรึกษาแพทย์เพื่อความสบายใจค่ะ"** ใน prompt/hint/correction · **ผล: hit 0/6 สองรอบติด** (เกณฑ์ ≤1/6) · คำตอบสุขภาพถึงลูกค้าเต็มใบ ไม่โดน cut · G เต็ม 18/18 · 566 passed · รายละเอียด → DECISIONS D-61.C3
- **C5 แก้ 3 พฤติกรรมจากซ้อมจริง ✅** บน `main` — (1) 🔴 **บอทเลิกโชว์โปรที่ไม่มีจริง** ("2 ถ้วย 220") — ต้นเหตุคือตารางที่ inject แจกแจงทุกจำนวนโดยไม่บอกว่าแถวไหนเป็นโปร → ติดป้าย `[โปรโมชั่น]`/`[ราคาตามจำนวน ไม่ใช่โปร]` ที่ `formatPriceTable` + กติกา prompt (ไม่แตะ guard · ราคาถูกอยู่แล้ว) → รายการโปร = 1/3/5/10 ตรงชีตทุกเคส (2) รูปแบบราคาแยกค่าส่ง "95 บาท + ค่าส่ง 30 บาท = รวม 125 บาท" (เดิม "125 (มีค่าส่ง 30)" ลูกค้าตีความเป็น 155) (3) บอลลูนปิด: คำถามพาไปต่ออยู่บรรทัดสุดท้ายเสมอ + few-shot ทุกฉากสอนลำดับใหม่ · **G 18/18** · 577 passed
- **C6 ปิดช่องที่ C5 เหลือ ✅** บน `main` — **คำถามพาไปต่อ = บอลลูนเดี่ยวเสมอ บังคับที่ delivery layer** (`splitClosingQuestion` ใน `lib/line.ts` · ตัดที่ขอบบรรทัด · deterministic ไม่พึ่ง LLM) · เหตุผล: LINE มือถือโชว์ noti จากข้อความสุดท้าย = ระดับ conversion · เพดาน ≤5 ชน → รวมสองบอลลูนแรก ไม่ทิ้งคำถาม · v3 เท่านั้น · ตัวตรวจคำถามย้ายมา lib เป็นแหล่งเดียว (ชั้น G import ใช้ร่วม) · unit 11 เคส edge ครบ
- 🔴 **C6 เจอต้นเหตุจริงของ C5 ด้วย: `โหมดประหยัดโควตา` ยุบ `[[เว้น]]` ทุกตัว** (ชีตตั้ง `เปิด` · default ในโค้ดก็ `true`) → โมเดลใส่ `[[เว้น]]` มาตลอดแต่ delivery ยุบทิ้ง · **เจ้าของเคาะ: ปิดโหมดประหยัดใน v3 โดยเจตนา** (ซ้อม=จริง 100% + จังหวะบอลลูนคือดีไซน์ CX) · ทำที่ `config.ts` ระดับโหมด — **v2 prod ไม่ขยับ** · ต้นทุนเพิ่ม = 0 สำหรับเทิร์นตอบปกติ (Reply API 5 messages/1 call · reply ไม่นับโควตา) · ห้องซ้อม render เหมือน prod เป๊ะ (ดักหลัง `parseReplyIntoMessages`) → DECISIONS D-61.C6
- **C4 persona ชื่อบอทตาม Config เสร็จ ✅** บน `main` — เจอจากซ้อมจริง: ตั้ง `ชื่อบอท`=ปลาทู แต่บอทเรียกตัวเองว่า "แอดมิน" เพราะ few-shot เขียนตายตัว · แก้ few-shot ให้ใช้ `${botName}` **เฉพาะที่บอทพูดถึงตัวเอง** + คง "ทีมแอดมิน" ตรงงานคนจริง (แพ็ค/จัดส่ง) + กติกา identity "เรียกแทนตัวเองว่า {ชื่อบอท} เสมอ" + เลิก hardcode "ปลาทู" ในข้อความ fallback 6 จุด (`defaultReply(botName)` + 5 ฟังก์ชันใน handler) · live G01: บอทตอบ "**ปลาทู**ขอแนะนำรายละเอียด..." ✅ · 573 passed
- **D-62 ยกระดับตาข่าย H1 เสร็จ ✅** บน `main` — (1) guard แยกบริบท: allowlist แคบ "เชิงระวัง `เพื่อความ...` (ไม่มีช่องว่างคั่น) + บรรทัดเดียวกันส่งต่อแพทย์/ทีม" = ไม่ hit · รับรองตรง/มีเงื่อนไข/บรรยายสินค้า hit เหมือนเดิม (2) regen ห้ามแย่ลง: ยืนยัน re-check เดิม (regen มี hit = ทิ้ง ใช้ต้นฉบับ-ตัดบรรทัด) + log `regen-dirty` · เทสด้วยประโยคจริงจาก probe ทั้งสองฝั่ง → DECISIONS D-62
- ⚠️ **บทเรียน prompt v3:** เติมกติกาทักทายแบบ "บล็อกใหม่" ทำ G11/G12 (ตอบแทรก-พากลับ) ตกทันที — ต้องเป็น **bullet เดียวใน `<บทบาท>`** + มีประโยค "ทักทายไม่เปลี่ยนประตู" กำกับ ไม่งั้นบอทย้อนไปแนะนำสินค้าใหม่แทนสรุปยอด
- ⚠️ **บทเรียนการวัด (สำคัญ):** 🔴 **ห้ามใช้ตัวเลขจาก sample เดียว หรือจาก prompt คนละเวอร์ชัน มาตัดสินใจ** — เคยสรุปว่า "regen 5/6 ดีขึ้นแล้ว" จากรอบเดียวที่เป็น prompt ระหว่างทาง พอวัดบนโค้ดที่ ship จริงได้ 2/5 · เคสสุขภาพ/ส่งต่อเป็น non-deterministic ต้องรันหลายรอบก่อนสรุป · 🔴 **ห้ามรัน golden ซ้อนกัน** — ทุกรอบ `TRUNCATE` Neon `harness-test` ก้อนเดียวกัน เคยได้ผลลวง fail 11 เคสจากการรันทับ
- ⚠️ **known-variance (ดูหลัง cutover · ยังไม่ต้องแก้):** golden ชั้น G รอบหนึ่งใน 2 รอบ โมเดลหลุดคำ **"รบกวน"** 1 เทิร์น (G02) — ยอมรับได้ตอนนี้เพราะ invariant C2 จับได้ + เคสจริงมี guard ชั้นชีต/degraded คุมอยู่ · 🔴 **หลัง cutover ให้ดูว่าเกิดถี่แค่ไหนกับลูกค้าจริง** (Vercel logs · ถ้าถี่ = ต้องดัน prompt เพิ่มหรือทำ guard ระดับคำเหมือน assurance)
- ✅ **cutover เสร็จแล้ว** · 🔴 **D-68 ถอด v2 ออกหมด** — ไม่มีสวิตช์ให้สลับกลับอีก (rollback = Vercel Instant Rollback)
- **ต่อไป: ซ้อมบท 2/4/5 → D-67 (`{รูปโปรโมชั่น}`) → เฟส D** (ผู้ช่วยเทรน v3 + โหมดสัมภาษณ์เซ็ตอัพ + write path/วงจร draft บนชีต v3 · เฟส D ต้องแก้ `write.ts` ที่ชี้ชีต v2 ด้วย)
- 🔴 กติกา: report แผนก่อนทุกเฟส · 1 commit/เฟส · **v2 ถอดออกหมดแล้ว (D-68)** · ห้ามแตะ pricing/gate semantics/Neon/channel adapters/TRAIN_LOG

> สแนปช็อตสำหรับคนรับช่วงต่อ (ไม่เห็นแชทก็ทำต่อได้) · อัปเดต 2026-07-30
> รายละเอียด → [docs/DECISIONS.md](docs/DECISIONS.md) · แผนที่โค้ด → [REPO-MAP.md](REPO-MAP.md) · brief → [docs/P2-REBUILD-BRIEF.md](docs/P2-REBUILD-BRIEF.md)

## 🟢 T-STUDIO ห้องซ้อมเทรน (/train) — ครบ 4 เฟส (ก-ง) ✅ บน `main`
เจ้าของซ้อมสนทนา + แตะบอลลูนดูที่มา + แก้ draft + เขียนกลับชีต ได้จบในหน้าเดียว บนมือถือ · spec = [docs/T1-PATTERN-STUDIO-SPEC.md](docs/T1-PATTERN-STUDIO-SPEC.md) · หลักเหล็ก: reuse engine production ทุกจุด · sandbox ไม่มี side effect ถึง prod
- **ก Simulator:** pipeline จริง (Gemini จริง) ใน ALS sandbox · LINE/Blob/ชีต Orders→collector · Neon→branch `train` · X-ray + cron จำลอง
- **ข แตะบอลลูน:** provenance (แท็บ/key/คอลัมน์+raw+ตัวแปร) · draft overlay (batchGet proxy) · lint สด · dropped bubble ขีดฆ่า · "▶ เล่นใหม่"
- **ค เขียนกลับ+copy:** A1 สดจาก key+header · conflict 409 · hard guard BotLibrary เท่านั้น (ห้าม Orders) · lint gate server · TRAIN_LOG
- **ง mobile polish:** แชทเต็มจอ · bottom sheet (drag-to-close/กันคีย์บอร์ดบัง) · ปุ่มนิ้วโป้ง · bug fix: เปิด editor fetch ข้อความดิบสด + badge "ชีตถูกแก้แล้ว"
- **hotfix มือถือ:** กดบอลลูน→"Application error" = **TDZ** (`const tb` ประกาศหลัง `renderEditor()` ถูกเรียก) · แก้: ย้าย tb ขึ้น + `EditorBoundary` ครอบแผง editor (พังในอนาคต=เด้งเฉพาะแผง แชทอยู่) + guard touch
- **โครงสร้างขยับ:** `route.ts`→`handler.ts` (ก) · `loader.ts` bypass cache ใน sandbox (ข · guarded no-op)
- ✅ **KI-06 ปิดแล้ว:** `appendOrderRow` เขียน `line_user_id` (R) + เทส join จริง (golden บท 19)
- 🔴 **รอเจ้าของ:** ENV `DATABASE_URL_TRAIN` (Neon branch `train`) เข้า Vercel → redeploy → เปิด /train · (option) วาง `public/train-slip-sample.jpg` · ตรวจ viewport ~380px บนอุปกรณ์จริง

## 🔴 D-64 · cron เหลืองานเดียว = แจ้งเลขพัสดุ (เสร็จ ✅ บน `main`)
- **เลขออเดอร์ย้ายไป Apps Script บนชีต** (เขียนคอลัมน์ A ตอนติ๊ก M · รูปแบบ `MMDD_n` เช่น `0819_1`) · ส่งออเดอร์เข้ากลุ่มแพ็ค = **คน copy จากคอลัมน์สูตร** · cron รันวันละ 2 รอบ 15:00/18:00 (cron-job.org)
- **ตัดออก:** loop แจกเลขทั้งก้อน · `listPendingOrders` · `markOrderSent` · `nextOrderNumber` + ตาราง `order_counter` · `resolveOrderDay` · `orderNumberResetDaily` → ✅ **ปิด KI-05** (ไม่มี race ให้กันแล้ว)
- 🔴 **คิวแจ้งพัสดุใหม่ = A(ลำดับ) ไม่ว่าง + P ไม่ว่าง + N≠TRUE** — **ห้ามพึ่ง O** (คนติ๊กเอง = ลืมได้ · ถ้าพึ่งจะไม่มีใครได้รับแจ้งเลย) · dedup ยังอยู่ที่ Neon `shipping_notified`
- 🔴 **`deriveOrderStatus` แก้ตาม** อิง A/N/P (ตัด `awaiting_number`) — ไม่งั้นทุกออเดอร์ค้าง "รอแจกเลข" ถาวร
- 🔴 **D-45b hook ย้ายไป `handler.ts` ต่อจาก `markOrderWritten`** (จังหวะเขียนชีตสำเร็จ = ยิงแน่นอนเสมอ) · ธงล้างเร็วขึ้น อาจส่ง S2 ซ้ำถ้าลูกค้าคุยต่อ — เจ้าของถือว่าถูก **เฝ้าดูตอนซ้อม v3**
- **ชีต 27 คอลัมน์:** แทรก **Q "กล่องส่งออเดอร์"** → `order_id`=R … `แก้ไขกี่ครั้ง`=AA · 🔴 **ห้ามใส่ชื่อนี้ใน `ORDERS_HEADER`** (จะกลายเป็น required)
- 🔴 **ปิดจุดบอดเทส:** mock header เดิม = `ORDERS_HEADER` เป๊ะ → เทสไม่มีวันจับ column-offset · ตอนนี้ mock มีคอลัมน์แทรกจริง + helper/fixture อิง `sheetsCalls.ordersHeader`
- ⚠️ **กระบวนการ:** ไม่มีใครยิงออเดอร์เข้ากลุ่มอัตโนมัติแล้ว — ทีมแพ็คลืม copy = ไม่มีสัญญาณเตือน

## 🟢 ระบบพร้อมรับลูกค้าจริง

- **โค้ด v2.0 + ซีรีส์ D-45→D-49 อยู่บน `main`** — เทสรับบน LINE จริงผ่านครบ (2026-07-23):
  - ✅ ก้อน "เปลี่ยน COD + ที่อยู่" จบเทิร์นเดียว พร้อมทวนเต็ม (D-48 extraction + D-49 override→won + snapshot)
  - ✅ cron ฟื้น — แจกเลขออเดอร์ (atomic) + แจ้งกลุ่ม format ถูก
  - ✅ ซื้อซ้ำได้ — ประตู S2 ส่งเต็มก้อนใหม่ (ธง `delivered_steps` ล้างหลังปิดออเดอร์ · KI-06)
- **cron-job.org: enabled** ทุก 5 นาที (endpoint ออเดอร์ · เช็ค `Authorization: Bearer <CRON_SECRET>`)
- **D-50 (แจ้งเลขพัสดุ · ก้อน B ส่วนแรก) เสร็จ ✅** บน `main` — ทีมแพ็คกรอก Tracking(P) → cron push แจ้งลูกค้า (ขนส่ง+เลขพัสดุ) ผ่าน greeting D-51 · dedup Neon `shipping_notified` · human_mode→แจ้งแอดมิน · T-STUDIO ปุ่ม "📦 กรอกพัสดุ + cron" · 🔴 เจ้าของเพิ่ม Config keys (ล่าง)
- **D-51 (ทักทายรายวัน) เสร็จ ✅** บน `main` — เทิร์นแรกของลูกค้าแต่ละวัน (เวลาไทย) เติม prefix หน้าบอลลูนข้อความแรก (delivery ล้วน · CSV_Config `ทักทายรายวัน` · ค่าเริ่ม `สวัสดีค่ะ ` · ว่าง=ปิด · ข้าม handoff/degraded/รูป)
- 🔴 **เจ้าของต้องเพิ่มใน CSV_Config (ชีต):** `ทักทายรายวัน` (D-51 · ค่าเริ่ม `สวัสดีค่ะ ` · เว้นว่าง=ปิด) · `ข้อความแจ้งพัสดุ` (D-50 · มี `{ขนส่ง}{เลขพัสดุ}` · เว้นว่าง=ปิด) · `ขนส่ง_เริ่มต้น` (D-50 · `Shopee Express`) — ทั้งหมด "ไม่มี key = ใช้ค่าเริ่มในโค้ด" (ฟีเจอร์เปิดอยู่แล้ว) · เพิ่มเพื่อแก้สำนวนเองในชีต
## 🔵 Meta Messenger adapter — เริ่มแล้ว (§5 เคาะครบ · แผน M-1→M-4)
- **M-0 research เสร็จ ✅** — [docs/META-ADAPTER-SPEC.md](docs/META-ADAPTER-SPEC.md) `[UNBUILT]` · 🔴 `POST_PURCHASE_UPDATE` ตาย (เม.ย. 2026) → แจ้งพัสดุนอก 24 ชม. ต้อง Utility Template · Dev Mode เทสได้ก่อนรีวิว
- **M-1 refactor `ChannelTransport` เสร็จ ✅** — interface + `LineTransport` · `processMessage`+helper รับ `transport` แทน `replyToken` · zero behavior change
- **M-2 Meta Messenger webhook เสร็จ ✅** บน `main` — `lib/channel/{pages,meta,meta-webhook}.ts` + `MessengerTransport` + `app/api/meta-webhook` · webhook (GET challenge + POST verify HMAC) → `processMessage` เดิม ผ่าน Send API (PSID) · id `fb:<pageId>:<psid>` · echo filter (META_APP_ID · fallback+เตือน) · สลิป `meta/<pageId>/` · Orders `source_channel=messenger` · cron D-50 ข้าม `fb:` (รอ M-4) · **417 passed** (405 คงเดิม + 12) · **เจ้าของ:** ENV 5 ตัว META_* เข้า Vercel + ตั้ง webhook + เทส Dev Mode
- **D-52 ป้ายช่องทาง เสร็จ ✅** — `channelLabel` (`[FB]`/`[ซ้อม]`/`[LINE]`) หน้าชื่อลูกค้าในข้อความแอดมินทุกจุด
- **M-4 cron route ตาม channel เสร็จ ✅** บน `main` — D-50 push ตาม prefix R: LINE→pushMessages เดิม · `fb:`→gate 24 ชม.→MessengerTransport (เกิน→แจ้งแอดมิน [FB] แจ้งเอง) · แจกเลข ทุกช่องเหมือนเดิม · **422 passed**
- **D-53 สวิตช์บอทราย channel เสร็จ ✅** บน `main` — คำสั่งกลุ่ม "ปิด/เปิดบอท line|fb" → `channel_switches` (ไม่มีแถว=เปิด) · เช็คต้นทางทั้ง 2 ฝั่ง (LINE/Messenger) → ช่องปิดบอทเงียบ · `ปิดบอท`เฉยๆ/รายคน เดิม · รายคนทับรายช่อง · **430 passed**
- **D-54 หน้า Privacy Policy เสร็จ ✅** — `/privacy` (static · ไทย+อังกฤษ · ไม่มี tracking) ปลดล็อก M-3 · 🔴 เจ้าของแจ้งอีเมลจริง (placeholder `sakbinofficial@gmail.com`)
- **T2-STUDIO v2 · เฟส ก (Dashboard ร้านจริง อ่านอย่างเดียว) เสร็จ ✅** บน `main` — spec [docs/T2-STUDIO-SPEC.md](docs/T2-STUDIO-SPEC.md) · `/train/dashboard` (โซนแดง อ่าน PROD Neon แยกจากห้องซ้อม) · สรุป (ลูกค้าใหม่/กลับมา/ยอดขายแยกช่อง/handoff ค้าง) + ตารางลูกค้า (สถานะ🟢🟡🔴✅ · TRAIN ซ่อน default) + หน้าลูกค้า read-only · ไม่เพิ่ม data ใหม่
- **T2-ข (สวิตช์เปิด-ปิดบอทใน UI · D-55) เสร็จ ✅** บน `main` — สวิตช์รายช่อง [LINE]/[FB] + toggle รายคน (row+detail) · confirm→เขียน→refresh→แจ้งกลุ่ม `(จาก Dashboard)` · reuse `setChannelEnabled`/`setHumanMode` เดิม (ไม่มี SQL ใหม่) · builder ข้อความแยก `lib/train/bot-switch.ts` handler เดิม import ร่วม (คำสั่งพิมพ์เท่าเดิม) · route `api/dashboard/switch` (guard เดิม)
- **T2-ฉ (แท็บออเดอร์ read-only · D-56) เสร็จ ✅** บน `main` — แท็บ "🧾 ออเดอร์" ในหน้า dashboard · ตารางจากชีต Orders (cache 60วิ · เรียงใหม่สุด) + สถานะ derive จากคอลัมน์จริง M/N/O/P+`shipping_notified` (`deriveOrderStatus` · cancelled ก่อนเสมอ) + headline คอขวด (งานคน=รอคอนเฟิร์ม/รอแพ็ค เน้นแดง) + TRAIN กรอง default · 🔴 read-only ล้วน (การกระทำจริงทำในชีต)
- **T2-ค (จัดการแถวคลังความรู้จากเว็บ · D-57) เสร็จ ✅** บน `main` — แท็บ "📚 คลังความรู้" ใน /train · เพิ่มแถว (🔴 บังคับ draft · แท็บไร้สถานะ=ปฏิเสธ) · live↔draft (soft delete) · "▶ ทดสอบ draft ในห้องซ้อม" (overlay สถานะ→live รายแถว · prod ยังกรอง draft) · **lintHealthH1 trigger-aware** (แถวเกี่ยวสุขภาพ→คำตอบต้อง handoff ไม่งั้น block) · funnel validator · เขียนผ่านกลไก v1 (hard guard/conflict/lint) · TRAIN_LOG +action
- **D-57.1 bugfix เสร็จ ✅** บน `main` — คอลัมน์สถานะ **CSV_FAQ ใช้ `status` (อังกฤษ)** แต่ที่อื่น `สถานะ` (ไทย) · +`statusColumnIndex` (single source · loader+UI เรียกตัวเดียว) แก้แบนเนอร์ผิด + add-row/toggle FAQ ใช้งานได้ · **490 passed**
- 🔴 **เจ้าของต้องวางข้อความเตือนในแท็บวิธีใช้ของชีต (KI-08):** `เพิ่มแถวมือ ต้องใส่ "สถานะ=draft" ก่อนเสมอ — ช่องว่าง=บอทถือ live ทันที (ลูกค้าเห็นเลย)` — เพิ่มผ่านเว็บ (📚) กันให้แล้ว แต่แก้ชีตมือยังเสี่ยง
- **D-58 handoff_notify เสร็จ ✅** บน `main` — funnel ใหม่ `handoff_notify` (ตอบ pattern + แจ้งแอดมิน 🔔 + ไม่ปิดบอท) + pre-check ชั้นสอง `คำ_notify` (fail-safe → handoff ถ้าชีตตั้งผิด) · 🔴 **ไม่แตะ DEFAULT_HANDOFF_KEYWORDS** (notifyKeywords ว่าง=พฤติกรรมเดิม 100%) · **486 passed**
- 🔴 **เปิดใช้ D-58 = งานชีตเจ้าของ:** ย้ายคำสุขภาพ `คำ_handoff`→`คำ_notify` + ประตู H1 `funnel_stage=handoff_notify` + เขียน pattern ปลอดภัย (ข้อมูล+ปรึกษาแพทย์ ไม่รับรอง "ทานได้")
- **T2-จ1 ผู้ช่วยเทรน (D-59) เสร็จ ✅** บน `main` — แท็บ 🤖 ใน /train · แชท AI (Gemini call แยก · `GEMINI_API_KEY_TRAIN` optional) เสนอ proposal ร่าง/แก้แถว → เจ้าของยืนยัน → **เขียนผ่านเส้นทาง D-57 เป๊ะ** (draft/lint/TRAIN_LOG ai-draft/ai-edit) · 10 กติกา (สุขภาพ→handoff_notify · ถามก่อนเดา · ≤3/เทิร์น) · Config แนะนำได้ห้ามเขียน · edit-row live มีป้ายเตือน
- **D-60 เสร็จ ✅** บน `main` — (1) `คำ_notify_<step_id>` per-door (alias `คำ_notify`→H1 · fail-safe/dedup ต่อประตู) (2) system prompt ผู้ช่วย +กติกา 11 flow สัมภาษณ์/12 เสียงนักขาย CX/persona ค่ะ (3) โหมดเกลาเสียง (KB เนื้อเต็ม · `rewriteSafety` รักษา {}/ตัวเลข · ≤3/เทิร์น · ปุ่มข้าม/excludeKeys ไม่วนซ้ำ)
- **D-60.1 เกลากติกา 12 เสร็จ ✅** บน `main` — นักขาย CX **3 หมวก** (แก้ปัญหา/สร้างความต้องการ/สร้างทางเลือก) · 3 เทคนิค (choice close · ดี→ดีขึ้น→ดีที่สุด · say no but never say no) · 3C เฉพาะเทิร์นกังวล · **lint เหลือง `close-style`** จับ "รับมั้ยคะ/รับเลยนะคะ" ใน pattern ที่ร่าง (เตือน ไม่ block)
- **D-60.2 bugfix กติกา 11 เสร็จ ✅** บน `main` — ผู้ช่วยออก proposal เทิร์นแรกงานใหม่ (ข้าม flow สัมภาษณ์) → แก้ 3 ชั้น: FLOW ย้ายขึ้นต้น prompt + few-shot + ข้อยกเว้นแคบ · schema +`phase` (enum) · 🔴 **server gate**: phase ≠ proposal → ทิ้ง proposals (invariant อยู่ในโค้ด เทสได้จริง) · UI greeting "ผม" → persona ค่ะ + file-guard กันถอยหลัง
- 🔴 **เปิดใช้ per-door (เจ้าของ):** ตั้ง `คำ_notify_<step_id>` ใน CSV_Config (เช่น `คำ_notify_H5` = เบาหวาน,ความดัน) + ประตูนั้น `funnel_stage=handoff_notify` + pattern ปลอดภัย
- 🔴 **ลำดับใหม่ (D-59):** ก→ข→ฉ→ค→**จ1**→ง→จ2 · ต่อไป **T2-ง** (Config แบบฟอร์ม) แล้ว **T2-จ2** (onboarding ไฟล์/รูป · Products/Promo · ก่อน P2 ต.ค.)
- **ต่อไป (งานมือเจ้าของ):** (option) ตั้ง `GEMINI_API_KEY_TRAIN` แยกโควตาผู้ช่วยเทรน · M-3 (App Review · ใช้ URL `/privacy`) · Utility Template (Messenger นอก 24 ชม.) · Follow/CRM ก้อน B ส่วนหลัง

- เทสล่าสุด: **405 passed | 3 expected-fail | 34 skipped** (scripted) · tsc + build เขียว
- known-tuning (ยอมรับแล้ว · ปิดได้ทีหลังด้วยการจูนชีต): **G12** (S2 vs S2_DIRECT · "ขอลองถ้วยเดียว") · **G29** stage (S4A/S4B)

## ซีรีส์ D-45→D-49 (เส้นทางเงิน + สมองยึด Step) — ปิดครบ ✅ บน `main`

| D | เรื่อง | สถานะ |
|---|---|---|
| D-45 | สมองยึด Step + ธง `delivered_steps` + `{ชวนเลือกโปร}` | ✅ (a/b/c/d) |
| D-46 | บล็อก PROHIBITED_CONTENT ไม่เข้า degraded → safetySettings OFF 5 หมวด + degraded path | ✅ |
| D-47 | ถอดชนวนเส้นทางเงิน — payment pre-check (ข้าม AI) + redact + log pattern | ✅ |
| D-48 | extraction fallback (call จิ๋วไม่มีกลิ่นเงิน) แทน retry + fix payment lock เคสเปลี่ยนวิธีจ่าย | ✅ |
| D-49 | ปิดช่องปาก-มือ — recovered→ประตูปลายทาง · complete ชนะ FAQ/OBJ · snapshot ทวนสด | ✅ |

> 🛡️ **PROHIBITED_CONTENT ปิดไม่ได้ (KI-05)** — รับด้วยบันได 4 ชั้น: pre-check → call หลัก → extraction → degraded · เฝ้า log `scope:"extraction"` + blocked pattern

## สรุป P2-REBUILD ที่จบ: "AI ไม่เขียนข้อความถึงลูกค้าอีกต่อไป"
AI เหลือ 4 งาน (เลือก step · จำแนก objection · สกัด order_data · ตัดสิน handoff) · ทุกคำจากชีต (pattern) + resolver

| D | เรื่อง | commit |
|---|---|---|
| D-40 | verbatim = default (flip parseThinkMode · ว่าง=ปิด) | `64acce8` |
| D-41 | schema v2.0 (ตัด CSV_Examples/brain · +CSV_Vars · status filter ทุกแท็บ) | `e6ce4a7` |
| D-42 | FAQ เข้า verbatim (precedence **handoff > objection > FAQ > step** + stepClosing วกกลับ) | `10ffc13` |
| D-43 | ขยาย resolver (catalog/config/{นโยบายค่าส่ง}/CSV_Vars · ระบบชนะ collision) | `99fb1e1` |
| D-44a-c | หด `คำ_handoff` · systemInstruction v2.0 (~2,153 tokens) · golden routing | `f1f433b`/`5efe3f5` |

## งานเจ้าของ (โค้ดพร้อมแล้ว — ที่เหลือคือ "เทรนผ่านชีต")
1. 🔴 **เช็ค pattern ประตู won (S4B) ในชีต** (D-49 เงื่อนไข 2) — ถ้ามี `{ออเดอร์_เลขที่}` บอลลูนนั้นตกทุกครั้งบนเทิร์นเขียน (เลขมาตอน cron แจก) → เอาออก/แยกบอลลูน
2. **เทรน "เข้าเมื่อ/keywords/ตัวอย่างคำตอบ" ในชีต** — จูนพฤติกรรมผ่านชีต ไม่ใช่โค้ด · keyword = วลี ไม่ใช่คำโดดสามัญ (โอน/ยา/ส่ง/ราคา ชน substring) · ยกเว้นแถว action=handoff
3. 🔴 **เช็ค `temperature` ในชีต v2.0 CSV_Config ให้ ≤0.2** (ชีตชนะ default)
4. **รัน golden 33 + sheet-lint ด้วย creds จริง** (`.env.test` เป็น dummy — CC รันไม่ได้) → แดง = จูนชีต + sync fixture (KI-07)
5. หลัง go-live เสถียร: ลบ `handoff-decision` log · ล้างแถวเทสในชีต Orders

## งานโค้ดถัดไป (จองไว้ · ยังไม่เริ่ม)
- ~~D-46 note (ปรับ degraded/retry)~~ **ยกเลิก** — แทนด้วย D-48 extraction แล้ว
- **fixture sync** — G26-G29 กับชีตจริง (KI-07)
- **เฟสหลังการขาย** (ก้อน B/C เดิม) — แจ้ง tracking · จบเคส · Follow CRM ([docs/FOLLOW-SPEC.md](docs/FOLLOW-SPEC.md) `[UNBUILT]`)
- **T1 Pattern Studio** — เครื่องมือแก้/พรีวิว pattern ชีต (ตามแผน)

## 🔴 จุดอันตรายห้ามลืม
- **สิ่งที่ห้ามแตะ** (เส้นตาย): order gate · `calculatePrice` · idempotency (D-29) · last_order/S_EDIT (D-31/32) · handoff รวมศูนย์ (D-33) · เวลาไทย (D-37) · validate funnel_stage (D-38) · invariants 10 (REPO-MAP §10)
  · 🟢 **intake (D-34-36) เปิดกลับแล้วใน D-73** — ทำงานเมื่อมีแถว `funnel_stage=handoff_after_intake` ในชีต (draft = ปิด) · ห้ามลบเหมือนเดิม
  · ⚠️ quota-saver ถูกถอด (D-68) — `quotaSaver=false` ตายตัว
- 🔴 **H1 — แยกให้ชัดว่าอะไรแตะได้ (D-65 · เดิมเขียนรวมว่า "กฎ H1 ทุกชั้น = ห้ามแตะ" ซึ่งกำกวม เพราะ C2/C3/D-62 แก้ไปแล้ว):**
  - **แตะไม่ได้ (invariant):** (ก) **ห้ามคำรับรอง**ทุกรูปประโยคในเคสสุขภาพ — ทานได้/กินได้/ปลอดภัย/ไม่เป็นไร/หายห่วง/ไม่มีปัญหา รวมเชิงระวังและรูปมีเงื่อนไข (ข) เจอคำรับรอง **ห้ามเงียบ** — ต้อง block→regen→cut→fallback เสมอ (ค) **แอดมินต้องรู้ทุกเทิร์นที่ติดธงสุขภาพ** แม้ AI ล้ม/ส่งไม่ถึง (ง) ห้ามใส่ "หลักการตอบ" เรื่องสุขภาพลงชีต (ใส่ได้เฉพาะข้อเท็จจริงตามฉลาก)
  - **แตะได้ (จูนแล้ว/จูนต่อได้ ถ้าวัดผล):** ถ้อยคำโซนสุขภาพใน `system-v3.ts` (C3) · allowlist บริบทของ `findAssuranceHits` (D-62) · จุดยิง/เนื้อความธง 🔔 (C2) · `คำ_ธงสุขภาพ`/`คำรับรอง_ต้องห้าม` ในชีต
  - 🔴 **v2 ยังเป็น "handoff ทันทีเสมอ" — ห้ามเอาพฤติกรรม v3 (บอทคุยต่อ) ย้อนเข้า v2 ก่อน cutover**
- 🔴 **D-64: โค้ดห้ามเขียนคอลัมน์ A(ลำดับ) และ O(ส่งออเดอร์แล้ว) ของชีต Orders** — A เป็นของ Apps Script · O เป็นของคน · สถานะ/คิวทุกอย่าง derive จาก A/N/P เท่านั้น
- **บันได 4 ชั้นรับ PROHIBITED_CONTENT (KI-05)** — ห้ามถอดชั้นใดชั้นหนึ่งโดยไม่วัดผล · degraded = last resort ห้ามหลุด
- **"ท้อง" ใน `คำ_handoff` เป็น substring** — ชน "ท้องฟ้า/ท้องเสีย" → ดัก handoff ก่อน intake (ทิศปลอดภัย · แก้คำในชีต ไม่ใช่โค้ด)
- `{รูปสินค้า}` = URL ดิบ · CSV_Vars: live เท่านั้น · ชื่อชนตัวแปรระบบ → ระบบชนะ+log
- 🔴 **สารก่อภูมิแพ้ (แก้ D-65 · ข้อความเดิม "ไม่มี resolver {สารก่อภูมิแพ้} — H1 ห้ามทำ" ล้าสมัย):** **v3 ยัดคอลัมน์ `สารก่อภูมิแพ้` เข้า prompt แล้ว** (`inject.ts` `CATALOG_PRODUCT_COLS_V3` เมื่อ `includeAllergen` · D-61.B) เพราะ v3 ให้บอทตอบข้อเท็จจริงตามฉลากได้ · **ที่ยังไม่มีคือ resolver `{สารก่อภูมิแพ้}` สำหรับ pattern verbatim** (ยังไม่ทำ ไม่ใช่ห้ามทำ) · v2 ไม่ยัดเข้า prompt เหมือนเดิม
- prompt: `system.ts` (v2) + `system-v3.ts` (v3) แก้ด้วย Edit เท่านั้น (KI-03 backtick) · prompt-lint คุม order_data example + C6
- 🟢 **`/train` ปุ่มเขียนชีต — เปิดแล้ว (D-72b · 2026-09-02 · ปิด KI D-65/D-68):**
  ชั้น 1 (ชื่อแท็บ shape) หายที่ D-72a · ชั้น 2 (พิกัดจาก bundle ที่ normalize) หายที่ D-72b — ทุกจุดเขียน/พรีวิว
  หาพิกัดจาก `loadRawSheets()` (แถวดิบตามชีตเป๊ะ) · เทสยืนยัน A1 ต่อคอลัมน์ + เซลล์เดียวไม่ทับข้างเคียง
  ⚠️ ยังไม่พิสูจน์ด้วยมือบนชีตจริง — เจ้าของเทส 1 รอบหลัง deploy (แก้เซลล์ → เช็คชีตลงถูกช่อง + TRAIN_LOG)

## กฎทำงาน
report ก่อน code · 1 commit 1 เรื่อง · วัดก่อนแก้ · ไม่ over-engineer · เจอเปลี่ยน contract นอกบรีฟ → หยุดถาม ·
🔴 จบ D-xx/phase → อัปเดต STATUS.md ในคอมมิตเดียวกัน (สแนปช็อตให้คนใหม่รับช่วงต่อได้)
