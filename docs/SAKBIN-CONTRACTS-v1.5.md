# SAKBIN — API CONTRACTS v1.5
> **แหล่งความจริงเดียว** ของ data model + prompt assembly · ตัดสินในแชทภาพรวม
> แทนที่ v1.3 ทั้งฉบับ · ใช้คู่กับ `SAKBIN-FOLLOW-SPEC.md` และ `BRIEF-ClaudeCode-v1.5.md`
> แชทย่อย/Claude Code **ห้ามเปลี่ยนเอง** — ถ้าจำเป็น ให้หยุด แจ้งกลับแชทภาพรวม บันทึกลง DECISIONS.md
> 2026-07-14

---

## 0. กฎเหล็ก 6 ข้อ (breaking จาก v1.1)

| # | กฎ | ทำไม |
|---|---|---|
| **C1** | **Header-driven ทุกตาราง** — หาคอลัมน์จากชื่อ header เท่านั้น ห้าม hardcode index (A/B/C) ทุกแท็บ รวม Orders | โค้ดเดิมอ่าน Orders ด้วย index A–R → แทรกคอลัมน์ทีเดียวเขียนผิดช่องทั้งแถว |
| **C2** | **`stage` ที่ AI ตอบต้องเป็น enum** บังคับด้วย `responseSchema` | ตอนนี้เป็น free text → `funnel_events` เก็บค่าสะกดไม่ตรงกัน → วิเคราะห์ "ลูกค้าหายตรงไหน" ไม่ได้ |
| **C3** | **ทุก order มี `order_id` ตั้งแต่ถูกสร้าง** | ไม่มี key = ไม่มี idempotency = ออเดอร์ซ้ำ/หายจับไม่ได้ |
| **C4** | **ทุก order มี attribution** (`source_channel`, `ref_code`) | เก็บย้อนหลังไม่ได้ตลอดกาล · ไม่มี = ยิง Ads โดยไม่รู้ ROAS |
| **C5** | **3 ชั้นความรู้ ห้ามปนกัน** (ดู §3) | ให้บอท "เข้าใจแล้วประกอบเอง" กับข้อเท็จจริง = แต่งราคา + แต่งสรรพคุณ |
| **C6** | **บอทห้ามคำนวณราคาเอง** — โค้ดคำนวณ แล้วยัดตัวเลขสำเร็จรูปเข้า prompt | LLM คูณเลขผิดได้ และนี่คือเงินจริง |

---

## 1. โครงสร้างไฟล์โค้ด (Step 0 — ทำก่อนอย่างอื่น)

```
lib/core/          ← ไม่รู้จัก LINE ไม่รู้จัก Gemini
  pricing.ts       รับ items[] → คืน {subtotal, shipping, total, breakdown}
  orders.ts        รับ order object → เขียน + กันซ้ำ (order_id)
  customers.ts     identity, tags, stage
  catalog.ts       products + promos (จากชีต)
lib/sheets/        ← loader กลาง (ดู §2)
lib/agent/         ← prompt assembly, objection match, claims guard
lib/channels/line/ ← แปลง LINE event → เรียก core
app/api/webhook/   ← thin adapter เท่านั้น
```

**ทำไม:** ตอนนี้ logic แกน (คิดราคา, ตัดสินว่าออเดอร์ครบ, เขียนออเดอร์, กันซ้ำ) ฝังอยู่ใน LINE webhook handler
พอ Salepage มา มันไม่มี `pending_order` ไม่มี Gemini → จะต้อง copy logic ไปเขียนใหม่ → วันหนึ่งราคาใน Salepage กับ LINE ไม่ตรงกันโดยไม่มีใครรู้
**ต้นทุนวันนี้ ≈ การย้ายไฟล์ · ต้นทุนปีหน้า = รื้อ repo**

---

## 2. Sheet loader — env ตัวเดียว

