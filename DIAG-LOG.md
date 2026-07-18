# DIAG-LOG — บั๊กสินค้า/จำนวน/ยอด + prompt size

> 🔴 ข้อจำกัด: ผู้เขียน (Claude Code) **รัน production ไม่ได้** — log ดิบจาก real Gemini
> ต้องให้เจ้าของ paste หลังเทส (ส่วนที่ mark `[[รอ paste]]`) · ที่เหลือวัดจากโค้ด/harness จริง

## A. Harness (วัดได้จริง)
```
npm test → Test Files 12 passed (12)
           Tests 90 passed | 5 expected fail (95)
```
- เคสกันถอยหลัง bug B (ใหม่): `order-core.test.ts` — "จัดส่งครบ แต่ขาด จำนวน/ยอด → complete=false + brokenOrder" ✅ ผ่าน
- 5 expected fail = ฟีเจอร์ Step 4/5 (handoff แพ้อาหาร/ลดราคา, OBJ_PRICE, กฎ 10, price guard) — ยังไม่ทำ ตามแผน

## B. systemInstruction token (วัดจากโค้ดจริง · est ~2.78 chars/token)
| | chars | ~tokens |
|---|---|---|
| systemInstruction รวม | 15,309 | ~5,507 |
| การรับสลิปและออเดอร์ (ใหญ่สุด) | 5,277 | ~1,898 |
| รูปแบบผลลัพธ์ | 2,542 | ~914 |
> ดูตารางเต็มใน SYSTEM-PROMPT-BREAKDOWN.md

## C. prompt รวม — ก่อนแก้ vs หลังแก้ (token จริงจาก Gemini)
| | promptTokenCount | candidatesTokenCount | finishReason | order_data |
|---|---|---|---|---|
| **รอบที่ MAX_TOKENS** (เจ้าของรายงาน) | 10,911 | 4,079 (ชนเพดาน 4096) | MAX_TOKENS | จำนวน/ยอด ถูกตัดหาย |
| **รอบ STOP** (เจ้าของรายงาน) | ~8,536–? | 329 | STOP | aiSentFields=[ชื่อ,ที่อยู่,เบอร์] (ไม่มีสินค้า/จำนวน/ยอด) |
| **หลังแก้ (bug A+B)** | `[[รอ paste]]` | `[[รอ paste]]` | `[[รอ paste]]` | `[[รอ paste]]` |
> ⚠️ ตัวเลข "ก่อนแก้" มาจากที่เจ้าของรายงานในแชท ไม่ใช่ log ดิบที่ capture ในไฟล์นี้

## D. Log ดิบจากรอบเทสส่วนที่ 1 (real Gemini) — [[รอ paste]]
> วิธีได้: ตั้ง `DIAG_PROMPT_TOKENS=1` → redeploy → พิมพ์ `/reset` → "เอา 5 ถ้วย" → ให้ที่อยู่ครบ
> capture 5 บรรทัดนี้จาก Vercel log (เทิร์นที่ให้ที่อยู่):
```
[[รอ paste]] {"scope":"prompt-size", ...}
[[รอ paste]] {"scope":"prompt-preview", ...}      ← ดู step: สารบัญสั้นจริง หรือ fallback ยัดทั้งก้อน
[[รอ paste]] {"scope":"prompt-tokens", real:true, segments:{...}, segmentSum:...}
[[รอ paste]] {"scope":"gemini", finishReason:..., promptTokenCount:..., candidatesTokenCount:...}
[[รอ paste]] {"scope":"orders", event:"gate", aiSentFields:[...], complete:..., missing:[...], brokenOrder:...}
```

## E. Sanity check (step 4)
`segmentSum` (จาก prompt-tokens) ควรใกล้ `promptTokenCount` (จาก gemini) เทิร์นเดียวกัน
- ต่างเล็กน้อยปกติ: responseSchema + role/structural overhead ที่ countTokens ต่อ segment ไม่ได้นับ
- ถ้าต่างมาก → มีส่วนที่ยังไม่ได้วัด (ตรวจ image inlineData ถ้ามีรูป) · `[[กรอกหลังได้ log]]`

## F. ผลที่ชีต Orders — คอลัมน์ I/J
- **Harness (write path พิสูจน์จริง):** `order-core`/`golden บท 14b` — เมื่อ order_data ครบ:
  - คอลัมน์ **I (สินค้า+จำนวน)** = `formatProductAndQty` = `"<สินค้า> x<จำนวน>"` (เช่น "น้ำพริกปลาทู x1")
  - คอลัมน์ **J (ยอดเงิน)** = `sanitizeAmount(ยอด)` (เช่น "95")
- **Production 5 ถ้วย (หลังแก้):** คาดหวัง I="น้ำพริกปลาทู x5" · J="440" — `[[รอ paste จากชีตจริง]]`
- **ก่อนแก้ (บั๊ก):** I="น้ำพริกปลาทู" (ไม่มี x จำนวน) · J=ว่าง — ตรงกับที่เจ้าของเห็น

## G. รากบั๊ก (สรุป)
- **bug A:** AI ไม่ extract สินค้า/จำนวน/ยอด (aiSentFields ยืนยัน) — แก้: systemInstruction เสริม "ครบ 6 ช่อง · สินค้า/จำนวน/ยอด สำคัญเท่า ชื่อ/ที่อยู่/เบอร์"
- **bug B:** gate เช็คแค่ name/addr/phone → complete:true ทั้งที่ order line ว่าง — แก้: `evaluateOrderGate` require สินค้า+จำนวน+ยอด · ขาด → complete=false + `brokenOrder` → push แจ้งแอดมิน (D-13)
- **ไม่เกี่ยว MAX_TOKENS:** รอบที่เจ้าของยืนยัน finishReason=STOP, candidates 329 (ไม่ถูกตัด) แต่ order_data ยังขาด = คนละปัญหา
