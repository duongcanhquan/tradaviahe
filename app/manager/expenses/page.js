'use client';

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
  Trash2,
  Wallet,
} from "lucide-react";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { formatActorLabel } from "@/lib/audit";
import {
  FUND_TYPES,
  deleteShopFundEntry,
  expenseCategoryLabel,
  EXPENSE_CATEGORIES,
  isFundIn,
  isShopExpense,
  isShopFundEntry,
  normalizeExpenseCategory,
  recordFundIn,
  recordShopExpense,
  summarizeShopFund,
} from "@/lib/expenses";
import { db } from "@/lib/firebase";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { cn, formatCurrency, todayInputValue } from "@/lib/utils";

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
  const { user, profile, role, canManageShop } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [mode, setMode] = useState(null); // null | fund_in | expense

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dateInput, setDateInput] = useState(todayInputValue());
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0].value);
  const [payMethod, setPayMethod] = useState("cash");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    // Chỉ tải nạp quỹ + chi quỹ — không kéo cả sổ bán hàng.
    const fundQuery = query(
      collection(db, "transactions"),
      where("type", "in", [FUND_TYPES.fundIn, FUND_TYPES.expense])
    );
    const unsub = onSnapshot(
      fundQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(isShopFundEntry)
          .sort((a, b) => txTimeMs(b) - txTimeMs(a));
        setRows(list);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast(firestoreErrorMessage(error, "Không tải được sổ quỹ"), "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const summary = useMemo(() => summarizeShopFund(rows), [rows]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "fund_in") return rows.filter(isFundIn);
    return rows.filter(
      (r) =>
        isShopExpense(r) && normalizeExpenseCategory(r.category) === filter
    );
  }, [rows, filter]);

  const resetForm = () => {
    setAmount("");
    setNote("");
    setDateInput(todayInputValue());
    setCategory(EXPENSE_CATEGORIES[0].value);
    setPayMethod("cash");
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
        await recordFundIn({
          amount,
          note,
          dateInput,
          paymentMethod: payMethod,
          user,
          profile,
        });
        showToast("Đã nạp quỹ cửa hàng", "success");
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

  return (
    <AppShell title="Quỹ cửa hàng" subtitle="Nạp quỹ · chi tiêu theo hạng mục">
      <section className="mb-4 rounded-[1.25rem] bg-brand-700 px-4 py-3.5 text-white shadow-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
          Quỹ vận hành quán
        </p>
        <p className="mt-1 text-sm leading-snug text-white/90">
          Quản lý và cổ đông đều xem / nạp / chi tại đây. Tiền từ sổ vốn muốn
          đưa vào két: trang Vốn → Chi tiêu vốn (bật chuyển quỹ).
        </p>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-2">
        <StatCard
          label="Số dư quỹ cửa hàng"
          value={loading ? 0 : summary.balance}
          tone={summary.balance >= 0 ? "brand" : "danger"}
        />
        <div className="grid grid-cols-2 gap-2">
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
        <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-100">
          Số dư = nạp quỹ − chi tiêu. Nạp quỹ{" "}
          <span className="font-semibold">không</span> tính doanh thu. Chi tiêu
          trừ quỹ và tính vào lợi nhuận tháng. Khác với{" "}
          <span className="font-semibold">Chi tiêu vốn</span> (trang Vốn) — ghi
          một lần một sổ, tránh trùng.
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
        <h2 className="section-title mb-2">Theo hạng mục</h2>
        <div className="grid grid-cols-2 gap-2">
          {EXPENSE_CATEGORIES.map((c) => {
            const value = summary.byCategory[c.value] || 0;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setFilter(c.value)}
                className={cn(
                  "rounded-2xl px-3 py-3 text-left ring-1 transition active:scale-[0.98]",
                  filter === c.value
                    ? "bg-brand-50 ring-brand-200"
                    : "bg-white ring-slate-200"
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {c.label}
                </p>
                <p className="mt-1 text-sm font-extrabold text-slate-900">
                  <Money amount={value} />
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="section-title">Sổ quỹ</h2>
          <p className="text-xs text-slate-500">{filtered.length} dòng</p>
        </div>

        <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition",
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
          <div className="card-panel flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-700" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Chưa có dòng nào trong bộ lọc này.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((row) => {
              const fund = isFundIn(row);
              return (
                <li
                  key={row.id}
                  className="rounded-[1.25rem] bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
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
                          "mt-1.5 text-lg font-extrabold",
                          fund ? "text-emerald-700" : "text-rose-700"
                        )}
                      >
                        {fund ? "+" : "−"}
                        <Money amount={row.amount} />
                      </p>
                      {row.note ? (
                        <p className="mt-1 text-sm text-slate-700">{row.note}</p>
                      ) : null}
                      <p className="mt-1.5 text-xs text-slate-500">
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
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-200 active:scale-95 disabled:opacity-40"
                      >
                        {deletingId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
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
