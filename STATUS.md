# STATUS — SakbinAdvBot ("ปลาทู")

> สแนปช็อตสำหรับย้ายแชทใหม่ (ต่อ Phase 2) · อัปเดต 2026-07-22 · commit ล่าสุด `8ff95a2`
> รายละเอียดการตัดสินใจ → [docs/DECISIONS.md](docs/DECISIONS.md) · แผนที่โค้ด → [REPO-MAP.md](REPO-MAP.md)

## เสร็จ (Phase 1 core + เครื่องมือ Phase 2)
order flow · pricing · gate · handoff รวมศูนย์ (D-33) · handoff_after_intake (D-34) ·
เวลาไทย (D-37) · Step 6 stage validate (D-38) · คิดเอง=ปิด/verbatim 2 ช่อง (D-39/B/B2)
= ตัวแปร resolve ครบ (15 เดิม + Group X 9) · แยกบอลลูน (`[[เว้น]]`/`[[แยก]]`) · ปิดท้ายแยกอัตโนมัติ ·
ทิ้งบอลลูนตัวแปรว่าง (var-guard)

## ทิศทาง Phase 2 (เจ้าของตัดสิน)
บอทเข้าใจบริบทลูกค้า (ชั้น ①) + ตอบตามเจ้าของเป๊ะ (คิดเอง=ปิด) เท่านั้น
ไม่พึ่ง AI ประกอบเอง · เทรนละเอียดผ่าน 2 ช่อง (ตัวอย่างคำตอบ + ปิดท้าย) ทุก step

## เจ้าของกำลังจะทำ (Phase 2 งานหลัก)
- เขียน pattern (ตัวอย่างคำตอบ + ปิดท้าย) ทุก step + เซต `คิดเอง=ปิด`
- ตัวแปร pending `{ชื่อ}` ≠ snapshot `{ออเดอร์_ชื่อ}` (อย่าสับสน — คนละแหล่ง)
- รูป: ใส่ `[[รูป:URL]]` เมื่อมี URL (อาจต้องเพิ่ม resolver `{รูปสินค้า}`)

## ค้าง ยังไม่ทำ
- **CSV_Objections/CSV_Examples:** เช็คว่า inject จริงมั้ย + ปรัชญา "ประกอบเอง/เลียนโทน"
  (ออกแบบเดิม) ขัดกับ คิดเอง=ปิด — ตัดสินว่าใช้ยังไงในโลกที่ปิด
- **System Prompt เขียนตอนโหมดเปิด** — เช็คขัด คิดเอง=ปิด มั้ย (Phase 2)
- claims blocklist (พ.ร.บ.อาหาร · โค้ด guard เสร็จ D-26 · เหลือเจ้าของกรอกคำในชีต) · ลด prompt · cron 📦
- จัด `คำ_handoff` (ย้ายคำ H1-H4 · substring KI-01) · 🔴 H1 สุขภาพ = handoff ทันทีเสมอ
- CSV_Vars (ตัวแปรข้อความเจ้าของนิยามเอง · เฟสถัดไป)
- เทสค้าง: cap=3, timeout 45 นาที

## อนาคตไกล (หลังเปิดขายเสถียร — จากบรีฟเดิม)
- **Follow engine ใหม่ (tag-triggered)** — spec เดิมยังไม่ build (โค้ดปัจจุบัน = `follow_log` dedup + cron "เงียบเกิน N วัน" dormant · `customer_tags`/`follow_queue` ยังไม่มีในโค้ด) · สวิตช์ `เปิด_ระบบติดตาม` ปิดอยู่
- **ทำบอทธุรกิจอื่น:** ก๊อป repo + เปลี่ยน env + เปลี่ยนชีต (engine เป็นกลาง) · ไม่ใช้บรีฟเก่า · 🔴 เช็ค hardcode ชื่อธุรกิจก่อน
- Dashboard + attribution · AI supervisor · Salepage · Marketplace sync (Gosell/BigSeller) · สินค้าตัวที่ 2

## กฎทำงาน
report ก่อน code · 1 commit 1 เรื่อง · วัดก่อนแก้ · ไม่ over-engineer ·
แชทภาพรวม = สถาปนิก · CC = ลงมือ · ห้าม hallucinate · guard ส่งสัญญาณคน ไม่แทนคน
