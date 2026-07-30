# META-ADAPTER-SPEC — Messenger (Facebook Page) adapter `[UNBUILT]`

> **สถานะ:** M-0 research → **M-1 (ChannelTransport) + M-2 (webhook+MessengerTransport) build แล้ว ✅** · เหลือ M-3 (App Review · งานมือ) + M-4 (cron route ตาม channel) · ดูรายละเอียด build ใน [DECISIONS.md](DECISIONS.md) M-1/M-2 · ค้นข้อมูลสด 2026-07-29 (ดู Sources ท้ายไฟล์)
> **เป้า:** รับ-ตอบแชทเพจ Facebook ด้วย "สมองปลาทู" ตัวเดิม (`processMessage`) โดยไม่ทุบ pipeline · LINE ยังทำงานปกติ
> **หลักคิดเดียวกับกฎ ShippingProvider:** เพิ่ม channel ที่สองได้โดยไม่รื้อ · ระบุ `page_id` ชัดทุก event · mapping `page_id → config` แบบวันนี้ 1 เพจใช้ค่าเดียว แต่ไม่ตายทางถ้าเพิ่มเพจ/ธุรกิจ

---

## 🔴 ข้อค้นพบที่กระทบดีไซน์มากสุด (อ่านก่อน)

1. **`POST_PURCHASE_UPDATE` (message tag ที่เคยใช้แจ้งพัสดุนอกหน้าต่าง 24 ชม.) ถูกยกเลิกแล้วตั้งแต่ 27 เม.ย. 2026** — ส่งไปได้ error code 100 · แทนที่ด้วย **Utility Templates (intent `post_purchase`)** ซึ่งต้อง **pre-approve ต่อ use case + เป็น template (ไม่ใช่ free-form) + มีค่าใช้จ่าย** → **D-50 แจ้งพัสดุของเราแบบข้อความอิสระ ใช้บน Messenger นอก 24 ชม. ไม่ได้** (ต่างจาก LINE ที่ push ได้เสมอ)
2. **หน้าต่าง 24 ชม. (Standard Messaging):** ตอบ **free-form ได้ภายใน 24 ชม.** นับจากข้อความล่าสุดของลูกค้า (`messaging_type=RESPONSE`) — **แกนการขายของเราอยู่ในกรอบนี้พอดี** (ลูกค้าทัก → บอทตอบไว)
3. **`HUMAN_AGENT` tag** ต่อหน้าต่างเป็น 7 วัน แต่ **ต้องเป็นคนจริงส่ง ห้ามบอท** → ใช้กับ handoff (แอดมินตอบเอง) ได้ · ใช้กับ follow อัตโนมัติของบอท **ไม่ได้**
4. **Development Mode ทดสอบได้ทันทีก่อน App Review** กับบัญชีที่มี role (Admin/Developer/Tester) บนแอป → **เทส end-to-end จริงได้เร็ว** ไม่ต้องรอรีวิว
5. **คุยกับลูกค้าทั่วไป (ไม่ใช่ role) ต้องผ่าน App Review + Business Verification** ของ permission `pages_messaging` (Advanced Access)

**สรุปผลต่อ roadmap:** พอร์ต **แกนขาย (ก้อน A) ขึ้น Messenger ได้เต็ม** (อยู่ใน 24 ชม.) · แต่ **แจ้งพัสดุ/Follow นอก 24 ชม. (ก้อน B) เป็นงานแยกที่ต้องทำ Utility Templates** — อย่าสัญญาว่า D-50 จะ "ยกมาเฉยๆ" บน Messenger

---

## §1 · ขั้นตอนจริงของการทำบอทตอบเพจ (onboarding)

