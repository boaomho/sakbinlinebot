# STATUS — SakbinAdvBot ("ปลาทู")

## 🔴 D-61 · v3.0 "บอทนักขาย CX" — รื้อใหญ่ (กำลังทำ · contract: [D61-SPEC.md](D61-SPEC.md) · โมเดล Fable)
- **เฟส A (สมองใหม่) เสร็จ ✅** บน `main` — สวิตช์ `SHEET_SCHEMA` (env-only · default **v2 = พฤติกรรมเดิม 100%**) · prompt v3 (`prompt/system-v3.ts` · หมวก 3 ใบ/3C/ตอบแทรก-พากลับ/4 ประตู/few-shot เจ้าของ) · เรียบเรียงสด (verbatim/precedence ไม่วิ่งใน v3) · ธงสุขภาพ `คำ_ธงสุขภาพ` (hint+🔔 dedup `__HEALTH_NOTIFY__`+ไม่ปิดบอท) · assurance guard (block→regenerate 1→ตัดบรรทัด→fallback · ห้ามเงียบ) · `DEFAULT_HANDOFF_KEYWORDS_V3` (v2 เดิมไม่ขยับ)
- **เฟส B (ชีต v3 + adapter) เสร็จ ✅** บน `main` — adapter จุดเดียว (`adapter-v3.ts`): map แท็บ (เส้นทางขาย→Step · ความรู้→FAQ รวม OBJ) + **normalize สถานะ "ว่าง=draft" isolate ที่ adapter** + funnel map ตายตัว · loader dispatch `SHEET_BOTLIB_V3_ID` · `สาระที่ต้องสื่อ`/สารก่อภูมิแพ้ เข้า prompt (v3) · Config `เข้า prompt` header-driven · seed script idempotent (แท็บวิธีใช้+คำเตือน) · mapping: [docs/D61-MIGRATION.md](docs/D61-MIGRATION.md)
- 🔴 **เจ้าของหลัง seed:** เปิดไฟล์ v3 ตรวจ — แท็บวิธีใช้/เส้นทางขาย/Config · **กรอกจริง: เลขที่บัญชี·ชื่อบัญชี·ธนาคาร (ยัง placeholder) + คำต้องห้าม_โฆษณา + รูปสินค้า URL** ก่อน cutover
- **เฟส C (golden + การ์ด schema + เตรียม cutover) เสร็จ ✅** บน `main` — **ปุ่ม "ชีต: v2/v3" ในห้องซ้อม** (sandbox override ต่อ session · prod ไม่กระทบ · ถาวร) + แก้ config memo leak · golden 2 ชั้น (D 18 เคสรันทุก npm test · G gated real Gemini+ชีตจริง → scorecard) · การ์ดสุขภาพชีต v3 ใน dashboard · cron ยืนยันสองโหมด · **checklist วันสลับ: [docs/D61-CUTOVER.md](docs/D61-CUTOVER.md)**
- **C1 ปลดล็อก golden ชั้น G เสร็จ ✅** บน `main` — เดิม `HARNESS_REAL_SHEET` ถูกอ่านแค่ที่ **gate ของเทส** ไม่มีใครเอาไปปิด mock → `setup.ts` mock `googleapis` ไม่มีเงื่อนไข → loader ได้ bundle ว่าง → **ชั้น G รันไม่ผ่านบนทุกเครื่อง** (ไม่ใช่ปัญหา env) · แก้: flag=1 → `values.batchGet` + `getConfig` ยิงของจริง · 🔴 **ชีต Orders (`get`/`append`/`batchUpdate`) ยัง mock เสมอ** + client จริงขอ scope `readonly` (เทสเขียนชีตจริงไม่ได้) · flag ปิด = พฤติกรรมเดิม 100% (560 passed) · +`tmp/` เข้า .gitignore · +`GEMINI_API_KEY_TRAIN` เข้า REPO-MAP §5/.env.example
- **C2 ปิด 3 ช่องจาก scorecard เสร็จ ✅** บน `main` — (1) 🔴 **`pushHealthNotifyV3` ย้ายออกจากบล็อก `deliverMarksStep`** — เดิมเทิร์นที่ AI ล้ม/ส่งไม่ถึง = แอดมิน**ไม่รู้เลย**ว่ามีคนถามเรื่องแพ้อาหาร (H1) · ตอนนี้แจ้งเสมอ แยก 2 แบบ: ตอบแล้ว=เนื้อจาก Config · **ยังไม่ตอบ=🔴 ด่วน (เนื้อในโค้ด)** · dedup marker เดิมคุมทั้งคู่ (2) `DEGRADED_NO_INPUT_REPLY` ตัดคำ "รบกวน" (3) invariant "รบกวน" เข้า golden ทั้ง D+G + สแกนแนวตอบในชีต (S01) + เข้าลิสต์คำห้ามใน `prompt/system-v3.ts` + **กติกาทักทาย** (เปิดบทใหม่=ทักเสมอทุกประตู · ต่อเนื่อง=ห้ามทักซ้ำ · ทักทาย**ไม่เปลี่ยนประตู**)
- **golden ชั้น G = 18/18 ✅** (วัดบน `aa0f658` · ชีตจริง+Gemini จริง · เคสเสี่ยง 3 รอบ) · ทักทายซ้อน "สวัสดีค่ะสวัสดีค่ะ" หายหมด · `npm test` **566 passed**
- **C3 จูน prompt โซนสุขภาพ เสร็จ ✅** บน `main` — วินิจฉัยพลิกโจทย์: hit 83% ส่วนใหญ่เป็น **false positive** (โมเดลใช้ "ปลอดภัย" เชิงระวัง "เพื่อความปลอดภัย แนะนำปรึกษาแพทย์" · guard จับ substring แยกบริบทไม่ได้ → cut ฆ่าประโยคปรึกษาแพทย์ = ผลกลับหัว) · แก้ 3 จุดเฉพาะพื้นผิวเทิร์นสุขภาพ: ห้าม "คำ" (ไม่ใช่แค่ประโยค) + **ประโยคแทนสำเร็จรูป "แนะนำนำข้อมูลส่วนผสมนี้ปรึกษาแพทย์เพื่อความสบายใจค่ะ"** ใน prompt/hint/correction · **ผล: hit 0/6 สองรอบติด** (เกณฑ์ ≤1/6) · คำตอบสุขภาพถึงลูกค้าเต็มใบ ไม่โดน cut · G เต็ม 18/18 · 566 passed · รายละเอียด → DECISIONS D-61.C3
- **C5 แก้ 3 พฤติกรรมจากซ้อมจริง ✅** บน `main` — (1) 🔴 **บอทเลิกโชว์โปรที่ไม่มีจริง** ("2 ถ้วย 220") — ต้นเหตุคือตารางที่ inject แจกแจงทุกจำนวนโดยไม่บอกว่าแถวไหนเป็นโปร → ติดป้าย `[โปรโมชั่น]`/`[ราคาตามจำนวน ไม่ใช่โปร]` ที่ `formatPriceTable` + กติกา prompt (ไม่แตะ guard · ราคาถูกอยู่แล้ว) → รายการโปร = 1/3/5/10 ตรงชีตทุกเคส (2) รูปแบบราคาแยกค่าส่ง "95 บาท + ค่าส่ง 30 บาท = รวม 125 บาท" (เดิม "125 (มีค่าส่ง 30)" ลูกค้าตีความเป็น 155) (3) บอลลูนปิด: คำถามพาไปต่ออยู่บรรทัดสุดท้ายเสมอ + few-shot ทุกฉากสอนลำดับใหม่ · **G 18/18** · 577 passed
- **C6 ปิดช่องที่ C5 เหลือ ✅** บน `main` — **คำถามพาไปต่อ = บอลลูนเดี่ยวเสมอ บังคับที่ delivery layer** (`splitClosingQuestion` ใน `lib/line.ts` · ตัดที่ขอบบรรทัด · deterministic ไม่พึ่ง LLM) · เหตุผล: LINE มือถือโชว์ noti จากข้อความสุดท้าย = ระดับ conversion · เพดาน ≤5 ชน → รวมสองบอลลูนแรก ไม่ทิ้งคำถาม · v3 เท่านั้น · ตัวตรวจคำถามย้ายมา lib เป็นแหล่งเดียว (ชั้น G import ใช้ร่วม) · unit 11 เคส edge ครบ
- 🔴 **C6 เจอต้นเหตุจริงของ C5 ด้วย: `โหมดประหยัดโควตา` ยุบ `[[เว้น]]` ทุกตัว** (ชีตตั้ง `เปิด` · default ในโค้ดก็ `true`) → โมเดลใส่ `[[เว้น]]` มาตลอดแต่ delivery ยุบทิ้ง · **เจ้าของเคาะ: ปิดโหมดประหยัดใน v3 โดยเจตนา** (ซ้อม=จริง 100% + จังหวะบอลลูนคือดีไซน์ CX) · ทำที่ `config.ts` ระดับโหมด — **v2 prod ไม่ขยับ** · ต้นทุนเพิ่ม = 0 สำหรับเทิร์นตอบปกติ (Reply API 5 messages/1 call · reply ไม่นับโควตา) · ห้องซ้อม render เหมือน prod เป๊ะ (ดักหลัง `parseReplyIntoMessages`) → DECISIONS D-61.C6
- **C4 persona ชื่อบอทตาม Config เสร็จ ✅** บน `main` — เจอจากซ้อมจริง: ตั้ง `ชื่อบอท`=ปลาทู แต่บอทเรียกตัวเองว่า "แอดมิน" เพราะ few-shot เขียนตายตัว · แก้ few-shot ให้ใช้ `${botName}` **เฉพาะที่บอทพูดถึงตัวเอง** + คง "ทีมแอดมิน" ตรงงานคนจริง (แพ็ค/จัดส่ง) + กติกา identity "เรียกแทนตัวเองว่า {ชื่อบอท} เสมอ" + เลิก hardcode "ปลาทู" ในข้อความ fallback 6 จุด (`defaultReply(botName)` + 5 ฟังก์ชันใน handler) · live G01: บอทตอบ "**ปลาทู**ขอแนะนำรายละเอียด..." ✅ · 573 passed
- **D-62 ยกระดับตาข่าย H1 เสร็จ ✅** บน `main` — (1) guard แยกบริบท: allowlist แคบ "เชิงระวัง `เพื่อความ...` (ไม่มีช่องว่างคั่น) + บรรทัดเดียวกันส่งต่อแพทย์/ทีม" = ไม่ hit · รับรองตรง/มีเงื่อนไข/บรรยายสินค้า hit เหมือนเดิม (2) regen ห้ามแย่ลง: ยืนยัน re-check เดิม (regen มี hit = ทิ้ง ใช้ต้นฉบับ-ตัดบรรทัด) + log `regen-dirty` · เทสด้วยประโยคจริงจาก probe ทั้งสองฝั่ง → DECISIONS D-62
- ⚠️ **บทเรียน prompt v3:** เติมกติกาทักทายแบบ "บล็อกใหม่" ทำ G11/G12 (ตอบแทรก-พากลับ) ตกทันที — ต้องเป็น **bullet เดียวใน `<บทบาท>`** + มีประโยค "ทักทายไม่เปลี่ยนประตู" กำกับ ไม่งั้นบอทย้อนไปแนะนำสินค้าใหม่แทนสรุปยอด
- ⚠️ **บทเรียนการวัด (สำคัญ):** 🔴 **ห้ามใช้ตัวเลขจาก sample เดียว หรือจาก prompt คนละเวอร์ชัน มาตัดสินใจ** — เคยสรุปว่า "regen 5/6 ดีขึ้นแล้ว" จากรอบเดียวที่เป็น prompt ระหว่างทาง พอวัดบนโค้ดที่ ship จริงได้ 2/5 · เคสสุขภาพ/ส่งต่อเป็น non-deterministic ต้องรันหลายรอบก่อนสรุป · 🔴 **ห้ามรัน golden ซ้อนกัน** — ทุกรอบ `TRUNCATE` Neon `harness-test` ก้อนเดียวกัน เคยได้ผลลวง fail 11 เคสจากการรันทับ
- ⚠️ **known-variance (ดูหลัง cutover · ยังไม่ต้องแก้):** golden ชั้น G รอบหนึ่งใน 2 รอบ โมเดลหลุดคำ **"รบกวน"** 1 เทิร์น (G02) — ยอมรับได้ตอนนี้เพราะ invariant C2 จับได้ + เคสจริงมี guard ชั้นชีต/degraded คุมอยู่ · 🔴 **หลัง cutover ให้ดูว่าเกิดถี่แค่ไหนกับลูกค้าจริง** (Vercel logs · ถ้าถี่ = ต้องดัน prompt เพิ่มหรือทำ guard ระดับคำเหมือน assurance)
- 🔴 **cutover พร้อมเมื่อ:** เจ้าของสลับ K001-K019 → live · กรอกเลขบัญชี/คำต้องห้าม/รูปสินค้า · การ์ด schema เขียวหมด · ซ้อม 5 บทผ่าน · golden G ผ่านเกณฑ์ → ตั้ง `SHEET_SCHEMA=v3` ใน Vercel (rollback = สลับกลับ v2 · ~1 นาที)
- **ต่อไป: C3 (Fable · จูน prompt โซนสุขภาพ ลด assurance hit rate) → แล้วค่อยเฟส D** (ผู้ช่วยเทรน v3 + โหมดสัมภาษณ์เซ็ตอัพ + write path/วงจร draft บนชีต v3)
- 🔴 กติกา: report แผนก่อนทุกเฟส · 1 commit/เฟส · v2 ที่ลูกค้าจริงใช้ห้ามเปลี่ยนจน cutover · ห้ามแตะ pricing/gate semantics/Neon/channel adapters/TRAIN_LOG

