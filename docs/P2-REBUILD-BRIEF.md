# P2-REBUILD-BRIEF — SakbinAdvBot v2.0 (สำหรับ Claude Code)

> จากแชทภาพรวม (สถาปนิก) · อนุมัติโดยเจ้าของ 2026-07-22
> คู่กับไฟล์ `03_BotLibrary_สากบิน_v2.0.xlsx` (โครงชีตใหม่) และ `golden-routing-cases.csv`
> อ่าน CLAUDE.md + REPO-MAP.md + docs/DECISIONS.md ก่อนเริ่ม · report แผนก่อน code · 1 commit 1 เรื่อง
> เสร็จแต่ละ D ให้บันทึกลง docs/DECISIONS.md และอัปเดต REPO-MAP.md ในคอมมิตเดียวกัน

## เจตนาใหญ่ (ทำไมถึงรื้อ)

เจ้าของเคาะทิศทางสุดท้ายของบอท: **AI ไม่เขียนข้อความถึงลูกค้าอีกต่อไป — เป็นสถาปัตยกรรม ไม่ใช่ออปชัน**
AI เหลือหน้าที่ 4 อย่าง: เลือก step · จับ objection/FAQ · สกัด order_data · ตัดสิน handoff
ทุกคำที่ลูกค้าเห็นมาจากชีต (pattern) + resolver ฝั่งโค้ด · เคสนอกตาราง = ประตู S_UNKNOWN
(ตอบสวย + handoff) แล้วเจ้าของเก็บเคสไปเพิ่มแถวใหม่ — นี่คือลูปเทรนหลักของระบบ

นี่คือการทำ D-39 (verbatim) ให้สุดทาง ไม่ใช่ระบบใหม่ — engine เดิมทั้งหมด
(gate, pricing, resolveAllVars, verbatim path, region routing, harness) **คงไว้ ห้ามรื้อ**

---

## D-40 · verbatim = default ของทั้งระบบ

- ชีต v2.0 **ไม่มีคอลัมน์ `คิดเอง` แล้ว** → 🔴 กลับ default ในโค้ด: ไม่มีคอลัมน์ / ค่าว่าง = **ปิด (verbatim)**
  (เดิม D-39: ไม่มีคอลัมน์ = เปิด — ต้อง flip · ถ้าคอลัมน์กลับมาโผล่ในชีตวันหน้า ให้ยังอ่านเป็น override รายแถวได้)
- pattern ว่างทั้ง 2 ช่อง → safety net เดิม (fallback AI + log) **คงไว้** — แต่ควรเกิดแค่ระหว่าง migration
- objection ที่ match มี pattern → ชนะ step (เดิม D-39) คงไว้
- `stepVerbatim`/`joinVerbatimParts`/`resolveAllVars`/var-guard — ใช้ของเดิมทั้งหมด

## D-41 · ชีต v2.0 — schema ใหม่ (breaking · ดูไฟล์ xlsx เป็น contract)

- `BOTLIB_TABS`: **ตัด CSV_Examples ออก · เพิ่ม CSV_Vars** (รวมยังคง 8 แท็บ)
- คอลัมน์ที่หายไปจาก CSV_Step: `ความรู้สึกลูกค้าตอนนี้` `ทำไมประตูนี้สำคัญ` `หลักการนำพา` `ห้ามทำ` `คิดเอง`
  คอลัมน์ใหม่: `โน้ตเจ้าของ (ไม่เข้า prompt)` — 🔴 **ห้าม inject คอลัมน์นี้เข้า prompt เด็ดขาด**
- CSV_Objections: หายไป `หลักการตอบ` `ห้ามทำ` `คิดเอง` · `ตัวอย่างคำตอบที่ดี` เปลี่ยนชื่อเป็น `ตัวอย่างคำตอบ (บอลลูน)` · เพิ่ม `โน้ตเจ้าของ (ไม่เข้า prompt)`
- CSV_FAQ: เพิ่มคอลัมน์ `faq_id` (FAQ01…) เป็นคอลัมน์แรก — key ถาวรของแถว (ทุกแท็บต้องมี key:
  step_id / objection_id / faq_id / ตัวแปร / ชื่อกฎ / sku / promo_id / ค่า (key)) · รองรับหน้าเทรน T1
  ที่จะอ้างอิง/เขียนกลับรายแถวในอนาคต — ดู `docs/T1-PATTERN-STUDIO-SPEC.md` `[UNBUILT]`
