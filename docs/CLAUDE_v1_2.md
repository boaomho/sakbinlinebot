# CLAUDE.md — SakbinAdvBot (v1.2, ตรงกับโค้ดจริง)

> อัปเดตจาก CLAUDE.md เดิมให้ตรงสถานะที่ build จริง · ถ้าจะใช้เป็น CLAUDE.md ของ repo ใหม่ ก๊อปเนื้อหานี้ไปวางที่ root
> รายละเอียดเต็มอยู่ใน `docs/08_Brief_v1_2.md` · System Prompt อยู่ใน `docs/07_SystemPrompt_v1_2.md`

## บอทนี้คืออะไร

**SakbinAdvBot** — "ปลาทู" พนักงานตอบแชทหญิงนักขาย CX ของร้านสากบิน บน LINE OA
ไม่ใช่บอท Q&A แต่เป็น **นักขายที่จูงมือลูกค้าผ่าน "ประตูการขาย"** ทีละขั้น (ทักทาย → นำเสนอ+ปิดการขาย → รับชำระ → รับออเดอร์/สลิป)
ทำงาน 24 ชม. ด้วย Gemini อ่านข้อมูลจาก Google Sheet · จำลูกค้าใน Neon · แอดมินแทรกดูแลเองได้ผ่านคำสั่งในกลุ่ม

## หัวใจของบอท — ห้ามทำหลุด

- **กฎเหล็กการตอบ 9 ข้อ** ใน System Prompt คือ DNA การขาย (ตอบครบก่อนขาย · เข้าใจก่อนนำพา · จบทุกเทิร์นด้วยทางเลือก · ห้าม "รับมั้ยคะ" · ห้าม "รบกวน" · เกริ่นก่อนส่งของ · FAQ แล้ววกกลับ funnel · เข้าประตูไหนก็ได้ · **ปิดท้ายด้วยข้อความเสมอ ห้ามจบด้วยรูป**)
- บอทตอบเป็น **JSON** `{reply, stage, tags_add, handoff, handoff_reason, order_action, order_data, image_intent, image_note}` เท่านั้น (บังคับด้วย responseSchema)
- System Prompt แยก 2 ส่วน: **systemInstruction** (กฎ คงที่) + **user content** (ข้อมูล+ข้อความลูกค้า) — ห้ามเอาข้อความลูกค้าไปต่อใน systemInstruction (กัน injection)

## ฟีเจอร์ที่ build จริง (ทุกตัวอ่านสวิตช์จาก Config + all-or-nothing กับ env)

- **แกนขาย** — Step + FAQ (ส่ง CSV ดิบเข้า Gemini) + Config (parse key-value)
- **ความจำ (Neon)** — stage/tags/history/last_seen/human_mode ต่อเนื่องข้ามบทสนทนา (auto-migrate schema)
- **ติดแท็ก** — เก็บความสนใจลูกค้า
- **ส่งต่อแอดมิน (handoff)** — 2 ชั้น: keyword pre-check + AI semantic → push `ADMIN_GROUP_ID`
- **จังหวะเหมือนคน** — debounce รวบข้อความผ่าน pending_messages + loading indicator
- **คำสั่ง human_mode ในกลุ่มแอดมิน** — ปิดบอท/เปิดบอท `<ชื่อ LINE/เลข/userId>` · ปิด/เปิดบอททั้งหมด · รายชื่อล่าสุด (ค้นชื่อ flexible, ชื่อซ้ำ→เลือกเลขข้อ, resume notice)
- **ระบบออเดอร์ + สลิป** — รับสลิป→Blob private→signed URL→ยิง ADMIN_GROUP_ID (เช็คยอด) · เขียนชีต Orders · cron แจกเลข atomic→ยิง ORDER_GROUP_ID (แพ็ค)
- **อ่านรูปลูกค้า** — รูปคือ "ข้อความอีกรูปแบบ" ส่งเข้า Gemini พร้อมบริบทครบ (stage/ประวัติ/Step/FAQ) ให้ AI ตัดสิน `image_intent` (slip/damage/other) เอง · โค้ดลงมือเฉพาะ slip (เก็บ+ยิง ADMIN เช็คยอด) / damage (handoff) · other = บทสนทนาปกติ · ไม่ hardcode ลิสต์เคสรูป
- **ตามลูกค้า (Follow)** — cron ตามลูกค้าเงียบเกิน N วัน (สวิตช์ปิด default)
- **กัน prompt injection** — แยก user content, sanitize order_data
- **(dormant) Flex Cards** — builder มีในโค้ดแต่ยังไม่มี call site

