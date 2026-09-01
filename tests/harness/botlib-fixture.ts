import { sheetsCalls } from "./state";

/**
 * สำเนา "แช่แข็ง" ของ BotLibrary จริง (เจ้าของ paste header + ค่าจริงมา) — ใช้ร่วมทุกเทส
 * 🔴 อย่าแต่งให้สวย: header เรียงเหมือนชีตจริงเป๊ะ (Products/Promo 13 คอลัมน์)
 *    + มี "แถวอันตราย" ที่พบในชีตจริง (แถวว่าง · แถวหมายเหตุคอลัมน์ A · coming_soon · สิ้นสุดว่าง)
 *    ถ้าชีตจริงแก้ราคา → แก้ที่ไฟล์นี้ที่เดียว (กันแต่ละเทสถือ fixture ของตัวเองแล้วตกหล่น)
 */

// ── header จริง (paste ตรงจากเจ้าของ) ──
export const PRODUCTS_HEADER = [
  "sku", "ชื่อสินค้า", "หน่วย", "ราคาปกติ_ต่อหน่วย", "ขนาด/น้ำหนัก", "เลข อย.",
  "ส่วนประกอบตามฉลาก", "สารก่อภูมิแพ้", "วิธีรับประทาน", "วิธีเก็บรักษา", "อายุการเก็บ", "รูปสินค้า (URL)", "สถานะ",
];
// v2.0 (D-41): สลับลำดับ — ค่าส่ง · ยอดที่ลูกค้าจ่าย · ประหยัด (ยอดจ่ายมาก่อนประหยัด) · pricing header-driven จึงทน
export const PROMO_HEADER = [
  "promo_id", "sku", "ชื่อโปร", "จำนวน", "ราคาปกติ (auto)", "ราคาโปร",
  "ค่าส่ง", "ยอดที่ลูกค้าจ่าย (auto)", "ประหยัด (auto)", "ข้อความโชว์ (auto)", "เริ่มใช้", "สิ้นสุด", "สถานะ",
];

const NOTE_PRODUCTS = ["หมายเหตุ: ช่องพื้นฟ้า = คนกรอก · ช่อง (auto) = สูตร", "", "", "", "", "", "", "", "", "", "", "", ""];
const NOTE_PROMO = ["หมายเหตุ: ช่องพื้นฟ้า = คนกรอก · ช่อง (auto) = สูตร", "", "", "", "", "", "", "", "", "", "", "", ""];
const BLANK = ["", "", "", "", "", "", "", "", "", "", "", "", ""];

/** Products จริง: NPT-10G live 95 · NPR-200ML coming_soon 90 + แถวว่าง + แถวหมายเหตุ */
export function productsRows(): string[][] {
  return [
    PRODUCTS_HEADER,
    ["NPT-10G", "น้ำพริกปลาทูฟรีซดราย", "ถ้วย", "95", "10 กรัม / ถ้วย", "22-2-02365-6-0041", "ปลาทู พริก กระเทียม", "ปลา", "ทานกับข้าวสวย", "อุณหภูมิห้อง", "12 เดือน", "https://ex/npt.jpg", "live"],
    ["NPR-200ML", "น้ำปลาร้าคุณนาย", "ขวด", "90", "200 มล. / ขวด", "(รอเลข อย.)", "ปลาร้า เกลือ", "ปลา", "ปรุงอาหาร", "อุณหภูมิห้อง", "12 เดือน", "", "coming_soon"],
    BLANK,
    NOTE_PRODUCTS,
  ];
}

/**
 * Promo จริง: P1/P3/P5/P10 ผูก NPT-10G · เริ่มใช้ 2026-07-01 · สิ้นสุดว่าง (=ยัง live) + แถวว่าง + แถวหมายเหตุ
 * @param priceOverride แก้ราคาโปรรายตัว (เทสกันชีตเปลี่ยนแล้วโค้ดไม่รู้ตัว: P5 440→400)
 */
