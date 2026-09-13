/**
 * Công thức món bán.
 * Dòng kho: qty + unitId → baseQty (đơn vị gốc NL).
 * Dòng ảo: chỉ cộng cost, không trừ kho.
 *
 * CT cũ phase=batch: không trừ lúc bán (đã trừ khi ghi mẻ trước đây).
 * Chỉ khi lưu lại món mới đổi thành serve + qty / suất.
 */
import { toIngredientBaseQty } from "./units.js";

export const RECIPE_PHASE = {
  SERVE: "serve",
  /** @deprecated chỉ để nhận diện dữ liệu cũ — không trừ kho cho đến khi lưu lại CT */
  BATCH: "batch",
};

export function normalizeRecipePhase() {
  return RECIPE_PHASE.SERVE;
}

/** Hàng được chọn trong CT: NL kho + thành phẩm nhập (có tồn). Không gồm món đang sửa / món chỉ có CT. */
export function isRecipeStockSource(product, excludeId) {
  if (!product || product.active === false) return false;
  if (excludeId && product.id === excludeId) return false;
  if (product.kind === "ingredient") return true;
  if (product.kind !== "finished") return false;
  if (product.costMode !== "recipe") return true;
  const stockLines = (Array.isArray(product.recipe) ? product.recipe : []).filter(
    (line) => line && !line.virtual && line.productId
  );
  return stockLines.length === 0;
}

export function isLegacyBatchLine(line) {
  return String(line?.phase || "") === RECIPE_PHASE.BATCH;
}

export function migrateRecipeQty(line, estimatedServings = 100) {
  const qty = Number(line?.qty) || 0;
  if (!isLegacyBatchLine(line)) return qty;
  return qty / Math.max(1, Number(estimatedServings) || 100);
}

function lineBaseQty(line, qty, unitId, ing) {
  const storedBase = Number(line.baseQty);
  if (ing) return toIngredientBaseQty(ing, qty, unitId || ing.unit);
  if (storedBase > 0 && !isLegacyBatchLine(line)) return storedBase;
  return qty;
}

export function normalizeRecipe(recipe, productsById = {}, options = {}) {
  if (!Array.isArray(recipe)) return [];
  const servings = Math.max(1, Number(options.estimatedServings) || 100);
  const convertBatch = options.convertBatch === true;
  return recipe
    .map((line) => {
      const qty = convertBatch
        ? migrateRecipeQty(line, servings)
        : Number(line.qty) || 0;
      if (qty <= 0) return null;
      if (line.virtual === true) {
        const name = String(line.name || "").trim();
        const unitCost = Math.max(0, Number(line.unitCost) || 0);
        if (!name) return null;
        return {
          virtual: true,
          name,
          qty,
          unitCost,
          phase: convertBatch ? RECIPE_PHASE.SERVE : isLegacyBatchLine(line)
            ? RECIPE_PHASE.BATCH
            : RECIPE_PHASE.SERVE,
          productId: "",
          unitId: "",
          baseQty: qty,
        };
      }
      const productId = String(line.productId || "");
      if (!productId) return null;
      const ing = productsById[productId];
      const unitId = String(line.unitId || "").trim();
      const phase =
        convertBatch || !isLegacyBatchLine(line)
          ? RECIPE_PHASE.SERVE
          : RECIPE_PHASE.BATCH;
      return {
        productId,
        qty,
        unitId: unitId || (ing?.unit ? String(ing.unit) : ""),
        baseQty: lineBaseQty(line, qty, unitId, ing),
        phase,
        virtual: false,
      };
    })
    .filter(Boolean);
}

export function filterRecipeByPhase(recipe, phase, productsById = {}, options = {}) {
  const wantBatch = phase === RECIPE_PHASE.BATCH;
  return normalizeRecipe(recipe, productsById, {
    ...options,
    convertBatch: false,
  }).filter((line) =>
    wantBatch ? isLegacyBatchLine(line) : !isLegacyBatchLine(line)
  );
}

export function computeRecipeCost(recipe, productsById, _phase = null, options = {}) {
  const lines = normalizeRecipe(recipe, productsById, {
    ...options,
    convertBatch: true,
  });
  return lines.reduce((sum, line) => {
    if (line.virtual) {
      return sum + (Number(line.unitCost) || 0) * (Number(line.qty) || 0);
    }
    const ing = productsById?.[line.productId];
    const unitCost = Number(ing?.cost) || 0;
    const baseQty = Number(line.baseQty) || 0;
    return sum + unitCost * baseQty;
  }, 0);
}

export function recipeLineCost(line, ingredient) {
  if (line?.virtual) {
    return (Number(line.unitCost) || 0) * (Number(line.qty) || 0);
  }
  const qty = Number(line.qty) || 0;
  const baseQty = ingredient
    ? toIngredientBaseQty(ingredient, qty, line.unitId || ingredient.unit)
    : Number(line.baseQty) || qty;
  return (Number(ingredient?.cost) || 0) * baseQty;
}