## Stack — ล็อกไว้

- Next.js 14 App Router + TypeScript · deploy Vercel
- `@line/bot-sdk` ^11.1 · `@google/genai` ^2.10 model **`gemini-3.5-flash`**
- `@neondatabase/serverless` ^0.10 (Postgres) · `@vercel/blob` **^2.6** (ต้อง ≥2.4 มี private+signed) · `googleapis` ^144 (Orders)
- Google Sheet CSV publish (Step/FAQ/Config/Follow) + Sheets API (Orders)

## Env vars (Vercel) — ห้าม hardcode

ขั้นต่ำ: `LINE_CHANNEL_ACCESS_TOKEN` `LINE_CHANNEL_SECRET` `GEMINI_API_KEY`
แกนขาย: `SHEET_STEP_URL` `SHEET_FAQ_URL` `SHEET_CONFIG_URL`
ความจำ: `DATABASE_URL`
handoff/ออเดอร์: `ADMIN_GROUP_ID` `ORDER_GROUP_ID` `SHEET_ORDERS_ID` `GOOGLE_SERVICE_ACCOUNT` `BLOB_SLIPS_TOKEN` `BLOB_PRODUCTS_TOKEN`
follow/cron: `SHEET_FOLLOW_URL` `CRON_SECRET`

## Don'ts

- ❌ hardcode token/key/prompt — ใช้ env + ชีต
- ❌ ทำให้กฎเหล็ก 9 ข้อหลุด — โดยเฉพาะ "ปิดท้ายด้วยข้อความ" (enforceTextLast สลับ/เติมให้ + log)
- ❌ เอาข้อความลูกค้าไปต่อใน systemInstruction — ใส่ user content ครอบ tag `<ข้อความลูกค้า>`
- ❌ ข้าม verify signature → 401
- ❌ ข้าม timeout Gemini (8s) · cache ชีตเกิน 60 วิ · log ข้อความเต็มลูกค้า (PII)
- ❌ hardcode `maxOutputTokens` < 1024 (gemini-3.x นับ thinking+output รวม)
- ❌ ทำฟีเจอร์ครึ่งๆ ตอน env/สวิตช์ไม่ครบ — ปิดทั้งฟีเจอร์ + log (all-or-nothing)
- ❌ แจกเลขออเดอร์แบบไม่ atomic
- ❌ push หาลูกค้าเชิงรุกโดยไม่จำเป็น — เปลือง push quota (เงินจริง) ใช้ reply/arm-flag แทน

## เวลาแก้โค้ด

- ต่อยอด repo เดิม — อ่านโค้ดปัจจุบันก่อน ไม่เขียนทับทิ้ง
- สรุปแผนก่อนลงมือ · ขออนุญาตก่อนแก้ไฟล์
- ทุกฟีเจอร์เช็คสวิตช์ Config + graceful เมื่อ env ขาด
- เสร็จแล้ว build ให้เขียว (tsc + next build) → push GitHub → Vercel deploy เอง

## บทเรียนจากบั๊กที่เคยเจอ (ตัวใหม่ต้องระวัง)

