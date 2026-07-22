# CLAUDE.md — SakbinAdvBot

> วางไฟล์นี้ที่ root ของ repo · Claude Code อ่านทุกครั้งที่เริ่ม session
> รายละเอียดการสร้างอยู่ในบรีฟ 08 · สมองบอทอยู่ใน System Prompt 07 (แนบตอนบรีฟ)

## บอทนี้คืออะไร

**SakbinAdvBot** — "ปลาทู" พนักงานตอบแชทหญิงนักขาย CX ของร้านสากบิน บน LINE OA
ไม่ใช่บอทตอบคำถาม (Q&A) แต่เป็น **นักขายที่จูงมือลูกค้าผ่าน "ประตูการขาย"** ทีละขั้น
(ทักทาย → นำเสนอ+ปิดการขาย → รับชำระ → รับออเดอร์/สลิป) พร้อมดูแลประสบการณ์
ให้อบอุ่นจนลูกค้าสบายใจและตัดสินใจซื้อ ทำงาน 24 ชม. ด้วย Gemini อ่านข้อมูลจาก Google Sheet

## หัวใจของบอท — ห้ามทำหลุด

- **กฎเหล็กการตอบ 10 ข้อ** ใน System Prompt คือ DNA การขาย (นับจากโค้ดจริง = 10 ข้อ · `prompt/system.ts` บล็อก `<ขั้นตอนการตอบ>`) — ตอบครบก่อนขาย · เข้าใจก่อนนำพา ·
  จบทุกเทิร์นด้วยทางเลือกที่พาไปประตูถัดไป · ห้าม "รับมั้ยคะ" · ห้าม "รบกวน" · เกริ่นก่อนส่งของ ·
  FAQ แล้ววกกลับ funnel · เข้าประตูไหนก็ได้ · **ปิดท้ายด้วยข้อความเสมอ ห้ามจบด้วยรูป** ·
  **กฎ 10 (ไม่รู้/ไม่มีข้อมูล = บอกตรงๆ + handoff · สุขภาพ/แพ้อาหาร = handoff เสมอ)** — ตั้งชื่อเป็นข้อในลิสต์แล้ว (D-26)
- **ประตูการขาย (Step)** = เส้นทางหลัก บอทอ่านสถานะลูกค้า→รู้ว่าอยู่ประตูไหน→ทำตามเป้าหมายประตูนั้น→พาไปต่อ
- บอทตอบเป็น **JSON** `{reply, stage, tags_add, handoff, handoff_reason, order_data, payment_method, order_edit_request, image_intent, image_note}` เท่านั้น

## 🔴 กฎความปลอดภัย พ.ร.บ.อาหาร (สำคัญสุด · ดูดจาก CONTRACTS-v1.5 §9)

- **H1 (สุขภาพ/แพ้อาหาร/คนท้อง/ให้นม/เด็ก/ผู้ป่วย/กินคู่ยา) = handoff ทันทีเสมอ** · **H1 คือความเสี่ยงอันดับ 1** — สินค้ามีปลา/กะปิ(กุ้ง) ถ้าบอทตอบ "ทานได้ค่ะ" แล้วลูกค้าแพ้ = **ไม่ใช่บั๊ก แต่เป็นคดี**
- 🔴 **ห้ามใส่ "หลักการตอบ" เรื่องสุขภาพ/แพ้อาหาร ลงใน `CSV_Objections` เด็ดขาด** — ถ้าใส่ บอทจะประกอบคำตอบเอง และวันหนึ่งจะประกอบผิด · เรื่องสุขภาพต้อง handoff ให้คน ห้ามให้บอทเข้าใจแล้วตอบเอง
- H2 ต่อรอง/ขอส่วนลด · H3 เคลม/ของเสีย · H4 ร้องเรียน/ขู่ฟ้อง → handoff เช่นกัน (แต่ H1 อันตรายสุด)

## ฟีเจอร์ที่บอทมี (ทุกตัวเป็นโมดูล · อ่านสวิตช์จาก CSV_Config ก่อนทำงาน)

