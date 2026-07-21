'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import { format, isValid, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import {
  ArrowLeft,
  Loader2,
  Trash2,
  Receipt,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money } from "@/components/StatusBadges";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/context/AuthContext";
import { formatActorLabel } from "@/lib/audit";
import { db } from "@/lib/firebase";
import { isGoodsIncome } from "@/lib/receipts";
import { roleLabel } from "@/lib/roles";
import { deleteSaleTransaction } from "@/lib/sales";
import {
  cn,
  formatCurrency,
  inputValueToDateKey,
  todayInputValue,
  todayKey,
} from "@/lib/utils";

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

function matchesSelectedDay(t, dateInput) {
  const key = dateInput ? inputValueToDateKey(dateInput) : todayKey();
  if (t?.businessDate && String(t.businessDate) === key) return true;
  const ms = txTimeMs(t);
  if (!ms) return false;
  return format(new Date(ms), "dd/MM/yyyy") === key;
}

function SalesLogContent() {
  const { showToast } = useToast();
  const { role, canDeleteSales } = useAuth();
  const [allTx, setAllTx] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateInput, setDateInput] = useState(todayInputValue());
  const [deletingId, setDeletingId] = useState(null);
  const [payFilter, setPayFilter] = useState("all"); // all | cash | banking

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "transactions"),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(isGoodsIncome)
          .sort((a, b) => txTimeMs(b) - txTimeMs(a));
        setAllTx(rows);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được sổ bán hàng", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const dayRows = useMemo(() => {
    let rows = allTx.filter((t) => matchesSelectedDay(t, dateInput));
    if (payFilter === "cash") {
      rows = rows.filter((t) => t.paymentMethod !== "banking");
    } else if (payFilter === "banking") {
      rows = rows.filter((t) => t.paymentMethod === "banking");
    }
    return rows;
  }, [allTx, dateInput, payFilter]);

  const dayTotal = useMemo(() => {
    let cash = 0;
    let banking = 0;
    for (const t of dayRows) {
      const amount = Number(t.amount) || 0;
      if (t.paymentMethod === "banking") banking += amount;
      else cash += amount;
    }
    return { cash, banking, total: cash + banking, count: dayRows.length };
  }, [dayRows]);

  const dayLabel = useMemo(() => {
    if (!dateInput) return todayKey();
    const d = parseISO(String(dateInput));
    if (!isValid(d)) return inputValueToDateKey(dateInput);
    return format(d, "EEEE, dd/MM/yyyy", { locale: vi });
  }, [dateInput]);

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
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell title="Món đã bán" subtitle="Theo giờ · ngày — xem & xóa nếu nhầm">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Về đối soát
      </Link>

      <section className="card-panel mb-4 space-y-3">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            Chọn ngày
          </span>
          <input
            type="date"
            className="field-input"
            value={dateInput}
            max={todayInputValue()}
            onChange={(e) => setDateInput(e.target.value)}
          />
        </label>
        <p className="text-xs font-medium capitalize text-slate-500">{dayLabel}</p>

        <div className="flex gap-1.5">
          {[
            { id: "all", label: "Tất cả" },
            { id: "cash", label: "Tiền mặt" },
            { id: "banking", label: "CK" },
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
            <Money amount={dayTotal.cash} />
          </p>
        </div>
        <div className="rounded-[1.25rem] bg-brand-700 px-4 py-3 text-white shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/75">
            Chuyển khoản
          </p>
          <p className="money mt-1 text-lg font-extrabold">
            <Money amount={dayTotal.banking} />
          </p>
        </div>
        <div className="col-span-2 rounded-[1.25rem] bg-slate-900 px-4 py-3 text-white shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
                Tổng ngày · {dayTotal.count} lần
              </p>
              <p className="money mt-1 text-2xl font-extrabold">
                <Money amount={dayTotal.total} />
              </p>
            </div>
            <Receipt className="h-8 w-8 text-white/40" aria-hidden />
          </div>
        </div>
      </section>

      <section className="mb-6 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title mb-0">Chi tiết món / lần thu</h2>
          {canDeleteSales ? (
            <p className="text-[11px] font-semibold text-rose-700">Có thể xóa</p>
          ) : null}
        </div>

        {loading ? (
          <div className="card-panel flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-brand-700" />
          </div>
        ) : dayRows.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Không có món bán trong ngày này.
          </div>
        ) : (
          <ul className="space-y-2">
            {dayRows.map((row) => {
              const isCk = row.paymentMethod === "banking";
              return (
                <li
                  key={row.id}
                  className="rounded-[1.25rem] bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-extrabold leading-snug text-slate-900">
                        {row.note || "Thu bán hàng"}
                      </p>
                      <p className="mt-1.5 text-xs font-semibold text-slate-500">
                        {formatTxDateTime(row)}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        <span className="font-bold text-brand-800">
                          {formatActorLabel(row)}
                        </span>
                        {row.createdByRole
                          ? ` · ${roleLabel(row.createdByRole)}`
                          : ""}
                        {" · "}
                        <span
                          className={
                            isCk
                              ? "font-bold text-brand-700"
                              : "font-bold text-emerald-700"
                          }
                        >
                          {isCk ? "Chuyển khoản" : "Tiền mặt"}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <p className="money text-lg font-extrabold text-emerald-700">
                        <Money amount={row.amount} />
                      </p>
                      {canDeleteSales ? (
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => handleDelete(row)}
                          className="inline-flex h-10 items-center gap-1 rounded-xl bg-rose-50 px-3 text-xs font-bold text-rose-700 ring-1 ring-rose-100 disabled:opacity-50"
                        >
                          {deletingId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          Xóa
                        </button>
                      ) : null}
                    </div>
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

export default function SalesLogPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor"]}>
      <SalesLogContent />
    </ProtectedRoute>
  );
}
