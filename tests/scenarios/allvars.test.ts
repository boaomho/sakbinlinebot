import { describe, it, expect } from "vitest";
import { productsRows, promoRows, varsRows, PRICING_CONFIG } from "../harness/botlib-fixture";
import { resolveCatalogVars, resolveDeliveryVar, buildAllowedPriceStrings } from "@/lib/core/pricing";
import { bangkokDeliveryDay } from "@/lib/core/time";
import { resolvePendingVars, resolveAllVars, resolveConfigVars, loadLiveVars, resolveCsvVars, findBadPrices, KNOWN_RUNTIME_VARS, AllVarsContext } from "@/lib/agent/quote";
import { parseReplyIntoMessages } from "@/lib/line";
import type { AppConfig } from "@/lib/config";

/**
 * D-39 · resolveAllVars — resolver รวม pass เดียว (R1+R2+R3 + Group X)
 * verbatim = AI reply ทุกอย่าง ต่างแค่แหล่งข้อความ → post-process ต้องครบ
 */
const NOW = new Date("2026-07-22T03:00:00Z"); // 10:00 เวลาไทย

function stubConfig(entries: [string, string][]): AppConfig {
  return { raw: new Map<string, string>(entries) } as unknown as AppConfig;
}

describe("resolveCatalogVars — สินค้า/โปร live จากชีต", () => {
  it("{ชื่อสินค้า}/{วิธีเก็บรักษา} = สินค้า live ตัวแรก", () => {
    const out = resolveCatalogVars("{ชื่อสินค้า} เก็บ{วิธีเก็บรักษา}", productsRows(), promoRows(), NOW);
    expect(out).toBe("น้ำพริกปลาทูฟรีซดราย เก็บอุณหภูมิห้อง");
  });
  it("{โปรโมชั่นทั้งหมด} = ข้อความโชว์ promo live ทุกแถว (\\n คั่น)", () => {
    const out = resolveCatalogVars("{โปรโมชั่นทั้งหมด}", productsRows(), promoRows(), NOW);
    expect(out).toContain("1 ถ้วย 95 บาท");
    expect(out).toContain("10 ถ้วย");
    expect(out.split("\n").length, "4 โปร live = 4 บรรทัด").toBe(4);
  });
  it("ไม่มี token → คืนเดิม (ไม่แตะ)", () => {
    expect(resolveCatalogVars("สวัสดีค่ะ", productsRows(), promoRows(), NOW)).toBe("สวัสดีค่ะ");
  });
});

describe("resolvePendingVars — ออเดอร์ที่กำลังคุย (ไม่ใช่ snapshot)", () => {
  it("{ชื่อ}/{ที่อยู่เต็ม}/{เบอร์}/{การชำระเงินใหม่} → ค่าจริง", () => {
    const pending = { ชื่อ: "สมชาย", ที่อยู่: "1 ถ.สุข กทม 10110", เบอร์: "0811111111", การชำระเงิน: "โอน" };
    const out = resolvePendingVars("{ชื่อ}\n{ที่อยู่เต็ม}\n{เบอร์}\nจ่าย{การชำระเงินใหม่}", pending);
    expect(out).toBe("สมชาย\n1 ถ.สุข กทม 10110\n0811111111\nจ่ายโอนเงิน");
  });
  it("ค่าว่าง → คงวงเล็บ (var-guard จับ · ไม่ส่งช่องว่าง)", () => {
    expect(resolvePendingVars("ชื่อ {ชื่อ}", {})).toBe("ชื่อ {ชื่อ}");
  });
  it("🔴 {ชื่อ} ไม่ชน {ชื่อสินค้า}/{ชื่อบัญชี} (คนละ token)", () => {
    const out = resolvePendingVars("{ชื่อสินค้า} {ชื่อบัญชี} {ชื่อ}", { ชื่อ: "ป" });
    expect(out).toBe("{ชื่อสินค้า} {ชื่อบัญชี} ป");
  });
});

