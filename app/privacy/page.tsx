import React from "react";

/**
 * D-54 · หน้า Privacy Policy (static) — ปลดล็อก M-3 App Review (Meta ต้องการ URL จริง)
 * 🔴 ห้ามมี tracking script / analytics / external request ใดๆ ในหน้านี้
 * เขียนด้วย createElement (ไม่มี JSX) → เทส import + render ได้ใน vitest (tsconfig jsx=preserve)
 * วันที่อัปเดตล่าสุด = แก้เมื่อเนื้อหาเปลี่ยน (คงที่ ไม่ใช้ new Date())
 */
export const metadata = {
  title: "นโยบายความเป็นส่วนตัว · Privacy Policy — สากบิน (Sakbin)",
  description: "นโยบายความเป็นส่วนตัวของร้านสากบิน (Sakbin) สำหรับบริการแชทบน LINE OA และ Facebook Messenger",
};

const LAST_UPDATED_TH = "30 กรกฎาคม 2026";
const LAST_UPDATED_EN = "30 July 2026";
const CONTACT_EMAIL = "sakbinofficial@gmail.com"; // placeholder — เจ้าของจะแจ้งอีเมลจริง

const SECTIONS_TH: [string, string][] = [
  ["เราคือใคร", "ร้านสากบิน จำหน่ายอาหารออนไลน์ ให้บริการแชทอัตโนมัติบน LINE OA และ Facebook Messenger เพื่อรับคำสั่งซื้อและตอบคำถามเกี่ยวกับสินค้า"],
  ["ข้อมูลที่เราเก็บ", "ข้อความสนทนา · ชื่อโปรไฟล์และรหัสผู้ใช้ของแพลตฟอร์ม (LINE userId / Facebook PSID) · ข้อมูลที่ลูกค้าให้เพื่อจัดส่ง (ชื่อ ที่อยู่ เบอร์โทร) · หลักฐานการชำระเงิน (รูปสลิป) · ประวัติคำสั่งซื้อ"],
  ["เราใช้ข้อมูลทำอะไร", "ตอบคำถามและให้บริการผ่านแชท · ประมวลผลและจัดส่งคำสั่งซื้อ · แจ้งสถานะพัสดุ · ปรับปรุงคุณภาพการให้บริการ — ระบบมีการใช้ AI ช่วยประมวลผลข้อความเพื่อให้บริการ โดยข้อมูลไม่ถูกนำไปใช้เพื่อการอื่น"],
  ["การเปิดเผยข้อมูล", "เราไม่ขายหรือให้เช่าข้อมูลของคุณแก่บุคคลที่สาม · เปิดเผยเฉพาะเท่าที่จำเป็นต่อการให้บริการ (บริษัทขนส่งเพื่อจัดส่งสินค้า · ผู้ให้บริการระบบที่เราใช้ประมวลผล) หรือเมื่อกฎหมายกำหนด"],
  ["การเก็บรักษาข้อมูล", "เก็บบนระบบคลาวด์ที่มีการควบคุมการเข้าถึง · เก็บเท่าที่จำเป็นต่อการให้บริการและตามที่กฎหมายกำหนด"],
  ["สิทธิของคุณ", "คุณสามารถขอดู แก้ไข หรือลบข้อมูลของคุณได้ โดยติดต่อเราผ่านช่องทางในข้อ 7"],
  ["ติดต่อเรา", `อีเมล: ${CONTACT_EMAIL}`],
  ["การเปลี่ยนแปลงนโยบาย", "หากมีการแก้ไขนโยบายนี้ เราจะเผยแพร่ฉบับล่าสุดที่หน้านี้ พร้อมระบุวันที่อัปเดตล่าสุด"],
];

const SECTIONS_EN: [string, string][] = [
  ["Who we are", "Sakbin is an online food shop. We provide automated chat services on LINE Official Account and Facebook Messenger to take orders and answer questions about our products."],
  ["Information we collect", "Chat messages · your platform profile name and user ID (LINE userId / Facebook PSID) · delivery details you provide (name, address, phone number) · payment proof (transfer slip images) · order history."],
  ["How we use it", "To answer questions and provide service via chat · to process and deliver orders · to send shipping updates · to improve our service quality. We use AI to help process messages in order to serve you; your data is not used for any other purpose."],
  ["Disclosure", "We do not sell or rent your data to third parties. We disclose it only as necessary to provide the service (delivery companies to ship your order · the service providers we use to process data) or when required by law."],
  ["Data retention", "Data is stored on access-controlled cloud systems, kept only as long as necessary to provide the service and as required by law."],
  ["Your rights", "You may request to access, correct, or delete your data by contacting us via the channel in section 7."],
  ["Contact us", `Email: ${CONTACT_EMAIL}`],
  ["Changes to this policy", "If we update this policy, we will publish the latest version on this page with the updated date shown above."],
];

const S: Record<string, React.CSSProperties> = {
  main: { maxWidth: 760, margin: "0 auto", padding: "32px 20px 64px", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: "#1a1a1a", lineHeight: 1.7, fontSize: 16 },
  h1: { fontSize: 26, fontWeight: 700, margin: "0 0 4px" },
  updated: { color: "#666", fontSize: 14, margin: "0 0 28px" },
  h2: { fontSize: 19, fontWeight: 700, margin: "28px 0 8px" },
  body: { margin: "0 0 10px" },
  hr: { border: "none", borderTop: "1px solid #e2e2e2", margin: "44px 0" },
};

const h = React.createElement;

function block(lang: string, title: string, updatedLabel: string, updatedDate: string, sections: [string, string][]): React.ReactNode {
  return h(
    React.Fragment,
    { key: lang },
    h("h1", { style: S.h1 }, title),
    h("p", { style: S.updated }, `${updatedLabel}: ${updatedDate}`),
    ...sections.map(([t, bodyText], i) =>
      h(
        "section",
        { key: `${lang}-${i}` },
        h("h2", { style: S.h2 }, `${i + 1}. ${t}`),
        h("p", { style: S.body }, bodyText),
      ),
    ),
  );
}

export default function PrivacyPage() {
  return h(
    "main",
    { style: S.main },
    block("th", "นโยบายความเป็นส่วนตัว — สากบิน (Sakbin)", "อัปเดตล่าสุด", LAST_UPDATED_TH, SECTIONS_TH),
    h("hr", { style: S.hr }),
    block("en", "Privacy Policy — Sakbin", "Last updated", LAST_UPDATED_EN, SECTIONS_EN),
  );
}