```
SHEET_BOTLIB_ID   ← spreadsheet ID เดียว (ทุกแท็บ BotLibrary) — ใหม่
SHEET_ORDERS_ID   ← 🔴 เปลี่ยนค่าจาก CSV URL → ID ล้วน (อ่าน+เขียนด้วยตัวเดียว)
```
**เลิกใช้** `SHEET_STEP_URL` `SHEET_FAQ_URL` `SHEET_CONFIG_URL` `SHEET_FOLLOW_URL`

> 🔴 **สถานะเดิม:** โค้ดอ่านชีตทุกตัวผ่าน publish CSV URL — รวม Orders (`SHEET_ORDERS_ID` เดิมเก็บ CSV URL ไว้สำหรับ *อ่าน*) ส่วน *เขียน* Orders ใช้ service account อยู่แล้ว
> การรื้อครั้งนี้เปลี่ยนวิธี *อ่าน* เป็น Sheets API **ทั้ง Orders และ BotLibrary** เหลือ env ฝั่งชีต 2 ตัวเป็น ID ล้วน · ลำดับการสลับ ENV ดูใน BRIEF Step 1

- อ่านทุกแท็บผ่าน **Google Sheets API + service account เดิม** (ตัวที่ใช้กับ Orders อยู่แล้ว)
  → ได้ของแถม: **ชีตไม่ต้อง publish สาธารณะ** (เลขพร้อมเพย์อยู่ในนั้น)
- ⚠️ **ค้นข้อมูล API ปัจจุบันก่อนเขียน** — อย่าอ้างจากความจำ
- **โหลดทุกแท็บพร้อมกัน** (`Promise.all`) ไม่ใช่ทีละอัน
- **cache เป็นก้อนเดียว** ไม่ใช่ 8 ก้อนที่หมดอายุคนละเวลา
  - Config: 60 วิ (ต้องสด — สวิตช์)
  - Step / FAQ / Objections / Examples / Products / Promo / Follow: 5 นาที
- โหลดไม่ได้ → **ใช้ cache เก่า** (พฤติกรรมเดิม คงไว้)
- header ไม่เจอ → **ปิดฟีเจอร์ + log error ชัด** (all-or-nothing) ห้าม fallback เป็น index เงียบๆ

**แท็บทั้งหมด:** `CSV_Step` `CSV_Objections` `CSV_Examples` `CSV_FAQ` `CSV_Follow` `CSV_Config` `CSV_Products` `CSV_Promo`

---

## 3. 3 ชั้นความรู้ (C5 — หัวใจของการเทรน)

| ชั้น | อยู่ที่ | บอททำอะไรกับมัน |
|---|---|---|
| **ข้อเท็จจริง** | `CSV_FAQ` · `CSV_Products` · `CSV_Promo` | **ท่อง** — copy ตรง ห้ามเรียบเรียงใหม่ |
| **หลักการ** | `CSV_Step` · `CSV_Objections` | **เข้าใจ** — ประกอบคำตอบเอง |
| **น้ำเสียง** | `CSV_Examples` | **เลียนแบบสไตล์** — ห้ามลอกถ้อยคำ |
| **กฎเหล็ก** | System Prompt | **ห้ามฝ่าฝืน** ไม่ว่าเข้าใจอะไรมา |

**ฐานคือหลักการ ตัวอย่างคือเปลือก** — ลูกค้าพูดสำนวนที่ไม่มีในตัวอย่าง บอทต้องกลับไปที่หลักการแล้วประกอบใหม่ ห้ามหาตัวอย่างที่ใกล้ที่สุดมาดัดใช้

---

## 4. Prompt assembly (ต่อ 1 เทิร์น) — สเปกบังคับ

### systemInstruction (คงที่ · ห้ามใส่ข้อความลูกค้า)
- persona (ปลาทู = ผู้ช่วย AI ของสากบิน · ประกาศตัวตรงๆ)
- **กฎเหล็ก 10 ข้อ** (9 เดิม + ข้อ 10 ใหม่ ดู §5)
- claims blocklist
- คำสั่งการใช้ Objections/Examples (ดู §6)
- `responseSchema`

