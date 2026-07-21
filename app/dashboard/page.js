'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  format,
} from "date-fns";
import { vi } from "date-fns/locale";
import {
  CalendarDays,
  Landmark,
  Package,
  Percent,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import BankingByDateForm from "@/components/BankingByDateForm";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { formatActorLabel } from "@/lib/audit";
import { db } from "@/lib/firebase";
import { deleteSaleTransaction } from "@/lib/sales";
import {
  DEFAULT_PRODUCT_GROUPS,
  ensureDefaultProductGroups,
  subscribeProductGroups,
} from "@/lib/productGroups";
import { isSellable } from "@/lib/products";
import {
  isGoodsIncome,
  sumGoodsIncomeByMethod,
  summarizeGoodsIncomeByActor,
} from "@/lib/receipts";
import { roleLabel } from "@/lib/roles";
import { cn, formatCurrency } from "@/lib/utils";

const REVENUE_PERIODS = [
  { id: "day", label: "Ngày" },
  { id: "week", label: "Tuần" },
  { id: "month", label: "Tháng" },
];

function txTimeMs(t) {
  return t?.timestamp?.toMillis?.() ?? 0;
}

function filterTxInRange(rows, from, to) {
  return rows.filter((t) => {
    const ms = txTimeMs(t);
    return ms >= from && ms <= to;
  });
}

function DashboardContent() {
  const { showToast } = useToast();
  const {
    role,
    canViewInvestmentCapital,
    canViewDividends,
    canManageSystem,
    canCloseShift,
    canDeleteSales,
  } = useAuth();
  const [allTx, setAllTx] = useState([]);
  const [products, setProducts] = useState([]);
  const [groups, setGroups] = useState(DEFAULT_PRODUCT_GROUPS);
  const [loadingTx, setLoadingTx] = useState(true);
  const [loadingStock, setLoadingStock] = useState(true);
  const [period, setPeriod] = useState("day");
  const [deletingId, setDeletingId] = useState(null);

  const handleDeleteSale = async (row) => {
    if (!canDeleteSales || !row?.id) return;
    const label = row.note || "khoản thu";
    const ok = window.confirm(
      `Xóa "${label}" · ${formatCurrency(row.amount)}?\nChỉ xóa khi ghi nhầm.`
    );
    if (!ok) return;
    setDeletingId(row.id);
    try {
      await deleteSaleTransaction(row.id, role);
      showToast("Đã xóa khoản thu", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    ensureDefaultProductGroups().catch(() => {});
  }, []);

  useEffect(() => {
    const unsubTx = onSnapshot(
      collection(db, "transactions"),
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => txTimeMs(b) - txTimeMs(a));
        setAllTx(rows);
        setLoadingTx(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được giao dịch — kiểm tra quyền Firestore", "error");
        setLoadingTx(false);
      }
    );

    const unsubProducts = onSnapshot(
      query(collection(db, "products"), orderBy("name")),
      (snap) => {
        setProducts(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter(isSellable)
        );
        setLoadingStock(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được tồn kho", "error");
        setLoadingStock(false);
      }
    );

    const unsubGroups = subscribeProductGroups(
      (rows) => {
        const active = rows.filter((g) => g.active !== false);
        setGroups(active.length ? active : DEFAULT_PRODUCT_GROUPS);
      },
      () => setGroups(DEFAULT_PRODUCT_GROUPS)
    );

    return () => {
      unsubTx();
      unsubProducts();
      unsubGroups();
    };
  }, [showToast]);

  const ranges = useMemo(() => {
    const now = new Date();
    const weekFrom = startOfWeek(now, { weekStartsOn: 1 });
    const weekTo = endOfWeek(now, { weekStartsOn: 1 });
    return {
      day: {
        from: startOfDay(now).getTime(),
        to: endOfDay(now).getTime(),
        label: format(now, "EEEE dd/MM", { locale: vi }),
        shortLabel: "Tổng kết ngày",
      },
      week: {
        from: weekFrom.getTime(),
        to: weekTo.getTime(),
        label: `${format(weekFrom, "dd/MM")} – ${format(weekTo, "dd/MM")}`,
        shortLabel: "Tổng kết tuần",
      },
      month: {
        from: startOfMonth(now).getTime(),
        to: endOfMonth(now).getTime(),
        label: format(now, "MM/yyyy"),
        shortLabel: "Tổng kết tháng",
      },
    };
  }, []);

  const goodsByPeriod = useMemo(() => {
    return {
      day: sumGoodsIncomeByMethod(
        filterTxInRange(allTx, ranges.day.from, ranges.day.to)
      ),
      week: sumGoodsIncomeByMethod(
        filterTxInRange(allTx, ranges.week.from, ranges.week.to)
      ),
      month: sumGoodsIncomeByMethod(
        filterTxInRange(allTx, ranges.month.from, ranges.month.to)
      ),
    };
  }, [allTx, ranges]);

  const selectedGoods = goodsByPeriod[period] || goodsByPeriod.day;
  const selectedRange = ranges[period] || ranges.day;

  const monthTx = useMemo(
    () => filterTxInRange(allTx, ranges.month.from, ranges.month.to),
    [allTx, ranges]
  );

  const periodTx = useMemo(
    () => filterTxInRange(allTx, selectedRange.from, selectedRange.to),
    [allTx, selectedRange]
  );

  const totals = useMemo(() => {
    const income = monthTx
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const expense = monthTx
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    return {
      income,
      expense,
      profit: income - expense,
    };
  }, [monthTx]);

  const recentIncome = useMemo(() => {
    return periodTx
      .filter((t) =>
        canViewDividends ? t.type === "income" : isGoodsIncome(t)
      )
      .slice(0, 30);
  }, [periodTx, canViewDividends]);

  const salesByActor = useMemo(
    () => summarizeGoodsIncomeByActor(periodTx),
    [periodTx]
  );

  const stockByGroup = useMemo(() => {
    const known = new Set(groups.map((g) => g.id));
    const rows = groups.map((g) => {
      const items = products.filter((p) => p.groupId === g.id);
      const qty = items.reduce((sum, p) => sum + (Number(p.inStock) || 0), 0);
      const value = items.reduce(
        (sum, p) =>
          sum + (Number(p.inStock) || 0) * (Number(p.price) || 0),
        0
      );
      return {
        id: g.id,
        name: g.name,
        count: items.length,
        qty,
        value,
      };
    });
    const otherItems = products.filter(
      (p) => !p.groupId || !known.has(p.groupId)
    );
    if (otherItems.length) {
      rows.push({
        id: "other",
        name: "Khác",
        count: otherItems.length,
        qty: otherItems.reduce((s, p) => s + (Number(p.inStock) || 0), 0),
        value: otherItems.reduce(
          (s, p) => s + (Number(p.inStock) || 0) * (Number(p.price) || 0),
          0
        ),
      });
    }
    return rows;
  }, [groups, products]);

  const stockTotals = useMemo(() => {
    return stockByGroup.reduce(
      (acc, g) => ({
        qty: acc.qty + g.qty,
        value: acc.value + g.value,
        count: acc.count + g.count,
      }),
      { qty: 0, value: 0, count: 0 }
    );
  }, [stockByGroup]);

  const lowStock = useMemo(() => {
    return products
      .filter((p) => (Number(p.inStock) || 0) <= 5)
      .sort((a, b) => (Number(a.inStock) || 0) - (Number(b.inStock) || 0))
      .slice(0, 8);
  }, [products]);

  return (
    <AppShell
      title="Đối soát"
      subtitle="Doanh thu nhanh · thao tác phụ bên dưới"
    >
      {/* Doanh thu trước — việc mở app mỗi ngày */}
      <section className="mb-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {REVENUE_PERIODS.map((item) => {
            const active = period === item.id;
            const total = loadingTx ? 0 : goodsByPeriod[item.id].total;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPeriod(item.id)}
                className={cn(
                  "touch-btn min-h-[4.5rem] flex-col gap-1 px-2 py-2.5 text-center",
                  active
                    ? "bg-emerald-600 text-white shadow-md"
                    : "bg-white text-slate-800 ring-1 ring-slate-200"
                )}
              >
                <span
                  className={cn(
                    "text-xs font-extrabold uppercase tracking-wide",
                    active ? "text-white/85" : "text-slate-500"
                  )}
                >
                  {item.label}
                </span>
                <span
                  className={cn(
                    "money text-sm font-extrabold leading-tight sm:text-base",
                    active ? "text-white" : "text-emerald-700"
                  )}
                >
                  <Money amount={total} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="rounded-[1.25rem] bg-gradient-to-br from-emerald-600 to-emerald-700 px-4 py-5 text-white shadow-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">
            {selectedRange.shortLabel}
          </p>
          <p className="mt-0.5 text-sm font-semibold capitalize text-white/90">
            {selectedRange.label}
          </p>
          <p className="money mt-2 text-4xl font-extrabold leading-none">
            <Money amount={loadingTx ? 0 : selectedGoods.total} />
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-white/15 px-3 py-2">
              <p className="text-white/75">Tiền mặt</p>
              <p className="money font-extrabold">
                <Money amount={loadingTx ? 0 : selectedGoods.cash} />
              </p>
            </div>
            <div className="rounded-xl bg-white/15 px-3 py-2">
              <p className="text-white/75">Chuyển khoản</p>
              <p className="money font-extrabold">
                <Money amount={loadingTx ? 0 : selectedGoods.banking} />
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Lối tắt gọn — 2 cột, không che doanh thu */}
      <section className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Thao tác nhanh
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/dashboard/monthly"
            className="touch-btn h-12 justify-start gap-2 bg-emerald-600 px-3 text-sm text-white"
          >
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              {canViewDividends ? "Tháng · cổ tức" : "Thu theo tháng"}
            </span>
          </Link>

          {canCloseShift ? (
            <Link
              href="/manager/inventory"
              className="touch-btn h-12 justify-start gap-2 bg-slate-900 px-3 text-sm text-white"
            >
              <Package className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">Tồn kho</span>
            </Link>
          ) : null}

          <Link
            href="/manager/sales"
            className="touch-btn h-12 justify-start gap-2 bg-emerald-700 px-3 text-sm text-white"
          >
            <Receipt className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">Món đã bán</span>
          </Link>

          <Link
            href="/manager/expenses"
            className="touch-btn h-12 justify-start gap-2 bg-rose-600 px-3 text-sm text-white"
          >
            <Wallet className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">Quỹ cửa hàng</span>
          </Link>

          <Link
            href="/dashboard/capital"
            className="touch-btn h-12 justify-start gap-2 bg-brand-700 px-3 text-sm text-white"
          >
            <Landmark className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">
              {canViewInvestmentCapital ? "Vốn cổ đông" : "Hàng hóa / TB"}
            </span>
          </Link>

          {canViewDividends && canManageSystem ? (
            <Link
              href="/dashboard/settings"
              className="touch-btn h-12 justify-start gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-800"
            >
              <Percent className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
              <span className="truncate">% Quỹ đối ngoại</span>
            </Link>
          ) : null}
        </div>
      </section>

      {/* Tổng kết ngày / tuần / tháng — chi tiết phía dưới đã có hero */}
      <section className="mb-4 space-y-3">
        <h2 className="section-title">Chi tiết kỳ đang chọn</h2>

        {canViewDividends ? (
          <div className="grid grid-cols-1 gap-2">
            <StatCard
              label="Thu bán hàng tháng"
              value={loadingTx ? 0 : totals.income}
              tone="success"
            />
            <StatCard
              label="Chi quỹ cửa hàng tháng"
              value={loadingTx ? 0 : totals.expense}
              tone="danger"
            />
            <StatCard
              label="Lợi nhuận tháng (thu − chi)"
              value={loadingTx ? 0 : totals.profit}
              tone="brand"
            />
          </div>
        ) : (
          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-100">
            Quản lý xem tổng kết ngày / tuần / tháng (TM + CK hàng hóa).
          </p>
        )}
      </section>

      {/* Ai bán / nhập tiền trong kỳ */}
      <section className="mb-4 space-y-3">
        <h2 className="section-title">
          Người nhập bán · {selectedRange.shortLabel}
        </h2>
        <p className="text-xs text-slate-500">
          Tổng tiền mỗi nhân viên / quản lý đã ghi thu trong kỳ đang chọn
        </p>
        {loadingTx ? (
          <div className="card-panel h-20 animate-pulse bg-white/80" />
        ) : salesByActor.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Chưa có ai ghi thu trong kỳ này.
          </div>
        ) : (
          salesByActor.map((row) => (
            <article
              key={row.key}
              className="rounded-[1.25rem] bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-extrabold text-slate-900">
                    {(() => {
                      const label = formatActorLabel({
                        createdByName: row.name,
                        createdByUsername: row.username,
                      });
                      return label === "—" ? "Không rõ người nhập" : label;
                    })()}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">
                    {roleLabel(row.role)}
                    {" · "}
                    {row.count} lần ghi
                  </p>
                </div>
                <p className="money shrink-0 text-lg font-extrabold text-emerald-700">
                  <Money amount={row.total} />
                </p>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-900">
                  <p className="font-semibold text-emerald-700/80">Tiền mặt</p>
                  <p className="money font-extrabold">
                    <Money amount={row.cash} />
                  </p>
                </div>
                <div className="rounded-xl bg-brand-50 px-3 py-2 text-brand-900">
                  <p className="font-semibold text-brand-700/80">Chuyển khoản</p>
                  <p className="money font-extrabold">
                    <Money amount={row.banking} />
                  </p>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      {canCloseShift ? (
        <BankingByDateForm className="mb-4" />
      ) : null}

      {/* Báo cáo tồn kho nhanh theo nhóm */}
      <section className="mb-4 space-y-3">
        <div className="flex items-end justify-between gap-2">
          <h2 className="section-title mb-0">Tồn kho theo nhóm</h2>
          {canCloseShift ? (
            <Link
              href="/manager/inventory"
              className="text-xs font-bold text-brand-800"
            >
              Sửa tồn →
            </Link>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Báo cáo nhanh danh mục còn trong kho
        </p>

        {loadingStock ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : (
          <>
            <div className="rounded-[1.25rem] bg-slate-900 px-4 py-4 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                Tổng tồn
              </p>
              <p className="mt-1 text-3xl font-extrabold leading-none">
                {stockTotals.qty}
              </p>
              <p className="mt-2 text-sm text-white/80">
                {stockTotals.count} món · Giá trị ước tính{" "}
                <span className="money font-bold text-white">
                  {formatCurrency(stockTotals.value)}
                </span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {stockByGroup.map((g) => (
                <article
                  key={g.id}
                  className="rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200"
                >
                  <p className="text-xs font-bold text-slate-500">{g.name}</p>
                  <p className="money mt-1 text-xl font-extrabold text-slate-900">
                    {g.qty}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {g.count} món · {formatCurrency(g.value)}
                  </p>
                </article>
              ))}
            </div>

            {lowStock.length > 0 ? (
              <div className="rounded-2xl bg-amber-50 px-3 py-3 ring-1 ring-amber-100">
                <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-amber-800">
                  Sắp hết (≤ 5)
                </p>
                <ul className="space-y-1.5">
                  {lowStock.map((p) => (
                    <li
                      key={p.id}
                      className="flex justify-between gap-2 text-sm text-amber-950"
                    >
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="money shrink-0 font-extrabold">
                        {Number(p.inStock) || 0}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="mb-6 space-y-3">
        <div className="flex items-end justify-between gap-2">
          <h2 className="section-title mb-0">
            Thu gần đây · {selectedRange.shortLabel}
          </h2>
          <Link
            href="/manager/sales"
            className="text-xs font-bold text-brand-800"
          >
            Sổ theo ngày →
          </Link>
        </div>
        {loadingTx ? (
          <div className="card-panel h-20 animate-pulse bg-white/80" />
        ) : recentIncome.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Chưa có khoản thu trong kỳ này. Vào Thu tiền → ghi TM hoặc CK.
          </div>
        ) : (
          recentIncome.map((row) => {
            const ms = row.timestamp?.toMillis?.() ?? 0;
            const timeLabel = ms
              ? new Date(ms).toLocaleString("vi-VN", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—";
            const isCk = row.paymentMethod === "banking";
            const dayLabel = row.businessDate || null;
            return (
              <article key={row.id} className="card-panel space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {row.note || row.category || "Thu"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {dayLabel ? `Ngày ${dayLabel} · ` : ""}
                      {timeLabel}
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
                        {isCk ? "CK" : "TM"}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="money text-base font-extrabold text-emerald-700">
                      <Money amount={row.amount} />
                    </p>
                    {canDeleteSales ? (
                      <button
                        type="button"
                        disabled={deletingId === row.id}
                        onClick={() => handleDeleteSale(row)}
                        className="inline-flex items-center gap-1 rounded-xl bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-100 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        {deletingId === row.id ? "Đang xóa…" : "Xóa"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor", "superadmin"]}>
      <DashboardContent />
    </ProtectedRoute>
  );
}
