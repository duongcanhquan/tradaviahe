/**
 * Quy đổi đơn vị dùng (lạng/kg/g…) về đơn vị gốc tồn của NL.
 * Không Firebase.
 */
import { findUnit, normalizeProductUnits } from "./packaging.js";

export const PRODUCT_UNITS = [
  "g",
  "lạng",
  "kg",
  "ml",
  "l",
  "gói",
  "túi",
  "thùng",
  "vỉ",
  "quả",
  "bát",
  "cái",
  "ly",
  "chai",
  "lon",
];

const MASS_TO_G = {
  g: 1,
  gram: 1,
  lạng: 100,
  lang: 100,
  kg: 1000,
};

const VOL_TO_ML = {
  ml: 1,
  l: 1000,
  lít: 1000,
  lit: 1000,
};

export function normalizeUnitKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

export function usageUnitsForIngredient(ingredient) {
  const { baseUnit, units } = normalizeProductUnits(ingredient);
  const seen = new Set();
  const out = [];

  const push = (id, label) => {
    const key = `${normalizeUnitKey(id)}|${normalizeUnitKey(label)}`;
    if (seen.has(key) || !id) return;
    seen.add(key);
    out.push({ id, label: label || id });
  };

  push(baseUnit, baseUnit);
  for (const u of units) {
    push(u.id, u.label);
  }

  const baseKey = normalizeUnitKey(baseUnit);
  if (MASS_TO_G[baseKey]) {
    push("g", "g");
    push("lạng", "lạng");
    push("kg", "kg");
  }
  if (VOL_TO_ML[baseKey]) {
    push("ml", "ml");
    push("l", "l");
  }

  return out;
}

/**
 * SL theo đơn vị dùng → số lượng đơn vị gốc tồn.
 */
export function toIngredientBaseQty(ingredient, qty, unitId) {
  const q = Number(qty) || 0;
  if (q <= 0) return 0;

  const { baseUnit } = normalizeProductUnits(ingredient);
  const useId = unitId || baseUnit || "base";

  const pack = findUnit(ingredient, useId);
  if (
    pack &&
    (pack.id === useId || pack.label === useId) &&
    ingredient?.packaging?.enabled
  ) {
    return q * Math.max(1, Number(pack.factor) || 1);
  }
  if (pack && pack.id === useId && Number(pack.factor) > 1) {
    return q * pack.factor;
  }

  const useKey = normalizeUnitKey(useId === "base" ? baseUnit : useId);
  const baseKey = normalizeUnitKey(baseUnit);

  if (!useId || useId === "base" || useKey === baseKey) return q;

  const useG = MASS_TO_G[useKey];
  const baseG = MASS_TO_G[baseKey];
  if (useG && baseG) return (q * useG) / baseG;

  const useMl = VOL_TO_ML[useKey];
  const baseMl = VOL_TO_ML[baseKey];
  if (useMl && baseMl) return (q * useMl) / baseMl;

  const byLabel = findUnit(ingredient, useId);
  if (byLabel) return q * Math.max(1, Number(byLabel.factor) || 1);

  return q;
}

export function formatBaseQty(value) {
  const n = Number(value) || 0;
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(Math.round(n * 1000) / 1000);
}