export function promoRows(priceOverride: Record<string, string> = {}): string[][] {
  const promoPrice = (id: string, def: string) => priceOverride[id] ?? def;
  // v2.0 order: ... ราคาโปร | ค่าส่ง | ยอดที่ลูกค้าจ่าย | ประหยัด | ข้อความโชว์ ...
  return [
    PROMO_HEADER,
    ["P1", "NPT-10G", "1 ถ้วย", "1", "95", promoPrice("P1", "95"), "30", "125", "0", "น้ำพริกปลาทูฟรีซดราย 1 ถ้วย 95 บาท ค่าส่ง 30 บาท", "2026-07-01", "", "live"],
    ["P3", "NPT-10G", "3 ถ้วย ส่งฟรี", "3", "285", promoPrice("P3", "275"), "0", "275", "10", "น้ำพริกปลาทูฟรีซดราย 3 ถ้วย จากปกติ 285 บาท ลดเหลือ 275 บาท ส่งฟรี", "2026-07-01", "", "live"],
    ["P5", "NPT-10G", "5 ถ้วย ส่งฟรี", "5", "475", promoPrice("P5", "440"), "0", "440", "35", "น้ำพริกปลาทูฟรีซดราย 5 ถ้วย จากปกติ 475 บาท ลดเหลือ 440 บาท ส่งฟรี", "2026-07-01", "", "live"],
    ["P10", "NPT-10G", "10 ถ้วย ส่งฟรี", "10", "950", promoPrice("P10", "850"), "0", "850", "100", "น้ำพริกปลาทูฟรีซดราย 10 ถ้วย จากปกติ 950 บาท ลดเหลือ 850 บาท ส่งฟรี", "2026-07-01", "", "live"],
    BLANK,
    NOTE_PROMO,
  ];
}

/** Vars v2.0 (D-41/43): ตัวแปรข้อความเจ้าของ · header ตัวแปร/ค่า/หมายเหตุ/สถานะ · โหลดเฉพาะ live
 *  🔴 มีแถว draft ({ตัวอย่าง_ตัวแปรใหม่}) + แถวกติกาสำหรับคน — ทั้งคู่ต้องถูกกรองทิ้ง (เทส D-43) */
export function varsRows(): string[][] {
  return [
    ["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"],
    ["{สัดส่วนปลาทู}", "เนื้อปลาทู 45%", "copy ตรงจากฉลาก", "live"],
    ["{ตัวอย่าง_ตัวแปรใหม่}", "ค่าที่ยังไม่พร้อมใช้", "ตัวอย่างให้เจ้าของดู", "draft"],
    ["— กติกา: ชื่อตัวแปรต้องมีปีกกา · ห้ามชนตัวแปรระบบ —", "", "", ""],
  ];
}

/** key ราคา/ค่าส่ง/เพดาน จริงใน Config (ใส่ลง testConfig.raw เพื่อให้ pricing อ่านได้) */
export const PRICING_CONFIG: Record<string, string> = {
  ยอดขั้นต่ำส่งฟรี_บาท: "275",
  ค่าส่ง_มาตรฐาน: "30",
  ค่าส่ง_COD_เพิ่ม: "0",
  เพดานจำนวน_คูณโปรใหญ่สุด: "2",
};

// ══════════════════ D-68 · ชีต v3 (loader อ่านแท็บ v3 เส้นเดียวแล้ว) ══════════════════

/**
 * 🔴 ชื่อแท็บอยู่ที่เดียวทั้ง repo — D-72a เปลี่ยนเป็นอังกฤษแล้ว (ตรงกับคีย์ BotLibrary เป๊ะ)
 * ห้ามเขียนชื่อแท็บเป็นสตริงตรง ๆ ในไฟล์เทส
 */
export const TAB = {
  steps: "Steps",
  knowledge: "Knowledge",
  products: "Products",
  promo: "Promo",
  vars: "Vars",
  config: "Config",
} as const;