### 1.1 สร้าง Meta App + เชื่อมเพจ
1. สร้าง **Meta App** ที่ developers.facebook.com → เลือก type **Business**
2. เพิ่ม product **Messenger** → ผูกกับ **Facebook Page** ของร้าน → ได้ **Page Access Token**
3. ตั้ง **Webhook**: ใส่ Callback URL (route ใหม่ของเรา) + **Verify Token** (เราตั้งเอง) → subscribe fields: `messages`, `messaging_postbacks` (+ `message_echoes` ถ้าต้องรู้ข้อความที่แอดมินพิมพ์เอง)
4. Subscribe เพจเข้ากับแอป (`/{PAGE_ID}/subscribed_apps`)

### 1.2 Permission ที่ต้องขอ
- **`pages_messaging`** — จำเป็นสุด (รับ-ส่งข้อความ) · ต้อง **Advanced Access** เพื่อคุยกับลูกค้าทั่วไป
- **`pages_manage_metadata`** — จัดการ webhook/subscription ของเพจ
- (ถ้าใช้ handoff แบบ human 7 วัน) permission **Human Agent** — ขอแยกใน App Dashboard → *Permissions and Features*
- Utility/Marketing Messages (ก้อน B นอก 24 ชม.) = flow อนุมัติ template แยก (ดู §2.4)

### 1.3 App Review + Business Verification
- **Advanced Access ของ `pages_messaging`** ต้องผ่าน **App Review** + **Business Verification** (ยืนยันตัวตนธุรกิจ) · ถ้าไม่ทำ business verification → permission ถูกเพิกถอน ส่ง/รับไม่ได้
- **ส่งอะไรในรีวิว:** คำอธิบาย use case + **สกรีนแคสต์วิดีโอ** แสดง flow ผู้ใช้จริง (ลูกค้าทัก → บอทตอบ) + นโยบายความเป็นส่วนตัว + เหตุผลที่ต้องใช้ permission
- **เวลา:** business verification + app review รวมกันปกติ **ไม่กี่วันถึง ~2 สัปดาห์** (แล้วแต่คิว/ความครบของเอกสาร · แหล่งชุมชนรายงานหลากหลาย — วางแผนเผื่อ)

### 1.4 🟢 Development Mode = เทสจริงได้เลย (ก่อนรีวิว)
- แอปที่ยังไม่ publish อยู่ใน **Development Mode**: Page token คุยได้เฉพาะบัญชีที่มี **role Admin/Developer/Tester** บนแอป
- **เราจึงเทส end-to-end บนเพจจริงได้ทันที** ด้วยบัญชีแอดมินเพจ/บัญชีทดสอบที่ให้ role → เก็บ flow ให้นิ่งก่อนค่อยส่งรีวิว
- **ผลต่อแผน:** สร้าง adapter + เทสกับแอดมินเพจได้ก่อน แล้วค่อยขนานกับ business verification/app review (ไม่บล็อกกัน)

---

## §2 · Webhook + Send API + หน้าต่างข้อความ + rate limit

### 2.1 Webhook ขาเข้า (คู่กับ `x-line-signature` ของ LINE)
- **Verify (ครั้งเดียวตอนตั้ง):** Meta ยิง **GET** พร้อม `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge` → route ตรวจ verify_token แล้ว **echo `hub.challenge`** กลับ
- **Event (ทุกข้อความ):** **POST** body ลงชื่อด้วย **`X-Hub-Signature-256` = HMAC-SHA256(app_secret, rawBody)** → **ต้อง verify** (เทียบชั้นเดียวกับ LINE) มิฉะนั้น 401
- โครง payload:
```json
{
  "object": "page",
  "entry": [{
    "id": "<PAGE_ID>",                         // ← page_id อยู่ทุก event (สำคัญต่อ mapping)
    "time": 1518479195594,
    "messaging": [{
      "sender":    { "id": "<PSID>" },          // Page-Scoped ID ของลูกค้า (ต่างเพจ = PSID คนละตัว)
      "recipient": { "id": "<PAGE_ID>" },
      "timestamp": 1518479195273,
      "message": {
        "mid": "mid.$...",                       // id ข้อความ (ใช้ dedup ได้)
        "text": "สวัสดีค่ะ",                      // ข้อความ (ถ้าเป็นข้อความ)
        "attachments": [                         // ถ้าส่งรูป/ไฟล์
          { "type": "image", "payload": { "url": "<CDN_URL ชั่วคราว>" } }
        ]
      }
    }]
  }]
}
```
- **echo:** ข้อความที่เพจ/แอดมินส่งเองมี `message.is_echo=true` → adapter **ต้องกรองทิ้ง** (กันลูป) เว้นแต่จะใช้จับ "แอดมินเข้ามาคุย → เข้า human_mode"
- **รูป:** ได้ **URL ชั่วคราวบน CDN** (ต้องโหลดมาเก็บเองถ้าต้องใช้ต่อ เช่นสลิป) — ต่างจาก LINE ที่โหลดผ่าน `getMessageContent(messageId)`

