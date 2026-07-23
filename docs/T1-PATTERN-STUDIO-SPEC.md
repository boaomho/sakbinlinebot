# T-STUDIO SPEC — ห้องซ้อมเทรนปลาทู `[เฟส ก ✅ · ข-ง UNBUILT]`

> (ชื่อไฟล์คง T1- เดิมกันลิงก์เสีย · ซีรีส์เปลี่ยนชื่อเป็น **T-STUDIO** ตามบรีฟ 2026-07-23)
> พอ build ครบทุกเฟส ดูดสรุปเข้า REPO-MAP แล้วลบไฟล์นี้ · contract คือชีต BotLibrary v2.0 — **ห้ามหน้าเว็บเปลี่ยน schema เอง**

## เป้าหมาย (requirement ใหม่ทับของเดิม)

เจ้าของ **ซ้อมสนทนากับปลาทูจำลอง แล้วแก้ pattern ณ จุดที่เห็นปัญหา** ได้จากหน้าเว็บเดียว:
1. **ใช้ได้ทั้งคอม + มือถือ** ตั้งแต่แรก (มือถือ = อุปกรณ์หลักของเจ้าของ)
2. **โหมดหลัก = สนทนาจำลองแล้วแก้ ณ จุด** (ไม่ใช่ editor ต่อแถวแบบ spec เก่า — อันนั้นกลายเป็นมุมมองรอง)
3. **เขียนกลับชีต + copy ได้ทั้งคู่ตั้งแต่แรก** (ของเดิม T3 แยกเฟส → รวมเข้าซีรีส์นี้เป็นเฟส ค)

## สถาปัตยกรรม

- **route `/train`** ใน repo เดิม (Next.js เดิม) · auth ด้วย ENV `TRAIN_PASSWORD` + cookie session ง่ายๆ (HMAC) · ไม่มี ENV = ปิดทั้งฟีเจอร์ 404 + log (All-or-nothing)
- 🔴 **import engine production ตรงๆ ทุกตัว** — pipeline (processMessage) / resolveAllVars / verbatim / gate / payment pre-check / extraction / lint · **ห้าม duplicate logic** — ถ้าห้องซ้อมตอบไม่ตรงบอทจริง = บั๊กร้ายแรงสุดของฟีเจอร์นี้
- **Sandbox = AsyncLocalStorage context + guard ที่ฟังก์ชัน I/O ปลายทาง** (leaf) — pipeline วิ่งโค้ด production เส้นเดิมทุกบรรทัด · เฉพาะจุดที่ "ยิงออกนอก" ถูกเบี่ยงเข้า collector ใน context
- **state ลูกค้าจำลอง = Neon branch แยก** (`DATABASE_URL_TRAIN`) — SQL semantics ตรง prod 100% (delivered_steps array / jsonb merge / counters) โดยไม่แตะ DB จริง · userId จำลองใช้ prefix `TRAIN:` (กันชนกับ LINE id จริง + ระบุ/ล้างได้ถ้ารั่ว)
- 🔴 ห้ามยิง LINE จริง · ห้ามเขียนชีต Orders (โชว์แทนว่า "จะเขียนแถวนี้") · ห้ามแตะ Neon prod · Gemini = ของจริง (ตั้งใจ — เทสความฉลาดจริง)

## เฟส ก — Simulator (แกนหลัก · ทำก่อน) ✅ build แล้ว

> ⚠️ **ข้อจำกัดที่เคาะแล้ว:** simulator เรียก `processMessage` ตรง = **ไม่จำลอง debounce/การรวบข้อความ**
> (`handleTextMessage` ของ webhook จริงรวบข้อความที่พิมพ์ติดกันเป็นเทิร์นเดียว) — debounce มีผลแค่การรวบ
> ไม่มีผลต่อผลลัพธ์ต่อเทิร์น (เทส fidelity พิสูจน์) · อยากเทสการรวบ ต้องเทสบน LINE จริง

- ช่องแชทจำลอง รัน pipeline จริงเต็มสาย: Gemini จริง + payment pre-check + gate + verbatim + ธง delivered_steps + extraction fallback
- **แผง X-ray** ข้างแชท (มือถือ = ปุ่มพับ): stage ปัจจุบัน · funnel · pending order · ธงที่ตั้งแล้ว · ผล gate · FAQ/OBJ ที่ถูก inject เทิร์นนั้น · blocked/extraction ถ้าเกิด — อ่านจาก (1) state หลังเทิร์นใน train DB (2) log JSON ที่ pipeline พ่นอยู่แล้ว (scope: gate/verbatim/extraction/payment-precheck/degraded) tee เข้า context
- **ปุ่มจำลองเหตุการณ์ระบบ:** "ติ๊ก M + cron แจกเลข" (เรียก handler cron จริงใน sandbox — เทสล้างธง/ทวนหลังเขียนโดยไม่รอจริง) · "ส่งรูปสลิปจำลอง" (รูปตัวอย่างใน repo + อัปโหลดรูปเองได้) · /reset
- **เทสบังคับ:** simulator ให้ผลตรง pipeline จริง (เทิร์นเดียวกันผ่าน webhook vs simulator → บอลลูน+state เหมือนกัน) + เทสรั่ว (LINE/ชีต/Blob ต้องเป็นศูนย์)