> สแนปช็อตสำหรับคนรับช่วงต่อ (ไม่เห็นแชทก็ทำต่อได้) · อัปเดต 2026-07-30
> รายละเอียด → [docs/DECISIONS.md](docs/DECISIONS.md) · แผนที่โค้ด → [REPO-MAP.md](REPO-MAP.md) · brief → [docs/P2-REBUILD-BRIEF.md](docs/P2-REBUILD-BRIEF.md)

## 🟢 T-STUDIO ห้องซ้อมเทรน (/train) — ครบ 4 เฟส (ก-ง) ✅ บน `main`
เจ้าของซ้อมสนทนา + แตะบอลลูนดูที่มา + แก้ draft + เขียนกลับชีต ได้จบในหน้าเดียว บนมือถือ · spec = [docs/T1-PATTERN-STUDIO-SPEC.md](docs/T1-PATTERN-STUDIO-SPEC.md) · หลักเหล็ก: reuse engine production ทุกจุด · sandbox ไม่มี side effect ถึง prod
- **ก Simulator:** pipeline จริง (Gemini จริง) ใน ALS sandbox · LINE/Blob/ชีต Orders→collector · Neon→branch `train` · X-ray + cron จำลอง
- **ข แตะบอลลูน:** provenance (แท็บ/key/คอลัมน์+raw+ตัวแปร) · draft overlay (batchGet proxy) · lint สด · dropped bubble ขีดฆ่า · "▶ เล่นใหม่"
- **ค เขียนกลับ+copy:** A1 สดจาก key+header · conflict 409 · hard guard BotLibrary เท่านั้น (ห้าม Orders) · lint gate server · TRAIN_LOG
- **ง mobile polish:** แชทเต็มจอ · bottom sheet (drag-to-close/กันคีย์บอร์ดบัง) · ปุ่มนิ้วโป้ง · bug fix: เปิด editor fetch ข้อความดิบสด + badge "ชีตถูกแก้แล้ว"
- **hotfix มือถือ:** กดบอลลูน→"Application error" = **TDZ** (`const tb` ประกาศหลัง `renderEditor()` ถูกเรียก) · แก้: ย้าย tb ขึ้น + `EditorBoundary` ครอบแผง editor (พังในอนาคต=เด้งเฉพาะแผง แชทอยู่) + guard touch
- **โครงสร้างขยับ:** `route.ts`→`handler.ts` (ก) · `loader.ts` bypass cache ใน sandbox (ข · guarded no-op)
- ✅ **KI-06 ปิดแล้ว:** `appendOrderRow` เขียน `line_user_id` (R) + เทส join จริง (golden บท 19)
- 🔴 **รอเจ้าของ:** ENV `DATABASE_URL_TRAIN` (Neon branch `train`) เข้า Vercel → redeploy → เปิด /train · (option) วาง `public/train-slip-sample.jpg` · ตรวจ viewport ~380px บนอุปกรณ์จริง

