# T2-STUDIO-SPEC — T-STUDIO v2: ศูนย์บัญชาการปลาทู `[ก·ข·ฉ·ค ✅ · ง-จ UNBUILT]`

> **สถานะ:** spec จากแชทภาพรวม (สถาปนิก) · ยังไม่เขียนโค้ด · ทำทีละเฟส 1 เฟส 1 commit · report แผน+จุดแตะไฟล์ก่อนลงมือทุกเฟส
> **ฐาน:** ต่อยอด T-STUDIO v1 (เฟส ก-ง เสร็จแล้ว: simulator sandbox · แตะบอลลูนแก้ · เขียนกลับชีต diff/conflict/TRAIN_LOG · mobile) — **ห้ามรื้อของ v1** ทุกฟีเจอร์เดิมต้องทำงานเหมือนเดิม
> **เป้าหมายใหญ่:** หน้าเดียวที่เจ้าของ (และ tenant ในอนาคต SaaS) ใช้ ดู-คุม-เทรน บอทครบวงจร โดยไม่ต้องเปิดชีต/กลุ่ม LINE/Vercel เลยในงานประจำวัน

---

## 🔴 หลักสถาปัตยกรรมที่เปลี่ยนจาก v1 (อ่านก่อน)

v1 ทั้งหมดคือ **โลกซ้อม (sandbox)** — v2 เพิ่มหน้าที่เป็น **แผงควบคุม production จริง** (dashboard อ่านข้อมูลจริง · สวิตช์ปิดบอทจริง · จัดการแถวชีตจริง) ดังนั้น:

1. **แยกโซนชัดใน UI:** โซน "ห้องซ้อม" (simulator เดิม) vs โซน "ร้านจริง" (dashboard/สวิตช์/จัดการชีต) — ผู้ใช้ต้องรู้เสมอว่ากำลังแตะของจริงหรือของซ้อม (สี/ป้ายกำกับต่างกันชัดเจน)
2. **อ่านของจริง = ตรงไปตรงมา** (Neon prod อ่านอย่างเดียว) · **เขียนของจริง = ผ่านกลไก guard เดิมของ v1 เท่านั้น** (diff → confirm → TRAIN_LOG · lint แดง = ปุ่มดับ · hard guard ห้ามแตะชีต Orders)
3. auth เดิม (TRAIN_PASSWORD cookie) ครอบทุกหน้า v2 · ไม่มี ENV = 404 ทั้งชุด
   > 🔴 **หมายเหตุ (หนี้ตั้งใจ):** `/train/dashboard` = **reuse auth ห้องซ้อมชั่วคราวโดยตั้งใจ** — โครง URL จริง (`/dashboard` แยกจากห้องซ้อม + login ของตัวเอง) จัดใหม่ตอนเฟส SaaS auth · วันนี้ **ป้ายโซนแดง/เขียวคือตัวแยกหลัก** (ผู้ใช้รู้ว่าแตะของจริง/ของซ้อมจากสี ไม่ใช่จาก URL)
4. ทุกเฟส: mobile-first ตามมาตรฐาน v1 เฟส ง (จอแคบ 380px ใช้ได้จริง)

---

## เฟส T2-ก · Dashboard (อ่านอย่างเดียว · ความเสี่ยงต่ำสุด ทำก่อน) ✅ เสร็จ

> **build แล้ว:** `/train/dashboard` (โซนแดง "ร้านจริง" · อ่าน PROD Neon นอก sandbox) แยกจากห้องซ้อม (แถบ nav สลับ) · แถบสรุป (ลูกค้าใหม่/กลับมา/ยอดขายแยกช่อง/handoff ค้าง · วันนี้·7วัน) · ตารางลูกค้า (turn count aggregate กัน N+1 · LIMIT 300 · filter สถานะ/ช่อง · TRAIN ซ่อน default + toggle) · หน้าลูกค้า read-only (แชท+ออเดอร์ format คนอ่าน · JSON ดิบใน collapse)
> **field จริง:** `customers`(created_at/last_seen/human_mode/stage/last_order) · `messages`(นับ role=user) · won+ช่อง+ช่วง จาก `orders_written`(written_at,user_id) · ยอดจากชีต (order_id→ยอดเงิน · cache 60วิ) · 🔴 TRAIN: ตัดจากสรุปเด็ดขาด · ไม่เพิ่ม data ใหม่ (ตัด 0 เมตริก)
> ไฟล์: `lib/train/dashboard.ts`(pure) · `lib/db.ts`(dashboardSummaryCounts/dashboardCustomerRows/wonOrdersSince) · `lib/orders.ts`(orderAmountMap) · `lib/core/time.ts`(bangkokDayStart) · `app/train/dashboard/*` · `app/train/api/dashboard/{route,customer}`

