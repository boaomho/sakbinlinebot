import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { PendingOrder, LastOrder } from "./core/orders";
import { getTrainSandbox } from "./train/sandbox";

let sqlClient: NeonQueryFunction<false, false> | null = null;
let trainSqlClient: NeonQueryFunction<false, false> | null = null;
let schemaReady = false;
let trainSchemaReady = false;

/**
 * T-STUDIO: อยู่ใน sandbox (/train) → ใช้ DATABASE_URL_TRAIN (Neon branch แยก) — จุดเดียวจบ
 * ทุกฟังก์ชัน db ได้ SQL semantics จริงครบโดย prod ไม่ขยับ · เลขออเดอร์/ธง/counter แยก branch
 * 🔴 guard ตัดสินจาก ALS context เท่านั้น (เงื่อนไข ก) — ไม่มี context = production เดิมทุกบรรทัด
 */
function getSql(): NeonQueryFunction<false, false> {
  if (getTrainSandbox()) {
    if (!trainSqlClient) {
      if (!process.env.DATABASE_URL_TRAIN) {
        throw new Error("DATABASE_URL_TRAIN is not set (ห้องซ้อม /train ต้องมี Neon branch แยก)");
      }
      trainSqlClient = neon(process.env.DATABASE_URL_TRAIN);
    }
    return trainSqlClient;
  }
  if (!sqlClient) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

export async function ensureSchema(): Promise<void> {
  // ธง ready แยกต่อ connection (T-STUDIO) — migrate (ADD COLUMN IF NOT EXISTS ฯลฯ) รันอัตโนมัติ
  // กับ DB ที่กำลังต่อ ครั้งแรกที่แตะ → train branch ไม่ drift เอง ไม่ต้องรัน manual
  const inTrain = Boolean(getTrainSandbox());
  if (inTrain ? trainSchemaReady : schemaReady) return;
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS customers (
      user_id TEXT PRIMARY KEY,
      stage TEXT,
      tags TEXT[] NOT NULL DEFAULT '{}',
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      human_mode BOOLEAN NOT NULL DEFAULT false,
      human_mode_since TIMESTAMPTZ,
      is_returning BOOLEAN NOT NULL DEFAULT false,
      last_slip_pathname TEXT,
      display_name TEXT,
      resume_notice_pending BOOLEAN NOT NULL DEFAULT false,
      pending_order JSONB,
      has_written_order BOOLEAN NOT NULL DEFAULT false,
      paid_no_address_notified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_slip_pathname TEXT`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS display_name TEXT`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS resume_notice_pending BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS pending_order JSONB`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS has_written_order BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS paid_no_address_notified BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_id TEXT`;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order JSONB`; // D-32: snapshot ออเดอร์ที่เขียนแล้ว
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_locked BOOLEAN NOT NULL DEFAULT false`; // M=TRUE (ล็อกแล้ว)
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS intake_turns INTEGER NOT NULL DEFAULT 0`; // D-34: เทิร์นใน handoff_after_intake
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS delivered_steps TEXT[] NOT NULL DEFAULT '{}'`; // D-45b: step ที่ส่งเนื้อหา (ตัวอย่างคำตอบ) ไปแล้ว — กันโชว์ซ้ำ
  await sql`CREATE INDEX IF NOT EXISTS customers_last_seen_idx ON customers (last_seen DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages (user_id, created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS follow_log (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // 🔴 D-64: ตาราง order_counter เลิกใช้ — เลขออเดอร์ย้ายไป Apps Script บนชีต (คอลัมน์ A)
  //    ไม่ drop ของเดิมทิ้ง (DB ที่มีอยู่ปล่อยค้างไว้เฉย ๆ) · DB ใหม่จะไม่ถูกสร้าง

  // idempotency (Step 2 · D-29): บันทึก order_id ที่ "เขียนชีตสำเร็จแล้ว" เท่านั้น (source of truth = Neon ไม่ใช่ชีต)
  // 🔴 มีแถวนี้ = การันตีว่าเขียนสำเร็จ → ห้ามเขียนซ้ำ · "มี order_id ใน pending" ≠ เขียนสำเร็จ (append อาจล้ม)
  await sql`
    CREATE TABLE IF NOT EXISTS orders_written (
      order_id TEXT PRIMARY KEY,
      user_id TEXT,
      written_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS funnel_events (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS pending_messages (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      reply_token TEXT,
      at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS pending_messages_user_id_idx ON pending_messages (user_id, id)`;

  // รายการตัวเลือกชั่วคราวของคำสั่งแอดมิน (ชื่อซ้ำ/รายชื่อล่าสุด) — 1 แถวต่อ 1 กลุ่ม
  await sql`
    CREATE TABLE IF NOT EXISTS admin_pending_choices (
      group_id TEXT PRIMARY KEY,
      choices JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // D-50: idempotency แจ้งเลขพัสดุ (แบบเดียวกับ orders_written D-29) — มีแถว = แจ้งลูกค้าแล้ว ห้ามแจ้งซ้ำ
  await sql`
    CREATE TABLE IF NOT EXISTS shipping_notified (
      order_id TEXT PRIMARY KEY,
      notified_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  /**
   * D-69 · ai_usage — 1 แถวต่อ 1 การเรียก Gemini
   * 🔴 log ใน Vercel หายตามเวลา · หน้าสรุปต้นทุน (D-70) ต้องมีข้อมูลย้อนหลัง → เก็บที่นี่ตั้งแต่วันนี้
   * 🔴 call_kind สำคัญที่สุด: 'regen' = assurance guard ยิงซ้ำ = จ่ายสองเท่าในเทิร์นเดียว
   *    เจ้าของต้องเห็นว่าเกิดบ่อยแค่ไหน (ถ้าถี่ = ต้องจูน prompt ไม่ใช่จ่ายเพิ่ม)
   */
  await sql`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_id TEXT,
      channel TEXT,
      model TEXT NOT NULL,
      call_kind TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      candidates_tokens INTEGER NOT NULL DEFAULT 0,
      thoughts_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      degraded BOOLEAN NOT NULL DEFAULT false,
      stage TEXT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ai_usage_at_idx ON ai_usage (at DESC)`;

  // D-53: สวิตช์บอทราย channel — key "line" | "fb:<pageId>" · ไม่มีแถว = เปิด (default true)
  await sql`
    CREATE TABLE IF NOT EXISTS channel_switches (
      channel TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // T-STUDIO: state ของ session ห้องซ้อม (fake grid ออเดอร์ ฯลฯ) — ใช้จริงเฉพาะ train branch
  // สร้างทั้ง 2 DB (schema เหมือนกัน 100% กัน drift) · บน prod = ตารางว่างเฉยๆ ไม่มีใครเขียน
  await sql`
    CREATE TABLE IF NOT EXISTS train_sessions (
      session_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  if (inTrain) trainSchemaReady = true;
  else schemaReady = true;
}

export interface CustomerState {
  userId: string;
  stage: string | null;
  tags: string[];
  lastSeen: Date;
  humanMode: boolean;
  humanModeSince: Date | null;
  isReturning: boolean;
  lastSlipPathname: string | null;
  displayName: string | null;
  resumeNoticePending: boolean;
  pendingOrder: PendingOrder;
  hasWrittenOrder: boolean;
  paidNoAddressNotified: boolean;
  /** order_id ของออเดอร์ล่าสุดที่เขียนชีตสำเร็จ — ใช้แก้แถวเดิมตอนลูกค้าขอแก้ (D-31) */
  lastOrderId: string | null;
  /** snapshot ออเดอร์ที่เขียนแล้ว (แยกจาก pending · D-32) — จำไว้แก้/ทวน · null = ไม่มี */
  lastOrder: LastOrder | null;
  /** ออเดอร์ล่าสุดถูกคอนเฟิร์ม (M=TRUE) แล้ว → ห้ามแก้อัตโนมัติ (ค้นพบตอน updateOrderRow) */
  lastOrderLocked: boolean;
  /** เทิร์นที่อยู่ในประตู handoff_after_intake ต่อเนื่อง (D-34) — 0 = ไม่ได้อยู่ · ใช้เช็คเพดานกันค้าง */
  intakeTurns: number;
  /** D-45b: step_id ที่ "ส่งเนื้อหา (ตัวอย่างคำตอบ) ไปแล้ว" — เคยส่ง = ส่งเฉพาะปิดท้าย (กันโชว์ตารางโปรซ้ำ) */
  deliveredSteps: string[];
  createdAt: Date;
}

function rowToCustomer(r: Record<string, unknown>): CustomerState {
  return {
    userId: r.user_id as string,
    stage: (r.stage as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? [],
    lastSeen: r.last_seen as Date,
    lastSlipPathname: (r.last_slip_pathname as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    resumeNoticePending: Boolean(r.resume_notice_pending),
    pendingOrder: (r.pending_order as PendingOrder | null) ?? {},
    hasWrittenOrder: Boolean(r.has_written_order),
    paidNoAddressNotified: Boolean(r.paid_no_address_notified),
    lastOrderId: (r.last_order_id as string | null) ?? null,
    lastOrder: (r.last_order as LastOrder | null) ?? null,
    lastOrderLocked: Boolean(r.last_order_locked),
    intakeTurns: Number(r.intake_turns) || 0,
    deliveredSteps: (r.delivered_steps as string[] | null) ?? [],
    humanMode: Boolean(r.human_mode),
    humanModeSince: (r.human_mode_since as Date | null) ?? null,
    isReturning: Boolean(r.is_returning),
    createdAt: r.created_at as Date,
  };
}

export async function getCustomer(userId: string): Promise<CustomerState | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM customers WHERE user_id = ${userId}`;
  if (rows.length === 0) return null;
  return rowToCustomer(rows[0] as Record<string, unknown>);
}

/** สร้างลูกค้าใหม่ถ้ายังไม่มี, อัปเดต last_seen/is_returning เสมอ, คืนสถานะล่าสุด */
export async function ensureCustomer(userId: string): Promise<CustomerState> {
  await ensureSchema();
  const sql = getSql();
  const existing = await getCustomer(userId);

  if (existing) {
    await sql`UPDATE customers SET last_seen = now(), is_returning = true WHERE user_id = ${userId}`;
    return { ...existing, isReturning: true };
  }

  await sql`
    INSERT INTO customers (user_id, is_returning)
    VALUES (${userId}, false)
    ON CONFLICT (user_id) DO NOTHING
  `;
  const created = await getCustomer(userId);
  return created ?? { ...emptyCustomer(userId) };
}

function emptyCustomer(userId: string): CustomerState {
  return {
    userId,
    stage: null,
    tags: [],
    lastSeen: new Date(),
    humanMode: false,
    humanModeSince: null,
    isReturning: false,
    lastSlipPathname: null,
    displayName: null,
    resumeNoticePending: false,
    pendingOrder: {},
    hasWrittenOrder: false,
    paidNoAddressNotified: false,
    lastOrderId: null,
    lastOrder: null,
    lastOrderLocked: false,
    intakeTurns: 0,
    deliveredSteps: [],
    createdAt: new Date(),
  };
}

export async function updateCustomerAfterTurn(
  userId: string,
  opts: { stage?: string; tagsAdd?: string[]; intakeTurns?: number },
): Promise<void> {
  await ensureSchema();
  const sql = getSql();

  const intake = opts.intakeTurns ?? 0; // D-34: นับเทิร์นใน handoff_after_intake (0 = ไม่ได้อยู่/ออกแล้ว)
  if (opts.stage) {
    await sql`UPDATE customers SET stage = ${opts.stage}, intake_turns = ${intake}, last_seen = now() WHERE user_id = ${userId}`;
  } else {
    await sql`UPDATE customers SET intake_turns = ${intake}, last_seen = now() WHERE user_id = ${userId}`;
  }

  if (opts.tagsAdd && opts.tagsAdd.length > 0) {
    await sql`
      UPDATE customers
      SET tags = ARRAY(SELECT DISTINCT unnest(tags || ${opts.tagsAdd}::text[]))
      WHERE user_id = ${userId}
    `;
  }
}

/**
 * เข้า/ออกโหมดแอดมินดูแลเอง (human_mode) ต่อ 1 ลูกค้า
 * on=true → arm resume_notice_pending ด้วย (ให้บอทเกริ่นประโยคเปลี่ยนมือ 1 ครั้งตอนกลับมา)
 * on=false → ไม่แตะ flag (คงไว้ให้ส่งประโยคตอนลูกค้าพิมพ์ครั้งถัดไป)
 */
export async function setHumanMode(userId: string, on: boolean): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  if (on) {
    await sql`
      UPDATE customers
      SET human_mode = true, human_mode_since = now(), resume_notice_pending = true
      WHERE user_id = ${userId}
    `;
  } else {
    await sql`UPDATE customers SET human_mode = false, human_mode_since = NULL WHERE user_id = ${userId}`;
  }
}

/** ปิด/เปิดบอทยกกลุ่ม (ทุกลูกค้า) — คืนจำนวนที่เปลี่ยนสถานะจริง */
export async function setHumanModeAll(on: boolean): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  if (on) {
    const rows = await sql`
      UPDATE customers
      SET human_mode = true, human_mode_since = now(), resume_notice_pending = true
      WHERE human_mode = false
      RETURNING user_id
    `;
    return rows.length;
  }
  const rows = await sql`
    UPDATE customers
    SET human_mode = false, human_mode_since = NULL
    WHERE human_mode = true
    RETURNING user_id
  `;
  return rows.length;
}

export async function clearResumeNotice(userId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE customers SET resume_notice_pending = false WHERE user_id = ${userId}`;
}

/** อัปเดตชื่อ LINE ที่เก็บไว้ (ใช้ค้นหาในคำสั่งแอดมิน) — เรียกเมื่อได้ชื่อจริงจาก LINE profile */
export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE customers SET display_name = ${displayName} WHERE user_id = ${userId}`;
}

export interface CustomerBrief {
  userId: string;
  displayName: string | null;
  lastSeen: Date;
  humanMode: boolean;
}

function rowToBrief(r: Record<string, unknown>): CustomerBrief {
  return {
    userId: r.user_id as string,
    displayName: (r.display_name as string | null) ?? null,
    lastSeen: r.last_seen as Date,
    humanMode: Boolean(r.human_mode),
  };
}

/** ดึงลูกค้าที่มีชื่อ (ไว้ค้นแบบยืดหยุ่นในโค้ด) เรียงคุยล่าสุดก่อน จำกัดจำนวนกันดึงเยอะเกิน */
export async function getCustomersWithName(limit = 500): Promise<CustomerBrief[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT user_id, display_name, last_seen, human_mode FROM customers
    WHERE display_name IS NOT NULL AND display_name <> ''
    ORDER BY last_seen DESC
    LIMIT ${limit}
  `;
  return (rows as Array<Record<string, unknown>>).map(rowToBrief);
}

/** ลูกค้าที่คุยล่าสุด N คน (คำสั่ง "รายชื่อล่าสุด") */
export async function getRecentCustomers(limit = 10): Promise<CustomerBrief[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT user_id, display_name, last_seen, human_mode FROM customers
    ORDER BY last_seen DESC
    LIMIT ${limit}
  `;
  return (rows as Array<Record<string, unknown>>).map(rowToBrief);
}

// ---- admin pending choices (ชื่อซ้ำ / รายชื่อล่าสุด · หมดอายุ 1 นาที) ----

export interface PendingChoice {
  n: number;
  userId: string;
  name: string;
}

export async function savePendingChoices(groupId: string, choices: PendingChoice[]): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO admin_pending_choices (group_id, choices, created_at)
    VALUES (${groupId}, ${JSON.stringify(choices)}::jsonb, now())
    ON CONFLICT (group_id) DO UPDATE SET choices = EXCLUDED.choices, created_at = now()
  `;
}

/** คืนรายการตัวเลือกถ้ายังไม่หมดอายุ (ภายใน maxAgeMs) · หมดอายุ/ไม่มี → null */
export async function getPendingChoices(groupId: string, maxAgeMs: number): Promise<PendingChoice[] | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT choices, created_at FROM admin_pending_choices WHERE group_id = ${groupId}`;
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  const createdAt = new Date(row.created_at as string).getTime();
  if (Date.now() - createdAt > maxAgeMs) return null;
  const choices = row.choices as PendingChoice[];
  return Array.isArray(choices) ? choices : null;
}

export async function clearPendingChoices(groupId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM admin_pending_choices WHERE group_id = ${groupId}`;
}

export async function setLastSlipPathname(userId: string, pathname: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  // deterministic เมื่อลูกค้าส่งสลิปหลายใบพร้อมกัน (หลาย invocation แข่งเขียน):
  // GREATEST เก็บ pathname ที่มากกว่า = ใบล่าสุด (timestamp ในชื่อไฟล์สูงกว่า → string สูงกว่า)
  // GREATEST ข้าม NULL ให้เอง (ค่าเดิม NULL → ได้ pathname ใหม่)
  await sql`
    UPDATE customers
    SET last_slip_pathname = GREATEST(last_slip_pathname, ${pathname})
    WHERE user_id = ${userId}
  `;
}

// ---- ออเดอร์: pending_order (สะสมข้ามเทิร์น) + gate flags + waiting tags ----

/**
 * merge ข้อมูลเทิร์นนี้ลง pending_order — คืน pending หลัง merge
 * - ช่องข้อความ (ชื่อ/ที่อยู่/เบอร์/การชำระเงิน): ทับเฉพาะที่ไม่ว่าง · ไม่ส่ง = คงเดิม
 * - items: ทับเฉพาะเมื่อส่ง array "ไม่ว่าง" มา (ลูกค้าเปลี่ยน/เพิ่มรายการ)
 *   🔴 D-15 rule: items ว่าง = AI แค่ไม่พูดถึงซ้ำ ≠ ยกเลิก → คง items เดิมไว้ (ห้าม wipe เงียบ)
 *   การยกเลิก/เปลี่ยนใจต้องมาจากข้อความชัดเจน จัดการทางอื่น ไม่ใช่จาก field ที่ AI ลืมส่ง
 */
export async function mergePendingOrder(userId: string, fields: PendingOrder): Promise<PendingOrder> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT pending_order FROM customers WHERE user_id = ${userId}`;
  const existing = ((rows[0] as Record<string, unknown> | undefined)?.pending_order as PendingOrder | null) ?? {};
  const merged: PendingOrder = { ...existing };
  for (const k of ["ชื่อ", "ที่อยู่", "เบอร์", "การชำระเงิน"] as const) {
    const v = fields[k];
    if (typeof v === "string" && v.trim() !== "") merged[k] = v.trim();
  }
  if (Array.isArray(fields.items) && fields.items.length > 0) merged.items = fields.items;
  // order_id: set ครั้งเดียวตอนยังไม่มี (เสถียรข้าม retry) · ห้ามทับของเดิม
  if (typeof fields.order_id === "string" && fields.order_id.trim() && !merged.order_id) {
    merged.order_id = fields.order_id.trim();
  }
  await sql`UPDATE customers SET pending_order = ${JSON.stringify(merged)}::jsonb WHERE user_id = ${userId}`;
  return merged;
}

/** จำ snapshot ออเดอร์ที่เขียนชีตสำเร็จล่าสุด (D-32) — แก้แถวเดิม/ทวน/ประกอบที่อยู่ใหม่ · reset lock */
export async function setLastOrder(userId: string, order: LastOrder): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE customers
    SET last_order_id = ${order.order_id}, last_order = ${JSON.stringify(order)}::jsonb, last_order_locked = false
    WHERE user_id = ${userId}
  `;
}

/** ค้นพบว่าออเดอร์ล่าสุดถูกคอนเฟิร์ม (M=TRUE) แล้ว → ล็อก (ห้ามแก้อัตโนมัติต่อ · D-32) */
export async function setLastOrderLocked(userId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE customers SET last_order_locked = true WHERE user_id = ${userId}`;
}

/** D-45b: ติดธงว่า step นี้ "ส่งเนื้อหา (ตัวอย่างคำตอบ) ไปแล้ว" — เรียกหลัง deliver สำเร็จเท่านั้น · กันซ้ำในตัว */
export async function addDeliveredStep(userId: string, stepId: string): Promise<void> {
  if (!stepId) return;
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE customers SET delivered_steps = array_append(delivered_steps, ${stepId})
    WHERE user_id = ${userId} AND NOT (${stepId} = ANY(delivered_steps))
  `;
}

/**
 * D-45b: ล้างธง delivered_steps เมื่อ "ออเดอร์ปิดจบ" — คงเฉพาะ step ปัจจุบันของลูกค้า (กัน resend ทันที)
 * 🔴 v1 hook = จังหวะ cron แจกเลขออเดอร์ (จุดเดิมที่ระบบถือว่าจบ flow ขาย · ห้ามประดิษฐ์ event ใหม่)
 *    เฟสหลังการขาย (Follow CRM) จะย้าย/เพิ่มจุดล้างตามสัญญาณ "ได้รับของจริง" ได้
 */
export async function clearDeliveredStepsExceptCurrent(userId: string): Promise<void> {
  if (!userId) return;
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE customers
    SET delivered_steps = CASE WHEN stage IS NOT NULL AND stage = ANY(delivered_steps) THEN ARRAY[stage] ELSE '{}' END
    WHERE user_id = ${userId}
  `;
}

/** idempotency: order_id นี้เขียนชีตสำเร็จแล้วหรือยัง (source of truth = Neon · เร็ว มี index · ไม่กิน Sheets quota) */
export async function isOrderWritten(orderId: string): Promise<boolean> {
  if (!orderId) return false;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT 1 FROM orders_written WHERE order_id = ${orderId} LIMIT 1`;
  return rows.length > 0;
}

/** บันทึกว่า order_id เขียนชีตสำเร็จแล้ว — เรียกหลัง appendOrderRow คืน ok เท่านั้น (ON CONFLICT กันซ้ำ) */
export async function markOrderWritten(orderId: string, userId: string): Promise<void> {
  if (!orderId) return;
  await ensureSchema();
  const sql = getSql();
  await sql`INSERT INTO orders_written (order_id, user_id) VALUES (${orderId}, ${userId}) ON CONFLICT (order_id) DO NOTHING`;
}

/** ออเดอร์สมบูรณ์ขึ้นชีตแล้ว → ล้าง pending_order + สลิป พร้อมกัน */
export async function clearPendingOrderAndSlip(userId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE customers SET pending_order = NULL, last_slip_pathname = NULL WHERE user_id = ${userId}`;
}

export async function setHasWrittenOrder(userId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE customers SET has_written_order = true WHERE user_id = ${userId}`;
}

export async function setPaidNoAddressNotified(userId: string, value: boolean): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE customers SET paid_no_address_notified = ${value} WHERE user_id = ${userId}`;
}

/** ปรับแท็กรอ: ลบ "รอโอน"/"รอที่อยู่" เดิมออกทั้งคู่ แล้วใส่ตัวที่ต้องมี (keep) · keep=null = ไม่มีแท็กรอ */
export async function reconcileWaitTags(userId: string, keep: "รอโอน" | "รอที่อยู่" | null): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const keepArr = keep ? [keep] : [];
  await sql`
    UPDATE customers
    SET tags = ARRAY(SELECT DISTINCT unnest(array_remove(array_remove(tags, 'รอโอน'), 'รอที่อยู่') || ${keepArr}::text[]))
    WHERE user_id = ${userId}
  `;
}

/**
 * คำสั่งเทสต์ /reset — ล้างความจำเฉพาะ userId ที่พิมพ์เข้ามาเท่านั้น (สถานะ/stage/tags/
 * last_slip_pathname + ประวัติแชท) รวมถึง pending_messages ค้างของ user นั้น กันข้อความ
 * เก่าที่ debounce ค้างอยู่มาเขียนทับหลัง reset
 *
 * 🔴 ล้าง human_mode/resume_notice ด้วย (เปลี่ยนจากเดิมที่ตั้งใจไม่แตะ): /reset เป็นคำสั่ง "เทสต์"
 *    (ปิดตอนขายจริงด้วย testCommandsEnabled) → คนเทสรีเซ็ต session ตัวเอง · เดิมพอเทสชน handoff
 *    แล้ว /reset ไม่คืนบอท = บอทเงียบสนิท เข้าใจผิดว่าระบบล่ม เสียเวลา debug (จริง ๆ ถูกปิดอยู่)
 */
export async function resetCustomerMemory(userId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE customers
    SET stage = NULL, tags = '{}', last_slip_pathname = NULL,
        pending_order = NULL, has_written_order = false, paid_no_address_notified = false,
        human_mode = false, human_mode_since = NULL, resume_notice_pending = false,
        last_order_id = NULL, last_order = NULL, last_order_locked = false,
        intake_turns = 0, delivered_steps = '{}'
    WHERE user_id = ${userId}
  `;
  await sql`DELETE FROM messages WHERE user_id = ${userId}`;
  await sql`DELETE FROM pending_messages WHERE user_id = ${userId}`;
}

export async function addMessage(userId: string, role: "user" | "assistant", text: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`INSERT INTO messages (user_id, role, text) VALUES (${userId}, ${role}, ${text})`;
}

export interface HistoryTurn {
  role: string;
  text: string;
  createdAt: Date;
}

export async function getRecentHistory(userId: string, limit = 20): Promise<HistoryTurn[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT role, text, created_at FROM messages
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return (rows as Array<Record<string, unknown>>)
    .reverse()
    .map((r) => ({ role: r.role as string, text: r.text as string, createdAt: r.created_at as Date }));
}

export function formatHistoryForPrompt(history: HistoryTurn[]): string {
  if (history.length === 0) return "(ยังไม่มีประวัติสนทนา)";
  return history.map((h) => `${h.role === "user" ? "ลูกค้า" : "บอท"}: ${h.text}`).join("\n");
}

// ---- debounce / pending_messages ----

export async function insertPendingMessage(
  userId: string,
  text: string,
  replyToken: string | null,
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO pending_messages (user_id, text, reply_token)
    VALUES (${userId}, ${text}, ${replyToken})
    RETURNING id
  `;
  return Number((rows[0] as Record<string, unknown>).id);
}

export async function getLatestPendingId(userId: string): Promise<number | null> {
  const sql = getSql();
  const rows = await sql`SELECT MAX(id) AS max_id FROM pending_messages WHERE user_id = ${userId}`;
  const maxId = (rows[0] as Record<string, unknown>)?.max_id;
  return maxId === null || maxId === undefined ? null : Number(maxId);
}

export async function collectAndClearPendingMessages(
  userId: string,
): Promise<{ text: string; replyToken: string | null }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, text, reply_token FROM pending_messages
    WHERE user_id = ${userId}
    ORDER BY id ASC
  `) as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return { text: "", replyToken: null };
  }

  const ids = rows.map((r) => Number(r.id));
  await sql`DELETE FROM pending_messages WHERE id = ANY(${ids}::bigint[])`;

  const text = rows.map((r) => r.text as string).join("\n");
  const lastReplyToken = (rows[rows.length - 1].reply_token as string | null) ?? null;
  return { text, replyToken: lastReplyToken };
}

/**
 * ลูกค้าที่เงียบเกิน N วัน (นับจาก last_seen) และไม่ได้อยู่ในโหมดแอดมินดูแล
 * — ใช้กับ Follow ที่ชีตจริงกำหนดเป็น "รอกี่วัน" (ไม่มีคอลัมน์ประตู/stage)
 */
export async function getStaleCustomers(days: number): Promise<string[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT user_id FROM customers
    WHERE human_mode = false
      AND last_seen < now() - (${days}::text || ' days')::interval
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => r.user_id as string);
}

// ---- follow ----

export async function hasFollowedRecently(userId: string, ruleName: string, sinceHours: number): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT 1 FROM follow_log
    WHERE user_id = ${userId} AND rule_name = ${ruleName}
      AND sent_at > now() - (${sinceHours}::text || ' hours')::interval
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function logFollowSent(userId: string, ruleName: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`INSERT INTO follow_log (user_id, rule_name) VALUES (${userId}, ${ruleName})`;
}

// ---- funnel ----

export async function logFunnelEvent(
  userId: string,
  fromStage: string | null,
  toStage: string | null,
): Promise<void> {
  if (!toStage || fromStage === toStage) return;
  await ensureSchema();
  const sql = getSql();
  await sql`INSERT INTO funnel_events (user_id, from_stage, to_stage) VALUES (${userId}, ${fromStage}, ${toStage})`;
}

// ---- D-50: แจ้งเลขพัสดุ (idempotent · atomic claim กัน cron รันซ้อนแจ้งซ้ำ) ----

/** เคลมสิทธิ์แจ้งพัสดุออเดอร์นี้ (atomic) — คืน true = เพิ่งเคลม (ให้แจ้ง) · false = เคยแจ้ง/เคลมแล้ว (ข้าม) */
export async function markShippingNotified(orderId: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO shipping_notified (order_id) VALUES (${orderId})
    ON CONFLICT (order_id) DO NOTHING
    RETURNING order_id
  `;
  return rows.length > 0;
}

/** T2-ฉ: order_id ที่แจ้งพัสดุลูกค้าแล้ว (read-only · filter ตามชุดที่ส่งมา · ว่าง→Set ว่าง) */
export async function listNotifiedOrderIds(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT order_id FROM shipping_notified WHERE order_id = ANY(${orderIds}::text[])`;
  return new Set(rows.map((r) => (r as { order_id: string }).order_id));
}

// ---- T2-ก: Dashboard reads (อ่าน PROD อย่างเดียว · ไม่มี write/คอลัมน์ใหม่ · TRAIN: ตัดออกจากสรุป) ----

export interface DashboardCounts { newLine: number; newFb: number; returning: number; handoffPending: number }

/** ตัวเลขสรุปแถวบน (ช่วง start→now) · 🔴 ไม่นับ TRAIN: (ต้องเป็นของจริงล้วน) */
export async function dashboardSummaryCounts(start: Date): Promise<DashboardCounts> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      count(*) FILTER (WHERE created_at >= ${start} AND user_id LIKE 'fb:%')      AS new_fb,
      count(*) FILTER (WHERE created_at >= ${start} AND user_id NOT LIKE 'fb:%')  AS new_line,
      count(*) FILTER (WHERE last_seen >= ${start} AND created_at < ${start})     AS returning_c,
      count(*) FILTER (WHERE human_mode)                                          AS handoff_pending
    FROM customers
    WHERE user_id NOT LIKE 'TRAIN:%'
  `;
  const r = (rows[0] ?? {}) as Record<string, unknown>;
  return { newLine: Number(r.new_line ?? 0), newFb: Number(r.new_fb ?? 0), returning: Number(r.returning_c ?? 0), handoffPending: Number(r.handoff_pending ?? 0) };
}

export interface DashboardCustomerRow {
  userId: string; displayName: string | null; stage: string | null;
  lastSeen: Date; humanMode: boolean; createdAt: Date; hasOrder: boolean; turns: number;
}

/** แถวตารางลูกค้า — 🔴 aggregate turn count ครั้งเดียว (กัน N+1) + LIMIT เสมอ */
export async function dashboardCustomerRows(includeTrain: boolean, limit = 300): Promise<DashboardCustomerRow[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT c.user_id, c.display_name, c.stage, c.last_seen, c.human_mode, c.created_at,
           (c.last_order IS NOT NULL OR c.last_order_id IS NOT NULL) AS has_order,
           COALESCE(m.turns, 0) AS turns
    FROM customers c
    LEFT JOIN (SELECT user_id, count(*) AS turns FROM messages WHERE role = 'user' GROUP BY user_id) m
      ON m.user_id = c.user_id
    WHERE ${includeTrain} OR c.user_id NOT LIKE 'TRAIN:%'
    ORDER BY c.last_seen DESC
    LIMIT ${limit}
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    userId: r.user_id as string,
    displayName: (r.display_name as string | null) ?? null,
    stage: (r.stage as string | null) ?? null,
    lastSeen: r.last_seen as Date,
    humanMode: Boolean(r.human_mode),
    createdAt: r.created_at as Date,
    hasOrder: Boolean(r.has_order),
    turns: Number(r.turns ?? 0),
  }));
}