## 🟢 ระบบพร้อมรับลูกค้าจริง

- **โค้ด v2.0 + ซีรีส์ D-45→D-49 อยู่บน `main`** — เทสรับบน LINE จริงผ่านครบ (2026-07-23):
  - ✅ ก้อน "เปลี่ยน COD + ที่อยู่" จบเทิร์นเดียว พร้อมทวนเต็ม (D-48 extraction + D-49 override→won + snapshot)
  - ✅ cron ฟื้น — แจกเลขออเดอร์ (atomic) + แจ้งกลุ่ม format ถูก
  - ✅ ซื้อซ้ำได้ — ประตู S2 ส่งเต็มก้อนใหม่ (ธง `delivered_steps` ล้างหลังปิดออเดอร์ · KI-06)
- **cron-job.org: enabled** ทุก 5 นาที (endpoint ออเดอร์ · เช็ค `Authorization: Bearer <CRON_SECRET>`)
- **D-50 (แจ้งเลขพัสดุ · ก้อน B ส่วนแรก) เสร็จ ✅** บน `main` — ทีมแพ็คกรอก Tracking(P) → cron push แจ้งลูกค้า (ขนส่ง+เลขพัสดุ) ผ่าน greeting D-51 · dedup Neon `shipping_notified` · human_mode→แจ้งแอดมิน · T-STUDIO ปุ่ม "📦 กรอกพัสดุ + cron" · 🔴 เจ้าของเพิ่ม Config keys (ล่าง)
- **D-51 (ทักทายรายวัน) เสร็จ ✅** บน `main` — เทิร์นแรกของลูกค้าแต่ละวัน (เวลาไทย) เติม prefix หน้าบอลลูนข้อความแรก (delivery ล้วน · CSV_Config `ทักทายรายวัน` · ค่าเริ่ม `สวัสดีค่ะ ` · ว่าง=ปิด · ข้าม handoff/degraded/รูป)
- 🔴 **เจ้าของต้องเพิ่มใน CSV_Config (ชีต):** `ทักทายรายวัน` (D-51 · ค่าเริ่ม `สวัสดีค่ะ ` · เว้นว่าง=ปิด) · `ข้อความแจ้งพัสดุ` (D-50 · มี `{ขนส่ง}{เลขพัสดุ}` · เว้นว่าง=ปิด) · `ขนส่ง_เริ่มต้น` (D-50 · `Shopee Express`) — ทั้งหมด "ไม่มี key = ใช้ค่าเริ่มในโค้ด" (ฟีเจอร์เปิดอยู่แล้ว) · เพิ่มเพื่อแก้สำนวนเองในชีต
## 🔵 Meta Messenger adapter — เริ่มแล้ว (§5 เคาะครบ · แผน M-1→M-4)
- **M-0 research เสร็จ ✅** — [docs/META-ADAPTER-SPEC.md](docs/META-ADAPTER-SPEC.md) `[UNBUILT]` · 🔴 `POST_PURCHASE_UPDATE` ตาย (เม.ย. 2026) → แจ้งพัสดุนอก 24 ชม. ต้อง Utility Template · Dev Mode เทสได้ก่อนรีวิว
- **M-1 refactor `ChannelTransport` เสร็จ ✅** — interface + `LineTransport` · `processMessage`+helper รับ `transport` แทน `replyToken` · zero behavior change
- **M-2 Meta Messenger webhook เสร็จ ✅** บน `main` — `lib/channel/{pages,meta,meta-webhook}.ts` + `MessengerTransport` + `app/api/meta-webhook` · webhook (GET challenge + POST verify HMAC) → `processMessage` เดิม ผ่าน Send API (PSID) · id `fb:<pageId>:<psid>` · echo filter (META_APP_ID · fallback+เตือน) · สลิป `meta/<pageId>/` · Orders `source_channel=messenger` · cron D-50 ข้าม `fb:` (รอ M-4) · **417 passed** (405 คงเดิม + 12) · **เจ้าของ:** ENV 5 ตัว META_* เข้า Vercel + ตั้ง webhook + เทส Dev Mode
- **D-52 ป้ายช่องทาง เสร็จ ✅** — `channelLabel` (`[FB]`/`[ซ้อม]`/`[LINE]`) หน้าชื่อลูกค้าในข้อความแอดมินทุกจุด
- **M-4 cron route ตาม channel เสร็จ ✅** บน `main` — D-50 push ตาม prefix R: LINE→pushMessages เดิม · `fb:`→gate 24 ชม.→MessengerTransport (เกิน→แจ้งแอดมิน [FB] แจ้งเอง) · แจกเลข ทุกช่องเหมือนเดิม · **422 passed**
- **D-53 สวิตช์บอทราย channel เสร็จ ✅** บน `main` — คำสั่งกลุ่ม "ปิด/เปิดบอท line|fb" → `channel_switches` (ไม่มีแถว=เปิด) · เช็คต้นทางทั้ง 2 ฝั่ง (LINE/Messenger) → ช่องปิดบอทเงียบ · `ปิดบอท`เฉยๆ/รายคน เดิม · รายคนทับรายช่อง · **430 passed**
- **D-54 หน้า Privacy Policy เสร็จ ✅** — `/privacy` (static · ไทย+อังกฤษ · ไม่มี tracking) ปลดล็อก M-3 · 🔴 เจ้าของแจ้งอีเมลจริง (placeholder `sakbinofficial@gmail.com`)
- **T2-STUDIO v2 · เฟส ก (Dashboard ร้านจริง อ่านอย่างเดียว) เสร็จ ✅** บน `main` — spec [docs/T2-STUDIO-SPEC.md](docs/T2-STUDIO-SPEC.md) · `/train/dashboard` (โซนแดง อ่าน PROD Neon แยกจากห้องซ้อม) · สรุป (ลูกค้าใหม่/กลับมา/ยอดขายแยกช่อง/handoff ค้าง) + ตารางลูกค้า (สถานะ🟢🟡🔴✅ · TRAIN ซ่อน default) + หน้าลูกค้า read-only · ไม่เพิ่ม data ใหม่
- **T2-ข (สวิตช์เปิด-ปิดบอทใน UI · D-55) เสร็จ ✅** บน `main` — สวิตช์รายช่อง [LINE]/[FB] + toggle รายคน (row+detail) · confirm→เขียน→refresh→แจ้งกลุ่ม `(จาก Dashboard)` · reuse `setChannelEnabled`/`setHumanMode` เดิม (ไม่มี SQL ใหม่) · builder ข้อความแยก `lib/train/bot-switch.ts` handler เดิม import ร่วม (คำสั่งพิมพ์เท่าเดิม) · route `api/dashboard/switch` (guard เดิม)
- **T2-ฉ (แท็บออเดอร์ read-only · D-56) เสร็จ ✅** บน `main` — แท็บ "🧾 ออเดอร์" ในหน้า dashboard · ตารางจากชีต Orders (cache 60วิ · เรียงใหม่สุด) + สถานะ derive จากคอลัมน์จริง M/N/O/P+`shipping_notified` (`deriveOrderStatus` · cancelled ก่อนเสมอ) + headline คอขวด (งานคน=รอคอนเฟิร์ม/รอแพ็ค เน้นแดง) + TRAIN กรอง default · 🔴 read-only ล้วน (การกระทำจริงทำในชีต)
- **T2-ค (จัดการแถวคลังความรู้จากเว็บ · D-57) เสร็จ ✅** บน `main` — แท็บ "📚 คลังความรู้" ใน /train · เพิ่มแถว (🔴 บังคับ draft · แท็บไร้สถานะ=ปฏิเสธ) · live↔draft (soft delete) · "▶ ทดสอบ draft ในห้องซ้อม" (overlay สถานะ→live รายแถว · prod ยังกรอง draft) · **lintHealthH1 trigger-aware** (แถวเกี่ยวสุขภาพ→คำตอบต้อง handoff ไม่งั้น block) · funnel validator · เขียนผ่านกลไก v1 (hard guard/conflict/lint) · TRAIN_LOG +action
- **D-57.1 bugfix เสร็จ ✅** บน `main` — คอลัมน์สถานะ **CSV_FAQ ใช้ `status` (อังกฤษ)** แต่ที่อื่น `สถานะ` (ไทย) · +`statusColumnIndex` (single source · loader+UI เรียกตัวเดียว) แก้แบนเนอร์ผิด + add-row/toggle FAQ ใช้งานได้ · **490 passed**
- 🔴 **เจ้าของต้องวางข้อความเตือนในแท็บวิธีใช้ของชีต (KI-08):** `เพิ่มแถวมือ ต้องใส่ "สถานะ=draft" ก่อนเสมอ — ช่องว่าง=บอทถือ live ทันที (ลูกค้าเห็นเลย)` — เพิ่มผ่านเว็บ (📚) กันให้แล้ว แต่แก้ชีตมือยังเสี่ยง
- **D-58 handoff_notify เสร็จ ✅** บน `main` — funnel ใหม่ `handoff_notify` (ตอบ pattern + แจ้งแอดมิน 🔔 + ไม่ปิดบอท) + pre-check ชั้นสอง `คำ_notify` (fail-safe → handoff ถ้าชีตตั้งผิด) · 🔴 **ไม่แตะ DEFAULT_HANDOFF_KEYWORDS** (notifyKeywords ว่าง=พฤติกรรมเดิม 100%) · **486 passed**
- 🔴 **เปิดใช้ D-58 = งานชีตเจ้าของ:** ย้ายคำสุขภาพ `คำ_handoff`→`คำ_notify` + ประตู H1 `funnel_stage=handoff_notify` + เขียน pattern ปลอดภัย (ข้อมูล+ปรึกษาแพทย์ ไม่รับรอง "ทานได้")
- **T2-จ1 ผู้ช่วยเทรน (D-59) เสร็จ ✅** บน `main` — แท็บ 🤖 ใน /train · แชท AI (Gemini call แยก · `GEMINI_API_KEY_TRAIN` optional) เสนอ proposal ร่าง/แก้แถว → เจ้าของยืนยัน → **เขียนผ่านเส้นทาง D-57 เป๊ะ** (draft/lint/TRAIN_LOG ai-draft/ai-edit) · 10 กติกา (สุขภาพ→handoff_notify · ถามก่อนเดา · ≤3/เทิร์น) · Config แนะนำได้ห้ามเขียน · edit-row live มีป้ายเตือน
- **D-60 เสร็จ ✅** บน `main` — (1) `คำ_notify_<step_id>` per-door (alias `คำ_notify`→H1 · fail-safe/dedup ต่อประตู) (2) system prompt ผู้ช่วย +กติกา 11 flow สัมภาษณ์/12 เสียงนักขาย CX/persona ค่ะ (3) โหมดเกลาเสียง (KB เนื้อเต็ม · `rewriteSafety` รักษา {}/ตัวเลข · ≤3/เทิร์น · ปุ่มข้าม/excludeKeys ไม่วนซ้ำ)
- **D-60.1 เกลากติกา 12 เสร็จ ✅** บน `main` — นักขาย CX **3 หมวก** (แก้ปัญหา/สร้างความต้องการ/สร้างทางเลือก) · 3 เทคนิค (choice close · ดี→ดีขึ้น→ดีที่สุด · say no but never say no) · 3C เฉพาะเทิร์นกังวล · **lint เหลือง `close-style`** จับ "รับมั้ยคะ/รับเลยนะคะ" ใน pattern ที่ร่าง (เตือน ไม่ block)
- **D-60.2 bugfix กติกา 11 เสร็จ ✅** บน `main` — ผู้ช่วยออก proposal เทิร์นแรกงานใหม่ (ข้าม flow สัมภาษณ์) → แก้ 3 ชั้น: FLOW ย้ายขึ้นต้น prompt + few-shot + ข้อยกเว้นแคบ · schema +`phase` (enum) · 🔴 **server gate**: phase ≠ proposal → ทิ้ง proposals (invariant อยู่ในโค้ด เทสได้จริง) · UI greeting "ผม" → persona ค่ะ + file-guard กันถอยหลัง
- 🔴 **เปิดใช้ per-door (เจ้าของ):** ตั้ง `คำ_notify_<step_id>` ใน CSV_Config (เช่น `คำ_notify_H5` = เบาหวาน,ความดัน) + ประตูนั้น `funnel_stage=handoff_notify` + pattern ปลอดภัย
- 🔴 **ลำดับใหม่ (D-59):** ก→ข→ฉ→ค→**จ1**→ง→จ2 · ต่อไป **T2-ง** (Config แบบฟอร์ม) แล้ว **T2-จ2** (onboarding ไฟล์/รูป · Products/Promo · ก่อน P2 ต.ค.)
- **ต่อไป (งานมือเจ้าของ):** (option) ตั้ง `GEMINI_API_KEY_TRAIN` แยกโควตาผู้ช่วยเทรน · M-3 (App Review · ใช้ URL `/privacy`) · Utility Template (Messenger นอก 24 ชม.) · Follow/CRM ก้อน B ส่วนหลัง

