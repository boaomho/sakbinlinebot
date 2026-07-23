# STATUS — SakbinAdvBot ("ปลาทู")

> สแนปช็อตสำหรับคนรับช่วงต่อ (ไม่เห็นแชทก็ทำต่อได้) · อัปเดต 2026-07-23
> รายละเอียด → [docs/DECISIONS.md](docs/DECISIONS.md) · แผนที่โค้ด → [REPO-MAP.md](REPO-MAP.md) · brief → [docs/P2-REBUILD-BRIEF.md](docs/P2-REBUILD-BRIEF.md)

## 🔴 อยู่ตรงไหนตอนนี้ (สำคัญสุด)
- **D-49 (ปิดช่องปาก-มือไม่ตรงกัน — ออเดอร์เขียนแต่ลูกค้าไม่ได้ทวน) เสร็จ ✅** บน `main`
  - #1 extraction-recovered → `resolveRecoveredStage` เลือกประตูปลายทาง deterministic (complete→won · เลือกจ่าย→ประตูวิธีจ่าย)
  - #3 ออเดอร์ complete จริง → ชนะ FAQ/OBJ interception (ปาก-มือตรงกัน) · #2 snapshot ทวนสดจาก pending+price (order_id="" → บอลลูนเลขที่ตกตาม guard)
  - 🔴 **รอเจ้าของ:** เช็ค pattern ประตู won (S4B) ในชีต — ถ้ามี `{ออเดอร์_เลขที่}` บอลลูนนั้นจะตกทุกครั้งบนเทิร์นเขียน (เลขมาตอน cron แจก) · เอาออกหรือแยกบอลลูน
- **D-48 (extraction fallback — บันไดใหม่เมื่อ blocked) เสร็จ ✅** บน `main`
  - หลักฐาน: combo "เปลี่ยน COD + ที่อยู่" ถูกบล็อก 7/7 = deterministic · retry เดิมไร้ผล
  - งานหลัก: call หลัก blocked → **extraction call จิ๋ว** (ไม่มี prompt ขาย/ราคา/step/history = ตัดกลิ่นเงิน) → order_data เข้า gate · flow ต่อ · **แทน** retry เดิม
  - fix (2): payment lock ตัด `noPaymentYet` → ครอบเคส "เปลี่ยนวิธีจ่าย" (เดิมยิงเฉพาะเลือกครั้งแรก) · +redact count log
- **D-47 (ถอดชนวน PROHIBITED_CONTENT เส้นทางเงิน) เสร็จ ✅** บน `main`
  - ชิ้น 1 (พระเอก): payment pre-check ฝั่งโค้ด — เทิร์นเลือกจ่าย ("โอน"/"COD") ข้าม AI · deterministic
  - ชิ้น 3→D-48: retry เปลี่ยนเป็น extraction fallback · ชิ้น 2: redact เลขบัญชี/เบอร์ ใน input โมเดล · ชิ้น 4: log pattern blocked (หลักฐานนำสู่ D-48)
- **D-46 (แก้ลูปวนขอที่อยู่ = Gemini บล็อก PROHIBITED_CONTENT ไม่เข้า degraded) เสร็จ ✅** บน `main`
  - ชั้น 1: `safetySettings` OFF ทั้ง 5 หมวด (บอทรับ PII เป็นเนื้องาน · 🔴 PROHIBITED_CONTENT ปรับไม่ได้ ยังบล็อกได้)
  - ชั้น 2 (หลักประกัน): route เทิร์นข้อความล้วน degraded → ข้อความ "ยังไม่ได้รับ ขอส่งใหม่" · ไม่ resend step ค้าง
- **D-45 (สมองยึด Step + ธงต่อ step + ชวนเลือกโปร) จบฝั่งโค้ดแล้ว ✅** บน `main` — 4 คอมมิต a/b/c/d ต่อจาก P2-REBUILD (D-40..44 merge แล้ว)
  - a: prompt +บล็อก "ลำดับความคิดประจำเทิร์น" (FAQ/OBJ = ผู้สมัคร · ~2,490 tokens < งบ 2,700)
  - b: ธง `delivered_steps` — step ส่งเนื้อหาครั้งเดียว · FAQ/OBJ กลับบ้าน (เต็มก้อนครั้งแรก/ปิดท้ายถัดไป) · ล้างธงตอน cron แจกเลข (v1 hook)
  - c: `{ชวนเลือกโปร}` (contextQty จาก pending + nextTier · เลขจาก calculatePrice เท่านั้น)
  - d: golden 25→29 + pipeline delivery 4 เคส + `scripts/sheet-lint.mjs`
- 🔴 **รอเจ้าของรัน 2 คำสั่ง (creds ใน .env.test เป็น dummy — CC รันไม่ได้ ยืนยันแล้ว):**
  1. `HARNESS_REAL_GEMINI=1 npx vitest run golden-routing` — เกณฑ์: ≥24/25 เดิม + G26-G29 · G12 ยัง known-tuning
  2. `node scripts/sheet-lint.mjs` — รายงาน keyword คำโดดสามัญที่หลงเหลือในชีตจริง
