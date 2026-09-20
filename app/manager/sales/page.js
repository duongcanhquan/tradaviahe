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
} from "lucide-react";
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

  const closeEdit = () => setEditing(null);

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
    <AppShell title="Món đã bán" subtitle="Sửa · xóa khoản thu">
      <div className="space-y-4">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Về đối soát
        </Link>

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
            <p className="text-sm capitalize text-slate-600">{rangeLabel}</p>
          }
        />

        <ChipRow>
          <FilterChip
            active={payFilter === "all"}
            onClick={() => setPayFilter("all")}
          >
            Tất cả
          </FilterChip>
          <FilterChip
            active={payFilter === "cash"}
            onClick={() => setPayFilter("cash")}
          >
            Tiền mặt
          </FilterChip>
          <FilterChip
            active={payFilter === "banking"}
            onClick={() => setPayFilter("banking")}
          >
            Chuyển khoản
          </FilterChip>
        </ChipRow>

        <StatCard
          label={
            payFilter !== "all"
              ? `Tổng kỳ · ${summary.count} lần · lọc ${summary.filteredCount}`
              : `Tổng kỳ · ${summary.count} lần`
          }
          value={summary.total}
          tone="muted"
        />

        <div className="grid grid-cols-2 gap-2">
          <div className="card-panel !p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Tiền mặt
            </p>
            <p className="money mt-1 text-base font-bold text-emerald-700">
              <Money amount={summary.cash} />
            </p>
          </div>
          <div className="card-panel !p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Chuyển khoản
            </p>
            <p className="money mt-1 text-base font-bold text-brand-700">
              <Money amount={summary.banking} />
            </p>
          </div>
        </div>

        <section className="space-y-3">
          <SectionHeader
            title="Danh sách"
            hint={
              dayRows.length > PAGE_SIZE
                ? `${dayRows.length} dòng · ${safePage}/${totalPages}`
                : `${dayRows.length} dòng`
            }
          />

          {loading ? (
            <div className="card-panel flex h-24 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-brand-700" />
            </div>
          ) : dayRows.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Không có giao dịch"
              description="Thử đổi khoảng ngày hoặc bộ lọc hình thức thanh toán."
            />
          ) : (
            <>
              <ul className="space-y-2">
                {pageRows.map((row) => {
                  const isCk = row.paymentMethod === "banking";
                  return (
                    <li key={row.id} className="card-panel space-y-3 !py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="money text-xl font-bold leading-none text-emerald-700">
                            <Money amount={row.amount} />
                          </p>
                          <p className="mt-2 truncate text-sm font-bold text-slate-900">
                            {row.note || "Thu bán hàng"}
                          </p>
                          <p className="mt-0.5 text-sm text-slate-500">
                            {formatTxDateTime(row)}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            <span className="font-semibold text-brand-800">
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
                      </div>
                      {canManageSales ? (
                        <div className="flex gap-2">
                          {canEditSales ? (
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              className="touch-btn h-11 flex-1 gap-1.5 bg-brand-50 text-sm font-bold text-brand-800 ring-1 ring-brand-100"
                            >
                              <Pencil className="h-4 w-4" />
                              Sửa
                            </button>
                          ) : null}
                          {canDeleteSales ? (
                            <button
                              type="button"
                              disabled={deletingId === row.id}
                              onClick={() => handleDelete(row)}
                              className="touch-btn h-11 flex-1 gap-1.5 bg-rose-50 text-sm font-bold text-rose-700 ring-1 ring-rose-100 disabled:opacity-50"
                            >
                              {deletingId === row.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              Xóa
                            </button>
                          ) : null}
                        </div>
                      ) : null}
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
                    className="touch-btn h-11 flex-1 gap-1 bg-white text-sm font-semibold ring-1 ring-slate-200 disabled:opacity-35"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Trước
                  </button>
                  <p className="shrink-0 text-sm font-semibold text-slate-500">
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
            </>
          )}
        </section>
      </div>

      <BottomSheet
        open={canEditSales && Boolean(editing)}
        onClose={closeEdit}
        title="Sửa giao dịch bán"
        labelledBy="sales-edit-sheet"
        footer={
          <button
            type="submit"
            form="sales-edit-form"
            disabled={savingEdit}
            className="btn-primary h-12 gap-2 disabled:opacity-50"
          >
            {savingEdit ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" />
            )}
            Lưu
          </button>
        }
      >
        <form id="sales-edit-form" onSubmit={saveEdit} className="space-y-4">
          <label className="block">
            <FieldLabel>Số tiền</FieldLabel>
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
            <FieldLabel>Ngày</FieldLabel>
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
            <FieldLabel optional>Ghi chú</FieldLabel>
            <input
              className="field-input"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
            />
          </label>
        </form>
      </BottomSheet>
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