/** ออเดอร์ที่ปิด (won · เขียนชีตสำเร็จ) ตั้งแต่ start — ใช้ join กับยอดในชีตเพื่อรวมยอดขาย · 🔴 ไม่นับ TRAIN: */
export async function wonOrdersSince(start: Date): Promise<{ orderId: string; userId: string }[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT order_id, user_id FROM orders_written WHERE written_at >= ${start} AND user_id NOT LIKE 'TRAIN:%'`;
  return (rows as Array<Record<string, unknown>>).map((r) => ({ orderId: r.order_id as string, userId: (r.user_id as string | null) ?? "" }));
}

// ---- D-53: สวิตช์บอทราย channel ----

/** เปิด/ปิดบอทของ channel (key "line" | "fb:<pageId>") · upsert */
export async function setChannelEnabled(channel: string, enabled: boolean): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO channel_switches (channel, enabled, updated_at) VALUES (${channel}, ${enabled}, now())
    ON CONFLICT (channel) DO UPDATE SET enabled = ${enabled}, updated_at = now()
  `;
}

/** channel เปิดอยู่ไหม · ไม่มีแถว = เปิด (default true) */
export async function isChannelEnabled(channel: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT enabled FROM channel_switches WHERE channel = ${channel}`;
  if (rows.length === 0) return true;
  return Boolean((rows[0] as { enabled: boolean }).enabled);
}

// 🔴 D-64: ลบ `nextOrderNumber` + ตาราง order_counter — เลขออเดอร์ย้ายไป Apps Script บนชีต (คอลัมน์ A)
//    ปิด KI-05 ไปในตัว (ไม่มี loop แจกเลขใน cron ให้รันซ้อนกันอีกแล้ว)

// ---- T-STUDIO: state ของ session ห้องซ้อม (เรียกจากใน sandbox เท่านั้น → เขียนลง train branch) ----

export interface TrainSessionData {
  orderRows: string[][];
  slipCounter: number;
}

export async function loadTrainSession(sessionId: string): Promise<TrainSessionData | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT data FROM train_sessions WHERE session_id = ${sessionId}`;
  if (rows.length === 0) return null;
  return (rows[0] as Record<string, unknown>).data as TrainSessionData;
}