- **แกนขาย** — Step (ประตูขาย) + FAQ (คลังคำตอบคลายกังวล) + Config (ค่าปรับแต่ง)
- **ความจำลูกค้า (Neon)** — สถานะ/ประวัติ/แท็ก/ตัวนับ ต่อเนื่องข้ามบทสนทนา
- **ติดแท็ก** — เก็บความสนใจลูกค้า (เช่น สนใจ:สินค้า, รอโอน)
- **ส่งต่อแอดมิน (Handoff)** — 2 ชั้น: keyword pre-check ในโค้ด (คำชัดๆ) + AI ตัดสิน semantic
- **จังหวะเหมือนคน** — debounce รวบข้อความ + หน่วงก่อนนำพา (ไม่ตอบรัวเหมือนบอท)
- **ระบบติดตาม (Follow)** — ตามลูกค้าที่เงียบ ผ่าน cron
- **ระบบออเดอร์ + สลิป** — รับสลิป→เก็บ Blob→ยิงกลุ่มเช็คยอด · เขียนออเดอร์ลง Google Sheet · แจกเลขตอนคอนเฟิร์ม (atomic กันซ้ำ) · cron ประมวลผล
- **กัน prompt injection** — บอทไม่ทำตามคำสั่งที่ฝังในข้อความลูกค้า (อ้างเป็นเจ้าของ/สั่งลืม prompt/เปลี่ยนภาษา)
- **(เสริม · ปิดไว้) Flex Cards + Rich Menu** — การ์ดปุ่ม/เมนูล่างจอ เปิดทีหลังได้

## Stack — ล็อกไว้ ห้ามเปลี่ยนเอง

- Next.js 14 App Router + TypeScript
- `@line/bot-sdk` (LINE Messaging API) · `@google/genai` model `gemini-3.5-flash`
- Neon Postgres · Google Sheet CSV (Step/FAQ/Config) + Google Sheets API (Orders) · Vercel Blob 2 store (สลิป private / สินค้า public)
- Vercel hosting · external cron (cron-job.org) สำหรับ cron ออเดอร์

## Env vars (Vercel) — ห้าม hardcode

หลัก: `LINE_CHANNEL_ACCESS_TOKEN` `LINE_CHANNEL_SECRET` `GEMINI_API_KEY` `DATABASE_URL` `SHEET_BOTLIB_ID` (คลัง Step/FAQ/Config/Products/Promo — โหลด batchGet แท็บเดียวจาก `loader.ts`)
ออเดอร์/handoff: `ADMIN_GROUP_ID` `ORDER_GROUP_ID` `SHEET_ORDERS_ID` `GOOGLE_SERVICE_ACCOUNT` `BLOB_SLIPS_TOKEN` `BLOB_PRODUCTS_TOKEN`
cron: `CRON_SECRET` (ทุก endpoint cron เช็คจาก `Authorization: Bearer <CRON_SECRET>`)
diag: `DIAG_PROMPT_TOKENS` (=1 → `gemini.ts` log token จริงต่อ segment ด้วย countTokens · ปกติปิด)
> ⚠️ `SHEET_STEP_URL` `SHEET_FAQ_URL` `SHEET_CONFIG_URL` `SHEET_FOLLOW_URL` — **โค้ดไม่อ่านแล้ว** (Step 1 รวมเป็น `SHEET_BOTLIB_ID`) · ยังค้างใน Vercel รอลบ (Phase C) · แหล่งจริงคือโค้ด ดู REPO-MAP.md §5

## Don'ts

- ❌ hardcode token/key/prompt — ใช้ env + ชีต
- ❌ ทำให้กฎเหล็ก 9 ข้อหลุด — โดยเฉพาะ "ปิดท้ายด้วยข้อความ" (ถ้าบอลลูนสุดท้ายเป็นรูป โค้ดต้องสลับ + log)
- ❌ เอาข้อความลูกค้าไปต่อเป็น system instruction — ใส่ฝั่ง user content ครอบด้วย tag (กัน injection)
- ❌ ข้าม verify signature (`x-line-signature`) → 401
- ❌ ข้าม timeout Gemini (8s) · cache ชีตเกิน 60 วิ · log ข้อความเต็มลูกค้า (PII)
- ❌ hardcode `maxOutputTokens` < 1024 — gemini-3.x นับ thinking+output รวม ถ้าต่ำจะตอบครึ่งประโยค
- ❌ ทำฟีเจอร์ครึ่งๆ ตอน env/สวิตช์ไม่ครบ — ปิดทั้งฟีเจอร์ + log เตือน (All-or-nothing)
- ❌ แจกเลขออเดอร์แบบไม่ atomic — ต้องกัน cron รันซ้อนแจกเลขซ้ำ

