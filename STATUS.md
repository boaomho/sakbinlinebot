# STATUS — SakbinAdvBot ("ปลาทู")

> สแนปช็อตสำหรับคนรับช่วงต่อ (ไม่เห็นแชทนี้ก็ทำต่อได้) · อัปเดต 2026-07-23
> รายละเอียด → [docs/DECISIONS.md](docs/DECISIONS.md) · แผนที่โค้ด → [REPO-MAP.md](REPO-MAP.md) · brief → [docs/P2-REBUILD-BRIEF.md](docs/P2-REBUILD-BRIEF.md)

## 🔴 อยู่ตรงไหนตอนนี้ (สำคัญสุด)
- **branch: `phase2-v2`** — 🔴 **ยังไม่ merge เข้า main** (รอเจ้าของสั่ง) · main = ระบบ v1.x ที่รันโปรดักชันอยู่
- **ยังไม่สลับชีต/ENV** — โค้ด v2.0 รองรับชีต `03_BotLibrary_สากบิน_v2.0.xlsx` เท่านั้น · ENV `SHEET_BOTLIB_ID` ยังชี้ชีตเก่า · **ห้าม deploy branch นี้จนกว่าจะสลับชีต** (ดูลำดับ deploy ใน P2-REBUILD-BRIEF §"ลำดับ deploy")
- contract ชีต v2.0 = [docs/BOTLIB-V2-HEADERS.txt](docs/BOTLIB-V2-HEADERS.txt) (header จริง + แถวตัวอย่าง)

## กำลังทำ: P2-REBUILD (D-40 → D-44) — "AI ไม่เขียนข้อความถึงลูกค้าอีกต่อไป"
เจตนา: AI เหลือ 4 งาน (เลือก step · จับ objection/FAQ · สกัด order_data · ตัดสิน handoff) · **ทุกคำที่ลูกค้าเห็นมาจากชีต (pattern) + resolver** · เคสนอกตาราง = S_UNKNOWN (ตอบสวย + handoff)

| D | เรื่อง | สถานะ | commit |
|---|---|---|---|
| D-40 | verbatim = default (flip parseThinkMode) | ✅ | `64acce8` |
| D-41 | schema v2.0 (ตัด CSV_Examples/brain · +CSV_Vars · status filter) | ✅ | `e6ce4a7` |
| D-42 | FAQ เข้า verbatim (precedence handoff>objection>FAQ>step) | ✅ | `10ffc13` |
| D-43 | ขยาย resolver (catalog/config/composed/CSV_Vars) | ✅ | (คอมมิตนี้) |
| **D-44** | **routing S_UNKNOWN + หด คำ_handoff + systemInstruction v2.0 + golden tests** | ⏳ **ถัดไป** | — |
- ทุก D: `npm test`+`npm run build` เขียวก่อน commit · 1 commit 1 decision · อัปเดต DECISIONS+REPO-MAP+STATUS ในคอมมิตเดียว
- เทสล่าสุด: **323 passed | 4 expected-fail | 1 skipped** · build เขียว

## D-44 เหลือทำ (รายละเอียดใน brief §D-44)
1. **S_UNKNOWN** (funnel=handoff) — AI เลือกเมื่อไม่ match ประตู/objection/FAQ · ส่ง pattern + handoff (ผ่าน D-33)
2. **หด `คำ_handoff`** — `DEFAULT_HANDOFF_KEYWORDS` ให้ตรงชีต v2.0 (เคาะแล้ว: `ขอแอดมิน,คุยกับคน,คุยกับแอดมิน,เจ้าของ,ฟ้อง,แพ้,ภูมิแพ้,แพ้กุ้ง,แพ้อาหารทะเล,แพ้ปลา,กลูเตน,ท้อง,ตั้งครรภ์,ให้นม,เบาหวาน,ความดัน,โรคไต,ผู้ป่วย,กินยา` — ตัด ร้องเรียน/เคลม/ขายส่ง ออก → เข้า H2-H4 intake) · คง word-boundary (KI-01)
3. **เขียน systemInstruction ใหม่ (v2.0)** — ตัดบล็อกสอน AI แต่งคำ/โทน/ความยาว · เป้า <2,500 tokens (เดิม ~5,507) · คงกฎ order_data 6 ช่อง + H1 + injection guard · 🔴 KI-03 backtick (ใช้ Edit ห้าม bash heredoc) · อัปเดต SYSTEM-PROMPT-BREAKDOWN.md
4. **golden routing tests** — แปลง [docs/golden-routing-cases.csv](docs/golden-routing-cases.csv) 25 เคส → assert stage/objection/handoff · gate `HARNESS_REAL_GEMINI=1` (scripted=skip · ไม่ block npm test)

## 🔴 จุดอันตรายห้ามลืม
- **สิ่งที่ห้ามแตะ** (เส้นตายในบรีฟ): order gate · `calculatePrice` · 2-pass/quota-saver · idempotency (D-29) · last_order/S_EDIT (D-31/32) · handoff รวมศูนย์ (D-33) · intake (D-34-36) · เวลาไทย (D-37) · validate funnel_stage (D-38) · invariants 10 (REPO-MAP §10) · **กฎ H1 ทุกชั้น** (สุขภาพ/แพ้ = handoff เสมอ · ห้ามใส่หลักการสุขภาพใน CSV_Objections)
- 🔴 **`{รูปสินค้า}` = URL ดิบ** (ชีตใส่ `[[รูป:{รูปสินค้า}]]` เอง) · **ไม่ทำ `{สารก่อภูมิแพ้}`** (H1)
- verbatim = ปิด default (D-40) · คอลัมน์ `คิดเอง` = override ถ้ากลับมา
- CSV_Vars: โหลดเฉพาะ live · ตัวแปรระบบชนะเสมอ

## กฎทำงาน
report ก่อน code · 1 commit 1 เรื่อง · วัดก่อนแก้ · ไม่ over-engineer · เจอเปลี่ยน contract นอกบรีฟ → หยุดถาม ·
🔴 จบ D-xx/phase → อัปเดต STATUS.md ในคอมมิตเดียวกัน (สแนปช็อตให้คนใหม่รับช่วงต่อได้)
