/** Multi-unit packaging helpers — no Firebase */

export function normalizeProductUnits(product) {
  const packaging = product?.packaging;
  const enabled = Boolean(packaging?.enabled);
  const baseUnit =
    String(packaging?.baseUnit || product?.unit || "cái").trim() || "cái";

  if (!enabled) {
    const legacy = {
      id: "base",
      label: baseUnit,
      factor: 1,
      sellPrice: Number(product?.price) || 0,
      sellCost: Number(product?.cost) || 0,
      canSell: true,
      canReceive: true,
    };
    return { enabled: false, baseUnit, units: [legacy] };
  }

  const raw = Array.isArray(product?.units) ? product.units : [];
  const units = raw
    .map((u) => ({
      id: String(u.id || u.label || "").trim(),
      label: String(u.label || u.id || "").trim() || "đv",
      factor: Math.max(1, Math.round(Number(u.factor) || 1)),
      sellPrice: Math.round(Number(u.sellPrice) || 0),
      sellCost: Math.round(Number(u.sellCost) || 0),
      canSell: u.canSell !== false,
      canReceive: u.canReceive !== false,
    }))
    .filter((u) => u.id);

  if (!units.some((u) => u.factor === 1)) {
    units.unshift({
      id: baseUnit,
      label: baseUnit,
      factor: 1,
      sellPrice: Math.round(Number(product?.price) || 0),
      sellCost: Math.round(Number(product?.cost) || 0),
      canSell: true,
      canReceive: true,
    });
  }

  return { enabled: true, baseUnit, units };
}

export function findUnit(product, unitId) {
  const { units } = normalizeProductUnits(product);
  if (!unitId) return units.find((u) => u.factor === 1) || units[0] || null;
  return units.find((u) => u.id === unitId) || null;
}

export function getSellableUnits(product) {
  return normalizeProductUnits(product).units.filter((u) => u.canSell);
}

export function getReceivableUnits(product) {
  return normalizeProductUnits(product).units.filter((u) => u.canReceive);
}

export function defaultSellUnit(product) {
  const units = getSellableUnits(product);
  return units.find((u) => u.factor === 1) || units[0] || null;
}

export function defaultReceiveUnit(product) {
  const units = getReceivableUnits(product);
  if (!units.length) return null;
  return [...units].sort((a, b) => b.factor - a.factor)[0];
}

export function toBaseQty(qty, unit) {
  const q = Number(qty) || 0;
  const f = Math.max(1, Number(unit?.factor) || 1);
  return q * f;
}

export function assertCanSellStock(product, unitId, qty) {
  const unit = findUnit(product, unitId);
  if (!unit) throw new Error("Đơn vị bán không hợp lệ");
  const need = toBaseQty(qty, unit);
  const have = Number(product?.inStock) || 0;
  if (need > have) {
    throw new Error(
      `Không đủ tồn (cần ${need} ${normalizeProductUnits(product).baseUnit}, còn ${have})`
    );
  }
}

function normalizeUnitRow(u) {
  return {
    id: String(u.id || u.label || "").trim(),
    label: String(u.label || u.id || "").trim() || "đv",
    factor: Math.max(1, Math.round(Number(u.factor) || 1)),
    sellPrice: Math.round(Number(u.sellPrice) || 0),
    sellCost: Math.round(Number(u.sellCost) || 0),
    canSell: u.canSell !== false,
    canReceive: u.canReceive !== false,
  };
}

/**
 * Chuẩn hoá packaging/units trước khi ghi Firestore.
 * @returns {{ stripPackaging: true } | { stripPackaging: false, skip: true } | { packaging, units, price, cost, unit }}
 */
export function normalizeUnitsForSave(data) {
  const packaging = data?.packaging;

  if (packaging == null || typeof packaging !== "object") {
    return { stripPackaging: false, skip: true };
  }

  if (packaging.enabled === false) {
    return { stripPackaging: true };
  }

  if (!packaging.enabled) {
    return { stripPackaging: false, skip: true };
  }

  const costMode = data?.costMode;

  if (costMode === "recipe") {
    throw new Error(
      "Không hỗ trợ nhiều đơn vị với món tính giá vốn theo công thức"
    );
  }

  const baseUnit =
    String(data?.packaging?.baseUnit || data?.unit || "cái").trim() || "cái";
  const raw = Array.isArray(data?.units) ? data.units : [];
  const units = raw.map(normalizeUnitRow).filter((u) => u.id);

  if (!units.length) {
    throw new Error("Thêm ít nhất một đơn vị");
  }

  if (!units.some((u) => u.factor === 1)) {
    throw new Error("Cần một đơn vị gốc với hệ số 1");
  }

  const base = units.find((u) => u.factor === 1);

  return {
    packaging: { enabled: true, baseUnit },
    units,
    price: base.sellPrice,
    cost: base.sellCost,
    unit: base.label,
  };
}
