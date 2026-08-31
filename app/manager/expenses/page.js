'use client';

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import AppShell from "@/components/AppShell";
import DateRangeFilter from "@/components/DateRangeFilter";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { formatActorLabel } from "@/lib/audit";
import {
  filterRowsByDateRange,
  formatRangeLabel,
  hasDateRange,
  rowBusinessMs,
} from "@/lib/dateRange";
import {
  deleteShopFundEntry,
  expenseCategoryLabel,
  EXPENSE_CATEGORIES,
  isFundIn,
  isShopExpense,
  isShopFundEntry,
  normalizeExpenseCategory,
  recordFundIn,
  recordFundInFromCapital,
  recordShopExpense,
  summarizeShopFund,
} from "@/lib/expenses";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { subscribeCollection } from "@/lib/liveCollection";
import { sumGoodsIncomeByMethod } from "@/lib/receipts";
import { cn, formatCurrency, todayInputValue } from "@/lib/utils";

const PAGE_SIZE = 10;

function txTimeMs(t) {
  return t?.timestamp?.toMillis?.() ?? 0;
}

function formatTxTime(t) {
  const ms = txTimeMs(t);
  if (!ms) return t?.businessDate || "—";
  try {
    return format(new Date(ms), "HH:mm · dd/MM/yyyy", { locale: vi });
  } catch {
    return t?.businessDate || "—";
  }
}

const FILTERS = [
  { id: "all", label: "Tất cả" },
  { id: "fund_in", label: "Nạp quỹ" },
  ...EXPENSE_CATEGORIES.map((c) => ({ id: c.value, label: c.label })),
];

