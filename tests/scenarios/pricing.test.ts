import { describe, it, expect } from "vitest";
import { calculatePrice, PriceInput } from "@/lib/core/pricing";

/**
 * lib/core/pricing.ts — กฎ a–k (D-15) · ตัวเลขยืนยันจากเจ้าของ (NPT-10G):
 * 1=125 · 2=220 · 3=275 · 4=367 · 5=440 · 6=528 · 9=792 · 10=850 · 11=935
 * ชั้นโปรจริง {1:95, 3:275, 5:440, 10:850} + ราคาปกติ/หน่วย 95 · ค่าส่ง 30 · ส่งฟรี≥275 · เพดาน 10×2=20
 */

// header จริงมี 13 คอลัมน์ — fixture ใส่เฉพาะที่ pricing อ่าน (resolveCols แมปตามชื่อ ไม่สนลำดับ)
const PRODUCTS: string[][] = [
  ["sku", "ชื่อสินค้า", "ราคาปกติ_ต่อหน่วย", "สถานะ"],
  ["NPT-10G", "น้ำพริกปลาทูฟรีซดราย", "95", "live"],
  ["NPR-200ML", "น้ำปลาร้าคุณนาย", "90", "coming_soon"], // ยังไม่ขาย
  ["NPT-20G", "น้ำพริกปลาทูถ้วยใหญ่", "150", "live"], // live แต่ไม่มีโปร → ราคาปกติ
];

const PROMO_HEADER = ["promo_id", "sku", "จำนวน", "ราคาโปร", "เริ่มใช้", "สิ้นสุด", "สถานะ", "ข้อความโชว์ (auto)"];
const PROMOS: string[][] = [
  PROMO_HEADER,
  ["P1", "NPT-10G", "1", "95", "2026-07-01", "", "live", "น้ำพริกปลาทู 1 ถ้วย 95 บาท ค่าส่ง 30 บาท"],
  ["P3", "NPT-10G", "3", "275", "2026-07-01", "", "live", "3 ถ้วย จากปกติ 285 ลดเหลือ 275 ส่งฟรี"],
  ["P5", "NPT-10G", "5", "440", "2026-07-01", "", "live", "5 ถ้วย จากปกติ 475 ลดเหลือ 440 ส่งฟรี"],
  ["P10", "NPT-10G", "10", "850", "2026-07-01", "", "live", "10 ถ้วย จากปกติ 950 ลดเหลือ 850 ส่งฟรี"],
  ["หมายเหตุ: ช่องพื้นฟ้า = คนกรอก · ช่อง (auto) = สูตร", "", "", "", "", "", "", ""], // แถวหมายเหตุ sku ว่าง
  ["PX", "NPT-10G", "5", "400", "2026-06-01", "2026-07-10", "live", "โปรหมดอายุ"], // สิ้นสุดผ่านมาแล้ว
];

const CONFIG: Record<string, string> = {
  ยอดขั้นต่ำส่งฟรี_บาท: "275",
  ค่าส่ง_มาตรฐาน: "30",
  ค่าส่ง_COD_เพิ่ม: "0",
  เพดานจำนวน_คูณโปรใหญ่สุด: "2",
};

const NOW = new Date("2026-07-18T03:00:00Z"); // ไทย 2026-07-18 10:00

function calc(items: { sku: string; qty: number }[], paymentMethod = "โอน", cfg = CONFIG) {
  const input: PriceInput = { items, paymentMethod, now: NOW };
  return calculatePrice(input, PROMOS, PRODUCTS, cfg);
}

describe("pricing — ตัวเลขยืนยัน NPT-10G (qty 1-12, โอน)", () => {
  const expected: Record<number, number> = {
    1: 125, 2: 220, 3: 275, 4: 367, 5: 440, 6: 528, 7: 616, 8: 704, 9: 792, 10: 850, 11: 935, 12: 1020,
  };
  for (const [qtyStr, total] of Object.entries(expected)) {
    const qty = Number(qtyStr);
    it(`qty ${qty} → total ${total}`, () => {
      const r = calc([{ sku: "NPT-10G", qty }]);
      expect(r.error).toBeNull();
      expect(r.total, `qty ${qty}`).toBe(total);
    });
  }

  it("qty 3 = โปรพอดี → exactPromoMessage มีค่า + ส่งฟรี (subtotal 275 ≥ 275)", () => {
    const r = calc([{ sku: "NPT-10G", qty: 3 }]);
    expect(r.shippingFee).toBe(0);
    expect(r.subtotal).toBe(275);
    expect(r.lines[0].exactPromoMessage).toContain("3 ถ้วย");
    expect(r.lines[0].basePromoId).toBe("P3");
  });

  it("qty 4 = ไม่ตรงโปร → exactPromoMessage null · ceil ที่ line (366.67→367)", () => {
    const r = calc([{ sku: "NPT-10G", qty: 4 }]);
    expect(r.lines[0].exactPromoMessage).toBeNull();
    expect(r.lines[0].basePromoId).toBe("P3");
    expect(r.lines[0].lineTotal).toBe(367);
  });

  it("qty 1 = ต่ำกว่าส่งฟรี → +ค่าส่ง 30 (95+30=125)", () => {
    const r = calc([{ sku: "NPT-10G", qty: 1 }]);
    expect(r.subtotal).toBe(95);
    expect(r.shippingFee).toBe(30);
    expect(r.total).toBe(125);
  });
});

