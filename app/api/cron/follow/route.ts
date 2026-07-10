import { NextRequest, NextResponse } from "next/server";
import { getConfig, resolveFeatureSwitches } from "@/lib/config";
import { getFollowCsv, parseCsvRows } from "@/lib/sheets";
import { getStaleCustomersByStage, hasFollowedRecently, logFollowSent } from "@/lib/db";
import { pushRawText } from "@/lib/line";

export const maxDuration = 30;

interface FollowRule {
  ruleName: string;
  stage: string;
  silentHours: number;
  message: string;
}

/** CSV_Follow คอลัมน์: ชื่อกฎ, ประตูที่ตรงเงื่อนไข, ชั่วโมงที่เงียบ, ข้อความที่จะส่ง (แถวแรกเป็นหัวตาราง) */
function parseFollowRules(csv: string): FollowRule[] {
  const rows = parseCsvRows(csv);
  const rules: FollowRule[] = [];

  for (const row of rows) {
    const [ruleName, stage, hoursStr, message] = row;
    if (!ruleName || ruleName.trim().toLowerCase() === "ชื่อกฎ") continue;
    const hours = Number(hoursStr);
    if (!stage || !Number.isFinite(hours) || !message) continue;
    rules.push({ ruleName: ruleName.trim(), stage: stage.trim(), silentHours: hours, message: message.trim() });
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
      userIds = await getStaleCustomersByStage(rule.stage, rule.silentHours);
    } catch (error) {
      console.error(JSON.stringify({ scope: "cron-follow", warning: "getStaleCustomersByStage failed", rule: rule.ruleName, error: String(error) }));
      continue;
    }

    for (const userId of userIds) {
      try {
        const already = await hasFollowedRecently(userId, rule.ruleName, rule.silentHours);
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
