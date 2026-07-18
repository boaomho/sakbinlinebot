import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import { PendingOrder } from "./core/orders";

let sqlClient: NeonQueryFunction<false, false> | null = null;
let schemaReady = false;

function getSql(): NeonQueryFunction<false, false> {
  if (!sqlClient) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    sqlClient = neon(process.env.DATABASE_URL);
  }
  return sqlClient;
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
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

  await sql`
    CREATE TABLE IF NOT EXISTS order_counter (
      day DATE PRIMARY KEY,
      last_no INTEGER NOT NULL DEFAULT 0
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

  schemaReady = true;
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
    createdAt: new Date(),
  };
}

export async function updateCustomerAfterTurn(
  userId: string,
  opts: { stage?: string; tagsAdd?: string[] },
): Promise<void> {
  await ensureSchema();
  const sql = getSql();

  if (opts.stage) {
    await sql`UPDATE customers SET stage = ${opts.stage}, last_seen = now() WHERE user_id = ${userId}`;
  } else {
    await sql`UPDATE customers SET last_seen = now() WHERE user_id = ${userId}`;
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
  await sql`UPDATE customers SET pending_order = ${JSON.stringify(merged)}::jsonb WHERE user_id = ${userId}`;
  return merged;
}

/** ออเดอร์สมบูรณ์ขึ้นชีตแล้ว → ล้าง pending_order + สลิป พร้อมกัน (ทั้งคู่อยู่ในชีตแล้ว) */
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
 * เก่าที่ debounce ค้างอยู่มาเขียนทับหลัง reset ไม่แตะ human_mode เพราะเป็นคนละเรื่องกับ
 * ความจำการขาย (ไม่ควรแย่งสิทธิ์แอดมินคืนเองจากคำสั่งเทสต์)
 */
export async function resetCustomerMemory(userId: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE customers
    SET stage = NULL, tags = '{}', last_slip_pathname = NULL,
        pending_order = NULL, has_written_order = false, paid_no_address_notified = false
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

// ---- order counter (atomic) ----

/** แจกเลขออเดอร์ถัดไปของวันนั้นแบบ atomic กัน cron รันซ้อนแจกเลขซ้ำ */
export async function nextOrderNumber(day: string): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO order_counter (day, last_no) VALUES (${day}, 1)
    ON CONFLICT (day) DO UPDATE SET last_no = order_counter.last_no + 1
    RETURNING last_no
  `;
  return Number((rows[0] as Record<string, unknown>).last_no);
}