export async function saveTrainSession(sessionId: string, data: TrainSessionData): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO train_sessions (session_id, data, updated_at) VALUES (${sessionId}, ${JSON.stringify(data)}::jsonb, now())
    ON CONFLICT (session_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `;
}

export async function deleteTrainSession(sessionId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM train_sessions WHERE session_id = ${sessionId}`;
}

// ---- D-69 · บันทึกการเรียก Gemini (ต้นทุน/ความเร็ว) ----

/** ประเภทการเรียก — 🔴 'regen' = assurance guard ยิงซ้ำ (จ่ายสองเท่าในเทิร์นเดียว) */
export type AiCallKind = "main" | "regen" | "extraction" | "assistant"; // D-75: ผู้ช่วยเทรน — เห็นต้นทุนแยก

export interface AiUsageRow {
  userId: string | null;
  channel: string | null;
  model: string;
  callKind: AiCallKind;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
  latencyMs: number;
  degraded: boolean;
  stage: string | null;
}

/**
 * เขียน 1 แถวต่อ 1 การเรียก — 🔴 **ห้ามบล็อกการตอบลูกค้า**
 * เขียนพลาด (DB ล่ม/ตารางยังไม่มี) = log warning แล้วผ่านไป บอทต้องตอบต่อได้เสมอ
 */
