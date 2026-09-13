import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecipe,
  computeRecipeCost,
  RECIPE_PHASE,
} from "./recipe.js";

/** resolveUnitCost logic mirrored (products.js pulls Firebase) */
function resolveUnitCost(product, productsById = {}) {
  if (!product) return 0;
  if (product.kind === "finished" && product.costMode === "recipe") {
    const servings = Math.max(1, Number(product.estimatedServings) || 100);
    const batchCost = computeRecipeCost(
      product.recipe,
      productsById,
      RECIPE_PHASE.BATCH
    );
    const serveCost = computeRecipeCost(
      product.recipe,
      productsById,
      RECIPE_PHASE.SERVE
    );
    return batchCost / servings + serveCost;
  }
  return Number(product.cost) || 0;
}

describe("recipe virtual lines", () => {
  it("normalizeRecipe keeps virtual lines without productId", () => {
    const lines = normalizeRecipe([
      { productId: "noodle", qty: 1, phase: RECIPE_PHASE.SERVE },
      {
        virtual: true,
        name: "Đá",
        qty: 1,
        unitCost: 200,
        phase: RECIPE_PHASE.SERVE,
      },
      { productId: "", qty: 1, virtual: false },
    ]);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].virtual, true);
    assert.equal(lines[1].name, "Đá");
    assert.equal(lines[1].unitCost, 200);
  });

  it("computeRecipeCost adds virtual unitCost", () => {
    const byId = {
      noodle: { id: "noodle", cost: 4000 },
      egg: { id: "egg", cost: 3000 },
    };
    const cost = computeRecipeCost(
      [
        { productId: "noodle", qty: 1, phase: RECIPE_PHASE.SERVE },
        { productId: "egg", qty: 2, phase: RECIPE_PHASE.SERVE },
        {
          virtual: true,
          name: "Nước sôi",
          qty: 1,
          unitCost: 100,
          phase: RECIPE_PHASE.SERVE,
        },
      ],
      byId,
      RECIPE_PHASE.SERVE
    );
    assert.equal(cost, 4000 + 6000 + 100);
  });

  it("resolveUnitCost includes virtual serve lines", () => {
    const product = {
      kind: "finished",
      costMode: "recipe",
      estimatedServings: 100,
      recipe: [
        {
          virtual: true,
          name: "Đá",
          qty: 1,
          unitCost: 200,
          phase: RECIPE_PHASE.SERVE,
        },
      ],
    };
    assert.equal(resolveUnitCost(product, {}), 200);
  });
});
