/** Multi-unit packaging helpers — no Firebase */

export function makeUnitId(label) {
  return (
    String(label || "unit")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-") || "unit"
  );
}

/** NL kho hoặc thành phẩm nhập: gốc gói/chai + kiện (thùng/túi). */
export function buildIngredientPackUnits({
  baseUnit,
  packLabel,
  packFactor,
  baseCost,
  canSell = false,
  sellPrice = 0,
} = {}) {
  const base = String(baseUnit || "gói").trim() || "gói";
  const pack = String(packLabel || "thùng").trim() || "thùng";
  const factor = Math.max(2, Math.round(Number(packFactor) || 0));
  const cost = Math.max(0, Number(baseCost) || 0);
  const sell = Boolean(canSell);
  const price = sell ? Math.round(Number(sellPrice) || 0) : 0;
  return {
    packaging: { enabled: true, baseUnit: base },
    units: [
      {
        id: makeUnitId(base),
        label: base,
        factor: 1,
        sellPrice: price,
        sellCost: Math.round(cost),
        canSell: sell,
        canReceive: true,
      },
      {
        id: makeUnitId(pack),
        label: pack,
        factor,
        sellPrice: sell ? Math.round(price * factor) : 0,
        sellCost: Math.round(cost * factor),
        canSell: false,
        canReceive: true,
      },
    ],
  };
}

export function defaultIngredientPackHint(baseUnit) {
  const u = String(baseUnit || "").trim().toLowerCase();
  if (u === "g" || u === "gram") return { packLabel: "kg", packFactor: "1000" };
  if (u === "ml") return { packLabel: "l", packFactor: "1000" };
  if (u === "quả") return { packLabel: "vỉ", packFactor: "10" };
  if (u === "gói") return { packLabel: "thùng", packFactor: "30" };
  if (u === "chai" || u === "lon") return { packLabel: "thùng", packFactor: "24" };
  return { packLabel: "thùng", packFactor: "24" };
}

export function largestPackUnit(product) {
  const { enabled, units } = normalizeProductUnits(product);
  if (!enabled) return null;
  return (
    [...units]
      .filter((u) => u.factor > 1)
      .sort((a, b) => b.factor - a.factor)[0] || null
  );
}

/** ĐV nhập: gốc (gói/chai) + kiện đã khai + gợi ý thùng/túi. */
export function receiveUnitChoices(product) {
  const norm = normalizeProductUnits(product);
  const seen = new Set();
  const out = [];
  const push = (u) => {
    const id = String(u.id || makeUnitId(u.label) || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      label: String(u.label || id).trim() || "đv",
      factor: Math.max(1, Math.round(Number(u.factor) || 1)),
      sellPrice: Math.round(Number(u.sellPrice) || 0),
      sellCost: Math.round(Number(u.sellCost) || 0),
      canSell: u.canSell !== false,
      canReceive: true,
    });
  };
  for (const u of norm.units) push(u);
  const hint = defaultIngredientPackHint(norm.baseUnit);
  const packId = makeUnitId(hint.packLabel);
  if (!seen.has(packId)) {
    push({
      id: packId,
      label: hint.packLabel,
      factor: Math.max(2, Math.round(Number(hint.packFactor) || 24)),
      sellPrice: 0,
      sellCost: 0,
      canSell: false,
    });
  }
  return out;
}

/**
 * Gắn kiện nhập (thùng × N lẻ) lên SP trước khi ghi phiếu.
 * factor < 2 = nhập đúng đơn vị gốc, giữ packaging cũ.
 */
export function withReceivePack(product, { unitLabel, packFactor } = {}) {
  const factor = Math.max(1, Math.round(Number(packFactor) || 1));
  const norm = normalizeProductUnits(product);
  if (factor < 2) {
    const base = norm.units.find((u) => u.factor === 1) || norm.units[0];
    return { product, unitId: base?.id || "base" };
  }
  const baseSell = norm.units.find((u) => u.factor === 1);
  const pack = buildIngredientPackUnits({
    baseUnit: norm.baseUnit,
    packLabel: unitLabel || "thùng",
    packFactor: factor,
    baseCost: Number(product?.cost) || 0,
    canSell:
      product?.kind === "finished" || Boolean(baseSell?.canSell),
    sellPrice:
      Number(product?.price) || Number(baseSell?.sellPrice) || 0,
  });
  const packUnit = pack.units.find((u) => u.factor > 1);
  return {
    product: { ...product, ...pack },
    unitId: packUnit?.id,
  };
}

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

/**
 * Từ phiếu nhập (SL × ĐV × giá ĐV) → số lượng gốc + đơn giá gốc + patch catalog.
 * last-purchase: cost gốc = round(amount / baseQty).
 */
export function deriveReceiveCostUpdate(
  product,
  { unit, receiveQty, unitReceivePrice }
) {
  const qty = Number(receiveQty) || 0;
  const price = Number(unitReceivePrice);
  if (qty <= 0) throw new Error("Số lượng nhập phải > 0");
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Giá nhập không hợp lệ");
  }
  const u = unit || defaultReceiveUnit(product);
  if (!u) throw new Error("Đơn vị nhập không hợp lệ");

  const baseQty = toBaseQty(qty, u);
  if (baseQty <= 0) throw new Error("Số lượng nhập phải > 0");

  const amount = Math.round(qty * price);
  if (amount <= 0) {
    throw new Error("Tiền nhập phải > 0 (số lượng × giá nhập)");
  }

  const baseUnitCost = Math.round(amount / baseQty);
  const productPatch = { cost: baseUnitCost };

  const normalized = normalizeProductUnits(product);
  if (normalized.enabled && Array.isArray(normalized.units) && normalized.units.length) {
    productPatch.packaging = { enabled: true, baseUnit: normalized.baseUnit };
    productPatch.unit = normalized.baseUnit;
    productPatch.units = normalized.units.map((row) => {
      if (Number(row.factor) === 1) {
        return { ...row, sellCost: baseUnitCost };
      }
      if (row.id === u.id) {
        return { ...row, sellCost: Math.round(price) };
      }
      return { ...row };
    });
  }

  return { baseQty, amount, baseUnitCost, productPatch };
}

export function assertCanSellStock(product, unitId, qty) {
  const unit = findUnit(product, unitId);
  if (!unit) throw new Error("Đơn vị bán không hợp lệ");
  // Món công thức trừ NL kho — không kiểm tồn chính thành phẩm.
  if (product?.costMode === "recipe") return true;
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