### user content (ต่อเทิร์น)
```
<ข้อมูลปัจจุบัน>   เวลาไทยตอนนี้, stage, tags, pending_order, ชื่อลูกค้า
<ประตูการขาย>      CSV_Step ทั้งก้อน (รวมคอลัมน์ ความรู้สึกลูกค้า/ทำไมสำคัญ/หลักการนำพา/ห้ามทำ)
<ข้อเท็จจริง>      CSV_FAQ ทั้งก้อน
<ข้อมูลสินค้า>     resolve จาก CSV_Products แล้ว (ชื่อ, อย., ส่วนประกอบ, วิธีทาน, วิธีเก็บ)
<ราคาที่คำนวณแล้ว> จาก CSV_Promo + Config — โค้ดคำนวณ ตัวเลขสำเร็จรูป (C6)
<ข้อโต้แย้งที่ตรวจพบ>  0–2 แถว (เต็มแถว) จาก CSV_Objections
<สารบัญข้อโต้แย้ง>     objection_id + ชื่อ ของทั้ง 17 แถว (สั้นๆ ~300 tokens)
<ตัวอย่างน้ำเสียง>     0–3 แถว จาก CSV_Examples
<ข้อความลูกค้า>    ครอบ tag เสมอ (กัน injection)
</ข้อความลูกค้า>
```

### ห้ามยัดเข้า prompt
- `CSV_Products` / `CSV_Promo` **ดิบ** → โค้ด resolve แล้วส่งเฉพาะผลลัพธ์
- `CSV_Follow` → cron ใช้ ไม่เกี่ยวกับการตอบแชท
- `CSV_Objections` **ทั้ง 17 แถวเต็ม** → prompt บวม ตอบช้า บอทลืมกฎ
- `CSV_Config` ทุกคีย์ → เฉพาะคีย์ที่ AI ต้องรู้

---

## 5. กฎเหล็กข้อ 10 (ใหม่)

> **ไม่มีข้อมูล = บอกตรงๆ ว่าไม่มี แล้วเรียกคน**
> ห้ามเดา · ห้ามตอบกว้างๆ ให้ผ่านไป · ห้ามเปลี่ยนเรื่อง · ห้ามใช้ความรู้ทั่วไปนอกชีต
> ประโยคมาตรฐาน: *"ตอนนี้ปลาทูยังไม่มีข้อมูลเรื่องนี้นะคะ ขอไม่เดาให้ลูกค้าค่ะ เดี๋ยวให้พี่แอดมินมาตอบให้ชัดๆ นะคะ"* → `handoff=true`

ข้อนี้คือสิ่งที่ทำให้ลูกค้ารู้สึกว่า **"บอทตัวนี้เชื่อถือได้"** — ลูกค้าให้อภัยบอทที่รู้ขีดจำกัดตัวเอง แต่ไม่ให้อภัยบอทที่มั่วแล้วโดนจับได้

---

## 6. Objection matching + Examples injection

### ขั้นตอน (ใน `lib/agent/`)
1. **keyword match** ข้อความลูกค้า กับคอลัมน์ `ลูกค้าพูดแบบไหนบ้าง` ของ CSV_Objections
2. เจอ → ยัด **เต็มแถว** สูงสุด **2 อัน** (`จำนวนข้อโต้แย้งที่ยัดเข้า prompt` ใน Config)
3. **ไม่เจอ → ไม่ยัด** (Step + FAQ + กฎ เพียงพอ) — ห้ามยัดมั่ว
4. ยัด **สารบัญ** (id + ชื่อ) ของทั้ง 17 แถวเสมอ — สั้น ราคาถูก
5. Examples: match จาก `step_id` ปัจจุบัน **และ/หรือ** `objection_id` ที่เจอ → ยัดสูงสุด **3 แถว**