- เทสล่าสุด: **405 passed | 3 expected-fail | 34 skipped** (scripted) · tsc + build เขียว
- known-tuning (ยอมรับแล้ว · ปิดได้ทีหลังด้วยการจูนชีต): **G12** (S2 vs S2_DIRECT · "ขอลองถ้วยเดียว") · **G29** stage (S4A/S4B)

## ซีรีส์ D-45→D-49 (เส้นทางเงิน + สมองยึด Step) — ปิดครบ ✅ บน `main`

| D | เรื่อง | สถานะ |
|---|---|---|
| D-45 | สมองยึด Step + ธง `delivered_steps` + `{ชวนเลือกโปร}` | ✅ (a/b/c/d) |
| D-46 | บล็อก PROHIBITED_CONTENT ไม่เข้า degraded → safetySettings OFF 5 หมวด + degraded path | ✅ |
| D-47 | ถอดชนวนเส้นทางเงิน — payment pre-check (ข้าม AI) + redact + log pattern | ✅ |
| D-48 | extraction fallback (call จิ๋วไม่มีกลิ่นเงิน) แทน retry + fix payment lock เคสเปลี่ยนวิธีจ่าย | ✅ |
| D-49 | ปิดช่องปาก-มือ — recovered→ประตูปลายทาง · complete ชนะ FAQ/OBJ · snapshot ทวนสด | ✅ |