export async function recordAiUsage(row: AiUsageRow): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return; // ไม่มี DB = ข้ามเงียบ (พฤติกรรมเดิม)
    await ensureSchema();
    const sql = getSql();
    await sql`
      INSERT INTO ai_usage (user_id, channel, model, call_kind, prompt_tokens, candidates_tokens, thoughts_tokens, cached_tokens, latency_ms, degraded, stage)
      VALUES (${row.userId}, ${row.channel}, ${row.model}, ${row.callKind}, ${row.promptTokens}, ${row.candidatesTokens},
              ${row.thoughtsTokens}, ${row.cachedTokens}, ${row.latencyMs}, ${row.degraded}, ${row.stage})
    `;
  } catch (error) {
    console.warn(JSON.stringify({ scope: "ai-usage", warning: "บันทึกไม่สำเร็จ (ไม่กระทบการตอบลูกค้า)", error: String(error).slice(0, 120) }));
  }
}

// ---- D-70: อ่าน ai_usage สำหรับหน้าต้นทุน (read-only · จำนวน query คงที่ · ไม่ N+1) ----

export interface AiUsageDailyRow {
  /** วันแบบเวลาไทย "YYYY-MM-DD" — 🔴 ai_usage.at เก็บ UTC → shift +7 ก่อนตัดวัน (ไม่งั้นยอด "วันนี้" เพี้ยน 7 ชม.) */
  day: string;
  callKind: string;
  model: string;
  calls: number;
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  cachedTokens: number;
}

