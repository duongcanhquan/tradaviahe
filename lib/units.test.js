import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_UNITS,
  formatBaseQty,
  toIngredientBaseQty,
  usageUnitsForIngredient,
} from "./units.js";
import { defaultIngredientPackHint } from "./packaging.js";
import { computeRecipeCost, normalizeRecipe } from "./recipe.js";
import { stockDeltasForSaleItems } from "./stock.js";

const sugar = {
  id: "sugar",
  name: "Đường",
  unit: "g",
  cost: 25,
  packaging: { enabled: true, baseUnit: "g" },
  units: [
    {
      id: "g",
      label: "g",
      factor: 1,
      sellPrice: 0,
      sellCost: 25,
      canSell: false,
      canReceive: true,
    },
    {
      id: "kg",
      label: "kg",
      factor: 1000,
      sellPrice: 0,
      sellCost: 25000,
      canSell: false,
      canReceive: true,
    },
  ],
};

describe("PRODUCT_UNITS quả", () => {
  it("có đơn vị quả (trứng, chanh…)", () => {
    assert.ok(PRODUCT_UNITS.includes("quả"));
  });

  it("gợi ý kiện vỉ × 10 khi gốc là quả", () => {
    assert.deepEqual(defaultIngredientPackHint("quả"), {
      packLabel: "vỉ",
      packFactor: "10",
    });
  });

  it("1 quả trứng gốc quả = 1", () => {
    const egg = {
      id: "egg",
      unit: "quả",
      packaging: { enabled: false, baseUnit: "quả" },
      units: [],
    };
    assert.equal(toIngredientBaseQty(egg, 1, "quả"), 1);
    assert.equal(toIngredientBaseQty(egg, 2, "quả"), 2);
  });
});

describe("usage units", () => {
  it("2 lạng đường gốc g = 200g", () => {
    assert.equal(toIngredientBaseQty(sugar, 2, "lạng"), 200);
  });

  it("0.2 kg đường gốc g = 200g", () => {
    assert.equal(toIngredientBaseQty(sugar, 0.2, "kg"), 200);
  });

  it("lists lạng when base is mass", () => {
    const ids = usageUnitsForIngredient(sugar).map((u) => u.id);
    assert.ok(ids.includes("lạng"));
    assert.ok(ids.includes("g"));
    assert.ok(ids.includes("kg"));
  });

  it("formatBaseQty keeps decimals", () => {
    assert.equal(formatBaseQty(200), "200");
    assert.equal(formatBaseQty(0.12), "0.12");
  });
});

describe("recipe usage → cost + stock", () => {
  it("computeRecipeCost 2 lạng × 25đ/g = 5000", () => {
    const cost = computeRecipeCost(
      [{ productId: "sugar", qty: 2, unitId: "lạng" }],
      { sugar }
    );
    assert.equal(cost, 5000);
  });

  it("legacy qty without unitId stays base unit", () => {
    const lines = normalizeRecipe([{ productId: "sugar", qty: 15 }], {
      sugar,
    });
    assert.equal(lines[0].baseQty, 15);
  });

  it("legacy batch lines are not deducted on sale (kho cũ đã trừ lúc ghi mẻ)", () => {
    const deltas = stockDeltasForSaleItems(
      [
        {
          productId: "drink",
          qty: 1,
          costMode: "recipe",
          estimatedServings: 100,
          recipe: [
            { productId: "tea", qty: 300, phase: "batch" },
            { productId: "sugar", qty: 15, phase: "serve" },
          ],
        },
      ],
      -1
    );
    assert.equal(deltas.tea, undefined);
    assert.equal(deltas.sugar, -15);
  });

  it("stock uses stored baseQty for 2 lạng", () => {
    const deltas = stockDeltasForSaleItems(
      [
        {
          productId: "milk-tea",
          qty: 1,
          costMode: "recipe",
          recipe: [
            { productId: "sugar", qty: 2, unitId: "lạng", baseQty: 200 },
          ],
        },
      ],
      -1
    );
    assert.equal(deltas.sugar, -200);
  });
});