describe("pricing — เพดานจำนวน (10×2=20)", () => {
  it("qty 20 → ผ่าน (needsHandoff false)", () => {
    const r = calc([{ sku: "NPT-10G", qty: 20 }]);
    expect(r.error).toBeNull();
    expect(r.needsHandoff).toBe(false);
  });
  it("qty 21 → needsHandoff true (ห้ามปิดเอง) แต่ยังคำนวณได้ error null", () => {
    const r = calc([{ sku: "NPT-10G", qty: 21 }]);
    expect(r.error).toBeNull();
    expect(r.needsHandoff).toBe(true);
  });
  it("รวมหลาย sku เกินเพดานรวม → needsHandoff true", () => {
    const r = calc([{ sku: "NPT-10G", qty: 11 }, { sku: "NPT-20G", qty: 10 }]); // รวม 21
    expect(r.needsHandoff).toBe(true);
  });
});

describe("pricing — หลาย sku", () => {
  it("NPT-10G x3 (โปร 275) + NPT-20G x2 (ปกติ 150×2=300) = subtotal 575 ส่งฟรี", () => {
    const r = calc([{ sku: "NPT-10G", qty: 3 }, { sku: "NPT-20G", qty: 2 }]);
    expect(r.error).toBeNull();
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1].basePromoId).toBeNull(); // NPT-20G ไม่มีโปร → ราคาปกติ
    expect(r.lines[1].lineTotal).toBe(300);
    expect(r.subtotal).toBe(575);
    expect(r.shippingFee).toBe(0);
    expect(r.total).toBe(575);
  });
});

describe("pricing — error (ห้ามเขียนชีต ห้ามพูดยอด → push แอดมิน)", () => {
  it("sku ไม่รู้จัก → error + needsHandoff", () => {
    const r = calc([{ sku: "NPX-999", qty: 2 }]);
    expect(r.error).toMatch(/ไม่รู้จัก/);
    expect(r.needsHandoff).toBe(true);
    expect(r.lines).toHaveLength(0);
  });
  it("sku ไม่ live (coming_soon) → error", () => {
    const r = calc([{ sku: "NPR-200ML", qty: 1 }]);
    expect(r.error).toMatch(/ไม่ได้ขาย|coming_soon/);
  });
  it("qty 0 → error", () => {
    const r = calc([{ sku: "NPT-10G", qty: 0 }]);
    expect(r.error).toMatch(/จำนวนไม่ถูกต้อง/);
  });
  it("qty ติดลบ → error", () => {
    const r = calc([{ sku: "NPT-10G", qty: -3 }]);
    expect(r.error).toMatch(/จำนวนไม่ถูกต้อง/);
  });
  it("qty ไม่เต็มจำนวน (2.5) → error", () => {
    const r = calc([{ sku: "NPT-10G", qty: 2.5 }]);
    expect(r.error).toMatch(/จำนวนไม่ถูกต้อง/);
  });
});

describe("pricing — items ว่าง = ยังไม่สั่ง (ไม่ใช่ error ไม่ push)", () => {
  it("[] → ทุกค่า 0 · error null · needsHandoff false", () => {
    const r = calc([]);
    expect(r).toEqual({ lines: [], subtotal: 0, shippingFee: 0, total: 0, nextTier: null, error: null, needsHandoff: false });
  });
});

describe("pricing — โปรหมดอายุต้องไม่ถูกใช้", () => {
  it("PX (สิ้นสุด 2026-07-10 < วันนี้) ถูกข้าม → qty5 ใช้ P5=440 ไม่ใช่ PX=400", () => {
    const r = calc([{ sku: "NPT-10G", qty: 5 }]);
    expect(r.lines[0].basePromoId).toBe("P5");
    expect(r.total).toBe(440);
  });
  it("โปรที่ยังไม่ถึงวันเริ่ม (เริ่มใช้อนาคต) ก็ถูกข้าม", () => {
    const future: string[][] = [
      PROMO_HEADER,
      ["PF", "NPT-10G", "3", "200", "2027-01-01", "", "live", "โปรอนาคต"],
      ["P1", "NPT-10G", "1", "95", "2026-07-01", "", "live", "1 ถ้วย"],
    ];
    const r = calculatePrice({ items: [{ sku: "NPT-10G", qty: 3 }], paymentMethod: "โอน", now: NOW }, future, PRODUCTS, CONFIG);
    // PF ยังไม่เริ่ม → base = P1 (qty1) → 95 + 2×95 = 285, ไม่ใช่ 200
    expect(r.lines[0].basePromoId).toBe("P1");
    expect(r.subtotal).toBe(285);
  });
});

describe("pricing — แถวหมายเหตุ (sku ว่าง) ต้องไม่ถูก parse เป็นโปร", () => {
  it("มีแถวหมายเหตุใน fixture แต่คำนวณ qty1 ยังถูก (125)", () => {
    const r = calc([{ sku: "NPT-10G", qty: 1 }]);
    expect(r.error).toBeNull();
    expect(r.total).toBe(125);
  });
});