> 🛡️ **PROHIBITED_CONTENT ปิดไม่ได้ (KI-05)** — รับด้วยบันได 4 ชั้น: pre-check → call หลัก → extraction → degraded · เฝ้า log `scope:"extraction"` + blocked pattern

## สรุป P2-REBUILD ที่จบ: "AI ไม่เขียนข้อความถึงลูกค้าอีกต่อไป"
AI เหลือ 4 งาน (เลือก step · จำแนก objection · สกัด order_data · ตัดสิน handoff) · ทุกคำจากชีต (pattern) + resolver

| D | เรื่อง | commit |
|---|---|---|
| D-40 | verbatim = default (flip parseThinkMode · ว่าง=ปิด) | `64acce8` |
| D-41 | schema v2.0 (ตัด CSV_Examples/brain · +CSV_Vars · status filter ทุกแท็บ) | `e6ce4a7` |
| D-42 | FAQ เข้า verbatim (precedence **handoff > objection > FAQ > step** + stepClosing วกกลับ) | `10ffc13` |
| D-43 | ขยาย resolver (catalog/config/{นโยบายค่าส่ง}/CSV_Vars · ระบบชนะ collision) | `99fb1e1` |
| D-44a-c | หด `คำ_handoff` · systemInstruction v2.0 (~2,153 tokens) · golden routing | `f1f433b`/`5efe3f5` |