## เฟส ข — แตะบอลลูนเพื่อแก้

- ทุกบอลลูนบอทกดได้ → panel/bottom-sheet: มาจากแท็บ/แถว/คอลัมน์ไหน (step_id/faq_id/objection_id + ชื่อคอลัมน์) · ข้อความดิบก่อน resolve · ตัวแปรแต่ละตัว resolve เป็นอะไร
- บอลลูนที่โดน var-guard ทิ้ง = โชว์เป็นบอลลูนขีดฆ่า + เหตุผล (**ห้ามหายเงียบ**)
- แก้ในช่อง → เซฟเป็น **draft overlay** (ทับค่าชีตเฉพาะใน simulator) → ปุ่ม "เล่นเทิร์นนี้ใหม่" เห็นผลทันที
- lint รันสดทุกครั้งที่พิมพ์ (ตารางเช็คด้านล่าง)

## เฟส ค — เขียนกลับ + copy

- ต่อเซลล์: ปุ่ม **Copy** (พร้อมวาง) + ปุ่ม **"เขียนลงชีต"** → target ด้วย key column + header (**ห้ามใช้ A1 ตายตัว**) → โชว์ diff เก่า/ใหม่ → ยืนยัน → เขียนผ่าน Sheets API
- เขียนสำเร็จ → จดลงแท็บใหม่ **TRAIN_LOG** (เวลา/แท็บ/แถว/คอลัมน์/ค่าเก่าย่อ/ค่าใหม่ย่อ) → เคลียร์ draft overlay ของเซลล์นั้น
- **lint แดง = ปุ่มเขียนถูกปิด** (copy ยังได้ พร้อมคำเตือน)
- ต้องการสิทธิ์ service account = **Editor** บนชีต BotLibrary (✅ เจ้าของตั้งแล้ว)

## เฟส ง — mobile polish

- จอแคบ = แชทเต็มจอ · แตะบอลลูน → bottom sheet editor · ปุ่ม/ฟอนต์ขนาดนิ้วโป้ง · เทสบน viewport แคบจริง

## Lint (คงจาก spec เดิม · เรียงตามอันตราย)

| เช็ค | ใช้ของ | ผล |
|---|---|---|
| ตัวแปร "ไม่รู้จัก" (typo/ยังไม่มี resolver) | KNOWN_RUNTIME_VARS + CSV_Vars | 🔴 บล็อกเขียน/copy เตือนแรง |
| ตัวแปรรู้จักแต่ resolve ไม่ได้ใน context นี้ | dropUnresolvedVarBubbles | เตือน: บอลลูนนี้จะถูกทิ้งเมื่อสถานะลูกค้า = X |
| claims พ.ร.บ.อาหาร | findBannedClaims (คำจาก Config จริง) | 🔴 บล็อกเขียน |
| ตัวเลขราคานอกระบบ | findBadPrices + buildAllowedPriceStrings | 🔴 บล็อกเขียน (ราคาอยู่ใน Products/Promo/Config เท่านั้น) |
| เกิน cap 5 บอลลูน / บอลลูนสุดท้ายเป็นรูป | parseReplyIntoMessages | เตือน + โชว์ผลหลังโค้ดจัดการ |
| ช่องว่างทั้งคู่ (step) | stepVerbatim | เตือน: แถวนี้จะ fallback AI |
| ชื่อตัวแปรใน Vars ชนตัวแปรระบบ | KNOWN_RUNTIME_VARS | 🔴 บล็อก |

## Setup ฝั่งเจ้าของ

- ✅ ENV `TRAIN_PASSWORD` ใน Vercel (ตั้งแล้ว)
- ✅ service account เป็น Editor ของชีต BotLibrary (ตั้งแล้ว — ใช้เฟส ค)
- ⏳ ENV `DATABASE_URL_TRAIN` = Neon branch ใหม่ชื่อ `train` (สำหรับ state ลูกค้าจำลอง — รอเคาะแผนเฟส ก)

## กติกา build

report แผน+จุดแตะไฟล์ก่อนเริ่มทุกเฟส · 1 เฟส 1 commit · npm test เขียวทุก commit · จบเฟสอัปเดต STATUS ในคอมมิตเดียวกัน · ห้ามแตะ invariants/H1/gate/pricing · เฟส ก ต้องมีเทส fidelity + เทสรั่ว

## Definition of done (ต่อเฟส)

- **ก:** คุยกับปลาทูจำลองบนมือถือได้จริง (Gemini จริง) · สั่งของจนออเดอร์ "จะถูกเขียน" + จำลอง cron แจกเลข + ซื้อซ้ำเห็นธงล้าง — โดย LINE จริง/ชีตจริง/Neon prod ไม่ขยับแม้แต่แถวเดียว (มีเทสพิสูจน์)
- **ข:** แตะบอลลูน เห็นที่มา+ตัวแปร แก้ draft แล้วเล่นซ้ำเห็นผลใหม่ทันที · บอลลูนโดนทิ้งไม่หายเงียบ
- **ค:** แก้ในห้องซ้อม → เขียนลงชีตจริงได้ปลอดภัย (diff+ยืนยัน+TRAIN_LOG) · lint แดงเขียนไม่ได้
- **ง:** ใช้ครบ flow บนจอมือถือแคบจริงโดยไม่ต้อง pinch-zoom