### 🔴 คำสั่งบังคับใน systemInstruction
```
ข้อโต้แย้ง: ใช้ "ความกังวลที่แท้จริง" + "หลักการตอบ" ประกอบคำตอบให้เข้ากับสิ่งที่ลูกค้า
พูดจริงในเทิร์นนี้ · เคารพ "ห้ามทำ" อย่างเคร่งครัด · ห้ามลอก "ตัวอย่างคำตอบที่ดี" คำต่อคำ
· ตอบเสร็จให้วกกลับประตูการขายเดิมเสมอ

ตัวอย่างน้ำเสียง: ใช้เป็นแนวจังหวะและโทน ห้ามลอกถ้อยคำ
```
ถ้าไม่ห้ามลอก ลูกค้า 2 คนที่พูดคนละสำนวนจะได้คำตอบเดียวกันเป๊ะ = **จับได้ทันทีว่าเป็นบอท**

### Self-improving loop (ทำเลย ฟรี)
เพิ่ม `objection_detected` ใน `responseSchema` — ให้ AI ตอบว่าคิดว่าเจอข้อโต้แย้งไหน (หรือ `none`)
เก็บลง log → ถ้า AI ตอบ `OBJ_PRICE` แต่ keyword ไม่ match แปลว่า **สำนวนนั้นยังไม่อยู่ในชีต**
→ คุณเอาสำนวนไปเติมในช่อง `ลูกค้าพูดแบบไหนบ้าง` ของแถวเดิม (**ห้ามเปิดแถว OBJ ใหม่**)

---

## 7. responseSchema (บังคับ enum)

```
{
  reply, 
  stage: enum[S1|S2|S2_DIRECT|S2_CONFIRM|S3_TRANSFER|S3_COD|S4A|S4B|S4C|X1|X2|H1|H2|H3|H4],
  objection_detected: enum[OBJ_*|none],       ← ใหม่
  tags_add, handoff, handoff_reason,
  order_data, payment_method, order_edit_request,
  image_intent, image_note
}
```
- `funnel_stage` **โค้ด map จาก step_id** (lookup ในชีต Step) — ไม่ให้ AI ตอบ กันเพี้ยน
- `funnel_events(from_stage, to_stage, at)` เก็บ **step_id**
- stage พิเศษที่โค้ดใส่เอง: **`lost`** = พ้นเพดานการตาม (จำเป็นสำหรับตอบ "ลูกค้าหายตรงไหน")

---

## 8. Orders sheet (A–X · 24 คอลัมน์) — header-driven

**🔴 breaking จาก v1.5 ฉบับแรก: ลบคอลัมน์ `ตำบล`/`อำเภอ` ทิ้ง → Q–X เลื่อนซ้าย 2 ช่อง** (เดิมจอง S–Z)
ที่อยู่เก็บเป็น **"ก้อนเดียว"** ตามที่ลูกค้าพิมพ์ — บอทไม่แยก ไม่ตรวจ ไม่ cross-check
(หน้าที่ตรวจที่อยู่ = ระบบขนส่ง + แอดมิน ไม่ใช่บอท · ดู DECISIONS **D-05 / D-09**)