## งานเจ้าของ (โค้ดพร้อมแล้ว — ที่เหลือคือ "เทรนผ่านชีต")
1. 🔴 **เช็ค pattern ประตู won (S4B) ในชีต** (D-49 เงื่อนไข 2) — ถ้ามี `{ออเดอร์_เลขที่}` บอลลูนนั้นตกทุกครั้งบนเทิร์นเขียน (เลขมาตอน cron แจก) → เอาออก/แยกบอลลูน
2. **เทรน "เข้าเมื่อ/keywords/ตัวอย่างคำตอบ" ในชีต** — จูนพฤติกรรมผ่านชีต ไม่ใช่โค้ด · keyword = วลี ไม่ใช่คำโดดสามัญ (โอน/ยา/ส่ง/ราคา ชน substring) · ยกเว้นแถว action=handoff
3. 🔴 **เช็ค `temperature` ในชีต v2.0 CSV_Config ให้ ≤0.2** (ชีตชนะ default)
4. **รัน golden 33 + sheet-lint ด้วย creds จริง** (`.env.test` เป็น dummy — CC รันไม่ได้) → แดง = จูนชีต + sync fixture (KI-07)
5. หลัง go-live เสถียร: ลบ `handoff-decision` log · ล้างแถวเทสในชีต Orders