### 2.2 Send API ขาออก (แทน reply/push ของ LINE)
- **Endpoint:** `POST https://graph.facebook.com/v25.0/<PAGE_ID>/messages` (หรือ `/me/messages`) · auth = `access_token=<PAGE_ACCESS_TOKEN>`
- **ไม่มี reply token** — ระบุผู้รับด้วย **PSID ตรงๆ** ทุกครั้ง (ต่างจาก LINE ที่ reply ใช้ token ครั้งเดียว)
- ข้อความข้อความ:
```json
{ "recipient": { "id": "<PSID>" },
  "messaging_type": "RESPONSE",
  "message": { "text": "สนใจโปรไหนดีคะ" } }
```
- รูป: `message.attachment = { "type": "image", "payload": { "url": "<PUBLIC_URL>", "is_reusable": true } }` (หรืออัปโหลด attachment_id)
- **typing / อ่านแล้ว:** ยิงแยกด้วย `sender_action`: `typing_on` / `typing_off` / `mark_seen` (ไม่มี field "แสดง typing" ใน payload ข้อความเหมือน LINE)
- **หลายบอลลูน:** ไม่มี multicast/บอลลูนในตัว → **ยิงหลาย request ต่อเนื่อง** (adapter loop ตาม `[[เว้น]]/[[แยก]]` เดิม) · เรียงลำดับ/หน่วงเองถ้าต้องการ

### 2.3 `messaging_type` ต่อ flow ของเรา
| flow | ภายใน 24 ชม.? | messaging_type | หมายเหตุ |
|---|---|---|---|
| ตอบแชทขาย (แกน A) | ใช่ | `RESPONSE` | free-form OK ✅ |
| D-51 ทักทายรายวัน | ใช่ (เติมหน้า reply) | `RESPONSE` | ไปกับ reply เดิม ✅ |
| D-50 แจ้งพัสดุ (cron) | **อาจเกิน 24 ชม.** | 🔴 ถ้าเกิน = ต้อง Utility Template | ดู §2.4 · ถ้าลูกค้าเพิ่งคุย <24 ชม. → RESPONSE ได้ |
| handoff (คนตอบ) | เกินได้ถึง 7 วัน | `MESSAGE_TAG` + `HUMAN_AGENT` | **คนส่งเท่านั้น** ห้ามบอท |
| Follow/CRM (ก้อน B) | เกิน 24 ชม. | 🔴 Utility/Marketing Messages | งานแยก |