## เฟส T2-ก · Dashboard (อ่านอย่างเดียว · original spec)

**คำถามที่หน้านี้ต้องตอบ (โจทย์จากเจ้าของ):** ลูกค้าคนไหนทักครั้งเดียวแล้วหาย · คนไหนคุยต่อ · คนไหนถึงไหนแล้วหลุด · วันนี้/สัปดาห์นี้ขายได้เท่าไหร่ แยกช่องทาง

### แถวบน — ตัวเลขสรุป (วันนี้ · 7 วัน · สลับได้)
- ลูกค้าทักใหม่ (customer สร้างใหม่ในช่วง) · ลูกค้ากลับมาคุย (มี activity แต่ไม่ใช่ลูกค้าใหม่)
- ออเดอร์ปิด (won) + ยอดรวมบาท — แยกช่อง [LINE] / [FB] (ใช้ channelLabel เดิม D-52)
- ตัวเลข handoff ค้าง (ลูกค้าใน human_mode ที่ยังไม่เปิดคืน) — ตัวนี้คือ "งานที่รอแอดมิน"

### ตารางลูกค้า (เรียง activity ล่าสุดก่อน · paginate)
คอลัมน์: ป้ายช่อง [LINE]/[FB]/[ซ้อม] · ชื่อ · step ปัจจุบัน + funnel_stage · เวลาล่าสุด · จำนวนเทิร์น · สถานะ:
- 🟢 กำลังคุย (active ใน 24 ชม. · ไม่ human_mode)
- 🟡 ค้างกลางทาง (funnel qualified/quoted แต่เงียบ >24 ชม.) ← **กลุ่มทองสำหรับ follow อนาคต**
- 🔴 handoff / human_mode (รอแอดมิน)
- ✅ won (มี last_order)
- filter ตามสถานะ/ช่องทางได้

### จิ้มรายคน → หน้าลูกค้า
- ประวัติแชทเต็ม (อ่านจาก Neon · render บอลลูนแบบ simulator แต่ read-only)
- ข้อมูล: step · pending order · last_order · ธง delivered_steps · human_mode
- ปุ่มลัด: เปิด/ปิดบอทรายคน (ผูกเฟส T2-ข) · ลิงก์ไปแถวชีต Orders ของออเดอร์ล่าสุด (ถ้ามี)

### ข้อมูลมาจากไหน (CC ยืนยัน field จริงตอน report แผน)
- Neon `customers` (funnel_stage, last_seen, human_mode, history/messages, delivered_steps, last_order)
- ชีต Orders สำหรับยอดขาย (อ่านผ่าน service account เดิม · cache สั้นๆ ได้ เช่น 60 วิ)
- **ห้ามเพิ่มการเก็บข้อมูลใหม่ในเฟสนี้** — ถ้าข้อมูลไม่พอสำหรับตัวเลขไหน ให้ตัดตัวเลขนั้นออกก่อนแล้วรายงาน อย่า migrate เพิ่มเพื่อ dashboard

---

## เฟส T2-ข · สวิตช์เปิด-ปิดบอทใน UI (เล็ก · ต่อยอด D-53 ตรงๆ) ✅ เสร็จ (D-55)

> **build แล้ว:** แผงสวิตช์รายช่องทาง [LINE]/[FB] ใต้ banner (pill เขียว=เปิด/แดง=ปิด) · toggle ปิดบอทรายคนในแถวตาราง (stopPropagation) + ปุ่มในหน้ารายละเอียด · ทุกกด = `confirm()` ภาษาผลลัพธ์ → เขียน → refresh ทันที → แจ้งกลุ่มแอดมินข้อความเดียวกับคำสั่งพิมพ์ + ต่อท้าย `(จาก Dashboard)`
> **สถาปัตย์กันโค้ดซ้ำ:** แยก builder ข้อความ (`botModeMsg`/`channelSwitchMsg`) + orchestrator (`applyChannelSwitch`/`applyCustomerBotMode`) ไว้ `lib/train/bot-switch.ts` — handler เดิม (คำสั่งพิมพ์) import ตัวเดียวกัน พฤติกรรมเท่าเดิม · เขียนผ่าน `setChannelEnabled`/`setHumanMode` เดิม (ไม่มี SQL ใหม่) · สถานะอยู่ Neon ที่เดียว
> ไฟล์: `lib/train/bot-switch.ts`(NEW) · `app/train/api/dashboard/switch/route.ts`(NEW · target channel｜customer · guard เดิม) · `app/train/api/dashboard/route.ts`(+channels) · `DashboardView.tsx`(สวิตช์+toggle) · `app/api/line-webhook/handler.ts`(refactor ใช้ builder ร่วม)

