import { productUsesRecipe } from "./recipe.js";

/**
 * Kiểm kho: đối chiếu tồn sổ ↔ thực tế, tính lệch.
 * Không Firebase.
 */

export function isStocktakeTarget(product) {
  if (!product || product.active === false) return false;
  if (product.kind === "ingredient") return true;
  // Thành phẩm nhập (không CT) — món nấu/pha không kiểm tồn
  return product.kind === "finished" && !productUsesRecipe(product);
}

export function parseActualQty(raw) {
  if (raw === undefined || raw === null) return { skipped: true };
  const text = String(raw).trim();
  if (text === "") return { skipped: true };
  if (text === "-" || text === "." || text === ",") {
    return { skipped: true };
  }
  const n = Number(String(text).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    return { skipped: true, invalid: true };
  }
  return { skipped: false, actual: n };
}

export function buildStocktakeLine(product, actualRaw) {
  const parsed = parseActualQty(actualRaw);
  const book = Number(product?.inStock) || 0;
  const cost = Number(product?.cost) || 0;
  const unit =
    product?.packaging?.baseUnit || product?.unit || "đv";
  const base = {
    productId: product?.id || "",
    name: product?.name || "",
    unit,
    book,
    cost,
  };
  if (parsed.skipped) {
    return { ...base, skipped: true, actual: null, delta: 0, value: 0 };
  }
  const delta = parsed.actual - book;
  return {
    ...base,
    skipped: false,
    actual: parsed.actual,
    delta,
    value: Math.round(delta * cost),
  };
}

export function summarizeStocktake(lines = []) {
  let counted = 0;
  let mismatch = 0;
  let surplusQty = 0;
  let shortageQty = 0;
  let surplusValue = 0;
  let shortageValue = 0;

  for (const line of lines) {
    if (!line || line.skipped) continue;
    counted += 1;
    if (Number(line.delta) === 0) continue;
    mismatch += 1;
    if (line.delta > 0) {
      surplusQty += line.delta;
      surplusValue += Number(line.value) || 0;
    } else {
      shortageQty += -line.delta;
      shortageValue += Math.abs(Number(line.value) || 0);
    }
  }

  return {
    counted,
    mismatch,
    surplusQty,
    shortageQty,
    surplusValue,
    shortageValue,
    netValue: surplusValue - shortageValue,
  };
}

export function stocktakeLinesToApply(lines = []) {
  return (lines || []).filter(
    (line) => line && !line.skipped && Number(line.delta) !== 0
  );
}