### 2.4 นอกหน้าต่าง 24 ชม. (กระทบ D-50/Follow โดยตรง)
- **Utility Messages / Utility Templates (intent `post_purchase`)** = ทางแทน POST_PURCHASE_UPDATE สำหรับแจ้งพัสดุ/สถานะออเดอร์ · **ต้องสร้าง template + ขออนุมัติต่อ use case + มีค่าใช้จ่ายต่อข้อความ**
- **Recurring Notifications** ถูก sunset ทั่วโลก 12 ม.ค. 2026 · **Marketing Messages (Messenger)** = ทางจ่ายเงินสำหรับข้อความเชิงการตลาด
- **ข้อเสนอเชิงกลยุทธ์ (ต้องเคาะ §5):** เฟสแรกให้ **D-50 บน Messenger ยิงเฉพาะเมื่อยังอยู่ใน 24 ชม.** (best-effort · เกิน = ข้าม+log ให้แอดมินแจ้งเอง เหมือน branch human_mode เดิม) → เลี่ยงงาน Utility Template ก้อนใหญ่ไปก่อน

### 2.5 Rate limits
- โมเดลมาตรฐาน Messenger: **จำนวน call ต่อ 24 ชม. ≈ 200 × จำนวนผู้ใช้ที่ engage** (rolling) · Development Mode จำกัดกว่า
- ไม่มีตัวเลขเดียวตายตัวในผลค้น → **ยืนยันจาก App Dashboard ตอน build** · adapter ควรมี backoff เมื่อเจอ error rate-limit (โครงเดียวกับ timeout/guard เดิม)

---

## §3 · สิ่งที่ต่างจาก LINE ที่กระทบ adapter

| ประเด็น | LINE (วันนี้) | Messenger | ผลต่อ adapter |
|---|---|---|---|
| ระบุผู้รับตอบ | `replyToken` (ครั้งเดียว) + push (userId) | **PSID ตรงเสมอ** (ไม่มี reply token) | delivery รวมเป็น "push ด้วย PSID" อย่างเดียว → **นามธรรม transport ต้องไม่ผูก reply token** |
| verify | `x-line-signature` | `X-Hub-Signature-256` (app_secret) + GET challenge | route ใหม่ทำ verify ของตัวเอง |
| typing | field ใน flow (`showTyping`) | `sender_action: typing_on` ยิงแยก | transport มี `typing()` เป็น method |
| รูป/สลิป | `getMessageContent(id)` → binary | **CDN URL ชั่วคราว** ใน webhook | โหลดจาก URL แล้วเก็บ Blob (โค้ดเก็บสลิปเดิมใช้ต่อได้ แค่เปลี่ยน "แหล่งได้ binary") |
| หลายบอลลูน | reply/multicast 1 call หลาย message | **ยิงหลาย call** | loop ส่ง + หน่วงเอง (ใช้ `[[เว้น]]` เดิมได้) |
| debounce (รวบข้อความ) | จำเป็น (พิมพ์รัว) | **ยังจำเป็น** (ลูกค้าพิมพ์หลายบับเบิลเหมือนกัน) | **ใช้ debounce/pending_messages เดิมได้** แค่ key ด้วย (page_id, psid) |
| id ลูกค้า | LINE userId (ข้ามเพจได้) | **PSID ผูกกับเพจ** (คนเดียวคนละเพจ = คนละ PSID) | **customer key ต้องมี channel + page** (ดู §5) |

> **ข่าวดี:** เลเยอร์ debounce, ความจำ Neon, gate, pricing, verbatim, var-guard, greeting — **ไม่ต้องแตะ** ถ้า adapter แปลง event→`processMessage`→reply ให้อยู่ในรูปเดิม

---

## §4 · ร่างสถาปัตยกรรม adapter (ยังไม่ build)

