import { capitalSharesForDividends } from "./shareholderCapital";

/**
 * Tính báo cáo tháng + chia cổ tức theo đúng thứ tự yêu cầu.
 * % cổ phần lấy từ sổ vốn cổ đông (shareholder_capital_entries),
 * không trộn với transactions bán hàng / nhập hàng.
 */
export function calculateMonthlyReport({
  transactions = [],
  capitalEntries = [],
  relationFundPercent = 0,
}) {
  const { total: totalCapital, shares } = capitalSharesForDividends(
    capitalEntries
  );

  const investorShares = shares.map((s) => ({
    name: s.name,
    capital: s.value,
    ownershipPercent: s.percent, // 0–100
    ownershipRatio: totalCapital > 0 ? s.value / totalCapital : 0, // 0–1
  }));

  // Chỉ thu bán hàng (income). Nạp quỹ (fund_in) không vào doanh thu.
  const totalRevenue = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  // Chi quỹ cửa hàng (expense). Chi tiêu vốn cổ đông nằm collection khác — không cộng lại.
  const totalExpenses = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const grossProfit = totalRevenue - totalExpenses;

  const percent = Math.max(0, Number(relationFundPercent) || 0);
  const relationsFund =
    grossProfit > 0 ? grossProfit * (percent / 100) : 0;

  const netProfit = grossProfit > 0 ? grossProfit - relationsFund : 0;
  const isLoss = grossProfit <= 0;

  const dividends = investorShares.map((s) => ({
    ...s,
    dividend: isLoss ? 0 : netProfit * s.ownershipRatio,
  }));

  return {
    totalCapital,
    investorShares: dividends,
    totalRevenue,
    totalExpenses,
    grossProfit,
    relationFundPercent: percent,
    relationsFund,
    netProfit,
    isLoss,
  };
}

/** Lọc giao dịch theo tháng/năm (dựa trên timestamp Firestore) */
export function filterTransactionsByMonth(transactions, year, monthIndex) {
  // monthIndex: 0–11
  return transactions.filter((t) => {
    const ms = t.timestamp?.toMillis?.();
    if (!ms) return false;
    const d = new Date(ms);
    return d.getFullYear() === year && d.getMonth() === monthIndex;
  });
}