describe("pricing — COD surcharge", () => {
  const codCfg = { ...CONFIG, ค่าส่ง_COD_เพิ่ม: "15" };
  it("COD qty1 → 95 + ค่าส่ง 30 + COD 15 = 140", () => {
    const r = calc([{ sku: "NPT-10G", qty: 1 }], "COD", codCfg);
    expect(r.shippingFee).toBe(45);
    expect(r.total).toBe(140);
  });
  it("โอน qty1 (config เดียวกัน) → ไม่บวก COD = 125", () => {
    const r = calc([{ sku: "NPT-10G", qty: 1 }], "โอน", codCfg);
    expect(r.shippingFee).toBe(30);
    expect(r.total).toBe(125);
  });
  it("COD + subtotal ถึงส่งฟรี → ค่าส่ง 0 แต่ยังบวก COD surcharge", () => {
    const r = calc([{ sku: "NPT-10G", qty: 3 }], "COD", codCfg); // sub275 ส่งฟรี
    expect(r.shippingFee).toBe(15); // 0 + COD 15
    expect(r.total).toBe(290);
  });
});

describe("pricing — ไม่มีโปร live เลย → handoff ทุกออเดอร์ (ห้าม fallback เลขคงที่)", () => {
  it("promoRows มีแค่ header+หมายเหตุ → needsHandoff true (ยังคิดราคาปกติได้)", () => {
    const noPromo: string[][] = [PROMO_HEADER, ["หมายเหตุ", "", "", "", "", "", "", ""]];
    const r = calculatePrice({ items: [{ sku: "NPT-10G", qty: 1 }], paymentMethod: "โอน", now: NOW }, noPromo, PRODUCTS, CONFIG);
    expect(r.needsHandoff).toBe(true);
    expect(r.lines[0].lineTotal).toBe(95); // ราคาปกติ
    expect(r.total).toBe(125);
  });
});

describe("pricing — แจกแจง (basePromo/extra/nextTier) สำหรับ upsell", () => {
  it("🔴 extraAmount + basePromo.price = lineTotal เสมอ (ทุก qty 1-20 ไม่มีเคสบวกไม่ลง)", () => {
    for (let qty = 1; qty <= 20; qty++) {
      const r = calc([{ sku: "NPT-10G", qty }]);
      const l = r.lines[0];
      if (l.basePromo) {
        expect(l.basePromo.price + l.extraAmount, `qty ${qty}: base+extra ต้องเท่า lineTotal`).toBe(l.lineTotal);
      }
    }
  });

  it("qty 4 → basePromo P3, extraQty 1, extraAmount 92, nextTier P5 addQty 1 addAmount 73", () => {
    const r = calc([{ sku: "NPT-10G", qty: 4 }]);
    expect(r.lines[0].basePromo).toEqual({ promoId: "P3", qty: 3, price: 275 });
    expect(r.lines[0].extraQty).toBe(1);
    expect(r.lines[0].extraAmount).toBe(92); // 367 − 275
    expect(r.lines[0].isExactTier).toBe(false);
    expect(r.nextTier).toEqual({ promoId: "P5", qty: 5, price: 440, addQty: 1, addAmount: 73 }); // 440 − 367
  });

  it("qty 3 → isExactTier true (ตรงชั้น) · extraAmount 0", () => {
    const r = calc([{ sku: "NPT-10G", qty: 3 }]);
    expect(r.lines[0].isExactTier).toBe(true);
    expect(r.lines[0].extraAmount).toBe(0);
  });

  it("qty 11 → nextTier null (เกินโปรใหญ่สุด 10)", () => {
    const r = calc([{ sku: "NPT-10G", qty: 11 }]);
    expect(r.nextTier).toBeNull();
  });

  it("🔴 เปลี่ยนราคา P5 440→400 ใน fixture → nextTier.price/addAmount เปลี่ยนตาม (ไม่ hardcode)", () => {
    const promoAlt = PROMOS.map((row) => (row[0] === "P5" ? row.map((c, i) => (i === 3 ? "400" : c)) : row));
    const r = calculatePrice({ items: [{ sku: "NPT-10G", qty: 4 }], paymentMethod: "โอน", now: NOW }, promoAlt, PRODUCTS, CONFIG);
    expect(r.nextTier?.price).toBe(400);
    expect(r.nextTier?.addAmount).toBe(33); // 400 − 367
  });
});

describe("pricing — config ตัวเลขอ่านไม่ได้ → error (ไม่ hardcode fallback)", () => {
  it("ขาด ยอดขั้นต่ำส่งฟรี_บาท → error + needsHandoff", () => {
    const bad = { ...CONFIG };
    delete bad.ยอดขั้นต่ำส่งฟรี_บาท;
    const r = calc([{ sku: "NPT-10G", qty: 3 }], "โอน", bad);
    expect(r.error).toMatch(/CSV_Config/);
    expect(r.needsHandoff).toBe(true);
  });
});