| col | header | ใครเขียน | หมายเหตุ |
|---|---|---|---|
| A | `ลำดับ (แจกตอนคอนเฟิร์ม)` | cron | **ไม่ใช่ key** |
| B | `วันที่` | บอท | ISO8601 |
| C–E | ชื่อไลน์ · ชื่อ-นามสกุล · เบอร์โทร | บอท | เบอร์ sanitize แล้ว (9–10 หลัก · ดู D-07) |
| **F** | **`ที่อยู่`** | บอท | 🔴 **ก้อนดิบทั้งหมดตามที่ลูกค้าพิมพ์** (ไม่แยก ต./อ. แล้ว) |
| **G** | `จังหวัด` | บอท | metadata · หยิบได้ก็ใส่ ไม่ได้เว้นว่าง **ห้ามเดา** · ไม่กระทบการปิดออเดอร์ |
| **H** | `รหัสไปรษณีย์` | บอท | metadata · เหมือน G |
| I | `สินค้า+จำนวน` | บอท | ข้อความคนอ่าน: `น้ำพริกปลาทู x3 \| น้ำปลาร้า x2` |
| J | `ยอดเงิน` | บอท | ยอดที่จ่ายจริง (รวมค่าส่ง) |
| K–L | การชำระเงิน · รูปSlip | บอท | L = pathname เท่านั้น |
| M–N | คอนเฟิร์ม · ยกเลิก | คน | ติ๊กทั้งคู่ = ยกเลิก |
| O | `ส่งออเดอร์แล้ว` | cron | |
| P | `เลขTracking` | คน | |
| **Q** | `order_id` | บอท | `SKB-YYYYMMDD-xxxxxx` · **idempotency key** · *เดิม S* |
| **R** | `line_user_id` | บอท | join key กับ Neon · *เดิม T* |
| **S** | `items_json` | บอท | หลาย SKU ใน 1 แถว · *เดิม U* |
| **T** | `ค่าส่ง` | บอท | `subtotal = J − T` · *เดิม V* |
| **U** | `source_channel` | บอท | `line` \| `salepage` \| `shopee` … · *เดิม W* |
| **V** | `ref_code` | บอท | ไม่มี = ว่าง (**ห้ามเดา**) · *เดิม X* |
| **W** | `ยอดในสลิป` | **คน** | ไม่ตรง J = ห้ามคอนเฟิร์ม · *เดิม Y* |
| **X** | `bot_version` | บอท | `prompt_v1.5/lib_v1.5` · *เดิม Z* |

**สถานะปัจจุบัน:** A–P เขียนจริงแล้ว · **Q–X เขียนเป็นช่องว่าง** (จองตำแหน่งให้ตรงชีต) — Step 2/3 จะเติมค่า
⚠️ index ตายตัวชั่วคราว — **Step 1 (header-driven) จะรื้อถาวร** · ตาข่ายจนถึงตอนนั้น: `tests/scenarios/sheet-layout.test.ts`

### items_json
```json
[{"sku":"NPT-10G","name":"น้ำพริกปลาทู","qty":3,"unit_price":95,"line_total":275,"promo":"P3"}]
```
- `sku` = enum จาก CSV_Products (ห้าม AI คิดเอง)
- assert: `sum(line_total) + ค่าส่ง(T) == ยอดเงิน(J)` ไม่ตรง = **ไม่เขียน + log** (คอลัมน์เลื่อน ดู §8)

### idempotency
- `order_id` generate ตอนสร้าง `pending_order` (เก็บใน Neon) → retry ได้ id เดิม
- ก่อน append: อ่านคอลัมน์ `order_id` ทั้งชีต ถ้าซ้ำ = ข้าม + log

---

## 9. Handoff บังคับ (H1–H4) + Claims guard

| step_id | เคส |
|---|---|
| **H1** | สุขภาพ / แพ้อาหาร / คนท้อง / ให้นมบุตร / เด็ก / ผู้ป่วย / กินคู่กับยา |
| **H2** | ขอส่วนลด / ต่อรอง / ขายส่ง / อ้างว่าเจ้าของอนุมัติ |
| **H3** | เคลม / ของเสีย / ของไม่ถึง / ขอคืนเงิน (รวม `image_intent=damage`) |
| **H4** | ไม่พอใจ / ร้องเรียน / ขู่ฟ้อง |

**H1 คือความเสี่ยงอันดับ 1** — สินค้ามีปลา/กะปิ(กุ้ง) ถ้าบอทตอบ "ทานได้ค่ะ" แล้วลูกค้าแพ้ = ไม่ใช่บั๊ก แต่เป็นคดี

3 ชั้น: (1) `คำ_handoff` keyword pre-check · (2) Step H1–H4 (AI semantic) · (3) FAQ `action=handoff` → **แม้ช่องคำตอบมีข้อความก็ห้ามส่ง**

