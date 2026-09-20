'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  ChevronLeft,
  ChevronRight,
  Building2,
  Landmark,
  Package,
  Percent,
  Receipt,
  Trash2,
  Wallet,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import BankingByDateForm from "@/components/BankingByDateForm";
import DateRangeFilter from "@/components/DateRangeFilter";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import {
  ChipRow,
  EmptyState,
  FilterChip,
  SectionHeader,
} from "@/components/ui/MobileUI";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { formatActorLabel } from "@/lib/audit";
import {
  formatRangeLabel,
  hasDateRange,
  parseRangeBound,
} from "@/lib/dateRange";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { subscribeCollection } from "@/lib/liveCollection";
import { deleteSaleTransaction } from "@/lib/sales";
import { summarizeShopPnl } from "@/lib/pnl";
import {
  DEFAULT_PRODUCT_GROUPS,
  subscribeProductGroups,
} from "@/lib/productGroups";
import { isSellable, productsByIdMap, subscribeProducts } from "@/lib/products";
import {
  isGoodsIncome,
  sumGoodsIncomeByMethod,
  summarizeGoodsIncomeByActor,
} from "@/lib/receipts";
import { isShopOperatingExpense } from "@/lib/expenses";
import { roleLabel } from "@/lib/roles";
import { formatCurrency } from "@/lib/utils";

const REVENUE_PERIODS = [
  { id: "day", label: "Ngày" },
  { id: "week", label: "Tuần" },
  { id: "month", label: "Tháng" },
];

