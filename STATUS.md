# STATUS — SakbinAdvBot ("ปลาทู")

> สแนปช็อตสำหรับคนรับช่วงต่อ (ไม่เห็นแชทก็ทำต่อได้) · อัปเดต 2026-07-23
> รายละเอียด → [docs/DECISIONS.md](docs/DECISIONS.md) · แผนที่โค้ด → [REPO-MAP.md](REPO-MAP.md) · brief → [docs/P2-REBUILD-BRIEF.md](docs/P2-REBUILD-BRIEF.md)

## 🔴 อยู่ตรงไหนตอนนี้ (สำคัญสุด)
- **P2-REBUILD (D-40 → D-44) จบฝั่งโค้ดแล้ว ✅** — branch **`phase2-v2`** พร้อม merge · 🔴 **ยังไม่ merge เข้า main** (รอเจ้าของสั่ง) · main = ระบบ v1.x ที่รันโปรดักชันอยู่
- 🔴 **ยังไม่สลับชีต/ENV** — โค้ด v2.0 อ่านชีต `03_BotLibrary_สากบิน_v2.0.xlsx` เท่านั้น (contract = [docs/BOTLIB-V2-HEADERS.txt](docs/BOTLIB-V2-HEADERS.txt)) · ENV `SHEET_BOTLIB_ID` ยังชี้ชีตเก่า · **ห้าม deploy branch นี้จนกว่าจะสลับชีต** (ลำดับ deploy ใน brief)
- เทสล่าสุด: **325 passed | 3 expected-fail | 26 skipped** (golden 25 + real-gemini 1 = gate ไว้) · tsc + build เขียว

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

## เหลือทำ (มือเจ้าของ — โค้ดพร้อมแล้ว)
1. **สลับชีต:** อัป `03_BotLibrary_สากบิน_v2.0.xlsx` เป็น Google Sheet + เปลี่ยน ENV `SHEET_BOTLIB_ID` → redeploy (ลำดับใน brief §deploy)
2. **รัน golden จริง:** `HARNESS_REAL_GEMINI=1 GEMINI_API_KEY=... npx vitest run golden-routing` — 25 เคสต้องเขียว · แดง = จูน "เข้าเมื่อ/กรณี" ในชีต (+sync fixture ในเทส) · 🔴 **เช็ค `temperature` ในชีต v2.0 CSV_Config ให้ ≤0.2** (ถ้าชีตตั้ง 1.0 เดิม จะชนะ default 0.2 → variance กลับมา)
3. เทสจริงบน LINE (dev OA) → **merge `phase2-v2` → main** เมื่อเจ้าของสั่ง
4. หลัง merge: ลบ `handoff-decision` log (ใกล้ go-live) · ล้างแถวเทสในชีต Orders

## 🔴 จุดอันตรายห้ามลืม
- **สิ่งที่ห้ามแตะ** (เส้นตาย): order gate · `calculatePrice` · 2-pass/quota-saver · idempotency (D-29) · last_order/S_EDIT (D-31/32) · handoff รวมศูนย์ (D-33) · intake (D-34-36) · เวลาไทย (D-37) · validate funnel_stage (D-38) · invariants 10 (REPO-MAP §10) · **กฎ H1 ทุกชั้น**
- **"ท้อง" ใน `คำ_handoff` เป็น substring** — ชน "ท้องฟ้า/ท้องเสีย" → ดัก handoff ก่อน intake (ทิศปลอดภัย แต่ถ้าไม่ต้องการ แก้คำในชีต ไม่ใช่โค้ด)
- `{รูปสินค้า}` = URL ดิบ (ชีตใส่ `[[รูป:{รูปสินค้า}]]` เอง) · **ไม่มี resolver `{สารก่อภูมิแพ้}`** (H1 — ห้ามทำ)
- CSV_Vars: โหลดเฉพาะ live · ชื่อชนตัวแปรระบบ → ระบบชนะ+log
- prompt/system.ts: แก้ด้วย Edit เท่านั้น (KI-03 backtick) · prompt-lint คุม order_data example + C6

## กฎทำงาน
report ก่อน code · 1 commit 1 เรื่อง · วัดก่อนแก้ · ไม่ over-engineer · เจอเปลี่ยน contract นอกบรีฟ → หยุดถาม ·
🔴 จบ D-xx/phase → อัปเดต STATUS.md ในคอมมิตเดียวกัน (สแนปช็อตให้คนใหม่รับช่วงต่อได้)
