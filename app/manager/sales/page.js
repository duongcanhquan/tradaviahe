'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, isValid, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Receipt,
  Save,
  Trash2,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import DateRangeFilter from "@/components/DateRangeFilter";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money } from "@/components/StatusBadges";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { formatActorLabel } from "@/lib/audit";
import {
  filterRowsByDateRange,
  formatRangeLabel,
  hasDateRange,
} from "@/lib/dateRange";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { subscribeCollection } from "@/lib/liveCollection";
import { isGoodsIncome } from "@/lib/receipts";
import { roleLabel } from "@/lib/roles";
import {
  deleteSaleTransaction,
  updateSaleTransaction,
} from "@/lib/sales";
import {
  cn,
  dateKeyToInputValue,
  formatCurrency,
  todayInputValue,
} from "@/lib/utils";

const PAGE_SIZE = 10;

function txTimeMs(t) {
  return t?.timestamp?.toMillis?.() ?? 0;
}

function formatTxDateTime(t) {
  const ms = txTimeMs(t);
  if (!ms) {
    return t?.businessDate ? `Ngày ${t.businessDate}` : "—";
  }
  try {
    return format(new Date(ms), "HH:mm:ss · EEE dd/MM/yyyy", { locale: vi });
  } catch {
    return t?.businessDate || "—";
  }
}

function rowDateInput(row) {
  if (row?.businessDate) return dateKeyToInputValue(row.businessDate);
  const ms = txTimeMs(row);
  if (ms) {
    try {
      return format(new Date(ms), "yyyy-MM-dd");
    } catch {
      /* fall through */
    }
  }
  return todayInputValue();
}

