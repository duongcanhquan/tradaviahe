import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addFundTotals,
  canCloseMonthKey,
  combineLifetimeWithMonth,
  emptyFundTotals,
  nextMonthKey,
  previousMonthKey,
  summarizeRowsForFundClose,
} from "./shopFundCloseMath.js";

describe("shopFundClose pure", () => {
  it("previousMonthKey from mid November → 2026-10", () => {
    assert.equal(previousMonthKey(new Date(2026, 10, 17)), "2026-10");
  });

  it("nextMonthKey rolls year", () => {
    assert.equal(nextMonthKey("2026-12"), "2027-01");
  });

  it("addFundTotals stacks balance", () => {
    const a = { fundIn: 100, cashSales: 50, expense: 20, balance: 130 };
    const b = { fundIn: 10, cashSales: 5, expense: 3, balance: 12 };
    assert.deepEqual(addFundTotals(a, b), {
      fundIn: 110,
      cashSales: 55,
      expense: 23,
      balance: 142,
    });
  });

  it("combineLifetimeWithMonth = chốt + tháng này", () => {
    const close = { fundIn: 1000, cashSales: 500, expense: 200, balance: 1300 };
    const month = { fundIn: 100, cashSales: 80, expense: 50, balance: 130 };
    assert.equal(combineLifetimeWithMonth(close, month).balance, 1430);
  });

  it("empty + month keeps month", () => {
    const month = { fundIn: 10, cashSales: 0, expense: 2, balance: 8 };
    assert.deepEqual(combineLifetimeWithMonth(emptyFundTotals(), month), month);
  });

  it("canCloseMonthKey blocks current month", () => {
    const now = new Date(2026, 10, 17);
    assert.equal(canCloseMonthKey("2026-10", now), true);
    assert.equal(canCloseMonthKey("2026-11", now), false);
  });

  it("summarizeRowsForFundClose uses cash sales + fund", () => {
    const rows = [
      { type: "fund_in", amount: 100000, businessLine: "shop" },
      {
        type: "expense",
        amount: 20000,
        category: "nhập hàng",
        businessLine: "shop",
      },
      {
        type: "income",
        category: "bán hàng",
        source: "pos",
        paymentMethod: "cash",
        amount: 50000,
      },
      {
        type: "income",
        category: "bán hàng",
        source: "pos",
        paymentMethod: "banking",
        amount: 30000,
      },
    ];
    const s = summarizeRowsForFundClose(rows);
    assert.equal(s.fundIn, 100000);
    assert.equal(s.cashSales, 50000);
    assert.equal(s.expense, 20000);
    assert.equal(s.balance, 130000);
  });
});