/** header แท็บ "เส้นทางขาย" (v3) — ตรงกับที่ adaptSteps อ่าน */
export const V3_STEP_HEADER = [
  "step_id", "funnel_stage", "ชื่อประตู", "เข้าเมื่อ", "สาระที่ต้องสื่อ", "ต้องได้อะไรถึงไปต่อ", "ไปประตูไหน", "แนวตอบ", "handoff", "สถานะ",
];

/** header แท็บ "ความรู้" (v3) — ตรงกับที่ adaptKnowledge อ่าน */
export const V3_KNOW_HEADER = ["ลูกค้าพูดยังไง", "keyword", "ความกังวลจริง", "ข้อเท็จจริง/สิ่งที่อยากให้รู้", "แนวตอบ", "สถานะ"];

export interface V3Step {
  step_id: string;
  name?: string;
  /** "เข้าเมื่อ" — ตัวอย่างในเครื่องหมายคำพูดคือสิ่งที่ matchesEntry ใช้จับ */
  entry?: string;
  essence?: string;
  collect?: string;
  next?: string;
  guide?: string;
  /**
   * funnel_stage — คอลัมน์ optional (D-68) · เว้นว่าง = adapter ใช้ FIXED_FUNNEL จาก step_id
   * (S1=lead · S2/S2Q=qualified · S3=quoted · S4=won · id อื่น = qualified + warn)
   * 🔴 ชีตจริงยังไม่มีคอลัมน์นี้ — ใส่ค่าที่นี่ = จำลอง "ถ้าเจ้าของเปิดใช้" เท่านั้น
   */
  funnel?: string;
  /** ประตูส่งต่อคน — ชนะ funnel_stage เสมอ (adapter ให้ "handoff") */
  handoff?: boolean;
  status?: string;
}

/** แถวแท็บ "เส้นทางขาย" (v3) — ใช้แทนการเขียน header เองในไฟล์เทส */
export function v3StepRows(steps: V3Step[]): string[][] {
  return [
    [...V3_STEP_HEADER],
    ...steps.map((s) => [
      s.step_id,
      s.funnel ?? "",
      s.name ?? s.step_id,
      s.entry ?? "",
      s.essence ?? "",
      s.collect ?? "",
      s.next ?? "",
      s.guide ?? "",
      s.handoff ? "ใช่" : "",
      s.status ?? "live",
    ]),
  ];
}

/** แถวแท็บ "ความรู้" (v3) */
export function v3KnowRows(rows: { say: string; keyword?: string; concern?: string; fact?: string; guide?: string; status?: string }[]): string[][] {
  return [
    [...V3_KNOW_HEADER],
    ...rows.map((r) => [r.say, r.keyword ?? "", r.concern ?? "", r.fact ?? "", r.guide ?? "", r.status ?? "live"]),
  ];
}

/**
 * seed "ชีตดิบ v3" ให้ loader อ่าน (mock batchGet คืน botLibReturn[tab]) → ผ่าน adaptV3Bundle → shape ภายใน
 * @param stepRows แถวแท็บ เส้นทางขาย — สร้างด้วย `v3StepRows()` เท่านั้น (ห้ามเขียน header เอง)
 */
export function seedBotLib(opts: { stepRows?: string[][]; promoPriceOverride?: Record<string, string>; varsRows?: string[][]; knowRows?: string[][] } = {}): void {
  sheetsCalls.botLibReturn = {
    [TAB.steps]: opts.stepRows ?? v3StepRows([{ step_id: "S1", name: "ทักทาย", entry: "ลูกค้าทักมา" }]),
    [TAB.knowledge]: opts.knowRows ?? v3KnowRows([{ say: "ส่งกี่วัน", keyword: "ส่งกี่วัน", fact: "1-2 วันค่ะ" }]),
    [TAB.config]: [["key", "value"]],
    [TAB.products]: productsRows(),
    [TAB.promo]: promoRows(opts.promoPriceOverride),
    [TAB.vars]: opts.varsRows ?? varsRows(),
  };
}