### 4.1 ภาพรวม flow
```
Meta webhook (POST /api/meta-webhook)
  → verify X-Hub-Signature-256
  → สำหรับแต่ละ entry → อ่าน page_id (entry.id)          // 🔴 ระบุ page_id ชัดทุก event
  → resolvePageContext(page_id) → { pageAccessToken, config, businessScope }   // §4.3 mapping
  → สำหรับแต่ละ messaging: normalizeInbound() → InboundMessage
       { channel:"messenger", pageId, senderId:PSID, text, imageUrl?, mid, isEcho }
  → กรอง echo / event ที่ไม่รองรับ
  → channelUserId = "fb:" + pageId + ":" + PSID              // key ความจำ (ดู §5)
  → debounce เดิม (pending_messages · key = channelUserId)
  → processMessage(channelUserId, text, /*replyToken*/ null, config, switches, image, transport)
       // handler ใช้ transport แทนการ import line.ts ตรงๆ
  → transport = MessengerTransport(pageAccessToken, PSID)
       reply/push  → Send API (messaging_type RESPONSE, recipient PSID)
       typing()    → sender_action typing_on
       sendImage() → attachment image url
  → คำตอบ (บอลลูนตาม [[เว้น]]/[[แยก]]) → loop ยิง Send API
```

### 4.2 นามธรรมหลัก — `ChannelTransport` (ระดับเดียวกับ ShippingProvider)
> ปัญหาปัจจุบัน: `handler.ts` เรียก `lib/line.ts` ตรง (`deliverReply`/`pushMessages`/`getProfileName`/`downloadContent`) และรับ `replyToken` · Messenger ไม่มีสิ่งเหล่านี้เหมือนกัน
>
> **ทางออก:** สกัด interface กลาง แล้ว inject ต่อ channel (LINE คงพฤติกรรมเดิม 100%):
```ts
interface ChannelTransport {
  channel: "line" | "messenger";
  reply(text: string): Promise<boolean>;          // LINE=reply token · MSG=Send API push(PSID)
  push(text: string): Promise<boolean>;           // ทั้งคู่ = push
  typing(on: boolean): Promise<void>;             // LINE=flow flag · MSG=sender_action
  sendImage(url: string): Promise<boolean>;
  getProfileName(): Promise<string>;
  downloadInboundImage(ref: string): Promise<Buffer | null>; // LINE=messageId · MSG=CDN url
}
```
- `processMessage(channelUserId, text, config, switches, image, transport)` — เลิกรับ `replyToken` (ย้ายเข้า LineTransport) · logic ในนี้ (gate/verbatim/var-guard/greeting/order) **ไม่เปลี่ยน**
- **งาน refactor ครั้งเดียว (ก่อนเพิ่ม Messenger):** เปลี่ยนจุดที่ handler เรียก line.ts → เรียกผ่าน `transport` · LINE webhook สร้าง `LineTransport(replyToken, userId)` แล้วส่งเข้า `processMessage` — **เทสเดิมต้องเขียว = พิสูจน์ไม่มี regression** (เหมือนตอนแยก route.ts→handler.ts ของ T-STUDIO)

### 4.3 🔴 Mapping `page_id → config` (กันดีไซน์ตายทาง · ยังไม่ทำ multi-tenant จริง)
- **ทุก event มี `entry.id = page_id`** → adapter **ห้ามสมมติเพจเดียว** · ส่ง page_id ผ่านทุกชั้น
- นิยาม resolver ตัวเดียว:
```ts
function resolvePageContext(pageId: string): PageContext
// PageContext = { pageAccessToken, config, blobScope, ordersScope, businessLabel }
```
- **วันนี้ (1 เพจ):** อ่านจาก env — `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN` · `resolvePageContext` เช็ค `pageId === META_PAGE_ID` แล้วคืน config ชุดเดียว (config/ชีต/Blob เดิม) · pageId ไม่ตรง → 200 + log ทิ้ง (กัน event เพจแปลก)
- **อนาคต (หลายเพจ/ธุรกิจ):** เปลี่ยน **แค่ภายใน `resolvePageContext`** ให้อ่านตาราง `channel_pages(page_id PK, access_token, app_secret, config_scope, sheet_botlib_id, orders_sheet_id, blob_scope, business_label)` — **ไม่ต้องแตะ webhook/transport/handler** เพราะทุกจุดรับ `PageContext` มาแล้ว
- **กติกา (เขียนกันลืม):** โค้ด adapter **ห้ามอ่าน `process.env.META_*` ตรงนอก `resolvePageContext`** · ทุกอย่างที่ต่างต่อเพจ (token/secret/config/ชีต/Blob) ต้องมาจาก `PageContext` — นี่คือ "จุดเปลี่ยนจุดเดียว" แบบเดียวกับกฎ ShippingProvider