**สเปกเดิม (อ้างอิง):**
- แถบบนของ dashboard: สวิตช์รายช่องทาง — [LINE] และ [FB·เพจ] ต่อเพจ (อ่าน/เขียน `channel_switches` ผ่าน fn ของ D-53 เดิม `setChannelEnabled`/`isChannelEnabled` — **ห้ามเขียน SQL ใหม่**)
- ในตารางลูกค้า + หน้าลูกค้า: toggle ปิดบอทรายคน (= human_mode กลไกเดิม `เปิดบอท/ปิดบอท <ชื่อ>` — reuse fn เดิม)
- ทุกการกด: confirm 1 ชั้น + แสดงผลสถานะใหม่ทันที + **แจ้งเข้ากลุ่มแอดมินด้วยข้อความเดียวกับคำสั่งพิมพ์** (สองประตูคุมของชิ้นเดียว — คนดูกลุ่มต้องเห็นว่ามีการสั่งจาก UI)
- คำสั่งพิมพ์ในกลุ่มยังทำงานเหมือนเดิมทุกอย่าง (สถานะอยู่ Neon ที่เดียว ไม่มีทางขัดกัน)

---

## เฟส T2-ฉ · แท็บ "ออเดอร์" ใน dashboard ร้านจริง (อ่านอย่างเดียวแบบ T2-ก) ✅ เสร็จ (D-56)

> **build แล้ว:** แท็บ "👥 ลูกค้า ｜ 🧾 ออเดอร์" ใน `/train/dashboard` · ตารางออเดอร์จากชีต (cache 60วิ · เรียง rowIndex ใหม่สุดก่อน): เลข·ป้ายช่อง·ชื่อ·รายการ+ยอด·สถานะ · headline chips (รอคอนเฟิร์ม/รอแพ็ค=งานคน เน้นแดง · รอแจกเลข/รอแจ้ง=cron) · filter สถานะ+ช่อง · TRAIN กรอง default (toggle) · จิ้ม→รายละเอียด format คนอ่าน (ไม่มี JSON ดิบ) · 🔴 read-only ล้วน
> **สถานะ pure (`deriveOrderStatus`):** cancelled(N) > awaiting_confirm(ไม่M) > awaiting_number(M·ไม่O·cron) > awaiting_pack(O·P ว่าง·งานคน) > shipped_notified(P·notified) / shipped_pending_notify(P·ยังไม่·cron) · **cancelled precedence สูงสุดเสมอ**
> ไฟล์: `lib/orders.ts listOrdersForDashboard`(cache 60วิ · wrap readAllOrderRows) · `lib/db.ts listNotifiedOrderIds`(read-only ANY::text[]) · `lib/train/dashboard.ts deriveOrderStatus`+`ORDER_STATUS_META` · `app/train/api/dashboard/orders`(NEW) · `DashboardView.tsx`(แท็บ+ตาราง+detail)
> **เทส:** deriveOrderStatus ครบทุก combination N/M/O/P+notified (6 + precedence) · route TRAIN กรอง default/toggle · counts · sort · auth 401 · **462 passed**

**สเปกเดิม (อ้างอิง):**

**โจทย์:** เห็นออเดอร์ทั้งหมดจากชีต Orders ในหน้าเดียว โดยไม่ต้องเปิดชีต — รู้ทันทีว่าออเดอร์ไหนค้างขั้นไหน

- ตารางจากชีต Orders (อ่านผ่าน service account เดิม · cache 60วิ เหมือน `orderAmountMap`) · เรียงใหม่สุดก่อน
- คอลัมน์: เลขออเดอร์ · ป้ายช่อง (channelLabel) · ชื่อ · รายการ+ยอด · **สถานะ derive จากคอลัมน์จริง** (ไม่เก็บ field ใหม่):
  - `N`(ยกเลิก)=TRUE → **"ยกเลิก"**
  - ไม่มี `M`(คอนเฟิร์ม) → **"รอคอนเฟิร์ม"**
  - `M` มี · ไม่มี `O`(เลขออเดอร์) → **"รอแจกเลข (cron)"**
  - `O` มี · `P`(Tracking) ว่าง → **"รอแพ็ค/กรอกเลขแทรค"**
  - `P` มี · `shipping_notified` แล้ว → **"ส่งแล้ว · แจ้งลูกค้าแล้ว"**
  - `P` มี · ยังไม่ notified → **"ส่งแล้ว · รอแจ้ง (cron)"**