function SalesLogContent() {
  const { showToast } = useToast();
  const { role, canDeleteSales, canEditSales } = useAuth();
  const canManageSales = canDeleteSales || canEditSales;
  const [allTx, setAllTx] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayInputValue());
  const [dateTo, setDateTo] = useState(todayInputValue());
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState(null);
  const [payFilter, setPayFilter] = useState("all"); // all | cash | banking

  const [editing, setEditing] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editPay, setEditPay] = useState("cash");
  const [editDate, setEditDate] = useState(todayInputValue());
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeCollection(
      "transactions",
      (list) => {
        const rows = list
          .filter(isGoodsIncome)
          .sort((a, b) => txTimeMs(b) - txTimeMs(a));
        setAllTx(rows);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast(
          firestoreErrorMessage(error, "Không tải được sổ bán hàng"),
          "error"
        );
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const ranged = useMemo(
    () => filterRowsByDateRange(allTx, dateFrom, dateTo),
    [allTx, dateFrom, dateTo]
  );

  const dayRows = useMemo(() => {
    let rows = ranged;
    if (payFilter === "cash") {
      rows = rows.filter((t) => t.paymentMethod !== "banking");
    } else if (payFilter === "banking") {
      rows = rows.filter((t) => t.paymentMethod === "banking");
    }
    return rows;
  }, [ranged, payFilter]);

  const summary = useMemo(() => {
    let cash = 0;
    let banking = 0;
    for (const t of ranged) {
      const amount = Number(t.amount) || 0;
      if (t.paymentMethod === "banking") banking += amount;
      else cash += amount;
    }
    return {
      cash,
      banking,
      total: cash + banking,
      count: ranged.length,
      filteredCount: dayRows.length,
    };
  }, [ranged, dayRows.length]);

  const totalPages = Math.max(1, Math.ceil(dayRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return dayRows.slice(start, start + PAGE_SIZE);
  }, [dayRows, safePage]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, payFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const rangeLabel = useMemo(() => {
    if (!hasDateRange(dateFrom, dateTo)) return "Mọi ngày";
    if (dateFrom && dateTo && dateFrom === dateTo) {
      const d = parseISO(String(dateFrom));
      if (isValid(d)) return format(d, "EEEE, dd/MM/yyyy", { locale: vi });
    }
    return formatRangeLabel(dateFrom, dateTo);
  }, [dateFrom, dateTo]);

  const openEdit = (row) => {
    if (!canEditSales || !row?.id) return;
    setEditing(row);
    setEditAmount(String(row.amount ?? ""));
    setEditNote(row.note || "");
    setEditPay(row.paymentMethod === "banking" ? "banking" : "cash");
    setEditDate(rowDateInput(row));
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!canEditSales || !editing?.id) return;
    setSavingEdit(true);
    try {
      await updateSaleTransaction({
        id: editing.id,
        amount: editAmount,
        note: editNote,
        paymentMethod: editPay,
        dateInput: editDate,
        role,
      });
      showToast("Đã cập nhật giao dịch bán", "success");
      setEditing(null);
      if (editDate) {
        setDateFrom(editDate);
        setDateTo(editDate);
      }
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Sửa thất bại", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (row) => {
    if (!canDeleteSales || !row?.id) return;
    const ok = window.confirm(
      `Xóa món đã bán?\n${row.note || "Thu"}\n${formatCurrency(row.amount)}\n${formatTxDateTime(row)}\n\nChỉ xóa khi ghi nhầm.`
    );
    if (!ok) return;
    setDeletingId(row.id);
    try {
      await deleteSaleTransaction(row.id, role);
      showToast("Đã xóa khoản bán", "success");
      if (editing?.id === row.id) setEditing(null);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell
      title="Món đã bán"
      subtitle="Quản lý / Chủ ĐT / Super Admin — xem · sửa · xóa"
    >
      <Link
        href="/dashboard"
        className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Về đối soát
      </Link>

      <section className="mb-4 space-y-3">
        <DateRangeFilter
          dateFrom={dateFrom}
          dateTo={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
          onClear={() => {
            setDateFrom("");
            setDateTo("");
          }}
          summary={
            <p className="text-xs capitalize text-slate-600">{rangeLabel}</p>
          }
        />

        <div className="flex gap-1.5">
          {[
            { id: "all", label: "Tất cả" },
            { id: "cash", label: "Tiền mặt" },
            { id: "banking", label: "Chuyển khoản" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setPayFilter(f.id)}
              className={cn(
                "flex-1 rounded-full py-2 text-xs font-bold transition",
                payFilter === f.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-[1.25rem] bg-emerald-600 px-4 py-3 text-white shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">
            Tiền mặt
          </p>
          <p className="money mt-1 text-lg font-extrabold">
            <Money amount={summary.cash} />
          </p>
        </div>
        <div className="rounded-[1.25rem] bg-brand-700 px-4 py-3 text-white shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">
            Chuyển khoản
          </p>
          <p className="money mt-1 text-lg font-extrabold">
            <Money amount={summary.banking} />
          </p>
        </div>
        <div className="col-span-2 rounded-[1.25rem] bg-slate-900 px-4 py-3 text-white shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
                Tổng kỳ · {summary.count} lần
                {payFilter !== "all"
                  ? ` · đang lọc ${summary.filteredCount}`
                  : ""}
              </p>
              <p className="money mt-1 text-2xl font-extrabold">
                <Money amount={summary.total} />
              </p>
            </div>
            <Receipt className="h-8 w-8 text-white/40" aria-hidden />
          </div>
        </div>
      </section>

      {canEditSales && editing ? (
        <section className="card-panel mb-4 space-y-3 border-amber-100 bg-gradient-to-b from-amber-50/80 to-white">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-amber-800" aria-hidden />
              <h2 className="section-title text-amber-950">Sửa giao dịch bán</h2>
            </div>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-xl bg-white p-2 text-slate-500 ring-1 ring-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={saveEdit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">Số tiền</span>
              <input
                type="number"
                min="1"
                className="field-input money"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">
                Hình thức
              </span>
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
              <span className="mb-1 block text-sm font-semibold">Ngày</span>
              <input
                type="date"
                className="field-input"
                value={editDate}
                max={todayInputValue()}
                onChange={(e) => setEditDate(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">Ghi chú</span>
              <input
                className="field-input"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={savingEdit}
              className="touch-btn h-12 w-full gap-2 bg-amber-700 text-white disabled:opacity-50"
            >
              {savingEdit ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Save className="h-5 w-5" />
              )}
              Lưu
            </button>
          </form>
        </section>
      ) : null}

      <section className="mb-8 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title mb-0">Danh sách</h2>
          <p className="text-xs text-slate-500">
            {dayRows.length} dòng
            {dayRows.length > PAGE_SIZE ? ` · ${safePage}/${totalPages}` : ""}
          </p>
        </div>

        {loading ? (
          <div className="card-panel flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-700" />
          </div>
        ) : pageRows.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Không có giao dịch trong khoảng này.
          </div>
        ) : (
          pageRows.map((row) => {
            const isCk = row.paymentMethod === "banking";
            return (
              <article key={row.id} className="card-panel space-y-2 !py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {row.note || "Thu bán hàng"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatTxDateTime(row)}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-700">
                      <span className="font-extrabold text-brand-800">
                        {formatActorLabel(row)}
                      </span>
                      {row.createdByRole
                        ? ` · ${roleLabel(row.createdByRole)}`
                        : ""}
                      {" · "}
                      <span
                        className={
                          isCk ? "text-brand-700" : "text-emerald-700"
                        }
                      >
                        {isCk ? "Chuyển khoản" : "Tiền mặt"}
                      </span>
                    </p>
                  </div>
                  <p className="money shrink-0 text-base font-extrabold text-emerald-700">
                    <Money amount={row.amount} />
                  </p>
                </div>
                {canManageSales ? (
                  <div className="flex gap-2">
                    {canEditSales ? (
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="touch-btn h-10 flex-1 gap-1 bg-amber-50 text-xs font-bold text-amber-900 ring-1 ring-amber-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Sửa
                      </button>
                    ) : null}
                    {canDeleteSales ? (
                      <button
                        type="button"
                        disabled={deletingId === row.id}
                        onClick={() => handleDelete(row)}
                        className="touch-btn h-10 flex-1 gap-1 bg-rose-50 text-xs font-bold text-rose-700 ring-1 ring-rose-100 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingId === row.id ? "…" : "Xóa"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="touch-btn h-11 flex-1 gap-1 bg-white text-sm font-semibold ring-1 ring-slate-200 disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" />
              Trước
            </button>
            <p className="shrink-0 text-xs font-semibold text-slate-500">
              {safePage} / {totalPages}
            </p>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="touch-btn h-11 flex-1 gap-1 bg-white text-sm font-semibold ring-1 ring-slate-200 disabled:opacity-35"
            >
              Sau
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

export default function SalesPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor", "superadmin"]}>
      <SalesLogContent />
    </ProtectedRoute>
  );
}