### 4.4 ไฟล์ที่จะเกิด (ตอน build จริง)
- `app/api/meta-webhook/route.ts` — GET verify + POST events (verify signature · normalize · debounce · เรียก processMessage)
- `lib/channel/transport.ts` — interface `ChannelTransport` + `LineTransport` (ห่อ line.ts เดิม) + `MessengerTransport` (Send API)
- `lib/channel/meta.ts` — Send API client (text/image/sender_action) + verify X-Hub-Signature-256 + download CDN image
- `lib/channel/pages.ts` — `resolvePageContext(pageId)` (env วันนี้ · table วันหน้า)
- refactor `handler.ts` — รับ `transport` แทน `replyToken` + เลิก import line.ts ตรง
- ENV ใหม่: `META_PAGE_ID` `META_PAGE_ACCESS_TOKEN` `META_APP_SECRET` `META_VERIFY_TOKEN`

---

## §5 · Contract ที่ต้องเคาะกับแชทภาพรวม (ก่อน build)

1. **Customer key ข้าม channel** 🔴 — วันนี้ `customers.user_id` = LINE userId · Messenger ใช้ **PSID (ผูกเพจ)** · ตัวเลือก:
   - (ก) เพิ่มคอลัมน์ `channel` + ใช้ composite `(channel, external_id)` เป็น key (สะอาดสุด · ต้อง migrate)
   - (ข) prefix ใน `user_id` เดิม เช่น `fb:<pageId>:<psid>` (เร็ว · ไม่ migrate · แต่ปนกันในคอลัมน์เดียว)
   - เคาะ: (ก) หรือ (ข) — กระทบ resetCustomerMemory, history, follow ทั้งหมด
2. **Channel/attribution ในชีต Orders** 🔴 — คอลัมน์ `source_channel` (U) มีอยู่แล้ว · เคาะค่าที่ลง: `"messenger"` + เก็บ `page_id`/PSID ที่ไหน (คอลัมน์ใหม่ หรือรวมใน `line_user_id`→เปลี่ยนชื่อเป็น `channel_user_id`) · **`line_user_id (R)` คือ join key ของ D-50/cron** → ถ้า Messenger ต้องเก็บ PSID ที่นี่ ควร generalize ชื่อ/ความหมาย
3. **D-50 แจ้งพัสดุนอก 24 ชม.** 🔴 — Messenger ห้าม free-form → เคาะ: (ก) ยิงเฉพาะใน 24 ชม. + เกิน=แจ้งแอดมิน (เฟสแรก) หรือ (ข) ลงทุนทำ Utility Template (เฟสหลัง)
4. **human_mode / handoff** — บน Messenger แอดมินตอบผ่านกล่องเพจ = เกิด `message_echo` · เคาะ: ใช้ echo จับ "แอดมินเข้าคุย → human_mode" ไหม (เทียบ mechanism เดิมของ LINE)
5. **สลิป/Blob** — เก็บรูปจาก CDN URL ลง Blob เดิม · เคาะ scope Blob ต่อเพจ (เข้า `PageContext`)
6. **config/ชีต ต่อเพจ** — วันนี้ 1 ชุด · ยืนยันว่า Messenger เพจแรกใช้ **config/Step/FAQ/Products ชุดเดียวกับ LINE** (สินค้า/ราคาเดียวกัน) — ถ้าใช่ mapping ยิ่งง่าย

---

## §6 · งานมือเจ้าของ (เรียงเป็นขั้น · ทำตอนจะ build)

