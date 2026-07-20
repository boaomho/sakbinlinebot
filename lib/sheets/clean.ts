/**
 * lib/sheets/clean.ts — ทำความสะอาดค่าจากเซลล์ Google Sheet ก่อน lookup/เทียบ
 * ย้ายมารวมที่เดียวจาก lib/config.ts (Part 3 จะให้ config.ts import จากที่นี่แทน copy ของตัวเอง)
 *
 * 🔴 ห้าม import อะไรที่เกี่ยวกับ LINE/Gemini/googleapis — pure ล้วน (ใช้ได้ทั้งฝั่งอ่านและเทส)
 */

/**
 * ตัดอักขระล่องหนที่ .trim() ปกติจับไม่หมด (zero-width space/joiner U+200B–U+200D,
 * BOM U+FEFF, non-breaking space U+00A0) แล้ว trim — ใช้กับทั้ง key และ value จากชีต
 * เพราะบ่อยครั้งเซลล์ Google Sheet มีอักขระพวกนี้ติดมาโดยมองไม่เห็น ทำให้ทั้งการ
 * lookup คีย์/หัวคอลัมน์ และการเทียบค่าสวิตช์พลาดแบบเงียบ ๆ
 */
export function cleanCell(value: string | undefined): string {
  if (value === undefined) return "";
  return value.replace(/[​-‍﻿ ]/g, "").trim();
}

/**
 * ตัดคำอธิบายในวงเล็บท้ายชื่อออก เช่น "เปิด_ส่งต่อแอดมิน (Handoff)" -> "เปิด_ส่งต่อแอดมิน"
 * เพราะในชีตจริงคนใส่วงเล็บกำกับภาษาอังกฤษไว้ให้อ่านง่าย แต่โค้ด lookup ด้วยชื่อล้วน
 */
export function stripKeyAnnotation(key: string): string {
  return key.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/**
 * emoji/สัญลักษณ์กำกับที่คนใส่หัวคอลัมน์ให้อ่านง่าย (⭐🔴⚠️✅❌●▪ ฯลฯ) — ตัดก่อนเทียบชื่อ
 * ใช้ "blacklist ช่วง emoji/สัญลักษณ์" ไม่ใช่ whitelist — กันเผลอตัดเครื่องหมายที่ header ใช้จริง
 * (เช่น "สินค้า+จำนวน" ห้ามตัด + · "ชื่อ-นามสกุล" ห้ามตัด -) · variation selector + ZWJ ตัดด้วย
 */
const HEADER_SYMBOLS = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu;

/**
 * ทำความสะอาดชื่อหัวคอลัมน์: ตัดอักขระล่องหน + emoji/สัญลักษณ์กำกับ + วงเล็บกำกับ
 * 🔴 เจ้าของใส่ emoji ในหัวคอลัมน์เพื่ออ่านชีตง่าย ("หลักการตอบ ⭐") — โค้ด lookup ด้วยชื่อล้วน
 *    (ครั้งที่ 3 ที่ header matching พัง: วงเล็บ → substring "PR" → emoji · แก้ที่นี่ที่เดียว ครอบทุกแท็บ)
 */
export function cleanHeader(value: string | undefined): string {
  const noSymbols = cleanCell(value).replace(HEADER_SYMBOLS, "");
  return stripKeyAnnotation(noSymbols).replace(/\s+/g, " ").trim();
}
