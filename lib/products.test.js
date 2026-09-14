import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecipe,
  computeRecipeCost,
  RECIPE_PHASE,
  isRecipeStockSource,
  productUsesRecipe,
  isInventoryReceivable,
  ensureRecipeDraftLines,
} from "./recipe.js";

function resolveUnitCost(product, productsById = {}) {
  if (!product) return 0;
  if (product.kind === "finished" && product.costMode === "recipe") {
    return computeRecipeCost(product.recipe, productsById, null, {
      estimatedServings: product.estimatedServings,
    });
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
      byId
    );
    assert.equal(cost, 4000 + 6000 + 100);
  });

  it("resolveUnitCost is serve-only (no batch ÷ suất)", () => {
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

  it("legacy batch line is divided by estimatedServings for cost only", () => {
    const cost = resolveUnitCost(
      {
        kind: "finished",
        costMode: "recipe",
        estimatedServings: 100,
        recipe: [{ productId: "tea", qty: 300, phase: RECIPE_PHASE.BATCH }],
      },
      { tea: { id: "tea", cost: 2, unit: "g" } }
    );
    assert.equal(cost, 6);
  });

  it("old batch+serve cost equals previous mẻ÷suất + kèm", () => {
    const byId = {
      tea: { id: "tea", cost: 2, unit: "g" },
      sugar: { id: "sugar", cost: 0.5, unit: "g" },
    };
    const recipe = [
      { productId: "tea", qty: 300, phase: RECIPE_PHASE.BATCH },
      { productId: "sugar", qty: 15, phase: RECIPE_PHASE.SERVE },
    ];
    const old = (300 * 2) / 100 + 15 * 0.5;
    const next = resolveUnitCost(
      {
        kind: "finished",
        costMode: "recipe",
        estimatedServings: 100,
        recipe,
      },
      byId
    );
    assert.equal(next, old);
    assert.equal(next, 6 + 7.5);
  });
});

describe("productUsesRecipe", () => {
  it("treats legacy món bán (no costMode) as recipe", () => {
    assert.equal(
      productUsesRecipe({ kind: "finished", name: "Trà đá" }),
      true
    );
  });

  it("keeps hàng nhập bán nguyên as manual", () => {
    assert.equal(
      productUsesRecipe({
        kind: "finished",
        costMode: "manual",
        recipe: [],
      }),
      false
    );
  });

  it("uses recipe when CT already has lines", () => {
    assert.equal(
      productUsesRecipe({
        kind: "finished",
        costMode: "manual",
        recipe: [{ productId: "goi-mi", qty: 1 }],
      }),
      true
    );
  });

  it("ensureRecipeDraftLines adds a blank row", () => {
    const draft = ensureRecipeDraftLines([]);
    assert.equal(draft.length, 1);
    assert.equal(draft[0].productId, "");
    assert.equal(ensureRecipeDraftLines([{ productId: "x", qty: "1" }]).length, 1);
  });
});

describe("isInventoryReceivable", () => {
  it("allows NL and thành phẩm nhập, hides món CT", () => {
    assert.equal(
      isInventoryReceivable({ id: "mi", kind: "ingredient", active: true }),
      true
    );
    assert.equal(
      isInventoryReceivable({
        id: "nuoc",
        kind: "finished",
        costMode: "manual",
        recipe: [],
        active: true,
      }),
      true
    );
    assert.equal(
      isInventoryReceivable({
        id: "bat-mi",
        kind: "finished",
        costMode: "recipe",
        recipe: [{ productId: "mi", qty: 1 }],
        active: true,
      }),
      false
    );
    assert.equal(
      isInventoryReceivable({
        kind: "finished",
        name: "Trà đá",
        active: true,
      }),
      false
    );
  });
});

describe("recipe stock sources", () => {
  it("includes NL and thành phẩm nhập, not self or món CT", () => {
    assert.equal(
      isRecipeStockSource({ id: "mi", kind: "ingredient", active: true }),
      true
    );
    assert.equal(
      isRecipeStockSource({
        id: "goi-mi",
        kind: "finished",
        costMode: "manual",
        active: true,
      }),
      true
    );
    assert.equal(
      isRecipeStockSource(
        {
          id: "bat",
          kind: "finished",
          costMode: "recipe",
          recipe: [{ productId: "goi-mi", qty: 1 }],
          active: true,
        }
      ),
      false
    );
    assert.equal(
      isRecipeStockSource(
        { id: "goi-mi", kind: "finished", costMode: "manual" },
        "goi-mi"
      ),
      false
    );
  });
});