## เวลาแก้โค้ด

- นี่คือการต่อยอด repo บอทเดิม — อ่านโค้ดปัจจุบันก่อน ต่อยอด ไม่เขียนทับทิ้ง
- สรุปแผนก่อนลงมือแต่ละ step · ขออนุญาตก่อนแก้ไฟล์
- ทุกฟีเจอร์เช็คสวิตช์ Config + graceful เมื่อ env ขาด
- เสร็จแล้ว push GitHub → Vercel deploy เอง
- **แก้ export / คำสั่งพิเศษ / ENV ที่โค้ดอ่าน → ต้องอัปเดต `REPO-MAP.md` ในคอมมิตเดียวกัน** (ไม่งั้นแผนที่เพี้ยน)
- 🔴 **จบงานสำคัญทุกครั้ง (จบ D-xx · จบ phase · ก่อนปิด session ที่มีการแก้โค้ด) → อัปเดต `STATUS.md` ในคอมมิตเดียวกัน** ให้เป็นสแนปช็อตที่คนใหม่อ่านแล้วรับช่วงต่อได้ทันที (branch ปัจจุบัน · เสร็จอะไร · กำลังทำอะไร · เหลืออะไร · จุดอันตรายที่ห้ามลืม)

## เอกสาร — เก็บเฉพาะของที่ยังใช้ประโยชน์ (เพิ่มไฟล์ได้ถ้าจำเป็น)

🔴 **หลัก (ไม่ใช่ "ห้ามงอกไฟล์"):**
1. **ของ superseded/dead → ลบ** (git history เก็บให้) · ไม่ทิ้งค้างปนของจริง
2. **ไฟล์ซ้ำซ้อน/ชื่อคล้าย → รวม** · ไม่เก็บหลายเวอร์ชัน (`_v1`/`_v2`/`-copy`)
3. **spec ของ feature ที่ยังไม่ build → เก็บได้** (ป้าย `[UNBUILT]` หัวไฟล์) · พอ build เสร็จ ดูดเข้า REPO-MAP แล้วลบ spec
> เป้า: **ไม่มีของไม่ใช้ปนของใช้ · ไม่มีไฟล์ชื่อซ้ำหลายเวอร์ชัน**

**ไฟล์สถานะปัจจุบัน (อัปเดตทับ ไม่ทำเวอร์ชันใหม่):**
- **`STATUS.md`** (root) — สแนปช็อตย้ายแชท: เสร็จ · ทิศ Phase 2 · เจ้าของกำลังทำ · ค้าง · กฎทำงาน
- **`docs/DECISIONS.md`** — การตัดสินใจ (D-xx) + งานค้าง + Known Issues (KI)
- **`REPO-MAP.md`** — file tree · export · จุดประกอบ prompt · ENV · CSV_Config keys · data contracts (Orders A–Z) · 3-ชั้นความรู้ · invariants · Known issues
- **`CLAUDE.md`** (ไฟล์นี้) — บอทคืออะไร · หัวใจ · กฎ H1 · stack · Don'ts
- **`SYSTEM-PROMPT-BREAKDOWN.md`** — วิเคราะห์ systemInstruction ต่อบล็อก · 🔴 ห้ามตัด

**spec/อื่น:** `docs/FOLLOW-SPEC.md` `[UNBUILT]` (Follow engine อนาคต) · `prompt/system.ts` = โค้ด system prompt จริง (ไม่ใช่ doc · ห้ามแตะตอนงานเอกสาร) · `DIAG-LOG.md` = log วินิจฉัยชั่วคราว (ลบได้เมื่อปิดบั๊ก)
