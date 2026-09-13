/**
 * Pure recipe helpers — no Firebase (safe for node:test).
 */

export const RECIPE_PHASE = {
  BATCH: "batch",
  SERVE: "serve",
};

export function normalizeRecipePhase(phase) {
  return phase === RECIPE_PHASE.BATCH
    ? RECIPE_PHASE.BATCH
    : RECIPE_PHASE.SERVE;
}

/**
 * Chuẩn hoá công thức.
 * - Dòng kho: { productId, qty, phase, virtual: false }
 * - Dòng ảo: { virtual: true, name, qty, unitCost, phase, productId: "" }
 * Dòng cũ không có phase → serve.
 */
export function normalizeRecipe(recipe) {
  if (!Array.isArray(recipe)) return [];
  return recipe
    .map((line) => {
      const phase = normalizeRecipePhase(line.phase);
      const qty = Number(line.qty) || 0;
      if (line.virtual === true) {
        const name = String(line.name || "").trim();
        const unitCost = Math.max(0, Math.round(Number(line.unitCost) || 0));
        if (!name || qty <= 0) return null;
        return {
          virtual: true,
          name,
          qty,
          unitCost,
          phase,
          productId: "",
        };
      }
      const productId = String(line.productId || "");
      if (!productId || qty <= 0) return null;
      return { productId, qty, phase, virtual: false };
    })
    .filter(Boolean);
}

export function filterRecipeByPhase(recipe, phase) {
  const want = normalizeRecipePhase(phase);
  return normalizeRecipe(recipe).filter((line) => line.phase === want);
}

/**
 * Tổng cost công thức. Dòng ảo dùng line.unitCost; dòng kho dùng productsById.cost.
 */
export function computeRecipeCost(recipe, productsById, phase = null) {
  const lines =
    phase == null
      ? normalizeRecipe(recipe)
      : filterRecipeByPhase(recipe, phase);
  return lines.reduce((sum, line) => {
    if (line.virtual) {
      return sum + (Number(line.unitCost) || 0) * (Number(line.qty) || 0);
    }
    const ing = productsById?.[line.productId];
    const unitCost = Number(ing?.cost) || 0;
    return sum + unitCost * (Number(line.qty) || 0);
  }, 0);
}