- 🔴 **ยังไม่ deploy prod / ยังไม่สลับ ENV** — โค้ด v2.0 อ่านชีต v2.0 เท่านั้น (contract = [docs/BOTLIB-V2-HEADERS.txt](docs/BOTLIB-V2-HEADERS.txt)) · รอเทส LINE จริง (dev OA) ก่อนสลับ `SHEET_BOTLIB_ID` + redeploy
- เทสล่าสุด: **350 passed | 3 expected-fail | 34 skipped** (scripted) · tsc + build เขียว

## สรุป P2-REBUILD ที่จบ: "AI ไม่เขียนข้อความถึงลูกค้าอีกต่อไป"
AI เหลือ 4 งาน (เลือก step · จำแนก objection · สกัด order_data · ตัดสิน handoff) · ทุกคำจากชีต (pattern) + resolver

| D | เรื่อง | commit |
|---|---|---|
| D-40 | verbatim = default (flip parseThinkMode · ว่าง=ปิด) | `64acce8` |
| D-41 | schema v2.0 (ตัด CSV_Examples/brain · +CSV_Vars · status filter ทุกแท็บ) | `e6ce4a7` |
| D-42 | FAQ เข้า verbatim (precedence **handoff > objection > FAQ > step** + stepClosing วกกลับ) | `10ffc13` |
| D-43 | ขยาย resolver (catalog/config/{นโยบายค่าส่ง}/CSV_Vars · ระบบชนะ collision) | `99fb1e1` |
| D-44a | หด `คำ_handoff` default 19 คำตรงชีต + เทส S_UNKNOWN (D-33 การันตี) | `f1f433b` |
| D-44b | systemInstruction v2.0 "จำแนกและสกัด" · **~2,153 tokens (ลด 61% · เป้า <2,500 ✅)** | `5efe3f5` |
| D-44c | golden routing 25 เคส (gate real-Gemini · scripted=skip) | (คอมมิตนี้) |

## เหลือทำ (มือเจ้าของ — โค้ดบน main พร้อมแล้ว)
1. 🔴 **รัน golden 33 + sheet lint** (2 คำสั่งข้างบน — creds จริงอยู่ฝั่งเจ้าของ) · แดง = จูน "เข้าเมื่อ/keywords" ในชีต + sync fixture
2. **วางกติกา keyword ลงแท็บวิธีใช้ของชีต** (ข้อความอยู่ใน DECISIONS D-45 / แชทส่งมอบ): "keywords = วลี ไม่ใช่คำโดดสามัญ (โอน/ยา/ส่ง/ราคา…) — คำโดดชน substring ในประโยคปกติ · ยกเว้นแถว action=handoff กว้างได้แต่ต้องรับความเสี่ยง substring เอง"
3. 🔴 **เทส LINE จริง (dev OA)** — สลับ ENV `SHEET_BOTLIB_ID` ชี้ชีต v2.0 บน dev แล้วคุยจริง (verbatim/ธงต่อ step/{ชวนเลือกโปร}/FAQ กลับบ้าน)
4. **golden known-tuning:** G12 (S2 vs S2_DIRECT · "ขอลองถ้วยเดียว") ยอมรับแล้ว — ถ้าอยากปิด จูน "เข้าเมื่อ" ในชีต + sync fixture
5. 🔴 **เช็ค `temperature` ในชีต v2.0 CSV_Config ให้ ≤0.2** (ชีตชนะ default)
6. **Deploy prod:** เทส dev ผ่าน → สลับ ENV prod + redeploy (ลำดับใน brief §deploy)
7. หลัง go-live เสถียร: ลบ `handoff-decision` log · ล้างแถวเทสในชีต Orders

## 🔴 จุดอันตรายห้ามลืม
- **สิ่งที่ห้ามแตะ** (เส้นตาย): order gate · `calculatePrice` · 2-pass/quota-saver · idempotency (D-29) · last_order/S_EDIT (D-31/32) · handoff รวมศูนย์ (D-33) · intake (D-34-36) · เวลาไทย (D-37) · validate funnel_stage (D-38) · invariants 10 (REPO-MAP §10) · **กฎ H1 ทุกชั้น**
- **"ท้อง" ใน `คำ_handoff` เป็น substring** — ชน "ท้องฟ้า/ท้องเสีย" → ดัก handoff ก่อน intake (ทิศปลอดภัย แต่ถ้าไม่ต้องการ แก้คำในชีต ไม่ใช่โค้ด)
- `{รูปสินค้า}` = URL ดิบ (ชีตใส่ `[[รูป:{รูปสินค้า}]]` เอง) · **ไม่มี resolver `{สารก่อภูมิแพ้}`** (H1 — ห้ามทำ)
- CSV_Vars: โหลดเฉพาะ live · ชื่อชนตัวแปรระบบ → ระบบชนะ+log
- prompt/system.ts: แก้ด้วย Edit เท่านั้น (KI-03 backtick) · prompt-lint คุม order_data example + C6

## กฎทำงาน
report ก่อน code · 1 commit 1 เรื่อง · วัดก่อนแก้ · ไม่ over-engineer · เจอเปลี่ยน contract นอกบรีฟ → หยุดถาม ·
🔴 จบ D-xx/phase → อัปเดต STATUS.md ในคอมมิตเดียวกัน (สแนปช็อตให้คนใหม่รับช่วงต่อได้)
