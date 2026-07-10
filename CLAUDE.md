# CLAUDE.md — SakbinAdvBot

> วางไฟล์นี้ที่ root ของ repo · Claude Code อ่านทุกครั้งที่เริ่ม session
> รายละเอียดการสร้างอยู่ในบรีฟ 08 · สมองบอทอยู่ใน System Prompt 07 (แนบตอนบรีฟ)

## บอทนี้คืออะไร

**SakbinAdvBot** — "ปลาทู" พนักงานตอบแชทหญิงนักขาย CX ของร้านสากบิน บน LINE OA
ไม่ใช่บอทตอบคำถาม (Q&A) แต่เป็น **นักขายที่จูงมือลูกค้าผ่าน "ประตูการขาย"** ทีละขั้น
(ทักทาย → นำเสนอ+ปิดการขาย → รับชำระ → รับออเดอร์/สลิป) พร้อมดูแลประสบการณ์
ให้อบอุ่นจนลูกค้าสบายใจและตัดสินใจซื้อ ทำงาน 24 ชม. ด้วย Gemini อ่านข้อมูลจาก Google Sheet

## หัวใจของบอท — ห้ามทำหลุด

- **กฎเหล็กการตอบ 9 ข้อ** ใน System Prompt คือ DNA การขาย (ตอบครบก่อนขาย · เข้าใจก่อนนำพา ·
  จบทุกเทิร์นด้วยทางเลือกที่พาไปประตูถัดไป · ห้าม "รับมั้ยคะ" · ห้าม "รบกวน" · เกริ่นก่อนส่งของ ·
  FAQ แล้ววกกลับ funnel · เข้าประตูไหนก็ได้ · **ปิดท้ายด้วยข้อความเสมอ ห้ามจบด้วยรูป**)
- **ประตูการขาย (Step)** = เส้นทางหลัก บอทอ่านสถานะลูกค้า→รู้ว่าอยู่ประตูไหน→ทำตามเป้าหมายประตูนั้น→พาไปต่อ
- บอทตอบเป็น **JSON** `{reply, stage, tags_add, handoff, handoff_reason, order_action, order_data}` เท่านั้น

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

หลัก: `LINE_CHANNEL_ACCESS_TOKEN` `LINE_CHANNEL_SECRET` `GEMINI_API_KEY` `DATABASE_URL` `SHEET_STEP_URL` `SHEET_FAQ_URL` `SHEET_CONFIG_URL`
ออเดอร์/handoff: `ADMIN_GROUP_ID` `ORDER_GROUP_ID` `SHEET_ORDERS_ID` `GOOGLE_SERVICE_ACCOUNT` `BLOB_SLIPS_TOKEN` `BLOB_PRODUCTS_TOKEN`
cron: `CRON_SECRET` (ทุก endpoint cron เช็คจาก `Authorization: Bearer <CRON_SECRET>`)

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
