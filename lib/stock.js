/**
 * Trừ / hoàn kho khi bán hàng (kiểu B):
 * - Món costMode=recipe + có công thức → trừ nguyên liệu
 * - Còn lại → trừ chính món bán
 */
import {
  COST_MODE,
  normalizeRecipe,
} from "./products";

/**
 * @param {Array<{ id?: string, productId?: string, qty: number, costMode?: string, recipe?: unknown }>} items
 * @param {1 | -1} direction -1 = bán (trừ), +1 = hoàn (cộng lại)
 * @returns {Record<string, number>} productId → delta inStock
 */
export function stockDeltasForSaleItems(items = [], direction = -1) {
  const sign = direction >= 0 ? 1 : -1;
  const deltas = {};

  for (const item of items) {
    const productId = String(item.productId || item.id || "");
    const qty = Number(item.qty) || 0;
    if (!productId || qty <= 0) continue;

    const recipe = normalizeRecipe(item.recipe);
    const useRecipe =
      item.costMode === COST_MODE.RECIPE && recipe.length > 0;

    if (useRecipe) {
      for (const line of recipe) {
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

export function serializeSaleItems(items = []) {
  return items.map((item) => ({
    productId: String(item.productId || item.id || ""),
    name: String(item.name || ""),
    qty: Number(item.qty) || 0,
    unitPrice: Number(item.unitPrice ?? item.price) || 0,
    costMode: item.costMode === COST_MODE.RECIPE ? COST_MODE.RECIPE : COST_MODE.MANUAL,
    recipe: normalizeRecipe(item.recipe),
  }));
}
