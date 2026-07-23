# T1-PATTERN-STUDIO-SPEC — หน้าเว็บเทรนบอท `[UNBUILT]`

> วางที่ `docs/` ของ repo · build หลัง v2.0 (D-40–44) deploy เสถียร · พอ build เสร็จ ดูดสรุปเข้า REPO-MAP แล้วลบไฟล์นี้
> จากแชทภาพรวม 2026-07-22 · contract คือชีต BotLibrary v2.0 — **ห้ามหน้าเว็บเปลี่ยน schema เอง**

## เป้าหมาย

เจ้าของเขียน/แก้ pattern ทุกช่องของ BotLibrary ได้จากหน้าเว็บเดียว โดย **เห็นก่อนเซฟ** ว่า
ลูกค้าจะเห็นบอลลูนอะไรจริงๆ (ตัวแปร resolve แล้ว แยกบอลลูนแล้ว) และมี lint บอกทันทีว่า
อะไรจะพัง — จบปัญหา "แก้ชีตแล้วต้องไปเทสบน LINE ถึงรู้ว่าพิมพ์ตัวแปรผิด"

## หลักการเหล็ก

1. **ชีต Google = source of truth เดียว** — หน้าเว็บไม่มี DB ของตัวเอง ไม่ cache ข้าม session
2. **ห้าม duplicate logic** — preview/lint ต้อง import ฟังก์ชัน production ตรงๆ:
   `loadBotLibrary` (อ่านชีต) · `resolveAllVars` · `joinVerbatimParts` · `parseReplyIntoMessages`
   · `dropUnresolvedVarBubbles` + `KNOWN_RUNTIME_VARS` · `findBannedClaims` · `findBadPrices`
   + `buildAllowedPriceStrings` · `buildPriceTable` · `formatOrderSummary`
   ถ้าหน้าเว็บโชว์ไม่ตรงกับที่บอทส่งจริง = บั๊กร้ายแรงของฟีเจอร์นี้
3. **อยู่ใน repo เดิม** — route `/admin/train` (Next.js เดิม) · ไม่แตะ webhook/Neon prod
4. อ้างอิงแถวด้วย key column เท่านั้น (step_id / objection_id / faq_id / ตัวแปร / ชื่อกฎ) ห้ามใช้เลขแถว

## หน้าจอ (จอเดียว 3 ส่วน)

**ซ้าย — เลือกแถว:** แท็บ (Step / Objections / FAQ / Vars / Follow) → ลิสต์แถวจากชีตจริง
(โหลดผ่าน loader เดิม + ปุ่ม refresh ล้าง cache 60 วิ) · แถวที่ lint ไม่ผ่านมี badge แดง
· โชว์ "โน้ตเจ้าของ" ของแถวนั้นข้างๆ (อ่านอย่างเดียว — คือกติกาที่ตัวเองเคยตั้งไว้)

**กลาง — editor:** ช่องแก้ตามแท็บ — Step: `ตัวอย่างคำตอบ (บอลลูน)` + `ตัวอย่างประโยคปิดท้าย`
· Objections/FAQ: ช่องคำตอบเดียว · Vars: ค่า · Follow: ข้อความ
· toolbar แทรก: `[[แยก]]` `[[รูป:…]]` `\n` + เมนูตัวแปร (ลิสต์จาก KNOWN_RUNTIME_VARS + CSV_Vars live
  — คลิกแทรก ไม่ต้องพิมพ์เอง = ฆ่า typo ที่ต้นทาง)

**ขวา — preview + lint:** บอลลูนหน้าตาแบบ LINE เรนเดอร์จาก pipeline จริง
(joinVerbatimParts → resolveAllVars → var-guard → parseReplyIntoMessages → enforce text-last)
· บอลลูนที่จะโดน var-guard ทิ้ง = โชว์ขีดฆ่าสีแดงพร้อมเหตุผล ไม่ใช่หายเงียบ

**Mock context (dropdown เหนือ preview):** ตัวแปรกลุ่มเงิน/pending/snapshot ต้องมีสถานะลูกค้าจำลอง —
พรีเซ็ตขั้นต่ำ: ① ลูกค้าใหม่ ยังไม่มีออเดอร์ ② pending 3 ถ้วย โอน ③ pending 1 ถ้วย COD (มีค่าส่ง)
④ มี last_order บันทึกแล้ว (สำหรับ S_EDIT/X2) · ราคาในพรีเซ็ตคำนวณผ่าน `calculatePrice` จากชีตจริง ห้าม mock เลข