const RECENT_PAGE_SIZE = 10;

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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [recentPage, setRecentPage] = useState(1);
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
    const unsubTx = subscribeCollection(
      "transactions",
      (rows) => {
        setAllTx([...rows].sort((a, b) => txTimeMs(b) - txTimeMs(a)));
        setLoadingTx(false);
      },
      (error) => {
        console.error(error);
        showToast(
          firestoreErrorMessage(error, "Không tải được giao dịch"),
          "error"
        );
        setLoadingTx(false);
      }
    );

    const unsubProducts = subscribeProducts(
      (list) => {
        setProducts(list.filter(isSellable));
        setLoadingStock(false);
      },
      (error) => {
        console.error(error);
        showToast(firestoreErrorMessage(error, "Không tải được tồn kho"), "error");
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

  const customRangeActive = hasDateRange(dateFrom, dateTo);

  const selectedRange = useMemo(() => {
    if (customRangeActive) {
      const fromMs = parseRangeBound(dateFrom, false);
      const toMs = parseRangeBound(dateTo, true);
      const preset = ranges[period] || ranges.day;
      return {
        from: fromMs ?? preset.from,
        to: toMs ?? preset.to,
        label: formatRangeLabel(dateFrom, dateTo),
        shortLabel: "Theo khoảng ngày",
      };
    }
    return ranges[period] || ranges.day;
  }, [customRangeActive, dateFrom, dateTo, ranges, period]);

  const selectedGoods = useMemo(
    () =>
      sumGoodsIncomeByMethod(
        filterTxInRange(allTx, selectedRange.from, selectedRange.to)
      ),
    [allTx, selectedRange]
  );

  const periodTx = useMemo(
    () => filterTxInRange(allTx, selectedRange.from, selectedRange.to),
    [allTx, selectedRange]
  );

  const productsById = useMemo(() => productsByIdMap(products), [products]);

  const periodPnl = useMemo(
    () => summarizeShopPnl(periodTx, productsById),
    [periodTx, productsById]
  );

  const periodTotals = useMemo(() => {
    const goods = sumGoodsIncomeByMethod(periodTx);
    const expense = periodTx
      .filter(isShopOperatingExpense)
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const fundIn = periodTx
      .filter((t) => t.type === "fund_in" && t.businessLine !== "construction")
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    return {
      cash: goods.cash,
      banking: goods.banking,
      income: goods.total,
      expense,
      fundIn,
      profit: goods.total - expense,
    };
  }, [periodTx]);

  const recentIncome = useMemo(() => {
    return periodTx.filter(isGoodsIncome);
  }, [periodTx]);

  const recentTotalPages = Math.max(
    1,
    Math.ceil(recentIncome.length / RECENT_PAGE_SIZE)
  );
  const recentSafePage = Math.min(recentPage, recentTotalPages);
  const recentPageRows = useMemo(() => {
    const start = (recentSafePage - 1) * RECENT_PAGE_SIZE;
    return recentIncome.slice(start, start + RECENT_PAGE_SIZE);
  }, [recentIncome, recentSafePage]);

  useEffect(() => {
    setRecentPage(1);
  }, [period, dateFrom, dateTo]);

  useEffect(() => {
    if (recentPage > recentTotalPages) setRecentPage(recentTotalPages);
  }, [recentPage, recentTotalPages]);

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
          sum + (Number(p.inStock) || 0) * (Number(p.cost) || 0),
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
          (s, p) => s + (Number(p.inStock) || 0) * (Number(p.cost) || 0),
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
    <AppShell title="Đối soát" subtitle="Doanh thu kỳ đang chọn">
      {/* Hero doanh thu trước */}
      <section className="mb-6 space-y-3">
        <ChipRow>
          {REVENUE_PERIODS.map((item) => {
            const active = !customRangeActive && period === item.id;
            return (
              <FilterChip
                key={item.id}
                active={active}
                onClick={() => {
                  setPeriod(item.id);
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                {item.label}
              </FilterChip>
            );
          })}
        </ChipRow>

        <DateRangeFilter
          dense
          dateFrom={dateFrom}
          dateTo={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
          onClear={() => {
            setDateFrom("");
            setDateTo("");
          }}
        />

        <div className="rounded-[1.25rem] bg-gradient-to-br from-emerald-600 to-emerald-700 px-5 py-6 text-white shadow-md">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/80">
            {selectedRange.shortLabel}
          </p>
          <p className="mt-1 text-sm font-medium capitalize text-white/90">
            {selectedRange.label}
          </p>
          <p className="money mt-3 text-4xl font-bold leading-none tracking-tight">
            <Money amount={loadingTx ? 0 : selectedGoods.total} />
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-2xl bg-white/15 px-3 py-3">
              <p className="text-white/75">Tiền mặt</p>
              <p className="money mt-0.5 text-base font-bold">
                <Money amount={loadingTx ? 0 : selectedGoods.cash} />
              </p>
            </div>
            <div className="rounded-2xl bg-white/15 px-3 py-3">
              <p className="text-white/75">Chuyển khoản</p>
              <p className="money mt-0.5 text-base font-bold">
                <Money amount={loadingTx ? 0 : selectedGoods.banking} />
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Tổng kết kỳ */}
      <section className="mb-6 space-y-3">
        <SectionHeader title="Tổng kết kỳ" hint={selectedRange.shortLabel} />

        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="Thu TM"
            value={loadingTx ? 0 : periodTotals.cash}
            tone="success"
          />
          <StatCard
            label="Thu CK"
            value={loadingTx ? 0 : periodTotals.banking}
            tone="brand"
          />
          <StatCard
            label="Chi quỹ"
            value={loadingTx ? 0 : periodTotals.expense}
            tone="danger"
          />
          <StatCard
            label="Tiền két"
            value={loadingTx ? 0 : periodPnl.cashProfit}
            tone="brand"
          />
        </div>

        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Lãi theo giá vốn
        </p>
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="Giá vốn (COGS)"
            value={loadingTx ? 0 : periodPnl.cogs}
            tone="danger"
          />
          <StatCard
            label="Lãi gộp"
            value={loadingTx ? 0 : periodPnl.grossMargin}
            tone="success"
          />
          <StatCard
            label="Lãi kinh doanh"
            value={loadingTx ? 0 : periodPnl.operatingProfit}
            tone="brand"
          />
        </div>
        {!loadingTx && periodPnl.revenue > 0 && periodPnl.cogs === 0 ? (
          <p className="alert-soft text-xs">
            Giá vốn = 0 — kiểm tra cost món (Món · công thức).
          </p>
        ) : null}
        {!loadingTx && periodPnl.cogsEstimated ? (
          <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-slate-100">
            Một phần giá vốn đang ước từ catalog.
          </p>
        ) : null}
        {periodTotals.fundIn > 0 ? (
          <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-slate-100">
            Nạp quỹ:{" "}
            <span className="font-semibold text-emerald-700">
              <Money amount={periodTotals.fundIn} />
            </span>{" "}
            (không tính doanh thu)
          </p>
        ) : null}
      </section>

      {/* Thu gần đây */}
      <section className="mb-6 space-y-3">
        <SectionHeader
          title="Thu gần đây"
          hint={
            recentIncome.length
              ? `${recentIncome.length} giao dịch${
                  recentIncome.length > RECENT_PAGE_SIZE
                    ? ` · ${recentSafePage}/${recentTotalPages}`
                    : ""
                }`
              : selectedRange.shortLabel
          }
          action={
            <Link
              href="/manager/sales"
              className="min-h-11 inline-flex items-center text-sm font-bold text-brand-800"
            >
              Sổ →
            </Link>
          }
        />
        {loadingTx ? (
          <div className="card-panel h-20 animate-pulse bg-white/80" />
        ) : recentIncome.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Chưa có khoản thu"
            description="Ghi thu tiền mặt hoặc chuyển khoản để thấy ở đây."
            action={
              <Link
                href="/manager/pos"
                className="touch-btn h-12 w-full bg-emerald-600 text-white"
              >
                Vào thu tiền
              </Link>
            }
          />
        ) : (
          <>
            {recentPageRows.map((row) => {
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
                <article key={row.id} className="card-panel !py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold text-slate-900">
                        {row.note || row.category || "Thu"}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {dayLabel ? `Ngày ${dayLabel} · ` : ""}
                        {timeLabel}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-700">
                        <span className="font-bold text-brand-800">
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
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <p className="money text-lg font-bold text-emerald-700">
                        <Money amount={row.amount} />
                      </p>
                      {canDeleteSales ? (
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => handleDeleteSale(row)}
                          className="touch-btn h-11 min-w-[4.5rem] gap-1.5 rounded-2xl bg-rose-50 px-3 text-sm font-bold text-rose-700 ring-1 ring-rose-100 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          {deletingId === row.id ? "…" : "Xóa"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}

            {recentTotalPages > 1 ? (
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={recentSafePage <= 1}
                  onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                  className="touch-btn h-12 flex-1 gap-1 bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-35"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Trước
                </button>
                <p className="shrink-0 text-xs font-semibold text-slate-500">
                  {recentSafePage} / {recentTotalPages}
                </p>
                <button
                  type="button"
                  disabled={recentSafePage >= recentTotalPages}
                  onClick={() =>
                    setRecentPage((p) => Math.min(recentTotalPages, p + 1))
                  }
                  className="touch-btn h-12 flex-1 gap-1 bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-35"
                >
                  Sau
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* Người nhập bán */}
      <section className="mb-6 space-y-3">
        <SectionHeader
          title="Người nhập bán"
          hint={selectedRange.shortLabel}
        />
        {loadingTx ? (
          <div className="card-panel h-20 animate-pulse bg-white/80" />
        ) : salesByActor.length === 0 ? (
          <EmptyState
            title="Chưa có ai ghi thu"
            description="Khi có khoản thu trong kỳ, tổng theo người nhập sẽ hiện ở đây."
          />
        ) : (
          salesByActor.map((row) => (
            <article
              key={row.key}
              className="rounded-[1.25rem] bg-white px-4 py-3.5 shadow-sm ring-1 ring-slate-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-slate-900">
                    {(() => {
                      const label = formatActorLabel({
                        createdByName: row.name,
                        createdByUsername: row.username,
                      });
                      return label === "—" ? "Không rõ người nhập" : label;
                    })()}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {roleLabel(row.role)}
                    {" · "}
                    {row.count} lần ghi
                  </p>
                </div>
                <p className="money shrink-0 text-lg font-bold text-emerald-700">
                  <Money amount={row.total} />
                </p>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-900">
                  <p className="font-semibold text-emerald-700/80">Tiền mặt</p>
                  <p className="money font-bold">
                    <Money amount={row.cash} />
                  </p>
                </div>
                <div className="rounded-xl bg-brand-50 px-3 py-2 text-brand-900">
                  <p className="font-semibold text-brand-700/80">Chuyển khoản</p>
                  <p className="money font-bold">
                    <Money amount={row.banking} />
                  </p>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      {canCloseShift ? (
        <BankingByDateForm className="mb-6" />
      ) : null}

      {/* Tồn kho */}
      <section className="mb-6 space-y-3">
        <SectionHeader
          title="Tồn kho theo nhóm"
          action={
            canCloseShift ? (
              <Link
                href="/manager/inventory"
                className="min-h-11 inline-flex items-center text-sm font-bold text-brand-800"
              >
                Nhập hàng →
              </Link>
            ) : null
          }
        />

        {loadingStock ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : (
          <>
            <div className="rounded-[1.25rem] bg-slate-900 px-4 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
                Tổng tồn
              </p>
              <p className="mt-1 text-3xl font-bold leading-none">
                {stockTotals.qty}
              </p>
              <p className="mt-2 text-sm text-white/80">
                {stockTotals.count} món ·{" "}
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
                  <p className="money mt-1 text-xl font-bold text-slate-900">
                    {g.qty}
                  </p>
                  <p className="text-xs text-slate-500">
                    {g.count} món · {formatCurrency(g.value)}
                  </p>
                </article>
              ))}
            </div>

            {lowStock.length > 0 ? (
              <div className="alert-soft">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-800">
                  Sắp hết (≤ 5)
                </p>
                <ul className="space-y-1.5">
                  {lowStock.map((p) => (
                    <li
                      key={p.id}
                      className="flex justify-between gap-2 text-sm text-amber-950"
                    >
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="money shrink-0 font-bold">
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

      {/* Lối tắt — demoted dưới nội dung chính */}
      <section className="mb-6">
        <SectionHeader title="Thao tác nhanh" />
        <div className="grid grid-cols-2 gap-2">
          {[
            {
              href: "/manager/construction",
              icon: Building2,
              label: "Xây dựng",
            },
            { href: "/manager/products", icon: Package, label: "Món · CT" },
            {
              href: "/dashboard/monthly",
              icon: CalendarDays,
              label: canViewDividends ? "Tháng · cổ tức" : "Theo tháng",
            },
            canCloseShift
              ? {
                  href: "/manager/inventory",
                  icon: Package,
                  label: "Nhập hàng",
                }
              : null,
            { href: "/manager/sales", icon: Receipt, label: "Món đã bán" },
            { href: "/manager/expenses", icon: Wallet, label: "Quỹ CH" },
            {
              href: "/dashboard/capital",
              icon: Landmark,
              label: canViewInvestmentCapital ? "Vốn cổ đông" : "Hàng / TB",
            },
            canViewDividends && canManageSystem
              ? {
                  href: "/dashboard/settings",
                  icon: Percent,
                  label: "% Quỹ ĐN",
                }
              : null,
          ]
            .filter(Boolean)
            .map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  className="touch-btn h-12 justify-start gap-2 border border-slate-200 bg-white px-3 text-sm text-slate-800"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
        </div>
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