describe("bangkokDeliveryDay + resolveDeliveryVar", () => {
  it("ก่อนตัดรอบ = วันนี้ · เท่า/หลัง = พรุ่งนี้", () => {
    expect(bangkokDeliveryDay("18:00", NOW), "10:00 < 18:00").toBe("วันนี้");
    expect(bangkokDeliveryDay("18:00", new Date("2026-07-22T13:00:00Z")), "20:00 ≥ 18:00").toBe("พรุ่งนี้");
    expect(bangkokDeliveryDay("10:00", NOW), "เท่ากันพอดี = พรุ่งนี้").toBe("พรุ่งนี้");
  });
  it("cutoff อ่านไม่ได้ → null · resolveDeliveryVar คงวงเล็บ (ไม่เดาวัน)", () => {
    expect(bangkokDeliveryDay("", NOW)).toBeNull();
    expect(bangkokDeliveryDay("25:00", NOW)).toBeNull();
    expect(resolveDeliveryVar("ส่ง{วันจัดส่ง}ค่ะ", "", NOW)).toBe("ส่ง{วันจัดส่ง}ค่ะ");
    expect(resolveDeliveryVar("ส่ง{วันจัดส่ง}ค่ะ", "18:00", NOW)).toBe("ส่งวันนี้ค่ะ");
  });
});

describe("resolveAllVars — pass เดียว ครบทุกกลุ่ม", () => {
  const ctx: AllVarsContext = {
    priceVars: { summary: "น้ำพริก x3", total: 275, payment: "โอนเงิน", breakdown: "", nextTierOffer: "" },
    config: stubConfig([["เลขที่บัญชี", "1234567890"], ["ชื่อบัญชี", "ร้านสากบิน"], ["ธนาคาร", "กสิกร"], ["เวลาตัดรอบออเดอร์", "18:00"]]),
    lastOrder: null,
    lastOrderItemsText: "",
    pending: { ชื่อ: "สมชาย", ที่อยู่: "1 ถ.สุข", เบอร์: "0811111111", การชำระเงิน: "โอน" },
    products: productsRows(),
    promo: promoRows(),
    varsRows: [],
    now: NOW,
  };
  it("R1+R2 + catalog + pending + delivery ครบในครั้งเดียว", () => {
    const t = "{สรุปรายการ} {ยอดรวม}บาท โอน{เลขที่บัญชี} {ชื่อสินค้า} {ชื่อ} ส่ง{วันจัดส่ง}";
    expect(resolveAllVars(t, ctx)).toBe("น้ำพริก x3 275บาท โอน1234567890 น้ำพริกปลาทูฟรีซดราย สมชาย ส่งวันนี้");
  });
  it("🔴 AI-parity: ข้อความไม่มี token → ไม่ถูกแตะ (โหมดเปิดไม่ regression)", () => {
    expect(resolveAllVars("สวัสดีค่ะ รับอะไรดีคะ 😊", ctx)).toBe("สวัสดีค่ะ รับอะไรดีคะ 😊");
  });
  it("KNOWN_RUNTIME_VARS ครอบทุกกลุ่ม (pricing/transfer/order/catalog/pending/delivery)", () => {
    for (const v of ["{ยอดรวม}", "{เลขที่บัญชี}", "{ออเดอร์_ที่อยู่}", "{ชื่อสินค้า}", "{ที่อยู่เต็ม}", "{วันจัดส่ง}"]) {
      expect(KNOWN_RUNTIME_VARS).toContain(v);
    }
  });
});

