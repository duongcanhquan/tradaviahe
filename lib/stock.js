/**
 * Trừ / hoàn kho khi bán hàng:
 * - Món recipe: chỉ trừ NL phase=serve (kèm theo suất)
 * - NL phase=batch đã trừ lúc ghi mẻ pha
 * - Không recipe → trừ chính món bán
 */
import {
  COST_MODE,
  RECIPE_PHASE,
  filterRecipeByPhase,
  normalizeRecipe,
} from "./products";

/**
 * @param {Array} items
 * @param {1 | -1} direction -1 = bán (trừ), +1 = hoàn
 */
export function stockDeltasForSaleItems(items = [], direction = -1) {
  const sign = direction >= 0 ? 1 : -1;
  const deltas = {};

  for (const item of items) {
    const productId = String(item.productId || item.id || "");
    const qty = Number(item.qty) || 0;
    if (!productId || qty <= 0) continue;

    const recipe = normalizeRecipe(item.recipe);
    const useRecipe = item.costMode === COST_MODE.RECIPE;

    if (useRecipe) {
      const serveLines = filterRecipeByPhase(recipe, RECIPE_PHASE.SERVE);
      // Chỉ trừ NL kèm. NL mẻ đã trừ lúc ghi sổ pha.
      // Recipe trống / chỉ có mẻ → không trừ thành phẩm (model pha sẵn).
      for (const line of serveLines) {
        const ingId = String(line.productId || "");
        const lineQty = Number(line.qty) || 0;
        if (!ingId || lineQty <= 0) continue;
        deltas[ingId] = (deltas[ingId] || 0) + sign * lineQty * qty;
      }
    } else {
      deltas[productId] = (deltas[productId] || 0) + sign * qty;
    }
  }

  return deltas;
}

/** Delta trừ NL mẻ: recipe batch × số mẻ */
export function stockDeltasForBatch(product, batchCount = 1) {
  const n = Math.max(0, Number(batchCount) || 0);
  const deltas = {};
  if (!product || n <= 0) return deltas;
  if (product.costMode !== COST_MODE.RECIPE) return deltas;

  const lines = filterRecipeByPhase(product.recipe, RECIPE_PHASE.BATCH);
  for (const line of lines) {
    const ingId = String(line.productId || "");
    const lineQty = Number(line.qty) || 0;
    if (!ingId || lineQty <= 0) continue;
    deltas[ingId] = (deltas[ingId] || 0) - lineQty * n;
  }
  return deltas;
}

export function serializeSaleItems(items = []) {
  return items.map((item) => ({
    productId: String(item.productId || item.id || ""),
    name: String(item.name || ""),
    qty: Number(item.qty) || 0,
    unitPrice: Number(item.unitPrice ?? item.price) || 0,
    costMode:
      item.costMode === COST_MODE.RECIPE ? COST_MODE.RECIPE : COST_MODE.MANUAL,
    recipe: normalizeRecipe(item.recipe),
    estimatedServings: Math.max(1, Number(item.estimatedServings) || 100),
  }));
}

/**
 * Tổng kết tồn kho theo giá nhập (cost).
 */
export function summarizeInventory(products = []) {
  const list = Array.isArray(products) ? products : [];
  let skuCount = 0;
  let totalQty = 0;
  let costValue = 0;
  let sellValue = 0;
  let ingredientQty = 0;
  let ingredientValue = 0;
  let finishedQty = 0;
  let finishedCostValue = 0;
  let finishedSellValue = 0;
  let lowStockCount = 0;

  for (const p of list) {
    if (p?.active === false) continue;
    const qty = Number(p.inStock) || 0;
    const cost = Number(p.cost) || 0;
    const price = Number(p.price) || 0;
    const lineCost = qty * cost;
    const lineSell = qty * price;
    const kind = String(p.kind || "");

    skuCount += 1;
    totalQty += qty;
    costValue += lineCost;
    if (qty <= 5) lowStockCount += 1;

    if (kind === "ingredient") {
      ingredientQty += qty;
      ingredientValue += lineCost;
    } else {
      finishedQty += qty;
      finishedCostValue += lineCost;
      finishedSellValue += lineSell;
      sellValue += lineSell;
    }
  }

  return {
    skuCount,
    totalQty,
    costValue,
    sellValue,
    ingredientQty,
    ingredientValue,
    finishedQty,
    finishedCostValue,
    finishedSellValue,
    lowStockCount,
  };
}

export function lineStockCostValue(product) {
  return (Number(product?.inStock) || 0) * (Number(product?.cost) || 0);
}