- CSV_Promo: ลำดับคอลัมน์เปลี่ยน (ยอดจ่ายมาก่อนประหยัด) — header-driven อยู่แล้ว แต่เช็ค `resolveColumns` required ให้ตรง
- อัปเดต required columns ใน loader ทุกแท็บให้ตรง v2.0 (all-or-nothing เดิม)
- แถวใหม่ใน CSV_Step: **S_UNKNOWN** (funnel_stage=handoff) — เพิ่มเข้า step_id enum + validStages ที่เกี่ยว
- injection ใหม่ของ step เข้า prompt เหลือเฉพาะคอลัมน์ routing:
  `step_id / funnel_stage / ชื่อประตู / กรณี / เข้าเมื่อ / ต้องเก็บข้อมูล / ไปประตูถัดไปเมื่อ`
  (pattern 2 ช่องไม่ต้องเข้า prompt แล้ว — AI ไม่ใช้เขียนคำตอบ · ประหยัด token มหาศาล)

## D-42 · FAQ เข้า verbatim path เดียวกัน

- `action=answer` → คำตอบที่ส่ง = ช่อง `คำตอบ (บอลลูน)` ตรงตามชีต (ผ่าน resolveAllVars + deliver เดิม)
  ปิดท้ายด้วย `ตัวอย่างประโยคปิดท้าย` ของ step ปัจจุบัน (วกกลับ funnel)
- `action=handoff` → พฤติกรรมเดิม (ห้ามส่งคำตอบ · เข้าประตู H ที่เกี่ยว)
- ลำดับชนะ: objection pattern > FAQ answer > step pattern (ถ้าเทิร์นเดียว match หลายอย่าง)
  — ถ้าเห็นว่า precedence ควรต่างจากนี้ ให้หยุดถามแชทภาพรวมก่อน ห้ามตัดสินเอง

## D-43 · ขยาย resolver (เพิ่มใน resolveAllVars ที่เดียว + KNOWN_RUNTIME_VARS)

กลุ่ม catalog (จาก CSV_Products สินค้า live):
- `{เลข อย.}` `{ส่วนประกอบตามฉลาก}` `{รูปสินค้า}` (คอลัมน์ `รูปสินค้า (URL)`) `{ราคาต่อหน่วย}` (คอลัมน์ `ราคาปกติ_ต่อหน่วย`)
- 🔴 **ห้ามทำ resolver `{สารก่อภูมิแพ้}`** — ช่องนั้นมีไว้ให้แอดมิน ไม่ใช่บอท (H1)

กลุ่ม config (จาก config.raw แบบเดียว D-25):
- `{ค่าส่ง_มาตรฐาน}` `{ยอดขั้นต่ำส่งฟรี_บาท}`

กลุ่ม composed (โค้ดประกอบ — ราคาอยู่ที่เดียว ห้ามให้เจ้าของพิมพ์ตัวเลขซ้ำ):
- `{นโยบายค่าส่ง}` = ประโยคจาก ค่าส่ง_มาตรฐาน + ยอดขั้นต่ำส่งฟรี_บาท (เช่น "ค่าส่ง 30 บาทค่ะ สั่งครบ 275 บาทส่งฟรีเลยค่ะ")
- `{โปรแนะนำ}` = ข้อความโชว์ของโปร live ที่ `ประหยัด` สูงสุด (เสมอกันเอาจำนวนน้อยกว่า)

กลุ่ม CSV_Vars (เจ้าของนิยามเอง · แท็บใหม่ · header: ตัวแปร/ค่า/หมายเหตุ/สถานะ):
- โหลดเฉพาะ `สถานะ=live` · ชื่อตัวแปรรวมปีกกาตามที่พิมพ์ในชีต
- 🔴 ตัวแปรระบบชนะเสมอ — ถ้าเจ้าของตั้งชื่อชน ให้ log เตือน + ใช้ค่าระบบ
- ค่าใน CSV_Vars ยังผ่าน price guard ปกติ (กันเจ้าของเผลอใส่ราคาผิด)

ทุกตัวเข้า `KNOWN_RUNTIME_VARS` → var-guard ครอบ (resolve ไม่ได้ = ทิ้งบอลลูน + log)

