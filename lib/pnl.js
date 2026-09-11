import { resolveTxCogs } from "./cogs.js";
import { isShopOperatingExpense, isInventoryFundExpense } from "./expenses";
import { isGoodsIncome } from "./receipts";

/** Opex for Lens 2 — exclude inventory purchases */
export function isAccrualShopOpex(row) {
  if (!isShopOperatingExpense(row)) return false;
  if (isInventoryFundExpense(row)) return false;
  return true;
}

/**
 * @param {Array} transactions
 * @param {Record<string, object>} [productsById] — để ước COGS bill cũ chưa snapshot
 */
export function summarizeShopPnl(transactions = [], productsById = {}) {
  let revenue = 0;
  let cogs = 0;
  let cashOpex = 0;
  let accrualOpex = 0;
  let inventoryPurchase = 0;
  let cogsEstimated = false;
  let cogsUnknownRevenue = 0;

  for (const t of transactions) {
    if (isGoodsIncome(t)) {
      const amt = Number(t.amount) || 0;
      revenue += amt;
      const resolved = resolveTxCogs(t, productsById);
      cogs += resolved.amount;
      if (resolved.source === "estimated") cogsEstimated = true;
      if (resolved.source === "unknown" && amt > 0) {
        cogsUnknownRevenue += amt;
      }
    }
    if (isShopOperatingExpense(t)) {
      const amt = Number(t.amount) || 0;
      cashOpex += amt;
      if (isInventoryFundExpense(t)) inventoryPurchase += amt;
      else accrualOpex += amt;
    }
  }

  const cashProfit = revenue - cashOpex;
  const grossMargin = revenue - cogs;
  const operatingProfit = grossMargin - accrualOpex;

  return {
    revenue,
    cogs,
    cashOpex,
    accrualOpex,
    inventoryPurchase,
    cashProfit,
    grossMargin,
    operatingProfit,
    cogsEstimated,
    cogsUnknownRevenue,
  };
}