describe("D-43 · catalog/config/composed/CSV_Vars resolvers", () => {
  it("catalog ใหม่: {เลข อย.}/{ราคาต่อหน่วย}/{รูปสินค้า}(URL ดิบ)", () => {
    const out = resolveCatalogVars("{เลข อย.} {ราคาต่อหน่วย} [[รูป:{รูปสินค้า}]]", productsRows(), promoRows(), NOW);
    expect(out).toBe("22-2-02365-6-0041 95 [[รูป:https://ex/npt.jpg]]");
  });
  it("🔴 {รูปสินค้า} ว่าง → ตัด wrapper [[รูป:...]] ทิ้ง · บอลลูนข้อความยังอยู่", () => {
    const noImg = productsRows().map((r, i) => (i === 1 ? r.map((c, j) => (j === 11 ? "" : c)) : r)); // col 11 = รูปสินค้า
    expect(resolveCatalogVars("ดูสินค้า[[รูป:{รูปสินค้า}]]สวยมั้ยคะ", noImg, promoRows(), NOW)).toBe("ดูสินค้าสวยมั้ยคะ");
  });
  it("{โปรแนะนำ} = โปร live ที่ประหยัดสูงสุด (P10 ประหยัด 100)", () => {
    expect(resolveCatalogVars("{โปรแนะนำ}", productsRows(), promoRows(), NOW)).toContain("10 ถ้วย");
  });

  it("config: {ค่าส่ง_มาตรฐาน}/{ยอดขั้นต่ำส่งฟรี_บาท}/{นโยบายค่าส่ง}", () => {
    const cfg = { raw: new Map([["ค่าส่ง_มาตรฐาน", "30"], ["ยอดขั้นต่ำส่งฟรี_บาท", "275"]]) } as unknown as AppConfig;
    expect(resolveConfigVars("ส่ง{ค่าส่ง_มาตรฐาน} · {นโยบายค่าส่ง}", cfg)).toBe("ส่ง30 · ค่าส่ง 30 บาทค่ะ สั่งครบ 275 บาท ส่งฟรีเลยค่ะ");
  });
  it("🔴 {นโยบายค่าส่ง} เลข 30/275 ไม่โดน price-guard ทิ้ง (buildAllowedPriceStrings ครอบ config)", () => {
    const cfg = { raw: new Map([["ค่าส่ง_มาตรฐาน", "30"], ["ยอดขั้นต่ำส่งฟรี_บาท", "275"]]) } as unknown as AppConfig;
    const resolved = resolveConfigVars("{นโยบายค่าส่ง}", cfg);
    const allowed = buildAllowedPriceStrings(productsRows(), promoRows(), { ...PRICING_CONFIG }, "", NOW);
    expect(findBadPrices(resolved, allowed), "30/275 ต้องอยู่ใน allowed").toEqual([]);
  });

  it("CSV_Vars: loadLiveVars กรอง draft + แถวกติกา (เหลือ live)", () => {
    const live = loadLiveVars(varsRows());
    expect(live.map((v) => v.name)).toEqual(["{สัดส่วนปลาทู}"]);
  });
  it("🔴 CSV_Vars ชื่อชนตัวแปรระบบ → ระบบชนะ ({ชื่อสินค้า} ไม่ถูกแทนด้วยค่า Vars)", () => {
    const rows = [["ตัวแปร", "ค่า", "หมายเหตุ", "สถานะ"], ["{ชื่อสินค้า}", "ของปลอม", "", "live"], ["{สัดส่วนปลาทู}", "45%", "", "live"]];
    expect(resolveCsvVars("{ชื่อสินค้า} {สัดส่วนปลาทู}", rows, KNOWN_RUNTIME_VARS)).toBe("{ชื่อสินค้า} 45%");
  });
  it("KNOWN_RUNTIME_VARS ครอบ catalog/config ใหม่", () => {
    for (const v of ["{เลข อย.}", "{ราคาต่อหน่วย}", "{นโยบายค่าส่ง}", "{ค่าส่ง_มาตรฐาน}"]) expect(KNOWN_RUNTIME_VARS).toContain(v);
  });
});

describe("parseReplyIntoMessages — [[แยก]] alias + รูป + \\n", () => {
  it("[[แยก]] แยกบอลลูนเหมือน [[เว้น]]", () => {
    expect(parseReplyIntoMessages("ก[[แยก]]ข").length).toBe(2);
    expect(parseReplyIntoMessages("ก[[เว้น]]ข").length).toBe(2);
    expect(parseReplyIntoMessages("ก[[แยก]]ข[[เว้น]]ค").length).toBe(3);
  });
  it("[[รูป:url]] → image message (แทรกกลาง ปิดท้ายข้อความ)", () => {
    const msgs = parseReplyIntoMessages("ดูรูปนะคะ[[รูป:https://ex/p.jpg]]สนใจไหมคะ");
    expect(msgs.map((m) => m.type)).toEqual(["text", "image", "text"]);
  });
  it("\\n\\n คงในบอลลูน (LINE render เอง)", () => {
    const msgs = parseReplyIntoMessages("บรรทัด1\n\nบรรทัด2");
    expect(msgs.length).toBe(1);
    expect((msgs[0] as { text: string }).text).toContain("\n\n");
  });
});