## D-44 · routing + prompt ใหม่

1. **S_UNKNOWN**: AI เลือกเมื่อไม่ match ประตู/objection/FAQ ไหนเลย และไม่ใช่ H1–H4
   → ส่ง pattern S_UNKNOWN + handoff (push แอดมินตามกลไก funnel_stage=handoff เดิม D-33)
2. **หด `คำ_handoff`** — ค่าใหม่อยู่ใน CSV_Config v2.0 แล้ว (เหลือกลุ่ม H1 + ขอคุยกับคน + ฟ้อง)
   เคลม/ส่วนลด/ร้องเรียน/ขายส่ง ไม่ดัก pre-check แล้ว → routing พาเข้า H2–H4 (handoff_after_intake)
   ยังใช้ word-boundary match เดิม (D-26) · เช็คว่าไม่มี regression KI-01
3. **เขียน systemInstruction ใหม่ (prompt_version v2.0)** — บทบาทเหลือ: จำแนกประตู/objection/FAQ ·
   สกัด order_data (กฎ 6 ช่องเดิม ห้ามตัด) · payment_method · order_edit_request · image_intent ·
   handoff · **ตัดทุกบล็อกที่สอน AI แต่งคำ/โทน/ความยาว/ตัวอย่างประโยค** (ระวัง KI-03 backtick)
   เป้า systemInstruction < 2,500 tokens (เดิม ~5,507) · อัปเดต SYSTEM-PROMPT-BREAKDOWN.md ตาม
   · field `reply` ใน schema คงไว้ (ใช้เป็น fallback ตอน pattern ว่างเท่านั้น)
4. **golden routing tests**: แปลง `golden-routing-cases.csv` เป็น harness cases —
   assert ที่ step/objection/handoff ที่ AI เลือก (ไม่ assert ข้อความ เพราะข้อความมาจากชีต)
   · รันด้วย HARNESS_REAL_GEMINI=1 ได้ · นี่แทน CSV_Examples เดิม (ลบ inject Examples + `buildExampleInjection` + config key `จำนวนตัวอย่างที่ยัดเข้า prompt` ออกจากโค้ด)

## สิ่งที่ห้ามแตะ (กันรื้อเกิน)

order gate · pricing.ts · 2-pass/quota-saver · idempotency order_id (D-29) · last_order/S_EDIT (D-31/32) ·
handoff รวมศูนย์ (D-33) · intake (D-34–36) · เวลาไทย (D-37) · validate funnel_stage (D-38) ·
invariants ทั้ง 10 ข้อใน REPO-MAP §10 · กฎ H1 ทุกชั้น

## 🔴 ลำดับ deploy (พลาดลำดับ = บอทพัง)

1. CC ทำโค้ด v2.0 ทั้งหมด + harness เขียว + tsc/build เขียว (โค้ดใหม่รองรับชีต v2.0 เท่านั้น)
2. เจ้าของสร้าง **Google Sheet ใหม่** จากไฟล์ `03_BotLibrary_สากบิน_v2.0.xlsx` + แชร์ให้ service account
3. Deploy → สลับ env `SHEET_BOTLIB_ID` ชี้ชีตใหม่ (rollback = สลับกลับ + revert deploy)
4. ยิง `/api/diag/steps` → `/reset` → เทสบท golden 5–6 เคสบน LINE จริง → ดู log var-guard ว่าไม่มีตัวแปรถูกทิ้ง
5. อัปเดต STATUS.md · DECISIONS.md (D-40..D-44) · REPO-MAP.md · ลบ SYSTEM-PROMPT-BREAKDOWN ส่วนที่ตาย

## หมายเหตุถึงเจ้าของ (ไม่ใช่งาน CC)

- ชีตเดิมมีข้อมูลหลงใน CSV_Config คอลัมน์ท้าย (`noklek6815`, `9.45476815E8`) — v2.0 ตัดทิ้งแล้ว
  ถ้า `noklek6815` เป็นรหัสผ่านจริง ให้เปลี่ยนรหัสนั้นด้วย
- CSV_Vars มีช่อง `{สัดส่วนปลาทู}` รอกรอกตามฉลาก (พื้นเหลือง)
- CSV_Products แถว NPR-200ML ยังเป็น placeholder ตามเดิม (coming_soon)
