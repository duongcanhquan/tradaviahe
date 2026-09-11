import { isShopOperatingExpense, isInventoryFundExpense } from "./expenses";
import { isGoodsIncome } from "./receipts";

/** Opex for Lens 2 — exclude inventory purchases */
export function isAccrualShopOpex(row) {
  if (!isShopOperatingExpense(row)) return false;
  if (isInventoryFundExpense(row)) return false;
  return true;
}

export function summarizeShopPnl(transactions = []) {
  let revenue = 0;
  let cogs = 0;
  let cashOpex = 0;
  let accrualOpex = 0;
  let inventoryPurchase = 0;

  for (const t of transactions) {
    if (isGoodsIncome(t)) {
      revenue += Number(t.amount) || 0;
      cogs += Number(t.cogsTotal) || 0;
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
  };
}
