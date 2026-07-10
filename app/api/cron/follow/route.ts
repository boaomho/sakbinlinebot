import { NextRequest, NextResponse } from "next/server";
import { getConfig, resolveFeatureSwitches } from "@/lib/config";
import { getFollowCsv, parseCsvRows } from "@/lib/sheets";
import { getStaleCustomers, hasFollowedRecently, logFollowSent } from "@/lib/db";
import { pushRawText } from "@/lib/line";

export const maxDuration = 30;

interface FollowRule {
  ruleName: string;
  waitDays: number;
  message: string;
}

/**
 * โครงชีต CSV_Follow จริง (คอลัมน์ตามลำดับ):
 *   A=ชื่อกฎ  B=เงื่อนไข(เมื่อ...)  C=เริ่มนับจาก  D=รอกี่วัน  E=ข้อความที่ส่ง
 *   F=ปิดใช้หลังส่ง  G=หยุดตามเมื่อ
 * loader อ่านคอลัมน์ตาม "ชื่อ header" ก่อน (ทนต่อการสลับคอลัมน์) แล้ว fallback เป็น index
 * ตามโครงจริง (ชื่อกฎ=0, รอกี่วัน=3, ข้อความ=4) หา header ไม่เจอ
 * NB: คอลัมน์ B (เงื่อนไข), F (ปิดใช้หลังส่ง), G (หยุดตามเมื่อ) ยังไม่ถูกประเมินในเวอร์ชันนี้
 * — Follow ปิดอยู่ (dormant) ตอนนี้ตามลูกค้าจาก "เงียบเกิน D วัน" เป็นหลัก
 */
function findFollowCols(headerRow: string[] | undefined): { name: number; days: number; message: number; headerFound: boolean } {
  const fallback = { name: 0, days: 3, message: 4, headerFound: false };
  if (!headerRow) return fallback;
  const cells = headerRow.map((c) => c.replace(/[​-‍﻿ ]/g, "").trim().toLowerCase());
  let name = -1;
  let days = -1;
  let message = -1;
  for (let j = 0; j < cells.length; j++) {
    const h = cells[j];
    if (name === -1 && h.includes("ชื่อกฎ")) name = j;
    if (days === -1 && (h.includes("รอกี่วัน") || h.includes("กี่วัน"))) days = j;
    if (message === -1 && h.includes("ข้อความ")) message = j;
  }
  if (name !== -1 && days !== -1 && message !== -1) return { name, days, message, headerFound: true };
  return fallback;
}

function isHeaderRow(row: string[]): boolean {
  const first = (row[0] ?? "").replace(/[​-‍﻿ ]/g, "").trim();
  return first === "ชื่อกฎ";
}

function parseFollowRules(csv: string): FollowRule[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  const cols = findFollowCols(rows[0]);
  const rules: FollowRule[] = [];

  for (const row of rows) {
    if (isHeaderRow(row)) continue;
    const ruleName = (row[cols.name] ?? "").trim();
    const days = Number((row[cols.days] ?? "").trim());
    const message = (row[cols.message] ?? "").trim();
    if (!ruleName || !message || !Number.isFinite(days) || days <= 0) continue;
    rules.push({ ruleName, waitDays: days, message });
  }

  return rules;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = await getConfig();
  const switches = resolveFeatureSwitches(config);

  if (!switches.follow) {
    console.warn(JSON.stringify({ scope: "cron-follow", warning: "follow switch off or env missing, skip" }));
    return NextResponse.json({ status: "skipped" }, { status: 200 });
  }

  const csv = await getFollowCsv();
  if (!csv) {
    return NextResponse.json({ status: "skipped", reason: "SHEET_FOLLOW_URL missing or fetch failed" }, { status: 200 });
  }

  const rules = parseFollowRules(csv);
  let sent = 0;

  for (const rule of rules) {
    let userIds: string[] = [];
    try {
      userIds = await getStaleCustomers(rule.waitDays);
    } catch (error) {
      console.error(JSON.stringify({ scope: "cron-follow", warning: "getStaleCustomers failed", rule: rule.ruleName, error: String(error) }));
      continue;
    }

    for (const userId of userIds) {
      try {
        // กันส่งกฎเดิมซ้ำ: ถ้าเคยส่งภายในกรอบ waitDays แล้ว ข้าม
        const already = await hasFollowedRecently(userId, rule.ruleName, rule.waitDays * 24);
        if (already) continue;
        const ok = await pushRawText(userId, rule.message);
        if (ok) {
          await logFollowSent(userId, rule.ruleName);
          sent++;
        }
      } catch (error) {
        console.error(JSON.stringify({ scope: "cron-follow", warning: "follow send failed", userId, error: String(error) }));
      }
    }
  }

  console.log(JSON.stringify({ scope: "cron-follow", sent, rules: rules.length }));
  return NextResponse.json({ status: "ok", sent }, { status: 200 });
}
