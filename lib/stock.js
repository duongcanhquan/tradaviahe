/**
 * Trừ / hoàn kho khi bán hàng:
 * - Món recipe: trừ NL kho theo baseQty (dòng ảo không trừ)
 * - Không recipe → trừ chính món bán
 */
import { isLegacyBatchLine, normalizeRecipe } from "./recipe.js";

/** Local copy — avoid products.js (Firebase) so Node tests can import stock.js */
const COST_MODE = { MANUAL: "manual", RECIPE: "recipe" };

/**
 * Bảo vệ tồn kho trước khi ghi batch.
 * productsById: { [productId]: { inStock, name? } }
 */
export function checkStockDeltas(productsById = {}, deltas = {}) {
  const entries = Object.entries(deltas || {}).filter(
    ([, delta]) => Number(delta) !== 0
  );

  for (const [productId, rawDelta] of entries) {
    const product = productsById?.[productId];
    if (!product) continue;

    const delta = Number(rawDelta) || 0;
    const inStock = Number(product.inStock) || 0;
    if (delta < 0 && inStock + delta < 0) {
      throw new Error(
        `Không đủ tồn: ${product.name || productId || "món"}`
      );
    }
  }

  return true;
}

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

    const recipe = normalizeRecipe(item.recipe, {}, {
      estimatedServings: item.estimatedServings,
      convertBatch: false,
    });
    const useRecipe = item.costMode === COST_MODE.RECIPE;

    if (useRecipe) {
      for (const line of recipe) {
        if (line.virtual) continue;
        if (isLegacyBatchLine(line)) continue;
        const ingId = String(line.productId || "");
        const lineQty = Number(line.baseQty) || Number(line.qty) || 0;
        if (!ingId || lineQty <= 0) continue;
        deltas[ingId] = (deltas[ingId] || 0) + sign * lineQty * qty;
      }
    } else {
      const base =
        item.baseQty != null
          ? Number(item.baseQty) || 0
          : qty * Math.max(1, Number(item.unitFactor) || 1);
      deltas[productId] = (deltas[productId] || 0) + sign * base;
    }
  }

  return deltas;
}

export function serializeSaleItems(items = []) {
  return items.map((item) => {
    const qty = Number(item.qty) || 0;
    const unitFactor = Math.max(1, Number(item.unitFactor) || 1);
    const baseQty =
      item.baseQty != null ? Number(item.baseQty) || 0 : qty * unitFactor;
    const unitPrice = Number(item.unitPrice ?? item.price) || 0;
    const unitCost = Number(item.unitCost ?? item.sellCost ?? item.cost) || 0;
    return {
      productId: String(item.productId || item.id || ""),
      name: String(item.name || ""),
      qty,
      unitId: item.unitId || "base",
      unitLabel: item.unitLabel || "",
      unitFactor,
      baseQty,
      unitPrice,
      unitCost,
      lineRevenue: Math.round(
        Number(item.lineRevenue) || qty * unitPrice
      ),
      lineCogs: Math.round(Number(item.lineCogs) || qty * unitCost),
      costMode:
        item.costMode === COST_MODE.RECIPE
          ? COST_MODE.RECIPE
          : COST_MODE.MANUAL,
      recipe: normalizeRecipe(item.recipe, {}, {
        estimatedServings: item.estimatedServings,
        convertBatch: false,
      }),
      estimatedServings: Math.max(1, Number(item.estimatedServings) || 100),
    };
  });
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
