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
} from "lucide-react";
import AppShell from "@/components/AppShell";
import BankingByDateForm from "@/components/BankingByDateForm";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { formatActorLabel } from "@/lib/audit";
import { db } from "@/lib/firebase";
import {
  DEFAULT_PRODUCT_GROUPS,
  ensureDefaultProductGroups,
  subscribeProductGroups,
} from "@/lib/productGroups";
import { isSellable } from "@/lib/products";
import { isGoodsIncome, sumGoodsIncomeByMethod } from "@/lib/receipts";
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
    canViewInvestmentCapital,
    canViewDividends,
    canManageSystem,
    canCloseShift,
  } = useAuth();
  const [allTx, setAllTx] = useState([]);
  const [products, setProducts] = useState([]);
  const [groups, setGroups] = useState(DEFAULT_PRODUCT_GROUPS);
  const [loadingTx, setLoadingTx] = useState(true);
  const [loadingStock, setLoadingStock] = useState(true);
  const [period, setPeriod] = useState("day");

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
      .slice(0, 12);
  }, [periodTx, canViewDividends]);

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
      subtitle="Tổng kết ngày · tuần · tháng · tồn kho"
    >
      <div className="mb-4 grid grid-cols-1 gap-2">
        <Link
          href="/dashboard/monthly"
          className="touch-btn h-14 w-full justify-between bg-emerald-600 px-5 text-white"
        >
          <span className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" aria-hidden />
            {canViewDividends
              ? "Tổng kết tháng · cổ tức · tiền nhận"
              : "Chi tiết thu hàng hóa theo tháng"}
          </span>
          <span className="text-sm font-medium text-white/80">Mở →</span>
        </Link>

        {canCloseShift ? (
          <Link
            href="/manager/inventory"
            className="touch-btn h-14 w-full justify-between bg-slate-900 px-5 text-white"
          >
            <span className="flex items-center gap-2">
              <Package className="h-5 w-5" aria-hidden />
              Tồn kho · cập nhật danh mục còn lại
            </span>
            <span className="text-sm font-medium text-white/80">Mở →</span>
          </Link>
        ) : null}

        <Link
          href="/dashboard/capital"
          className="touch-btn h-14 w-full justify-between bg-brand-700 px-5 text-white"
        >
          <span className="flex items-center gap-2">
            <Landmark className="h-5 w-5" aria-hidden />
            {canViewInvestmentCapital
              ? "Ghi nhận vốn đầu tư & tài sản"
              : "Hàng hóa & thiết bị"}
          </span>
          <span className="text-sm font-medium text-white/80">Mở →</span>
        </Link>

        {canViewDividends && canManageSystem ? (
          <Link
            href="/dashboard/settings"
            className="touch-btn h-12 w-full justify-between border border-slate-200 bg-white px-5 text-slate-800"
          >
            <span className="flex items-center gap-2">
              <Percent className="h-5 w-5 text-brand-700" aria-hidden />
              % Quỹ đối ngoại (chia lãi)
            </span>
            <span className="text-sm text-slate-400">Cấu hình →</span>
          </Link>
        ) : null}
      </div>

      {/* Tổng kết ngày / tuần / tháng */}
      <section className="mb-4 space-y-3">
        <h2 className="section-title">Tổng kết doanh thu</h2>
        <p className="text-xs text-slate-500">
          Bấm Ngày · Tuần · Tháng để xem tổng tiền ngay
        </p>

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
                  "touch-btn min-h-[4.75rem] flex-col gap-1 px-2 py-2.5 text-center",
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

        {canViewDividends ? (
          <div className="grid grid-cols-1 gap-2">
            <StatCard
              label="Tổng thu (mọi loại) tháng"
              value={loadingTx ? 0 : totals.income}
              tone="success"
            />
            <StatCard
              label="Tổng chi tháng này"
              value={loadingTx ? 0 : totals.expense}
              tone="danger"
            />
            <StatCard
              label="Lợi nhuận tháng này"
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
        <h2 className="section-title">
          Thu gần đây · {selectedRange.shortLabel}
        </h2>
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
                    <p className="mt-1 text-xs font-semibold text-brand-800">
                      Nhập bởi: {formatActorLabel(row)}
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
    <ProtectedRoute allowRoles={["manager", "investor"]}>
      <DashboardContent />
    </ProtectedRoute>
  );
}
