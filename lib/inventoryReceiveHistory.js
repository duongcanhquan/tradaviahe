/**
 * Lịch sử nhập hàng theo sản phẩm — gộp phiếu quỹ cửa hàng + quỹ đầu tư.
 * Mỗi lần nhập một dòng riêng (đơn giá / số tiền có thể khác nhau).
 */

import { formatActorLabel } from "./audit.js";

function isShopInventoryReceive(row) {
  if (!row || row.type !== "expense") return false;
  if (row.businessLine === "construction") return false;
  const source = String(row.source || "");
  if (source === "inventory_backfill") return false;
  if (source === "inventory_receive") return true;
  return String(row.category || "").trim().toLowerCase() === "nhập hàng";
}

function rowTimeMs(row) {
  const ms =
    row?.timestamp?.toMillis?.() ??
    row?.createdAt?.toMillis?.() ??
    (typeof row?.timestamp === "number" ? row.timestamp : 0) ??
    0;
  if (ms) return ms;
  const key = String(row?.businessDate || row?.dateKey || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return new Date(`${key}T12:00:00`).getTime();
  }
  return 0;
}

function normalizeShopReceive(row) {
  if (!row?.id) return null;
  if (!isShopInventoryReceive(row)) return null;
  return {
    id: row.id,
    fundSource: "shop",
    amount: Math.round(Number(row.amount) || 0),
    receiveQty: Number(row.receiveQty) || 0,
    unit: String(row.unit || "").trim() || "đv",
    unitReceivePrice: Number(row.unitReceivePrice) || 0,
    baseQty: Number(row.baseQty) || 0,
    baseUnitCost: Number(row.baseUnitCost) || 0,
    costMethod: row.costMethod || null,
    paymentMethod: row.paymentMethod === "banking" ? "banking" : "cash",
    businessDate: row.businessDate || null,
    dateMs: rowTimeMs(row),
    actorLabel: formatActorLabel(row),
    createdByName: row.createdByName || null,
    createdByUsername: row.createdByUsername || null,
    qtyBefore: row.qtyBefore != null ? Number(row.qtyBefore) : null,
    qtyAfter: row.qtyAfter != null ? Number(row.qtyAfter) : null,
    note: row.note || "",
    productId: row.productId || null,
    productName: row.productName || "",
  };
}

function normalizeCapitalReceive(row) {
  if (!row?.id) return null;
  if (String(row.source || "") !== "inventory_receive") return null;
  if (row.kind && row.kind !== "expense") return null;
  return {
    id: row.id,
    fundSource: "capital",
    amount: Math.round(Number(row.amount) || 0),
    receiveQty: Number(row.receiveQty) || 0,
    unit: String(row.unit || "").trim() || "đv",
    unitReceivePrice: Number(row.unitReceivePrice) || 0,
    baseQty: Number(row.baseQty) || 0,
    baseUnitCost: Number(row.baseUnitCost) || 0,
    costMethod: row.costMethod || null,
    paymentMethod: row.paymentMethod === "banking" ? "banking" : "cash",
    businessDate: row.dateKey || row.businessDate || null,
    dateMs: rowTimeMs(row),
    actorLabel: formatActorLabel(row),
    createdByName: row.createdByName || null,
    createdByUsername: row.createdByUsername || null,
    qtyBefore: row.qtyBefore != null ? Number(row.qtyBefore) : null,
    qtyAfter: row.qtyAfter != null ? Number(row.qtyAfter) : null,
    note: row.note || "",
    productId: row.productId || null,
    productName: row.productName || "",
  };
}

/**
 * @param {string} productId
 * @param {{ transactions?: Array, capitalEntries?: Array }} sources
 * @returns {Array}
 */
export function listProductReceiveHistory(
  productId,
  { transactions = [], capitalEntries = [] } = {}
) {
  const id = String(productId || "").trim();
  if (!id) return [];

  const rows = [];

  for (const tx of transactions || []) {
    if (String(tx?.productId || "") !== id) continue;
    const normalized = normalizeShopReceive(tx);
    if (normalized) rows.push(normalized);
  }

  for (const entry of capitalEntries || []) {
    if (String(entry?.productId || "") !== id) continue;
    const normalized = normalizeCapitalReceive(entry);
    if (normalized) rows.push(normalized);
  }

  return rows.sort((a, b) => {
    if (b.dateMs !== a.dateMs) return b.dateMs - a.dateMs;
    return String(b.id).localeCompare(String(a.id));
  });
}

export function summarizeProductReceiveHistory(rows = []) {
  let totalAmount = 0;
  let totalReceiveQty = 0;
  let count = 0;
  for (const row of rows || []) {
    count += 1;
    totalAmount += Number(row.amount) || 0;
    totalReceiveQty += Number(row.receiveQty) || 0;
  }
  return {
    count,
    totalAmount: Math.round(totalAmount),
    totalReceiveQty,
  };
}

export function fundSourceLabel(fundSource) {
  if (fundSource === "capital") return "Quỹ đầu tư";
  return "Quỹ cửa hàng";
}

export function paymentMethodLabel(method) {
  return method === "banking" ? "Chuyển khoản" : "Tiền mặt";
}
