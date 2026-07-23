// D-45 sheet lint — ตรวจ keyword ชีตจริง: "วลี ไม่ใช่คำโดดสามัญ" (แถว action=handoff อนุโลมกว้างได้)
// รัน: node scripts/sheet-lint.mjs  (ต้องมี GOOGLE_SERVICE_ACCOUNT + SHEET_BOTLIB_ID ใน env จริง
//      หรือใส่ใน .env.local — .env.test เป็น dummy ใช้ไม่ได้) · read-only ไม่เขียนชีต
import { readFileSync, existsSync } from "node:fs";
import { google } from "googleapis";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
  );
}
const fileEnv = { ...loadEnvFile(".env.local"), ...loadEnvFile(".env") };
const SA = process.env.GOOGLE_SERVICE_ACCOUNT ?? fileEnv.GOOGLE_SERVICE_ACCOUNT;
const SHEET = process.env.SHEET_BOTLIB_ID ?? fileEnv.SHEET_BOTLIB_ID;
if (!SA || !SHEET) {
  console.error("ต้องมี GOOGLE_SERVICE_ACCOUNT + SHEET_BOTLIB_ID (env จริง หรือ .env.local)");
  process.exit(1);
}

const creds = JSON.parse(SA);
const auth = new google.auth.JWT({
  email: creds.client_email,
  key: creds.private_key.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

const res = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: SHEET,
  ranges: ["CSV_FAQ!A:Z", "CSV_Config!A:Z"],
});
const [faq, config] = res.data.valueRanges.map((v) => v.values ?? []);

// คำโดดสามัญที่ห้ามเป็น keyword เดี่ยว (ชน substring ในประโยคปกติ เช่น "โอนครับ"/"ยานนาวา")
const COMMON = ["โอน", "ยา", "จ่าย", "ส่ง", "เก็บ", "ราคา", "โปร", "แพง", "ลด", "ท้อง", "ขนาด", "กิน", "ของ", "คน", "วัน"];
const clean = (s) => (s ?? "").replace(/[​-‍﻿ ]/g, "").trim();
const stripParen = (s) => clean(s).replace(/\s*\([^)]*\)\s*$/, "");

// ---- CSV_FAQ: keywords ต่อแถว live ----
const header = (faq[0] ?? []).map(stripParen);
const col = (name) => header.indexOf(name);
const issues = [];
for (let i = 1; i < faq.length; i++) {
  const r = faq[i];
  if (!clean(r[col("faq_id")]) || clean(r[col("status")]).toLowerCase() !== "live") continue;
  const action = clean(r[col("action")]).toLowerCase();
  for (const kw of clean(r[col("keywords")]).split(",").map(clean).filter(Boolean)) {
    if (COMMON.includes(kw) || [...kw].length <= 2) {
      issues.push({
        faq: `${clean(r[col("faq_id")])} · ${clean(r[col("คำถาม")])}`,
        keyword: kw,
        note: action === "handoff" ? "แถว handoff — อนุโลมกว้างได้ แต่ระวัง substring" : "🔴 ควรแก้เป็นวลี",
      });
    }
  }
}

// ---- คำ_handoff (CSV_Config) — อนุโลมกว้างได้ตามกติกา · รายงานคำสั้น (substring เสี่ยง) เพื่อรับรู้ ----
const handoffRow = config.find((r) => (r ?? []).some((c) => stripParen(c) === "คำ_handoff"));
const handoffWords = handoffRow
  ? clean(handoffRow.find((c, j) => j > 0 && clean(c).includes(",")) ?? handoffRow[2] ?? "").split(",").map(clean).filter(Boolean)
  : [];

console.log(JSON.stringify({
  faqRows: Math.max(0, faq.length - 1),
  faqKeywordIssues: issues,
  handoffWords,
  handoffShortWords: handoffWords.filter((w) => [...w].length <= 3), // แจ้งเพื่อรับรู้ (เช่น "ท้อง" ชน "ท้องฟ้า/ท้องเสีย")
}, null, 1));
