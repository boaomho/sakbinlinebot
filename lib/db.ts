import { neon, NeonQueryFunction } from "@neondatabase/serverless";

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_slip_pathname TEXT`;
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
  createdAt: Date;
}

function rowToCustomer(r: Record<string, unknown>): CustomerState {
  return {
    userId: r.user_id as string,
    stage: (r.stage as string | null) ?? null,
    tags: (r.tags as string[] | null) ?? [],
    lastSeen: r.last_seen as Date,
    lastSlipPathname: (r.last_slip_pathname as string | null) ?? null,
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

export async function setHumanMode(userId: string, on: boolean): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  if (on) {
    await sql`UPDATE customers SET human_mode = true, human_mode_since = now() WHERE user_id = ${userId}`;
  } else {
    await sql`UPDATE customers SET human_mode = false, human_mode_since = NULL WHERE user_id = ${userId}`;
  }
}

export async function setLastSlipPathname(userId: string, pathname: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`UPDATE customers SET last_slip_pathname = ${pathname} WHERE user_id = ${userId}`;
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
    SET stage = NULL, tags = '{}', last_slip_pathname = NULL
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
