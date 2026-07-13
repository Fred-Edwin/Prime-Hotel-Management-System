import { describe, expect, it } from "vitest";
import {
  calculateIngredientEntryTotals,
  calculateStockEntryTotals,
  isIngredientEntryOversold,
  isLowStock,
  isStockEntryOversold,
  netProfit,
  orderTotal,
  totalStock,
  weekEndSunday,
  weekStartMonday,
} from "./calculations";

describe("totalStock", () => {
  it("sums opening and added stock", () => {
    expect(totalStock(10, 5)).toBe(15);
  });
});

describe("calculateStockEntryTotals", () => {
  it("computes closing stock and derived values per §3's formulas", () => {
    const result = calculateStockEntryTotals({
      openingStock: 20,
      addedStock: 10,
      sentOut: 5,
      quantitySold: 15,
      wastage: 2,
      sellingPriceSnapshot: 50,
      buyingPriceSnapshot: 30,
    });

    // total_stock = 30, closing = 30 - 5 - 15 - 2 = 8
    expect(result.closingStock).toBe(8);
    expect(result.salesValue).toBe(750); // 15 * 50
    expect(result.costValue).toBe(450); // 15 * 30
    expect(result.closingStockValue).toBe(240); // 8 * 30
    expect(result.wastageValue).toBe(60); // 2 * 30
  });

  it("values wastage at buying price, never selling price", () => {
    const result = calculateStockEntryTotals({
      openingStock: 10,
      addedStock: 0,
      sentOut: 0,
      quantitySold: 0,
      wastage: 4,
      sellingPriceSnapshot: 100,
      buyingPriceSnapshot: 20,
    });

    expect(result.wastageValue).toBe(80); // 4 * 20, not 4 * 100
  });
});

describe("isStockEntryOversold", () => {
  it("rejects when sent_out + quantity_sold + wastage exceeds total_stock", () => {
    expect(
      isStockEntryOversold({
        openingStock: 10,
        addedStock: 0,
        sentOut: 0,
        quantitySold: 8,
        wastage: 3,
      }),
    ).toBe(true);
  });

  it("allows exactly using up total_stock", () => {
    expect(
      isStockEntryOversold({
        openingStock: 10,
        addedStock: 0,
        sentOut: 0,
        quantitySold: 8,
        wastage: 2,
      }),
    ).toBe(false);
  });
});

describe("calculateIngredientEntryTotals", () => {
  it("computes closing stock and values per §3's ingredient formula", () => {
    const result = calculateIngredientEntryTotals({
      openingStock: 5,
      received: 10,
      quantityUsed: 8,
      wastage: 1,
      buyingPriceSnapshot: 40,
    });

    // closing = 5 + 10 - 8 - 1 = 6
    expect(result.closingStock).toBe(6);
    expect(result.closingStockValue).toBe(240); // 6 * 40
    expect(result.wastageValue).toBe(40); // 1 * 40
  });
});

describe("isIngredientEntryOversold", () => {
  it("rejects quantity_used + wastage exceeding opening_stock + received", () => {
    expect(
      isIngredientEntryOversold({
        openingStock: 5,
        received: 5,
        quantityUsed: 9,
        wastage: 2,
      }),
    ).toBe(true);
  });

  it("allows exactly using up available ingredient stock", () => {
    expect(
      isIngredientEntryOversold({
        openingStock: 5,
        received: 5,
        quantityUsed: 9,
        wastage: 1,
      }),
    ).toBe(false);
  });
});

describe("weekStartMonday", () => {
  it("returns the same date when given a Monday", () => {
    expect(weekStartMonday(new Date("2026-07-06T12:00:00Z"))).toBe("2026-07-06");
  });

  it("returns the prior Monday for a mid-week date", () => {
    expect(weekStartMonday(new Date("2026-07-09T08:00:00Z"))).toBe("2026-07-06");
  });

  it("treats Sunday as the end of the same week, not a new one", () => {
    expect(weekStartMonday(new Date("2026-07-12T23:00:00Z"))).toBe("2026-07-06");
  });

  it("correctly carries a week across a month boundary", () => {
    // 2026-07-27 is a Monday; the week containing 2026-07-30 (Thursday) starts there.
    expect(weekStartMonday(new Date("2026-07-30T00:00:00Z"))).toBe("2026-07-27");
  });
});

describe("weekEndSunday", () => {
  it("returns the Sunday six days after a Monday week start", () => {
    expect(weekEndSunday("2026-07-06")).toBe("2026-07-12");
  });

  it("correctly crosses a month boundary", () => {
    expect(weekEndSunday("2026-07-27")).toBe("2026-08-02");
  });
});

describe("orderTotal", () => {
  it("sums item lines plus the delivery fee snapshot", () => {
    const total = orderTotal({
      items: [
        { quantity: 2, sellingPriceSnapshot: 50 },
        { quantity: 1, sellingPriceSnapshot: 120 },
      ],
      deliveryFeeSnapshot: 100,
    });
    // (2*50) + (1*120) + 100 = 320
    expect(total).toBe(320);
  });

  it("is unaffected by fee for pickup orders (fee snapshot 0)", () => {
    const total = orderTotal({
      items: [{ quantity: 3, sellingPriceSnapshot: 40 }],
      deliveryFeeSnapshot: 0,
    });
    expect(total).toBe(120);
  });
});

describe("netProfit", () => {
  it("subtracts cost, expenses, and combined wastage from sales (§3.3)", () => {
    // sales 1000, cost 400, expenses 150, wastage (stock 30 + ingredient 20) = 50
    expect(
      netProfit({ salesValue: 1000, costValue: 400, expenses: 150, wastageValue: 50 }),
    ).toBe(400);
  });

  it("can go negative when costs exceed sales", () => {
    expect(
      netProfit({ salesValue: 100, costValue: 200, expenses: 50, wastageValue: 10 }),
    ).toBe(-160);
  });
});

describe("isLowStock", () => {
  it("flags closing stock at or below the threshold", () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(4, 5)).toBe(true);
  });

  it("does not flag closing stock above the threshold", () => {
    expect(isLowStock(6, 5)).toBe(false);
  });
});