1. **โครงชีต Config = A:หมวด B:key C:value** (ไม่ใช่ A:key B:value) — อ่านคอลัมน์แบบ header-driven หาชื่อ header อย่า hardcode index
2. **ค่าสวิตช์เป็นภาษาไทย "เปิด/ปิด"** — parse ให้รองรับ + `cleanCell` ตัดอักขระล่องหน (zero-width/BOM/nbsp `[​-‍﻿ ]`) ที่ `.trim()` จับไม่หมด · **คีย์หาย = ใช้ default, เซลล์ว่าง = false** (คนละกรณี)
3. **คีย์ในชีตมีวงเล็บกำกับ** เช่น `เปิด_ส่งต่อแอดมิน (Handoff)` — `stripKeyAnnotation` ตัด " (...)" ท้ายคีย์ก่อน lookup
4. **ชื่อคีย์/หน่วยเพี้ยนได้** — ใช้ lookup แบบ alias หลายชื่อ + prefix fallback · หน่วย (วิ/วัน) อยู่คอลัมน์ D แยก ไม่ใช่ส่วนของชื่อคีย์
5. **LINE ไม่ echo ข้อความแอดมิน + `mode` เป็น "active" เสมอ** (setup Chat+Webhook ไม่มี module) → **auto-detect "บอทหลบเมื่อแอดมินตอบ" ทำไม่ได้** ต้องใช้คำสั่ง manual ในกลุ่มแอดมิน
6. **serverless หลาย invocation** — state ชั่วคราว (debounce, รายการเลือกเลขข้อ) ต้องเก็บ Neon ไม่ใช่ in-memory
7. **push = เงินจริง** — reply ฟรี, push คิดเงิน · resume notice ใช้ arm-flag ส่งตอนลูกค้าพิมพ์ (reply) ไม่ push เชิงรุก · `quotaSaver` ยุบบับเบิลเป็น reply เดียวกันล้นไป push
8. **`human_mode` คืนสิทธิ์วัดจาก `last_seen` (แชทเงียบ) หน่วยนาที ไม่ใช่ human_mode_since** — จงใจ: ให้แอดมินคุยได้ไม่จำกัดเวลา พอเงียบจริง 45 นาที (จบเคส) บอทค่อยกลับ · ถ้านับจาก human_mode_since บอทอาจเด้งแทรกกลางวงสนทนา
9. **รูป = ข้อความอีกรูปแบบ ไม่ใช่ "ทุกรูป=สลิป"** — โค้ดเดิมอัปโหลดทุกรูปเข้า slips store ทันที + placeholder bias ว่าเป็นสลิป + ถ้า orders ปิดก็ไม่ส่งรูปให้ AI (บอทตาบอด) · แก้: ส่งรูปเข้า Gemini **เสมอ**พร้อมบริบท ให้ AI ตัดสิน `image_intent` ก่อน แล้วค่อยอัปโหลด/ยิงกลุ่มเฉพาะ slip/damage · ไม่ hardcode ลิสต์เคสรูป (แจกแจงไม่มีวันครบ) · ไม่แน่ใจ → AI ถามลูกค้า (ไม่เดา ไม่โยนแอดมิน) · สลิปอ่านไม่ชัด → ถือเป็น slip ไว้ก่อน (เรื่องเงินห้ามพลาด)

## หน้าที่ 2 กลุ่ม (แยกชัดเจน)

- **`ADMIN_GROUP_ID`** (กลุ่มปลาทูเรียก) = handoff + คำสั่งแอดมิน (ปิด/เปิดบอท) + เช็คยอดสลิป/CF COD
- **`ORDER_GROUP_ID`** (กลุ่มปลาทูส่งออเดอร์) = กลุ่มแพ็คของ = รับเฉพาะออเดอร์คอนเฟิร์มแล้วจาก `cron/orders`

## จุดที่โค้ดจริงต่างจากบรีฟเดิม (สรุป)

- auto-return human_mode วัดจาก `last_seen` หน่วยนาที (บรีฟ v1.1 เขียน human_mode_since — โค้ดจงใจใช้ last_seen ดูเหตุผลบทเรียนข้อ 8)
- `/api/cron/orders` ตั้งผ่าน external cron (ไม่อยู่ใน vercel.json) · follow cron = วันละครั้ง (Vercel Hobby)
- `flex-cards.ts` = มีในโค้ดแต่ยังไม่ถูกเรียกจริง (dormant · ฟีเจอร์ปิดสวิตช์รอเปิด)
- Rich Menu ยังไม่ทำ (ไม่มีโฟลเดอร์ scripts/)
- *(เดิมมี `getGroupName` และ `config.releaseKeyword` เป็น dead code — ลบออกแล้ว)*
