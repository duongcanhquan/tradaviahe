import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProductUnits,
  normalizeUnitsForSave,
  toBaseQty,
  defaultReceiveUnit,
  assertCanSellStock,
} from "./packaging.js";
import {
  buildSaleLineFromProduct,
  sumSaleCogs,
  isCountableCogsStatus,
} from "./cogs.js";
import { checkStockDeltas, stockDeltasForSaleItems } from "./stock.js";

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

describe("normalizeUnitsForSave", () => {
  it("syncs price/cost/unit from factor-1 unit", () => {
    const out = normalizeUnitsForSave({
      costMode: "manual",
      unit: "bao",
      price: 999,
      cost: 888,
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
    });
    assert.equal(out.price, 25000);
    assert.equal(out.cost, 18000);
    assert.equal(out.unit, "bao");
    assert.equal(out.packaging.baseUnit, "bao");
    assert.equal(out.units.length, 2);
  });

  it("rejects recipe + packaging enabled", () => {
    assert.throws(() =>
      normalizeUnitsForSave({
        costMode: "recipe",
        packaging: { enabled: true },
        units: [{ id: "ly", label: "ly", factor: 1, sellPrice: 5000 }],
      })
    );
  });

  it("requires factor-1 unit when enabled", () => {
    assert.throws(() =>
      normalizeUnitsForSave({
        costMode: "manual",
        packaging: { enabled: true },
        units: [{ id: "cay", label: "cây", factor: 10, sellPrice: 220000 }],
      })
    );
  });

  it("skips when packaging key absent", () => {
    assert.deepEqual(
      normalizeUnitsForSave({ costMode: "manual", price: 100, unit: "cái" }),
      { stripPackaging: false, skip: true }
    );
  });

  it("strips packaging on explicit disable", () => {
    assert.deepEqual(normalizeUnitsForSave({ packaging: { enabled: false } }), {
      stripPackaging: true,
    });
  });

  it("syncs packaging when enabled", () => {
    const out = normalizeUnitsForSave({
      costMode: "manual",
      packaging: { enabled: true, baseUnit: "bao" },
      units: [
        {
          id: "bao",
          label: "bao",
          factor: 1,
          sellPrice: 25000,
          sellCost: 18000,
        },
      ],
    });
    assert.equal(out.packaging.enabled, true);
    assert.equal(out.units.length, 1);
    assert.equal(out.price, 25000);
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

describe("stock", () => {
  it("checkStockDeltas blocks negative stock", () => {
    assert.throws(() =>
      checkStockDeltas(
        {
          p1: { inStock: 2, name: "Thuốc X" },
        },
        {
          p1: -3,
        }
      )
    );
  });

  it("stockDeltasForSaleItems uses baseQty for non-recipe", () => {
    const line = buildSaleLineFromProduct(medicine, { qty: 2, unitId: "cay" });
    const deltas = stockDeltasForSaleItems([line], -1);
    assert.equal(deltas.p1, -20);
  });

  it("stockDeltasForSaleItems falls back to qty × unitFactor", () => {
    const deltas = stockDeltasForSaleItems(
      [{ productId: "p1", qty: 2, unitFactor: 10, costMode: "manual" }],
      -1
    );
    assert.equal(deltas.p1, -20);
  });

  it("stockDeltasForSaleItems recipe branch ignores baseQty", () => {
    const deltas = stockDeltasForSaleItems(
      [
        {
          productId: "drink",
          qty: 2,
          baseQty: 999,
          costMode: "recipe",
          recipe: [{ productId: "tea", qty: 5, phase: "serve" }],
        },
      ],
      -1
    );
    assert.equal(deltas.drink, undefined);
    assert.equal(deltas.tea, -10);
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