⚠️ **ห้ามใส่ "หลักการตอบ" เรื่องสุขภาพ/แพ้อาหาร ลงใน CSV_Objections เด็ดขาด** — ถ้าใส่ บอทจะประกอบคำตอบเอง และวันหนึ่งจะประกอบผิด

### Claims guard (พ.ร.บ.อาหาร)
สแกน**ทุกบอลลูนก่อนส่ง** เทียบ `คำต้องห้าม_โฆษณา` → เจอ = **ไม่ส่งบอลลูนนั้น** ใช้ข้อความกลางแทน + `console.warn({scope:"claims-guard", word, step_id})`

---

## 10. Neon — ตารางที่เพิ่ม

```sql
customer_tags(user_id, tag, applied_at, source, PRIMARY KEY(user_id, tag))

follow_queue(id BIGSERIAL PK, user_id, rule_name, trigger_tag,
  tag_applied_at TIMESTAMPTZ, due_at TIMESTAMPTZ,
  status TEXT,                       -- pending|sent|cancelled|skipped
  follow_variant TEXT,               -- A/B (เตรียมไว้สำหรับเฟส 3)
  sent_at, cancel_reason,
  UNIQUE(user_id, rule_name, tag_applied_at))
```
เพิ่มใน `customers`: `source_channel`, `ref_code`
รายละเอียดกลไก → `SAKBIN-FOLLOW-SPEC.md`

---

## 11. Logging (ต้องเสร็จก่อนเปิดขาย)

| field | ทำไม |
|---|---|
| `conversation_id`, `turn_index`, `ts` | ประกอบบทสนทนากลับ |
| `role`, `text_hash` | **ห้าม log ข้อความเต็ม (PII)** |
| `step_id`, `funnel_stage` | funnel analysis |
| **`objection_detected`** | หา keyword ที่ยังไม่อยู่ในชีต (§6) |
| `objection_matched_by_code` | เทียบกับข้างบน = self-improving loop |
| `tags_before`, `tags_after` | สืบว่าแท็กเพี้ยนตรงไหน |
| `handoff`, `handoff_reason` | วัด rule compliance |
| `follow_rule`, `follow_variant` | วัดว่าตามแบบไหนได้ผล |
| **`prompt_version`, `botlibrary_version`** | **สืบว่ายอดตกเพราะแก้อะไร** |
| `latency_ms`, `degraded` | จับ timeout ที่ทำสลิปหาย |
| `outcome` | ground truth |

---

## 12. ยืนยัน — สิ่งที่ **ไม่** เปลี่ยน (ของเดิมถูกแล้ว)

✅ order gate = code-gate จาก `pending_order` ไม่พึ่ง AI signal
✅ ชีตรับเฉพาะออเดอร์สมบูรณ์ ไม่มีแถวครึ่ง
✅ บอทไม่ยืนยันเงินเข้าเอง
✅ degraded + มีรูป → ถือเป็นสลิปไว้ก่อน
✅ ขอแก้ออเดอร์ที่เขียนแล้ว → handoff ห้ามแก้แถวเอง
✅ atomic order number · ติ๊ก O+P = ยกเลิก
✅ human_mode คืนสิทธิ์จาก `last_seen`
✅ push = เงินจริง ใช้ reply/arm-flag
✅ แยก systemInstruction / user content (กัน injection)
✅ debounce รวบข้อความ (คงไว้ — รอลูกค้าพิมพ์จบคือประโยชน์จริง)

## 13. สิ่งที่เปลี่ยนเพราะ "ประกาศตัวเป็น AI"

❌ `หน่วง_ก่อนพาไปประตูถัดไป` 11 วิ → **2 วิ**
ลูกค้ารู้อยู่แล้วว่าเป็นบอท — การแกล้งพิมพ์ช้าไม่ได้ทำให้ประทับใจ **ความเร็วต่างหากคือจุดแข็งที่คนทำไม่ได้**
