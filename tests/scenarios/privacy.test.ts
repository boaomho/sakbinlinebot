import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPage from "@/app/privacy/page";

/** D-54 · หน้า Privacy Policy — เนื้อหาครบ (ปลดล็อก M-3 App Review) */

describe("D-54 · Privacy Policy page", () => {
  const html = renderToStaticMarkup(React.createElement(PrivacyPage));

  it("มีทั้งหัวข้อไทยและอังกฤษ", () => {
    expect(html).toContain("นโยบายความเป็นส่วนตัว — สากบิน");
    expect(html).toContain("Privacy Policy — Sakbin");
  });

  it("ครบสาระ 8 ข้อ (ไทย) — เก็บอะไร/ใช้ทำอะไร/เปิดเผย/สิทธิ", () => {
    expect(html).toContain("LINE userId");
    expect(html).toContain("Facebook PSID");
    expect(html).toContain("รูปสลิป");
    expect(html).toContain("AI");
    expect(html).toContain("ไม่ขายหรือให้เช่าข้อมูล");
    expect(html).toContain("แก้ไข หรือลบข้อมูล");
    expect(html).toContain("บริษัทขนส่ง");
  });

  it("มีอีเมลติดต่อ + วันที่อัปเดต", () => {
    expect(html).toContain("sakbinofficial@gmail.com");
    expect(html).toContain("อัปเดตล่าสุด");
    expect(html).toContain("Last updated");
  });

  it("🔴 ไม่มี tracking/analytics/สคริปต์ภายนอกในหน้า", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/googletagmanager|google-analytics|gtag|facebook\.net|fbevents/i);
  });
});
