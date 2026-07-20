import { neon } from "@neondatabase/serverless";
import { ensureSchema } from "@/lib/db";

/** ทุกตารางที่ lib/db สร้าง (ensureSchema) — harness ล้างทั้งหมดต่อบท */
const TABLES = [
  "customers",
  "messages",
  "follow_log",
  "order_counter",
  "funnel_events",
  "pending_messages",
  "admin_pending_choices",
  "orders_written",
];

/**
 * 🔴 กันชนกันล้าง DB ผิดตัว — harness ทำ TRUNCATE จริง
 * ต้องมี HARNESS_DB_CONFIRM=harness-test ใน .env.test เท่านั้นถึงจะแตะ DB ได้
 */
function assertHarnessDb(): string {
  if (process.env.HARNESS_DB_CONFIRM !== "harness-test") {
    throw new Error(
      "ปฏิเสธการแตะ DB: HARNESS_DB_CONFIRM ต้องเป็น 'harness-test' (กัน TRUNCATE โดน DB prod) — เช็ค .env.test",
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ไม่ได้ตั้งใน .env.test");
  return url;
}

export async function initHarnessDb(): Promise<void> {
  assertHarnessDb();
  await ensureSchema();
}

export async function resetDb(): Promise<void> {
  const url = assertHarnessDb();
  const sql = neon(url);
  await sql(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}

/** อ่าน customer ตรงจาก DB เพื่อ assert state จริง (ไม่ผ่าน lib/db) */
export async function readCustomer(userId: string): Promise<Record<string, unknown> | null> {
  const url = assertHarnessDb();
  const sql = neon(url);
  const rows = (await sql("SELECT * FROM customers WHERE user_id = $1", [userId])) as Record<string, unknown>[];
  return rows[0] ?? null;
}

/** order_id ที่บันทึกว่า "เขียนสำเร็จ" ใน Neon (idempotency source of truth · D-29) */
export async function readWrittenOrderIds(): Promise<string[]> {
  const url = assertHarnessDb();
  const sql = neon(url);
  const rows = (await sql("SELECT order_id FROM orders_written")) as Record<string, unknown>[];
  return rows.map((r) => String(r.order_id));
}
