import { findUnit, toBaseQty } from "./packaging.js";

/** Giá vốn 1 đơn vị bán: ưu tiên sellCost unit, rồi cost món */
export function resolveSellUnitCost(product, unitId) {
  const unit = findUnit(product, unitId);
  const fromUnit = Math.round(Number(unit?.sellCost) || 0);
  if (fromUnit > 0) return fromUnit;
  return Math.round(Number(product?.cost) || 0);
}

export function buildSaleLineFromProduct(product, { qty, unitId } = {}) {
  const q = Number(qty) || 0;
  if (!product?.id && !product?.productId) {
    throw new Error("Thiếu món");
  }
  if (q <= 0) throw new Error("Số lượng phải > 0");

  const unit = findUnit(product, unitId);
  if (!unit) throw new Error("Đơn vị bán không hợp lệ");

  const unitPrice = Math.round(Number(unit.sellPrice) || 0);
  const unitCost = resolveSellUnitCost(product, unit.id);
  const baseQty = toBaseQty(q, unit);

  return {
    productId: String(product.productId || product.id),
    name: String(product.name || ""),
    qty: q,
    unitId: unit.id,
    unitLabel: unit.label,
    unitFactor: unit.factor,
    baseQty,
    unitPrice,
    unitCost,
    lineRevenue: Math.round(q * unitPrice),
    lineCogs: Math.round(q * unitCost),
    costMode: product.costMode === "recipe" ? "recipe" : "manual",
    recipe: product.recipe || [],
    estimatedServings: Math.max(1, Number(product.estimatedServings) || 100),
  };
}

export function isCountableCogsStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "snapshotted" || s === "estimated";
}

export function sumSaleCogs(lines = []) {
  let cogsTotal = 0;
  let revenue = 0;
  let any = false;
  for (const line of lines) {
    any = true;
    cogsTotal += Math.round(Number(line.lineCogs) || 0);
    revenue += Math.round(
      Number(line.lineRevenue) ||
        (Number(line.qty) || 0) * (Number(line.unitPrice) || 0)
    );
  }
  return {
    cogsTotal,
    revenue,
    cogsStatus: any ? "snapshotted" : "unknown",
  };
}

/**
 * Ước tính giá vốn 1 dòng bill (bill cũ chưa snapshot / thiếu unitCost).
 * @param {Record<string, object>} [productsById]
 */
export function estimateLineCogs(line, productsById = {}) {
  const qty = Number(line?.qty) || 0;
  if (qty <= 0) return 0;

  if (line.lineCogs != null && String(line.lineCogs).trim() !== "") {
    const direct = Math.round(Number(line.lineCogs) || 0);
    if (direct > 0) return direct;
  }

  const storedUnitCost = Math.round(Number(line.unitCost) || 0);
  if (storedUnitCost > 0) return Math.round(qty * storedUnitCost);

  const productId = String(line.productId || line.id || "");
  const product = productsById[productId];
  if (!product) return 0;

  const unitCost = resolveSellUnitCost(product, line.unitId);
  return Math.round(qty * unitCost);
}

/**
 * Giá vốn 1 giao dịch bán: snapshot nếu có, không thì ước từ items + catalog.
 */
export function resolveTxCogs(tx, productsById = {}) {
  if (isCountableCogsStatus(tx?.cogsStatus)) {
    return {
      amount: Math.round(Number(tx.cogsTotal) || 0),
      source: String(tx.cogsStatus).toLowerCase(),
    };
  }

  const items = Array.isArray(tx?.items) ? tx.items : [];
  if (!items.length) {
    return { amount: 0, source: "unknown" };
  }

  let amount = 0;
  for (const line of items) {
    amount += estimateLineCogs(line, productsById);
  }
  amount = Math.round(amount);
  return {
    amount,
    source: amount > 0 ? "estimated" : "unknown",
  };
}