/**
 * รวม ai_usage ต่อ (วันไทย × call_kind × model) ตั้งแต่ start — **1 query**
 * แยกตาม model เพราะราคาต่างกัน (ผู้เรียกคำนวณเงินจากตารางราคาแหล่งเดียวใน gemini.ts)
 */
export async function aiUsageDaily(start: Date): Promise<AiUsageDailyRow[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT to_char(at + interval '7 hours', 'YYYY-MM-DD') AS day,
           call_kind, model,
           count(*)                     AS calls,
           sum(prompt_tokens)           AS prompt_tokens,
           sum(candidates_tokens)       AS candidates_tokens,
           sum(thoughts_tokens)         AS thoughts_tokens,
           sum(cached_tokens)           AS cached_tokens
    FROM ai_usage
    WHERE at >= ${start}
    GROUP BY 1, 2, 3
    ORDER BY 1
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    day: r.day as string,
    callKind: (r.call_kind as string | null) ?? "",
    model: (r.model as string | null) ?? "",
    calls: Number(r.calls ?? 0),
    promptTokens: Number(r.prompt_tokens ?? 0),
    candidatesTokens: Number(r.candidates_tokens ?? 0),
    thoughtsTokens: Number(r.thoughts_tokens ?? 0),
    cachedTokens: Number(r.cached_tokens ?? 0),
  }));
}

