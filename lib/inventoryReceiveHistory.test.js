import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listProductReceiveHistory,
  summarizeProductReceiveHistory,
  fundSourceLabel,
} from "./inventoryReceiveHistory.js";

describe("listProductReceiveHistory", () => {
  it("gộp phiếu quỹ cửa hàng + quỹ đầu tư theo productId, mới nhất trước", () => {
    const transactions = [
      {
        id: "tx1",
        type: "expense",
        category: "nhập hàng",
        source: "inventory_receive",
        productId: "p1",
        amount: 100000,
        receiveQty: 10,
        unit: "gói",
        unitReceivePrice: 10000,
        businessDate: "2026-03-01",
        timestamp: { toMillis: () => Date.parse("2026-03-01T10:00:00Z") },
        createdByName: "An",
        paymentMethod: "cash",
      },
      {
        id: "tx-other",
        type: "expense",
        category: "nhập hàng",
        source: "inventory_receive",
        productId: "p2",
        amount: 50000,
        receiveQty: 5,
        unit: "gói",
      },
      {
        id: "tx-backfill",
        type: "expense",
        category: "nhập hàng",
        source: "inventory_backfill",
        productId: "p1",
        amount: 999,
      },
    ];
    const capitalEntries = [
      {
        id: "cap1",
        kind: "expense",
        source: "inventory_receive",
        productId: "p1",
        amount: 200000,
        receiveQty: 20,
        unit: "gói",
        unitReceivePrice: 10000,
        dateKey: "2026-03-10",
        timestamp: { toMillis: () => Date.parse("2026-03-10T10:00:00Z") },
        createdByName: "Bình",
        paymentMethod: "banking",
      },
    ];

    const rows = listProductReceiveHistory("p1", {
      transactions,
      capitalEntries,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "cap1");
    assert.equal(rows[0].fundSource, "capital");
    assert.equal(rows[0].amount, 200000);
    assert.equal(rows[1].id, "tx1");
    assert.equal(rows[1].fundSource, "shop");
    assert.equal(rows[1].actorLabel, "An");

    const summary = summarizeProductReceiveHistory(rows);
    assert.equal(summary.count, 2);
    assert.equal(summary.totalAmount, 300000);
    assert.equal(summary.totalReceiveQty, 30);
  });

  it("cho phép nhiều lần nhập cùng món với số tiền khác nhau", () => {
    const transactions = [
      {
        id: "a",
        type: "expense",
        source: "inventory_receive",
        category: "nhập hàng",
        productId: "x",
        amount: 50000,
        receiveQty: 5,
        unitReceivePrice: 10000,
        businessDate: "2026-01-01",
        timestamp: { toMillis: () => 1 },
      },
      {
        id: "b",
        type: "expense",
        source: "inventory_receive",
        category: "nhập hàng",
        productId: "x",
        amount: 80000,
        receiveQty: 5,
        unitReceivePrice: 16000,
        businessDate: "2026-02-01",
        timestamp: { toMillis: () => 2 },
      },
    ];
    const rows = listProductReceiveHistory("x", { transactions });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].unitReceivePrice, 16000);
    assert.equal(rows[1].unitReceivePrice, 10000);
  });

  it("fundSourceLabel", () => {
    assert.equal(fundSourceLabel("capital"), "Quỹ đầu tư");
    assert.equal(fundSourceLabel("shop"), "Quỹ cửa hàng");
  });
});