**A. ก่อน dev (ปลดล็อกให้เทสได้):**
1. สร้าง **Meta App** (type Business) ที่ developers.facebook.com
2. เพิ่ม product **Messenger** → **Generate Page Access Token** ของเพจร้าน → เก็บ token
3. คัด **App Secret** (Settings → Basic) + ตั้ง **Verify Token** (สตริงอะไรก็ได้ที่เราตกลง)
4. ให้ **role Tester/Developer** กับบัญชี Facebook ที่จะใช้ทดสอบ (Roles tab) → **เทสได้เลยใน Development Mode**
5. ส่ง 4 ค่านี้ให้ระบบ (ENV): `META_PAGE_ID` `META_PAGE_ACCESS_TOKEN` `META_APP_SECRET` `META_VERIFY_TOKEN`

**B. หลัง build webhook (เชื่อมสาย):**
6. เอา **Callback URL** (`https://<domain>/api/meta-webhook`) + Verify Token ใส่ใน Messenger → Webhooks → **Verify and Save**
7. **Subscribe fields:** `messages`, `messaging_postbacks` (+ `message_echoes` ถ้าเคาะข้อ §5.4)
8. **Subscribe เพจ** เข้ากับแอป
9. เทส end-to-end กับบัญชี Tester (ยังไม่ต้องรีวิว)

**C. เปิดให้ลูกค้าจริง (ขนานกับ B ได้):**
10. ทำ **Business Verification** (Business Settings → Security Center) — เตรียมเอกสารธุรกิจ
11. ยื่น **App Review** ขอ **Advanced Access `pages_messaging`** — แนบวิดีโอ flow + คำอธิบาย + privacy policy
12. (ถ้าทำก้อน B นอก 24 ชม.) สร้าง **Utility Template** intent `post_purchase` + ขออนุมัติ
13. Publish app → ลูกค้าทั่วไปคุยกับบอทได้

---

## Sources (ค้น 2026-07-29 · เอกสาร Meta เป็นหลัก + สรุปชุมชนที่อ้างเอกสาร)
- [Messenger Platform — Changelog (Meta)](https://developers.facebook.com/docs/messenger-platform/changelog/)
- [Messenger Platform — messages webhook event (Meta)](https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages/)
- [Messenger Platform — Send API (Meta)](https://developers.facebook.com/docs/messenger-platform/reference/send-api/)
- [Messenger Platform — Quick Start (Meta)](https://developers.facebook.com/docs/messenger-platform/getting-started/quick-start/)
- [Messenger Platform — Message Tags (Meta)](https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags/)
- [How to send messages outside the 24-hour and 7-day windows — Manychat (อ้าง policy Meta)](https://help.manychat.com/hc/en-us/articles/14281199732892-How-to-send-messages-outside-the-24-hour-and-7-day-windows-in-Messenger-and-Instagram)
- [How To Comply with Facebook Messenger Rules in 2026 — Chatimize](https://chatimize.com/facebook-messenger-policy/)
- [Meta Advanced Access: Which Permissions Need App Review — singhamandeep](https://singhamandeep.com/what-is-meta-advanced-access/)
- [Messenger Bot App Review 2026 — singhamandeep](https://singhamandeep.com/facebook-messenger-bot-app-review-chatbot-saas/)
- [How test users work with Facebook Messenger Bots — Ross Wintle](https://rosswintle.uk/2019/11/how-test-users-work-with-facebook-messenger-bots/)

> ⚠️ **ก่อน build ต้องยืนยันสด (ตัวเลข/เวอร์ชันเปลี่ยนบ่อย):** Graph API version ปัจจุบัน (research นี้เห็น v25.0) · rate limit ตัวเลขจริงใน App Dashboard · ราคา/เงื่อนไข Utility Messages · ขั้นตอน business verification ล่าสุด — ทั้งหมดจากหน้า Meta โดยตรง (หน้า docs เป็น JS อาจต้องเปิดเบราว์เซอร์จริง)
