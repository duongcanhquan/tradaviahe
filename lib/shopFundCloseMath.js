/**
 * Pure helpers cho chốt quỹ theo tháng (không Firebase).
 */
import {
  endOfMonth,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns";

export function monthKeyFromDate(date = new Date()) {
  return format(date, "yyyy-MM");
}

function monthInputBoundsLocal(year, monthIndex, now = new Date()) {
  const from = startOfMonth(new Date(year, monthIndex, 1));
  let to = endOfMonth(from);
  const today = startOfDay(now);
  if (to.getTime() > today.getTime()) to = today;
  return {
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  };
}

/** Tháng lịch trước (YYYY-MM), dùng làm mốc chốt cho “Từ đầu”. */
export function previousMonthKey(now = new Date()) {
  const d = startOfMonth(now);
  d.setMonth(d.getMonth() - 1);
  return format(d, "yyyy-MM");
}

export function nextMonthKey(monthKey) {
  const d = parseISO(`${String(monthKey).slice(0, 7)}-01`);
  if (!isValid(d)) throw new Error("Tháng chốt không hợp lệ");
  d.setMonth(d.getMonth() + 1);
  return format(d, "yyyy-MM");
}

export function monthBoundsForKey(monthKey, now = new Date()) {
  const d = parseISO(`${String(monthKey).slice(0, 7)}-01`);
  if (!isValid(d)) throw new Error("Tháng chốt không hợp lệ");
  const monthStart = startOfMonth(now);
  if (d.getTime() < monthStart.getTime()) {
    return {
      from: format(startOfMonth(d), "yyyy-MM-dd"),
      to: format(endOfMonth(d), "yyyy-MM-dd"),
    };
  }
  return monthInputBoundsLocal(d.getFullYear(), d.getMonth(), now);
}

export function emptyFundTotals() {
  return { fundIn: 0, cashSales: 0, expense: 0, balance: 0 };
}

export function addFundTotals(a = {}, b = {}) {
  const fundIn = (Number(a.fundIn) || 0) + (Number(b.fundIn) || 0);
  const cashSales = (Number(a.cashSales) || 0) + (Number(b.cashSales) || 0);
  const expense = (Number(a.expense) || 0) + (Number(b.expense) || 0);
  return {
    fundIn,
    cashSales,
    expense,
    balance: fundIn + cashSales - expense,
  };
}

function isFundInRow(row) {
  return row?.type === "fund_in";
}

function isShopExpenseRow(row) {
  if (!row || row.type !== "expense") return false;
  if (row.businessLine === "construction") return false;
  return true;
}

function isShopFundEntryRow(row) {
  if (!row) return false;
  if (row.businessLine === "construction") return false;
  return isFundInRow(row) || isShopExpenseRow(row);
}

function isGoodsIncomeRow(tx) {
  if (!tx || tx.type !== "income") return false;
  if (tx.businessLine === "construction") return false;
  const cat = String(tx.category || "")
    .trim()
    .toLowerCase();
  if (cat === "bán hàng" || cat === "ban hang" || cat === "pos") return true;
  if (cat === "dịch vụ xây dựng" || cat === "dich vu xay dung") return false;
  const source = String(tx.source || "").toLowerCase();
  if (source === "construction_service") return false;
  if (source === "pos" || source === "banking_by_date") return true;
  return false;
}

/** Tổng két từ danh sách phiếu thô (cả income + fund). */
export function summarizeRowsForFundClose(rows = []) {
  let fundIn = 0;
  let expense = 0;
  let cashSales = 0;
  for (const t of Array.isArray(rows) ? rows : []) {
    if (isGoodsIncomeRow(t) && t.paymentMethod !== "banking") {
      cashSales += Number(t.amount) || 0;
    }
    if (!isShopFundEntryRow(t)) continue;
    const amount = Number(t.amount) || 0;
    if (isFundInRow(t)) fundIn += amount;
    else if (isShopExpenseRow(t)) expense += amount;
  }
  return {
    fundIn,
    cashSales,
    expense,
    balance: fundIn + cashSales - expense,
  };
}

export function combineLifetimeWithMonth(closeTotals, monthTotals) {
  return addFundTotals(
    closeTotals || emptyFundTotals(),
    monthTotals || emptyFundTotals()
  );
}

export function lifetimeFundLabel(now = new Date()) {
  const prev = previousMonthKey(now);
  const [y, m] = prev.split("-");
  return `Chốt đến hết ${m}/${y} + tháng này`;
}

export function isLifetimePreset(preset) {
  return preset === "all" || preset === "lifetime";
}

export function canCloseMonthKey(monthKey, now = new Date()) {
  const current = monthKeyFromDate(now);
  return String(monthKey).slice(0, 7) < current;
}

export function todayMonthKey(now = new Date()) {
  return monthKeyFromDate(now);
}

/** Bản chốt đáng tin — phải sealed + đủ phiên bản quét đầy đủ. */
export const SHOP_FUND_SCAN_VERSION = 2;

export function isTrustedShopFundClose(row) {
  if (!row || row.sealed !== true) return false;
  if (!/^\d{4}-\d{2}$/.test(String(row.monthKey || ""))) return false;
  const ver = Number(row.scanVersion) || 0;
  return ver >= SHOP_FUND_SCAN_VERSION;
}

/** Đảm bảo balance = fundIn + cashSales − expense (tránh lệch khi cộng tay). */
export function normalizeFundTotals(totals = {}) {
  const fundIn = Math.round(Number(totals.fundIn) || 0);
  const cashSales = Math.round(Number(totals.cashSales) || 0);
  const expense = Math.round(Number(totals.expense) || 0);
  return {
    fundIn,
    cashSales,
    expense,
    balance: fundIn + cashSales - expense,
  };
}
