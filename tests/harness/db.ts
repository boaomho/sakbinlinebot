import { neon } from "@neondatabase/serverless";
import { ensureSchema } from "@/lib/db";

/** ทุกตารางที่ lib/db สร้าง (ensureSchema) — harness ล้างทั้งหมดต่อบท */
const TABLES = [
  "customers",
  "messages",
  "follow_log",
  "funnel_events",
  "pending_messages",
  "admin_pending_choices",
  "orders_written",
  "shipping_notified", // D-50: idempotency แจ้งพัสดุ — ต้องล้างต่อเทส กัน claim ค้างข้ามเคส
  "channel_switches", // D-53: สวิตช์บอทราย channel — ต้องล้างต่อเทส กันสถานะปิดค้างข้ามเคส
  "train_sessions", // T-STUDIO: fake grid ห้องซ้อม — ไม่ล้าง = ค้างข้ามเทส/ข้ามรอบ
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
  const url = assertHarnessDb();
  // 🔴 warm-up: Neon serverless compute อาจ cold (ตื่นช้า >30วิ) → ping SELECT 1 พร้อม retry ให้ตื่นก่อน
  //    กัน ensureSchema รอบแรก timeout (เคย "1 failed ปลอม" เป็นระยะ) · backoff 1→5วิ (รวม ~15วิ + latency)
  const sql = neon(url);
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await sql("SELECT 1");
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  if (lastErr) throw lastErr;
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

/** ตั้ง last_seen ของลูกค้าให้เป็น N นาทีก่อน (จำลองเงียบนาน · เทส intake timeout D-35) */
export async function setLastSeenAgo(userId: string, minutes: number): Promise<void> {
  const url = assertHarnessDb();
  const sql = neon(url);
  await sql("UPDATE customers SET last_seen = now() - ($2 || ' minutes')::interval WHERE user_id = $1", [userId, String(minutes)]);
}

export async function setCreatedAtAgo(userId: string, days: number): Promise<void> {
  const url = assertHarnessDb();
  const sql = neon(url);
  await sql("UPDATE customers SET created_at = now() - ($2 || ' days')::interval WHERE user_id = $1", [userId, String(days)]);
}

/** order_id ที่บันทึกว่า "เขียนสำเร็จ" ใน Neon (idempotency source of truth · D-29) */
export async function readWrittenOrderIds(): Promise<string[]> {
  const url = assertHarnessDb();
  const sql = neon(url);
  const rows = (await sql("SELECT order_id FROM orders_written")) as Record<string, unknown>[];
  return rows.map((r) => String(r.order_id));
}
