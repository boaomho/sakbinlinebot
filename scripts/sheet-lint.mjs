// D-45 sheet lint — ตรวจ keyword ชีตจริง: "วลี ไม่ใช่คำโดดสามัญ" (แถว action=handoff อนุโลมกว้างได้)
// read-only ไม่เขียนชีต · โหลด env แบบเดียวกับ vitest (Vite loadEnv → merge .env/.env.local/.env.[mode]/.env.[mode].local)
// รัน (creds มาจาก .env.test เหมือน golden · ทับได้ด้วย shell env):
//   node scripts/sheet-lint.mjs
//   SHEET_BOTLIB_ID=<id> node scripts/sheet-lint.mjs   (ระบุชีตอื่น)
//   ENV_MODE=production node scripts/sheet-lint.mjs     (ใช้ .env.production ถ้ามี)
import { google } from "googleapis";
import { loadEnv } from "vite";

// เหมือน vitest.config.ts: loadEnv(mode, cwd, "") — prefix "" = โหลดทุก key · quote/multiline จัดการให้ (dotenv ภายใน)
const mode = process.env.ENV_MODE ?? "test";
const fileEnv = loadEnv(mode, process.cwd(), "");
// shell env ชนะไฟล์ (เช่น ตั้ง GEMINI/GSA/SHEET_BOTLIB_ID เองตอนรัน)
const env = { ...fileEnv, ...process.env };

const SA = env.GOOGLE_SERVICE_ACCOUNT;
const SHEET = env.SHEET_BOTLIB_ID;
if (!SA || !SHEET) {
  console.error(`ต้องมี GOOGLE_SERVICE_ACCOUNT + SHEET_BOTLIB_ID (โหลดจาก .env.${mode}/.env.local หรือ shell env)`);
  console.error(`  พบ: GOOGLE_SERVICE_ACCOUNT=${SA ? "yes" : "MISSING"} · SHEET_BOTLIB_ID=${SHEET ? "yes" : "MISSING"}`);
  process.exit(1);
}

let creds;
try {
  creds = JSON.parse(SA);
} catch (e) {
  console.error("GOOGLE_SERVICE_ACCOUNT parse ไม่ได้ (ไม่ใช่ JSON):", String(e).slice(0, 80));
  process.exit(1);
}
if (!creds.private_key || creds.private_key === "dummy" || !creds.private_key.includes("PRIVATE KEY")) {
  console.error("🔴 GOOGLE_SERVICE_ACCOUNT.private_key เป็น placeholder/dummy — ต้องใช้ service account จริง");
  console.error("   .env.test ใน repo เป็น dummy (harness mock googleapis) · ใส่ค่าจริงชั่วคราวใน .env.test หรือ shell env ก่อนรัน");
  process.exit(2);
}
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
// นับ "ตัวฐาน" ไทย (ตัดสระบน/ล่าง/วรรณยุกต์) — "ท้อง"→ทอง=3 · "แพ้"→แพ=2 (คำสั้น = เสี่ยงชน substring)
const baseLen = (w) => [...w].filter((c) => !/[ัำ-ฺ็-๎]/.test(c)).length;

// ---- CSV_FAQ: keywords ต่อแถว live ----
const header = (faq[0] ?? []).map(stripParen);
const col = (name) => header.indexOf(name);
for (const need of ["faq_id", "status", "action", "keywords", "คำถาม"]) {
  if (col(need) === -1) { console.error(`🔴 CSV_FAQ header ไม่พบคอลัมน์ "${need}" (header: ${header.join(", ")})`); process.exit(1); }
}
const issues = [];
for (let i = 1; i < faq.length; i++) {
  const r = faq[i];
  if (!clean(r[col("faq_id")]) || clean(r[col("status")]).toLowerCase() !== "live") continue;
  const action = clean(r[col("action")]).toLowerCase();
  for (const kw of clean(r[col("keywords")]).split(",").map(clean).filter(Boolean)) {
    if (COMMON.includes(kw) || baseLen(kw) <= 2) {
      issues.push({
        faq: `${clean(r[col("faq_id")])} · ${clean(r[col("คำถาม")])}`,
        keyword: kw,
        note: action === "handoff" ? "แถว handoff — อนุโลมกว้างได้ แต่ระวัง substring" : "🔴 ควรแก้เป็นวลี",
      });
    }
  }
}

// ---- คำ_handoff (CSV_Config) — layout B=key C=ค่าที่ตั้ง · เอา cell ถัดจาก key (fallback: cell ที่มี comma) ----
let handoffWords = [];
for (const r of config) {
  const cells = r ?? [];
  const keyIdx = cells.findIndex((c) => stripParen(c) === "คำ_handoff");
  if (keyIdx === -1) continue;
  const val = clean(cells[keyIdx + 1]) || clean(cells.slice(keyIdx + 1).find((c) => clean(c).includes(",")) ?? "");
  handoffWords = val.split(",").map(clean).filter(Boolean);
  break;
}

console.log(JSON.stringify({
  faqRows: Math.max(0, faq.length - 1),
  faqKeywordIssues: issues,
  handoffWords,
  handoffShortWords: handoffWords.filter((w) => baseLen(w) <= 3), // แจ้งเพื่อรับรู้ (เช่น "ท้อง" ชน "ท้องฟ้า/ท้องเสีย")
}, null, 1));