- filter: สถานะ + ช่องทาง · ตัวเลขหัวจอ: รอคอนเฟิร์ม / รอแพ็ค / รอเลขแทรค (งานที่ต้องทำ)
- จิ้มออเดอร์ → รายละเอียด format คนอ่าน (reuse `formatOrderSummary`) · **read-only ล้วน — การกระทำจริง (คอนเฟิร์ม/กรอกเลข/ยกเลิก) ยังทำในชีต** เฟสนี้แค่ "กระจก"
- 🔴 หมายเหตุอนาคต: จะมีช่องทาง **`salepage`** เพิ่มใน `source_channel` (ระบบแยก ส่งออเดอร์เข้ามาผ่าน API) — derive สถานะ/ป้ายช่องต้องเผื่อค่านี้ · spec เชื่อมภายหลัง

---

## เฟส T2-ค · จัดการแถว Step/FAQ/OBJ/Vars จากหน้าเว็บ ✅ เสร็จ (D-57)

> **build แล้ว:** แท็บ "📚 คลังความรู้" ใน `/train` (modal · 4 แท็บ) — list แถว (key + ป้าย 🟢live/🔴draft + preview) · "＋ เพิ่มแถว" (ฟอร์ม header-driven · 🔴 บังคับ draft) · ปุ่ม live↔draft (soft delete) · ปุ่ม "▶ ทดสอบ" (draft ในห้องซ้อม)
> **workflow บังคับ:** สร้าง (draft) → ▶ ทดสอบในห้องซ้อม (overlay สถานะ→live รายแถว · prod ยังกรอง draft) → พอใจแล้วกด "เผยแพร่ (live)" · แก้เนื้อหา = แตะบอลลูนหลังทดสอบ (editor เดิม)
> **safety:** appendRow บังคับ `สถานะ=draft` · แท็บไร้คอลัมน์สถานะ=ปฏิเสธ (KI-08) · dedup key · funnel_stage enum (Step) · **lintHealthH1 trigger-aware** (แถวเกี่ยวสุขภาพ→คำตอบต้อง handoff ไม่งั้น block · เคส handoff=เหลือง) · เขียนผ่านกลไก v1 (hard guard·conflict·lint) · TRAIN_LOG +action
> ไฟล์: `lib/train/{write,lint,preview}.ts` · `lib/agent/inject.ts`(export isActiveStatus) · `app/train/api/{rows,write}` · `TrainStudio.tsx`
> **เหลือในเฟสถัด:** แก้เนื้อหาแถวจาก list โดยตรง (วันนี้ผ่าน bubble editor) · draft overlay แบบ "ทุกแถว" (วันนี้รายแถว)

**สเปกเดิม (อ้างอิง):**

**โจทย์:** เพิ่มเคสใหม่ (objection ใหม่ / FAQ ใหม่ / step ใหม่ / ตัวแปรใหม่) โดยไม่ต้องเปิดชีต

- หน้า list ต่อแท็บ (Step / Objections / FAQ / Vars): เห็นทุกแถว key + คอลัมน์หลัก + สถานะ live/draft · จิ้มแถว → editor เดิมของ v1 (reuse ทั้งชุด: lint สด, Copy, เขียนลงชีต diff/confirm)
- **เพิ่มแถวใหม่:** ฟอร์มตามคอลัมน์จริงของแท็บ (header-driven — อ่าน header สดเหมือน writeCell ห้าม hardcode) · เสนอ key ถัดไปอัตโนมัติ (FAQ26, OBJ_xxx) แต่แก้ได้ · 🔴 **แถวใหม่เกิดเป็น `draft` เสมอ** — บังคับ workflow: สร้าง → เทสในห้องซ้อม (draft overlay ของ v1 มองเห็น draft ได้ — ยืนยัน/ปรับ loader ฝั่ง sandbox ให้เทส draft ได้โดย prod ยังกรองทิ้ง) → พอใจแล้วค่อยกดสลับ live
- **ปิดแถว:** เปลี่ยนสถานะ live→draft (soft delete) · **ไม่มีปุ่มลบถาวรใน UI** (ลบจริงทำในชีตเอง — กันมือลั่น)
- ทุก write ผ่าน API เขียนเดิม + จด TRAIN_LOG (เพิ่มประเภท action: add-row / status-change)
- ขอบเขตเขียน: 4 แท็บนี้เท่านั้น (Products/Promo/Config ยังแก้ในชีต/เฟส T2-ง — มีเลขเงินเยอะ ค่อยเปิดทางหลังฟอร์มมี validation ตัวเลข)

