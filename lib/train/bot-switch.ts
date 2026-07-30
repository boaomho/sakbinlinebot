/**
 * lib/train/bot-switch.ts — T2-ข · ตัวประกอบข้อความ + orchestrator เปิด/ปิดบอท
 * ใช้ร่วมกัน 2 ทาง: (1) คำสั่งพิมพ์ในกลุ่ม (handler เดิม) (2) ปุ่มใน Dashboard
 * 🔴 ข้อความแจ้งกลุ่มต้อง "ตรงกับคำสั่งพิมพ์" → รวม builder ไว้ที่เดียว กันสตริง drift
 * สถานะอยู่ Neon ที่เดียว: reuse setChannelEnabled / setHumanMode เดิม (ไม่มี SQL ใหม่)
 */
import { setChannelEnabled, isChannelEnabled, setHumanMode, getCustomer } from "@/lib/db";
import { messengerPageIds } from "@/lib/channel/pages";
import { channelLabel } from "@/lib/channel/label";
import { pushRawText } from "@/lib/line";

/** ต่อท้ายข้อความจาก Dashboard — คนดูกลุ่มต้องรู้ว่าสั่งจาก UI ไม่ใช่พิมพ์เอง */
export const DASHBOARD_SUFFIX = "(จาก Dashboard)";

/** ข้อความแจ้งกลุ่มตอนเปิด/ปิดบอทรายคน — ตรงกับ applyBotMode ใน handler เป๊ะ */
export function botModeMsg(name: string, close: boolean, returnMinutes: number): string {
  return close
    ? `🔴 ปิดบอทให้ "${name}" แล้ว\nบอทจะกลับมาเองเมื่อลูกค้าเงียบครบ ${returnMinutes} นาที หรือพิมพ์: เปิดบอท ${name}`
    : `🟢 เปิดบอทให้ "${name}" แล้ว`;
}

/** ข้อความแจ้งกลุ่มตอนเปิด/ปิดบอทรายช่องทาง — ตรงกับสาขา channel ใน handler เป๊ะ */
export function channelSwitchMsg(channelKey: string, close: boolean, statusLine: string): string {
  return `${close ? "🔴 ปิด" : "🟢 เปิด"}บอทช่อง ${channelLabel(channelKey)} แล้ว\n${statusLine}`;
}

/** D-53: รายงานสถานะบอทครบทุก channel เช่น "[LINE] เปิด · [FB] ปิด" (ย้ายจาก handler เพื่อ reuse) */
export async function channelStatusLine(): Promise<string> {
  const keys = channelKeys();
  const parts = await Promise.all(keys.map(async (k) => `${channelLabel(k)} ${(await isChannelEnabled(k)) ? "เปิด" : "ปิด"}`));
  return parts.join(" · ");
}

/** รายชื่อ channel key ทั้งหมดที่มีในระบบ (line + ทุกเพจ Messenger ที่ผูกไว้) */
export function channelKeys(): string[] {
  return ["line", ...messengerPageIds().map((p) => `fb:${p}`)];
}

/** รายการช่องทาง + ป้าย + สถานะ (ให้ UI Dashboard วาดสวิตช์) */
export async function listChannelStates(): Promise<Array<{ key: string; label: string; enabled: boolean }>> {
  return Promise.all(channelKeys().map(async (k) => ({ key: k, label: channelLabel(k), enabled: await isChannelEnabled(k) })));
}

/** เขียนกลุ่มแอดมิน + ต่อท้าย (จาก Dashboard) · graceful เมื่อ ENV ขาด (สถานะเขียนแล้ว แค่ไม่ push) */
async function notifyAdminFromDashboard(text: string): Promise<boolean> {
  const adminGroupId = process.env.ADMIN_GROUP_ID;
  const full = `${text}\n${DASHBOARD_SUFFIX}`;
  if (!adminGroupId) {
    console.warn(JSON.stringify({ scope: "dashboard-switch", warning: "ADMIN_GROUP_ID not set — push skipped" }));
    return false;
  }
  return pushRawText(adminGroupId, full);
}

/** Dashboard: เปิด/ปิดบอทรายช่องทาง — reuse setChannelEnabled + แจ้งกลุ่ม (ข้อความเดียวกับคำสั่งพิมพ์) */
export async function applyChannelSwitch(channelKey: string, enabled: boolean): Promise<{ statusLine: string; notified: boolean }> {
  await setChannelEnabled(channelKey, enabled);
  const statusLine = await channelStatusLine();
  const notified = await notifyAdminFromDashboard(channelSwitchMsg(channelKey, !enabled, statusLine));
  return { statusLine, notified };
}

/** Dashboard: เปิด/ปิดบอทรายคน — reuse setHumanMode + แจ้งกลุ่ม (ชื่อจาก Neon) */
export async function applyCustomerBotMode(
  userId: string,
  close: boolean,
  returnMinutes: number,
): Promise<{ humanMode: boolean; name: string; notified: boolean }> {
  const c = await getCustomer(userId);
  const name = c?.displayName ?? userId;
  await setHumanMode(userId, close);
  const notified = await notifyAdminFromDashboard(botModeMsg(name, close, returnMinutes));
  return { humanMode: close, name, notified };
}