/**
 * ลูกค้าที่บอทคุยต่อวันไทย (distinct user_id) — **1 query** แยกจาก aiUsageDaily
 * เพราะ distinct ข้าม model/call_kind รวมกันไม่ได้ (บวกกันแล้วนับซ้ำ)
 * 🔴 ไม่นับ channel 'train' (ห้องซ้อม/ผู้ช่วยเทรน) และ user_id ว่าง
 */
export async function aiUsageDailyCustomers(start: Date): Promise<{ day: string; customers: number }[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT to_char(at + interval '7 hours', 'YYYY-MM-DD') AS day,
           count(DISTINCT user_id) AS customers
    FROM ai_usage
    WHERE at >= ${start}
      AND user_id IS NOT NULL
      AND (channel IS NULL OR channel <> 'train')
    GROUP BY 1
    ORDER BY 1
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({ day: r.day as string, customers: Number(r.customers ?? 0) }));
}

/**
 * 🔴 D-77: ล้าง snapshot ออเดอร์หลัง "ยกเลิกสำเร็จ" — ชีตคือความจริง (แถวยังอยู่ N=TRUE · แชทไม่ควรทวน/แก้ต่อ)
 * ล้างเฉพาะ snapshot + ธง lock — history/orders_written คงเดิม (รอยเท้าครบ) · ขอแก้อีกครั้ง = หาไม่เจอ → handoff (ทิศปลอดภัย)
 */
export async function clearLastOrder(userId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE customers SET last_order = NULL, last_order_locked = false WHERE user_id = ${userId}`;
}