## งานโค้ดถัดไป (จองไว้ · ยังไม่เริ่ม)
- ~~D-46 note (ปรับ degraded/retry)~~ **ยกเลิก** — แทนด้วย D-48 extraction แล้ว
- **fixture sync** — G26-G29 กับชีตจริง (KI-07)
- **เฟสหลังการขาย** (ก้อน B/C เดิม) — แจ้ง tracking · จบเคส · Follow CRM ([docs/FOLLOW-SPEC.md](docs/FOLLOW-SPEC.md) `[UNBUILT]`)
- **T1 Pattern Studio** — เครื่องมือแก้/พรีวิว pattern ชีต (ตามแผน)

## 🔴 จุดอันตรายห้ามลืม
- **สิ่งที่ห้ามแตะ** (เส้นตาย): order gate · `calculatePrice` · 2-pass/quota-saver · idempotency (D-29) · last_order/S_EDIT (D-31/32) · handoff รวมศูนย์ (D-33) · intake (D-34-36) · เวลาไทย (D-37) · validate funnel_stage (D-38) · invariants 10 (REPO-MAP §10) · **กฎ H1 ทุกชั้น**
- **บันได 4 ชั้นรับ PROHIBITED_CONTENT (KI-05)** — ห้ามถอดชั้นใดชั้นหนึ่งโดยไม่วัดผล · degraded = last resort ห้ามหลุด
- **"ท้อง" ใน `คำ_handoff` เป็น substring** — ชน "ท้องฟ้า/ท้องเสีย" → ดัก handoff ก่อน intake (ทิศปลอดภัย · แก้คำในชีต ไม่ใช่โค้ด)
- `{รูปสินค้า}` = URL ดิบ · **ไม่มี resolver `{สารก่อภูมิแพ้}`** (H1 — ห้ามทำ) · CSV_Vars: live เท่านั้น · ชื่อชนตัวแปรระบบ → ระบบชนะ+log
- prompt/system.ts: แก้ด้วย Edit เท่านั้น (KI-03 backtick) · prompt-lint คุม order_data example + C6

## กฎทำงาน
report ก่อน code · 1 commit 1 เรื่อง · วัดก่อนแก้ · ไม่ over-engineer · เจอเปลี่ยน contract นอกบรีฟ → หยุดถาม ·
🔴 จบ D-xx/phase → อัปเดต STATUS.md ในคอมมิตเดียวกัน (สแนปช็อตให้คนใหม่รับช่วงต่อได้)