function ExpensesContent() {
  const { showToast } = useToast();
  const { user, profile, role, canManageShop, canManageShareholderCapital } =
    useAuth();
  const [allTx, setAllTx] = useState([]);
  const [rows, setRows] = useState([]);
  const [cashSalesTotal, setCashSalesTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState(null); // null | fund_in | expense

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dateInput, setDateInput] = useState(todayInputValue());
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0].value);
  const [payMethod, setPayMethod] = useState("cash");
  /** Nạp quỹ từ vốn cổ đông — trừ sổ vốn */
  const [fromCapital, setFromCapital] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    const unsub = subscribeCollection(
      "transactions",
      (list) => {
        setAllTx(list);
        const fundRows = list
          .filter(isShopFundEntry)
          .sort((a, b) => rowBusinessMs(b) - rowBusinessMs(a));
        setRows(fundRows);
        setCashSalesTotal(sumGoodsIncomeByMethod(list).cash);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast(
          firestoreErrorMessage(error, "Không tải được sổ quỹ"),
          "error"
        );
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const summary = useMemo(
    () => summarizeShopFund(rows, cashSalesTotal),
    [rows, cashSalesTotal]
  );

  const rangedFundRows = useMemo(
    () => filterRowsByDateRange(rows, dateFrom, dateTo),
    [rows, dateFrom, dateTo]
  );

  const cashInPeriod = useMemo(
    () =>
      sumGoodsIncomeByMethod(
        filterRowsByDateRange(allTx, dateFrom, dateTo)
      ).cash,
    [allTx, dateFrom, dateTo]
  );

  const filtered = useMemo(() => {
    let list = rangedFundRows;
    if (filter === "fund_in") list = list.filter(isFundIn);
    else if (filter !== "all") {
      list = list.filter(
        (r) =>
          isShopExpense(r) && normalizeExpenseCategory(r.category) === filter
      );
    }
    return list;
  }, [rangedFundRows, filter]);

  const periodSummary = useMemo(() => {
    const base = summarizeShopFund(rangedFundRows, cashInPeriod);
    return {
      ...base,
      net: base.fundIn + base.cashSales - base.expense,
    };
  }, [rangedFundRows, cashInPeriod]);

  const categorySource = hasDateRange(dateFrom, dateTo)
    ? periodSummary
    : summary;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  useEffect(() => {
    setPage(1);
  }, [filter, dateFrom, dateTo]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const clearDateFilter = () => {
    setDateFrom("");
    setDateTo("");
  };

  const resetForm = () => {
    setAmount("");
    setNote("");
    setDateInput(todayInputValue());
    setCategory(EXPENSE_CATEGORIES[0].value);
    setPayMethod("cash");
    setFromCapital(true);
  };

  const closeForm = () => {
    setMode(null);
    resetForm();
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canManageShop) {
      showToast("Không có quyền ghi quỹ", "error");
      return;
    }
    setSaving(true);
    try {
      if (mode === "fund_in") {
        if (canManageShareholderCapital && fromCapital) {
          await recordFundInFromCapital({
            amount,
            note,
            dateInput,
            paymentMethod: payMethod,
            user,
            profile,
          });
          showToast(
            payMethod === "banking"
              ? "Đã nạp quỹ (chuyển khoản) và trừ sổ vốn"
              : "Đã nạp quỹ (tiền mặt) và trừ sổ vốn",
            "success"
          );
        } else {
          await recordFundIn({
            amount,
            note,
            dateInput,
            paymentMethod: payMethod,
            user,
            profile,
          });
          showToast("Đã nạp quỹ cửa hàng", "success");
        }
      } else {
        await recordShopExpense({
          amount,
          category,
          note,
          dateInput,
          user,
          profile,
        });
        showToast("Đã ghi chi tiêu", "success");
      }
      closeForm();
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Lưu thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!canManageShop || !row?.id) return;
    const label = isFundIn(row) ? "nạp quỹ" : "khoản chi";
    const ok = window.confirm(
      `Xóa ${label} · ${formatCurrency(row.amount)}?\nChỉ xóa khi ghi nhầm.`
    );
    if (!ok) return;
    setDeletingId(row.id);
    try {
      await deleteShopFundEntry(row.id, role);
      showToast("Đã xóa", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const hasDateFilter = hasDateRange(dateFrom, dateTo);

  return (
    <AppShell title="Quỹ cửa hàng" subtitle="Két tiền mặt · nạp · chi tiêu">
      <section className="mb-3 rounded-2xl bg-brand-700 px-3.5 py-2.5 text-white shadow-md">
        <p className="text-sm leading-snug text-white/95">
          Thu TM bán hàng vào quỹ. CK khách vào số dư vốn. Nạp từ sổ vốn: tick
          “Tiền từ sổ vốn”.
        </p>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-2">
        <StatCard
          label="Số dư quỹ cửa hàng"
          value={loading ? 0 : summary.balance}
          tone={summary.balance >= 0 ? "brand" : "danger"}
        />
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            label="Thu TM bán hàng"
            value={loading ? 0 : summary.cashSales}
            tone="success"
          />
          <StatCard
            label="Đã nạp quỹ"
            value={loading ? 0 : summary.fundIn}
            tone="success"
          />
          <StatCard
            label="Đã chi"
            value={loading ? 0 : summary.expense}
            tone="danger"
          />
        </div>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-100">
          Số dư = thu TM + nạp − chi. Nạp không tính doanh thu. CK bán hàng
          không vào quỹ.
        </p>
      </section>

      {canManageShop ? (
        <section className="mb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              resetForm();
              setMode((m) => (m === "fund_in" ? null : "fund_in"));
            }}
            className={cn(
              "touch-btn h-14 gap-2 text-sm font-bold",
              mode === "fund_in"
                ? "bg-emerald-800 text-white"
                : "bg-emerald-600 text-white"
            )}
          >
            <ArrowDownCircle className="h-5 w-5" aria-hidden />
            Nạp quỹ
          </button>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setMode((m) => (m === "expense" ? null : "expense"));
            }}
            className={cn(
              "touch-btn h-14 gap-2 text-sm font-bold",
              mode === "expense"
                ? "bg-rose-800 text-white"
                : "bg-rose-600 text-white"
            )}
          >
            <ArrowUpCircle className="h-5 w-5" aria-hidden />
            Chi tiêu
          </button>
        </section>
      ) : null}

      {canManageShop && mode ? (
        <section
          className={cn(
            "card-panel mb-4 space-y-3",
            mode === "fund_in"
              ? "border-emerald-100 bg-gradient-to-b from-emerald-50/80 to-white"
              : "border-rose-100 bg-gradient-to-b from-rose-50/80 to-white"
          )}
        >
          <div className="flex items-center gap-2">
            <Wallet
              className={cn(
                "h-5 w-5",
                mode === "fund_in" ? "text-emerald-700" : "text-rose-700"
              )}
              aria-hidden
            />
            <h2 className="section-title">
              {mode === "fund_in" ? "Nạp tiền quỹ cửa hàng" : "Ghi khoản chi"}
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            {mode === "fund_in"
              ? "Tiền bỏ vào két vận hành — không tính doanh thu bán hàng."
              : "Chi từ quỹ cửa hàng theo hạng mục. Trừ số dư quỹ và tính vào chi phí tháng."}
          </p>

          <form onSubmit={handleSave} className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Ngày
              </span>
              <input
                type="date"
                className="field-input"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                max={todayInputValue()}
                required
              />
            </label>

            {mode === "expense" ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Hạng mục
                </span>
                <select
                  className="field-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">
                    Hình thức
                  </span>
                  <select
                    className="field-input"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  >
                    <option value="cash">Tiền mặt</option>
                    <option value="banking">Chuyển khoản</option>
                  </select>
                </label>
                {canManageShareholderCapital ? (
                  <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 accent-emerald-700"
                      checked={fromCapital}
                      onChange={(e) => setFromCapital(e.target.checked)}
                    />
                    <span>
                      <span className="block text-sm font-bold text-emerald-900">
                        Tiền từ sổ vốn cổ đông
                      </span>
                      <span className="mt-0.5 block text-xs text-emerald-800/80">
                        Nạp quỹ (tiền mặt hoặc chuyển khoản) đồng thời trừ sổ
                        vốn — tránh lệch số như trước.
                      </span>
                    </span>
                  </label>
                ) : null}
              </>
            )}

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Số tiền (VNĐ)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                className="field-input money"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="30000000"
                required
              />
              {amount ? (
                <p
                  className={cn(
                    "mt-1.5 text-xs font-medium",
                    mode === "fund_in" ? "text-emerald-700" : "text-rose-700"
                  )}
                >
                  = <Money amount={amount} />
                </p>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Ghi chú
              </span>
              <input
                type="text"
                className="field-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  mode === "fund_in"
                    ? "VD: Nạp 30tr quỹ vận hành tháng 7"
                    : "VD: Nhập trà đường · sửa bếp"
                }
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="touch-btn h-14 flex-1 border border-slate-200 bg-white text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className={cn(
                  "touch-btn h-14 flex-[1.4] text-white disabled:opacity-50",
                  mode === "fund_in" ? "bg-emerald-700" : "bg-rose-700"
                )}
              >
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : mode === "fund_in" ? (
                  "Lưu nạp quỹ"
                ) : (
                  "Lưu chi tiêu"
                )}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="mb-3">
        <h2 className="section-title mb-1.5">
          Theo hạng mục
          {hasDateFilter ? " · kỳ lọc" : ""}
        </h2>
        <div className="grid grid-cols-2 gap-1.5">
          {EXPENSE_CATEGORIES.map((c) => {
            const value = categorySource.byCategory[c.value] || 0;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setFilter(c.value)}
                className={cn(
                  "rounded-xl px-2.5 py-2 text-left ring-1 transition active:scale-[0.98]",
                  filter === c.value
                    ? "bg-brand-50 ring-brand-200"
                    : "bg-white ring-slate-200"
                )}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {c.label}
                </p>
                <p className="mt-0.5 text-sm font-extrabold text-slate-900">
                  <Money amount={value} />
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="section-title mb-0">Sổ quỹ</h2>
          <p className="text-xs text-slate-500">
            {filtered.length} dòng
            {filtered.length > PAGE_SIZE
              ? ` · trang ${safePage}/${totalPages}`
              : ""}
          </p>
        </div>

        <DateRangeFilter
          dense
          className="mb-2"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
          onClear={clearDateFilter}
          summary={
            hasDateFilter ? (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-500">
                  Tổng kết kỳ · {formatRangeLabel(dateFrom, dateTo)}
                </p>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  <p>
                    Thu TM:{" "}
                    <span className="font-bold text-emerald-700">
                      <Money amount={periodSummary.cashSales} />
                    </span>
                  </p>
                  <p>
                    Nạp:{" "}
                    <span className="font-bold text-emerald-700">
                      <Money amount={periodSummary.fundIn} />
                    </span>
                  </p>
                  <p>
                    Chi:{" "}
                    <span className="font-bold text-rose-700">
                      <Money amount={periodSummary.expense} />
                    </span>
                  </p>
                  <p>
                    Biến động:{" "}
                    <span
                      className={cn(
                        "font-bold",
                        periodSummary.net >= 0
                          ? "text-emerald-700"
                          : "text-rose-700"
                      )}
                    >
                      <Money amount={periodSummary.net} />
                    </span>
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                Chọn khoảng ngày để xem tổng kết kỳ (TM + nạp + chi).
              </p>
            )
          }
        />

        <div className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                filter === f.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="card-panel flex h-20 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-brand-700" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-panel py-4 text-sm text-slate-500">
            Chưa có dòng nào trong bộ lọc này.
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {pageRows.map((row) => {
                const fund = isFundIn(row);
                return (
                  <li
                    key={row.id}
                    className="rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-slate-200"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                              fund
                                ? "bg-emerald-50 text-emerald-800"
                                : "bg-rose-50 text-rose-800"
                            )}
                          >
                            {fund
                              ? "Nạp quỹ"
                              : expenseCategoryLabel(row.category)}
                          </span>
                          {fund && row.paymentMethod === "banking" ? (
                            <span className="text-[10px] font-semibold text-slate-400">
                              CK
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 text-base font-extrabold",
                            fund ? "text-emerald-700" : "text-rose-700"
                          )}
                        >
                          {fund ? "+" : "−"}
                          <Money amount={row.amount} />
                        </p>
                        {row.note ? (
                          <p className="truncate text-xs text-slate-600">
                            {row.note}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {formatTxTime(row)}
                          {" · "}
                          {formatActorLabel(row)}
                        </p>
                      </div>
                      {canManageShop ? (
                        <button
                          type="button"
                          aria-label="Xóa"
                          disabled={deletingId === row.id}
                          onClick={() => handleDelete(row)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200 active:scale-95 disabled:opacity-40"
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {totalPages > 1 ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="touch-btn h-10 flex-1 gap-1 bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-35"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Trước
                </button>
                <p className="shrink-0 text-xs font-semibold text-slate-500">
                  {safePage} / {totalPages}
                </p>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="touch-btn h-10 flex-1 gap-1 bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-35"
                >
                  Sau
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </AppShell>
  );
}

export default function ExpensesPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor"]}>
      <ExpensesContent />
    </ProtectedRoute>
  );
}
