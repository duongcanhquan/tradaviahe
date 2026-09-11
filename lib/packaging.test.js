import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProductUnits,
  toBaseQty,
  defaultReceiveUnit,
  assertCanSellStock,
} from "./packaging.js";
import {
  buildSaleLineFromProduct,
  sumSaleCogs,
  isCountableCogsStatus,
} from "./cogs.js";

const medicine = {
  id: "p1",
  name: "Thuốc X",
  unit: "bao",
  price: 25000,
  cost: 18000,
  inStock: 20,
  costMode: "manual",
  packaging: { enabled: true, baseUnit: "bao" },
  units: [
    {
      id: "bao",
      label: "bao",
      factor: 1,
      sellPrice: 25000,
      sellCost: 18000,
      canSell: true,
      canReceive: true,
    },
    {
      id: "cay",
      label: "cây",
      factor: 10,
      sellPrice: 220000,
      sellCost: 180000,
      canSell: true,
      canReceive: true,
    },
  ],
};

describe("packaging", () => {
  it("toBaseQty cây × 2 = 20 bao", () => {
    const u = normalizeProductUnits(medicine).units.find((x) => x.id === "cay");
    assert.equal(toBaseQty(2, u), 20);
  });

  it("defaultReceiveUnit prefers largest factor", () => {
    assert.equal(defaultReceiveUnit(medicine).id, "cay");
  });

  it("assertCanSellStock blocks oversell", () => {
    assert.throws(() => assertCanSellStock(medicine, "cay", 3));
  });
});

describe("cogs", () => {
  it("snapshots independent sellCost for cây", () => {
    const line = buildSaleLineFromProduct(medicine, { qty: 1, unitId: "cay" });
    assert.equal(line.baseQty, 10);
    assert.equal(line.unitPrice, 220000);
    assert.equal(line.unitCost, 180000);
    assert.equal(line.lineCogs, 180000);
  });

  it("sumSaleCogs", () => {
    const lines = [
      buildSaleLineFromProduct(medicine, { qty: 1, unitId: "bao" }),
      buildSaleLineFromProduct(medicine, { qty: 1, unitId: "cay" }),
    ];
    const s = sumSaleCogs(lines);
    assert.equal(s.cogsTotal, 18000 + 180000);
    assert.equal(s.revenue, 25000 + 220000);
  });
});

describe("pnl", () => {
  it("summarizeShopPnl skips cogsTotal when cogsStatus is unknown", () => {
    const rows = [
      { amount: 100000, cogsTotal: 50000, cogsStatus: "unknown" },
      { amount: 200000, cogsTotal: 80000, cogsStatus: "snapshotted" },
      { amount: 50000, cogsTotal: 20000, cogsStatus: "estimated" },
      { amount: 30000, cogsTotal: 99999, cogsStatus: "SNAPSHOTTED" },
    ];
    let revenue = 0;
    let cogs = 0;
    for (const t of rows) {
      revenue += Number(t.amount) || 0;
      if (isCountableCogsStatus(t.cogsStatus)) {
        cogs += Number(t.cogsTotal) || 0;
      }
    }
    assert.equal(revenue, 380000);
    assert.equal(cogs, 80000 + 20000 + 99999);
  });
});