---

## เฟส T2-ง · หน้า Config แบบฟอร์ม

- อ่านแท็บ CSV_Config ทุก key → render เป็นฟอร์ม: ชื่อ key · ค่าปัจจุบัน · คำอธิบาย (จากคอลัมน์คำอธิบายในชีต) · input เหมาะชนิด (ตัวเลข/ข้อความ/toggle สำหรับ เปิด/ปิด)
- validation ก่อนเขียน: key ตัวเลข (temperature, งบต่างๆ) ต้อง parse เป็นเลขได้ + ช่วงสมเหตุผล (temperature 0–1) · key ข้อความที่มีตัวแปร ({ขนส่ง} ฯลฯ) ผ่าน lint ตัวแปรเดิม
- เขียนผ่านกลไก diff/confirm/TRAIN_LOG เดิม · แสดงหมายเหตุ "มีผลใน ~1 นาที (cache)"

---

## เฟส T2-จ · หน้า Brief — AI ช่วยตั้งต้นความรู้ (ทำท้ายสุด · ซับซ้อนสุด)

**โจทย์จากเจ้าของ:** โยน PDF/รูปฉลาก/ข้อความเล่าสินค้า+โปร → ไม่ต้องนั่งกรอกตารางเอง

- Input: อัปโหลดไฟล์ (PDF/รูป) หรือพิมพ์เล่าอิสระ ("น้ำปลาร้าคุณนาย ขวด 200ml ขาย 120 โปร 3 ขวด 330 ส่งฟรี...")
- ยิง Gemini call แยกเฉพาะกิจ (แบบ extraction call ของ D-48 — system สั้น "สกัดเป็นโครงสร้าง" ไม่ปน prompt ขาย): สกัดเป็น **ร่างแถว** ของ CSV_Products / CSV_Promo / CSV_FAQ ที่เกี่ยว
- แสดงร่างเป็นตาราง preview แบบ diff (แถวใหม่ทั้งหมด = สีเขียว) — **เจ้าของแก้ได้ทุกช่องก่อนยืนยัน** · เลขราคาทุกตัว highlight ให้ตรวจ
- ยืนยัน → เขียนเป็นแถว **draft** ผ่านกลไกเดิม + TRAIN_LOG · เจ้าของไปเทสในห้องซ้อมแล้วค่อยเปิด live (workflow เดียวกับ T2-ค)
- 🔴 กติกาเหล็ก: **AI ร่าง มนุษย์เคาะ** — ไม่มีเส้นทางไหนที่ตัวเลขเงินลงชีตโดยไม่ผ่านตาเจ้าของ · ร่างผิด/อ่านไม่ออก = โชว์ว่างให้กรอก ไม่เดา
- อนาคต SaaS: หน้านี้คือ onboarding tenant (ส่ง catalog → ระบบร่าง → เจ้าของร้านตรวจ → บอทพร้อม) — ออกแบบ component ให้ไม่ผูกกับ "สากบิน" hardcode

---

## ลำดับ + กติกา

- ลำดับ build: **ก → ข → ฉ → ค → ง → จ** (คุณค่าเร็ว→ช้า · เสี่ยงต่ำ→สูง · T2-ฉ อ่านอย่างเดียวแทรกก่อนงานเขียนชีต) · เสร็จแล้ว: ก·ข·ฉ·ค · หยุดพักระหว่างเฟสได้ทุกจุด — แต่ละเฟสจบในตัว
- ทุกเฟส: report แผน+จุดแตะไฟล์ก่อน · 1 commit · npm test เขียว · อัปเดต STATUS/DECISIONS/spec นี้ (ติ๊กเฟสที่เสร็จ) ในคอมมิตเดียวกัน
- ห้ามแตะ: engine/pipeline/invariants/H1/gate/pricing ทั้งหมด · v1 simulator ต้องทำงานเหมือนเดิมทุกเฟส (เทส fidelity เดิมเขียวตลอด)
- โมเดล: ทุกเฟสเริ่มด้วย Opus · สลับ Fable เฉพาะติดจริงตามกติกาโปรเจกต์
