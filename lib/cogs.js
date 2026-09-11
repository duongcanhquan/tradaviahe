import { findUnit, toBaseQty } from "./packaging.js";

export function buildSaleLineFromProduct(product, { qty, unitId } = {}) {
  const q = Number(qty) || 0;
  if (!product?.id && !product?.productId) {
    throw new Error("Thiếu món");
  }
  if (q <= 0) throw new Error("Số lượng phải > 0");

  const unit = findUnit(product, unitId);
  if (!unit) throw new Error("Đơn vị bán không hợp lệ");

  const unitPrice = Math.round(Number(unit.sellPrice) || 0);
  const unitCost = Math.round(Number(unit.sellCost) || 0);
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
