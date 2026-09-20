'use client';

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Search,
  Trash2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import AppShell from "@/components/AppShell";
import DateRangeFilter from "@/components/DateRangeFilter";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useToast } from "@/components/Toast";
import {
  BottomSheet,
  ChipRow,
  EmptyState,
  FieldLabel,
  FilterChip,
  SectionHeader,
} from "@/components/ui/MobileUI";
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
  MANUAL_EXPENSE_CATEGORIES,
  isFundIn,
  isShopExpense,
  isShopFundEditable,
  isShopFundEntry,
  matchesFundSearch,
  normalizeExpenseCategory,
  recordFundIn,
  recordFundInFromCapital,
  recordShopExpense,
  shopFundSourceLabel,
  summarizeShopFund,
  updateShopFundEntry,
} from "@/lib/expenses";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { subscribeCollection } from "@/lib/liveCollection";
import { sumGoodsIncomeByMethod } from "@/lib/receipts";
import { cn, formatCurrency, todayInputValue, dateKeyToInputValue } from "@/lib/utils";

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
  const { user, profile, role, canManageShop, canDeleteShopFundEntry, canManageShareholderCapital } =
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
  const [category, setCategory] = useState(MANUAL_EXPENSE_CATEGORIES[0].value);
  const [payMethod, setPayMethod] = useState("cash");
  /** Nạp quỹ từ vốn cổ đông — trừ sổ vốn */
  const [fromCapital, setFromCapital] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editDate, setEditDate] = useState(todayInputValue());
  const [editCategory, setEditCategory] = useState(
    MANUAL_EXPENSE_CATEGORIES[0].value
  );
  const [editPay, setEditPay] = useState("cash");
  const [savingEdit, setSavingEdit] = useState(false);

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
    if (searchQuery.trim()) {
      list = list.filter((r) => matchesFundSearch(r, searchQuery));
    }
    return list;
  }, [rangedFundRows, filter, searchQuery]);

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
  }, [filter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const clearDateFilter = () => {
    setDateFrom("");
    setDateTo("");
  };

  const openEdit = (row) => {
    if (!isShopFundEditable(row)) {
      showToast(
        "Khoản gắn nhập hàng / vốn / chuyển quỹ — sửa ở màn tương ứng",
        "info"
      );
      return;
    }
    setEditing(row);
    setEditAmount(String(row.amount ?? ""));
    setEditNote(row.note || "");
    setEditDate(
      row.businessDate
        ? dateKeyToInputValue(row.businessDate)
        : todayInputValue()
    );
    setEditCategory(
      normalizeExpenseCategory(row.category) ||
        MANUAL_EXPENSE_CATEGORIES[0].value
    );
    setEditPay(row.paymentMethod === "banking" ? "banking" : "cash");
  };

  const closeEdit = () => {
    setEditing(null);
    setSavingEdit(false);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editing?.id || !canManageShop) return;
    setSavingEdit(true);
    try {
      await updateShopFundEntry({
        id: editing.id,
        amount: editAmount,
        category: editCategory,
        note: editNote,
        dateInput: editDate,
        paymentMethod: editPay,
        user,
        profile,
      });
      showToast("Đã cập nhật khoản quỹ", "success");
      closeEdit();
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Sửa thất bại", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const resetForm = () => {
    setAmount("");
    setNote("");
    setDateInput(todayInputValue());
    setCategory(MANUAL_EXPENSE_CATEGORIES[0].value);
    setPayMethod("cash");
    setFromCapital(true);
  };

  const closeForm = () => {
    setMode(null);
    resetForm();
  };

  const openMode = (next) => {
    resetForm();
    setMode(next);
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
          paymentMethod: payMethod,
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
    if (!canDeleteShopFundEntry || !row?.id) return;
    const label = isFundIn(row) ? "nạp quỹ" : "khoản chi";
    const linked =
      row.capitalEntryId ||
      row.transferGroupId ||
      row.source === "capital_to_shop" ||
      String(row.source || "").startsWith("transfer_");
    const ok = window.confirm(
      `Xóa ${label} · ${formatCurrency(row.amount)}?\n` +
        (linked
          ? "Khoản này gắn vốn / chuyển quỹ — sẽ xóa cả cặp liên quan để sổ khớp.\n"
          : "Tiền sẽ về lại quỹ ngay.\n") +
        "Không xóa được phiếu nhập hàng."
    );
    if (!ok) return;
    setDeletingId(row.id);
    try {
      const result = await deleteShopFundEntry(row.id, role);
      if (result?.cascaded === "capital") {
        showToast("Đã xóa nạp quỹ + chi tiêu vốn liên quan", "success");
      } else if (result?.cascaded === "transfer_group") {
        showToast(
          `Đã xóa cặp chuyển quỹ (${result.deletedTx || 0} giao dịch)`,
          "success"
        );
      } else {
        showToast("Đã xóa — quỹ đã cập nhật", "success");
      }
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
      <div className="space-y-4">
        <Link
          href="/manager/construction"
          className="touch-btn h-12 w-full justify-between gap-2 border border-slate-200 bg-white px-4 text-slate-800"
        >
          <span className="flex items-center gap-2 text-left">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Building2 className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-sm font-bold">Mảng xây dựng</span>
          </span>
          <span className="text-sm text-slate-400">Mở →</span>
        </Link>

        <p className="text-sm leading-snug text-slate-500">
          Thu TM vào quỹ · CK khách vào vốn · tick “Từ sổ vốn” khi nạp.
        </p>

        <StatCard
          label="Số dư quỹ cửa hàng"
          value={loading ? 0 : summary.balance}
          tone={summary.balance >= 0 ? "brand" : "danger"}
        />

        <div className="grid grid-cols-3 gap-2">
          <div className="card-panel !p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Thu TM
            </p>
            <p className="money mt-1 text-sm font-bold text-emerald-700">
              <Money amount={loading ? 0 : summary.cashSales} />
            </p>
          </div>
          <div className="card-panel !p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Đã nạp
            </p>
            <p className="money mt-1 text-sm font-bold text-emerald-700">
              <Money amount={loading ? 0 : summary.fundIn} />
            </p>
          </div>
          <div className="card-panel !p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Đã chi
            </p>
            <p className="money mt-1 text-sm font-bold text-rose-700">
              <Money amount={loading ? 0 : summary.expense} />
            </p>
          </div>
        </div>

        {canManageShop ? (
          <section className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => openMode("fund_in")}
              className="touch-btn h-14 gap-2 bg-emerald-600 text-sm font-bold text-white"
            >
              <ArrowDownCircle className="h-5 w-5" aria-hidden />
              Nạp quỹ
            </button>
            <button
              type="button"
              onClick={() => openMode("expense")}
              className="touch-btn h-14 gap-2 bg-rose-600 text-sm font-bold text-white"
            >
              <ArrowUpCircle className="h-5 w-5" aria-hidden />
              Chi tiêu
            </button>
          </section>
        ) : null}

        <section>
          <SectionHeader
            title={hasDateFilter ? "Theo hạng mục · kỳ lọc" : "Theo hạng mục"}
          />
          <div className="grid grid-cols-2 gap-2">
            {EXPENSE_CATEGORIES.map((c) => {
              const value = categorySource.byCategory[c.value] || 0;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setFilter(c.value)}
                  className={cn(
                    "card-panel !p-3 text-left transition active:scale-[0.98]",
                    filter === c.value && "ring-2 ring-brand-500"
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {c.label}
                  </p>
                  <p className="money mt-1 text-base font-bold text-slate-900">
                    <Money amount={value} />
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="Sổ quỹ"
            hint={
              filtered.length > PAGE_SIZE
                ? `${filtered.length} dòng · trang ${safePage}/${totalPages}`
                : `${filtered.length} dòng`
            }
          />

          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              className="field-input !h-12 pl-11"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm ghi chú, hạng mục, số tiền, người…"
              inputMode="search"
              enterKeyHint="search"
            />
          </label>

          <DateRangeFilter
            dense
            dateFrom={dateFrom}
            dateTo={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            onClear={clearDateFilter}
            summary={
              hasDateFilter ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-slate-500">
                    Tổng kết kỳ · {formatRangeLabel(dateFrom, dateTo)}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 text-sm">
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
                <p className="text-sm text-slate-500">
                  Chọn khoảng ngày để xem tổng kết kỳ.
                </p>
              )
            }
          />

          <ChipRow>
            {FILTERS.map((f) => (
              <FilterChip
                key={f.id}
                active={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </FilterChip>
            ))}
          </ChipRow>

          {loading ? (
            <div className="card-panel flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-brand-700" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Chưa có dòng nào"
              description="Thử đổi bộ lọc hoặc ghi nạp quỹ / chi tiêu."
              action={
                canManageShop ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => openMode("fund_in")}
                      className="touch-btn h-11 bg-emerald-600 text-sm font-bold text-white"
                    >
                      Nạp quỹ
                    </button>
                    <button
                      type="button"
                      onClick={() => openMode("expense")}
                      className="touch-btn h-11 bg-rose-600 text-sm font-bold text-white"
                    >
                      Chi tiêu
                    </button>
                  </div>
                ) : null
              }
            />
          ) : (
            <>
              <ul className="space-y-2">
                {pageRows.map((row) => {
                  const fund = isFundIn(row);
                  return (
                    <li key={row.id} className="card-panel !py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "money text-xl font-bold leading-none",
                              fund ? "text-emerald-700" : "text-rose-700"
                            )}
                          >
                            {fund ? "+" : "−"}
                            <Money amount={row.amount} />
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                "rounded-lg px-2 py-0.5 text-xs font-bold",
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
                              <span className="text-xs font-semibold text-slate-400">
                                CK
                              </span>
                            ) : null}
                          </div>
                          {row.note ? (
                            <p className="mt-1 truncate text-sm text-slate-600">
                              {row.note}
                            </p>
                          ) : null}
                          <p className="mt-1 text-xs font-bold text-brand-800">
                            {shopFundSourceLabel(row)}
                            {" · "}
                            {row.paymentMethod === "banking"
                              ? "Chuyển khoản"
                              : "Tiền mặt"}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatTxTime(row)}
                            {" · "}
                            {formatActorLabel(row)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col gap-2">
                          {canManageShop && isShopFundEditable(row) ? (
                            <button
                              type="button"
                              aria-label="Sửa"
                              onClick={() => openEdit(row)}
                              className="touch-btn h-11 w-11 rounded-2xl bg-brand-50 p-0 text-brand-800 ring-1 ring-brand-100"
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </button>
                          ) : null}
                          {canDeleteShopFundEntry ? (
                          <button
                            type="button"
                            aria-label="Xóa"
                            disabled={deletingId === row.id}
                            onClick={() => handleDelete(row)}
                            className="touch-btn h-11 w-11 shrink-0 rounded-2xl bg-slate-50 p-0 text-slate-500 ring-1 ring-slate-200 disabled:opacity-40"
                          >
                            {deletingId === row.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" aria-hidden />
                            )}
                          </button>
                        ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {totalPages > 1 ? (
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="touch-btn h-11 flex-1 gap-1 bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-35"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    Trước
                  </button>
                  <p className="shrink-0 text-sm font-semibold text-slate-500">
                    {safePage} / {totalPages}
                  </p>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="touch-btn h-11 flex-1 gap-1 bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-35"
                  >
                    Sau
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <BottomSheet
        open={canManageShop && Boolean(mode)}
        onClose={closeForm}
        title={mode === "fund_in" ? "Nạp tiền quỹ" : "Ghi khoản chi"}
        subtitle={
          mode === "fund_in"
            ? "Không tính doanh thu bán hàng"
            : "Trừ quỹ · ghi chi phí tháng"
        }
        labelledBy="expenses-form-sheet"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="touch-btn h-12 flex-1 border border-slate-200 bg-white text-slate-700"
            >
              Hủy
            </button>
            <button
              type="submit"
              form="expenses-fund-form"
              disabled={saving}
              className={cn(
                "touch-btn h-12 flex-[1.4] text-white disabled:opacity-50",
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
        }
      >
        <form
          id="expenses-fund-form"
          onSubmit={handleSave}
          className="space-y-4"
        >
          <label className="block">
            <FieldLabel>Ngày</FieldLabel>
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
              <FieldLabel>Hạng mục</FieldLabel>
              <select
                className="field-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              >
                {MANUAL_EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-sm text-slate-500">
                Nhập hàng ghi ở màn Nhập hàng.
              </p>
            </label>
          ) : (
            <>
              <label className="block">
                <FieldLabel>Hình thức</FieldLabel>
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
                    <span className="mt-0.5 block text-sm text-emerald-800/80">
                      Nạp quỹ đồng thời trừ sổ vốn.
                    </span>
                  </span>
                </label>
              ) : null}
            </>
          )}

          <label className="block">
            <FieldLabel>Số tiền (VNĐ)</FieldLabel>
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
                  "mt-1.5 text-sm font-medium",
                  mode === "fund_in" ? "text-emerald-700" : "text-rose-700"
                )}
              >
                = <Money amount={amount} />
              </p>
            ) : null}
          </label>

          <label className="block">
            <FieldLabel optional>Ghi chú</FieldLabel>
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
        </form>
      </BottomSheet>

      <BottomSheet
        open={canManageShop && Boolean(editing)}
        onClose={closeEdit}
        title={isFundIn(editing) ? "Sửa nạp quỹ" : "Sửa khoản chi"}
        subtitle={editing ? shopFundSourceLabel(editing) : null}
        labelledBy="expenses-edit-sheet"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeEdit}
              className="touch-btn h-12 flex-1 border border-slate-200 bg-white text-slate-700"
            >
              Hủy
            </button>
            <button
              type="submit"
              form="expenses-edit-form"
              disabled={savingEdit}
              className="btn-primary h-12 flex-[1.4] disabled:opacity-50"
            >
              {savingEdit ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Lưu thay đổi"
              )}
            </button>
          </div>
        }
      >
        <form
          id="expenses-edit-form"
          onSubmit={handleSaveEdit}
          className="space-y-4"
        >
          <label className="block">
            <FieldLabel>Ngày</FieldLabel>
            <input
              type="date"
              className="field-input"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              required
            />
          </label>
          {editing && isShopExpense(editing) ? (
            <label className="block">
              <FieldLabel>Hạng mục</FieldLabel>
              <select
                className="field-input"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                required
              >
                {MANUAL_EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block">
            <FieldLabel>Hình thức</FieldLabel>
            <select
              className="field-input"
              value={editPay}
              onChange={(e) => setEditPay(e.target.value)}
            >
              <option value="cash">Tiền mặt</option>
              <option value="banking">Chuyển khoản</option>
            </select>
          </label>
          <label className="block">
            <FieldLabel>Số tiền</FieldLabel>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              className="field-input money"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              required
            />
            {editAmount ? (
              <p className="mt-1.5 text-sm font-medium text-brand-700">
                = <Money amount={editAmount} />
              </p>
            ) : null}
          </label>
          <label className="block">
            <FieldLabel optional>Ghi chú</FieldLabel>
            <input
              type="text"
              className="field-input"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Mô tả khoản chi / nạp"
            />
          </label>
        </form>
      </BottomSheet>
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