## Lint (เรียงตามอันตราย)

| เช็ค | ใช้ของ | ผล |
|---|---|---|
| ตัวแปร "ไม่รู้จัก" (typo/ยังไม่มี resolver) | KNOWN_RUNTIME_VARS + CSV_Vars | 🔴 บล็อก copy — ของแบบนี้จะหลุดดิบหรือโดนทิ้งบอลลูน |
| ตัวแปรรู้จักแต่ resolve ไม่ได้ใน context นี้ | dropUnresolvedVarBubbles | เตือน: บอลลูนนี้จะถูกทิ้งเมื่อสถานะลูกค้า = X |
| claims พ.ร.บ.อาหาร | findBannedClaims (คำจาก Config จริง) | 🔴 บล็อก copy |
| ตัวเลขราคานอกระบบ | findBadPrices + buildAllowedPriceStrings | 🔴 บล็อก copy (ราคาอยู่ใน Products/Promo/Config เท่านั้น) |
| เกิน cap 5 บอลลูน / บอลลูนสุดท้ายเป็นรูป | parseReplyIntoMessages | เตือน + โชว์ผลหลังโค้ดจัดการ |
| ช่องว่างทั้งคู่ (step) | stepVerbatim | เตือน: แถวนี้จะ fallback AI |
| ชื่อตัวแปรใน Vars ชนตัวแปรระบบ | KNOWN_RUNTIME_VARS | 🔴 บล็อก |

## Output ของ T1

ปุ่ม **Copy ต่อช่อง** — ได้ข้อความพร้อมวางลง cell ชีตตรงช่องนั้น (บอกชื่อแท็บ+คอลัมน์+key ให้ชัด)
T1 ไม่เขียนชีตเอง · แก้เสร็จเจ้าของวางเอง 1 ครั้ง = จุดตรวจสุดท้ายโดยมนุษย์

## Auth + ความปลอดภัย

- route ต้องมีรหัส (ENV ใหม่ `TRAIN_PASSWORD` · cookie session ง่ายๆ) — ห้ามเปิด public
- read-only ทั้งหน้า: อ่านชีตผ่าน loader เดิม (สิทธิ์ service account เดิม) · ไม่แตะ Neon · ไม่ยิง LINE
- ห้าม log เนื้อหา pattern ยาวๆ ลง Vercel log (กันรก ไม่ใช่ PII แต่ไม่จำเป็น)

## เฟสถัดไป (ไม่ทำใน T1 — กันบานปลาย)

- **T2 Simulator:** แชทจำลองในหน้าเดียวกัน รัน pipeline จริง (Gemini จริง โหมด harness · state ใน memory
  ไม่แตะ Neon prod) เทสบทกับ pattern ฉบับร่างก่อนลงชีต · ปุ่ม "รัน golden 25 เคส" จาก
  `golden-routing-cases` โชว์ผ่าน/ตกเป็นตาราง — นี่จะกลายเป็นหน้าปัดสุขภาพบอทประจำ
- **T3 เขียนกลับชีต:** Sheets API update รายเซลล์ target จาก key column + ชื่อ header (header-driven
  ไม่ใช้ A1 ตายตัว) + จอ confirm diff ก่อนเขียน + บันทึกประวัติแก้ (แท็บ log หรือ Neon) ·
  ทำเมื่อใช้ T1 จนไว้ใจ lint แล้วเท่านั้น
- **T4 คิวเคสนอกตาราง:** ดึงแชทที่เข้า S_UNKNOWN / handoff มาเรียงเป็นคิว "รอเทรน" —
  คลิกเคส → ระบบเดาว่าควรเป็นแถวใหม่ใน Step/Objections/FAQ → เจ้าของเขียน pattern ใน editor เดิม
  → ปิดลูปเทรนครบวงจร (เคสจริง → ตาราง → บอทฉลาดขึ้น โดยทุกคำยังเป็นของเจ้าของ)

## Definition of done (T1)

แก้ pattern S2 ใส่ตัวแปรผิด 1 ตัว → lint จับ+บล็อกได้ · แก้ถูก → preview ตรงกับที่บอทส่งจริงบน LINE
คำต่อคำ (เทสเทียบ 3 step กับ production) · เจ้าของเขียน pattern ครบทุก step ได้โดยไม่เปิด log Vercel เลย
