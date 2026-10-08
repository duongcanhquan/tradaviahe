'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Receipt,
  Trash2,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import BankingByDateForm from "@/components/BankingByDateForm";
import DateRangeFilter from "@/components/DateRangeFilter";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { EmptyState, SectionHeader } from "@/components/ui/MobileUI";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { formatActorLabel } from "@/lib/audit";
import {
  formatRangeLabel,
  hasDateRange,
  parseRangeBound,
  presetRange,
} from "@/lib/dateRange";
import { dropDoisoatTx, loadDoisoatToday, peekDoisoatToday } from "@/lib/dayLedger";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import {
  readTransactionsInRange,
  txLimitForRange,
} from "@/lib/liveCollection";
import { deleteSaleTransaction } from "@/lib/sales";
import { summarizeShopPnl } from "@/lib/pnl";
import { isSellable, productsByIdMap, subscribeProducts } from "@/lib/products";
import { isGoodsIncome, sumGoodsIncomeByMethod } from "@/lib/receipts";
import { isShopOperatingExpense } from "@/lib/expenses";
import { roleLabel } from "@/lib/roles";
import { formatCurrency } from "@/lib/utils";

const PERIOD_BUTTONS = [
  {
    id: "day",
    label: "Hôm nay",
    idle: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    on: "bg-emerald-600 text-white ring-emerald-700",
  },
  {
    id: "week",
    label: "Tuần",
    idle: "bg-sky-50 text-sky-900 ring-sky-200",
    on: "bg-sky-600 text-white ring-sky-700",
  },
  {
    id: "month",
    label: "Doanh thu tháng",
    idle: "bg-amber-50 text-amber-950 ring-amber-200",
    on: "bg-amber-500 text-white ring-amber-600",
  },
  {
    id: "custom",
    label: "Theo ngày",
    idle: "bg-violet-50 text-violet-900 ring-violet-200",
    on: "bg-violet-600 text-white ring-violet-700",
  },
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
    canDeleteSales,
  } = useAuth();
  const [allTx, setAllTx] = useState([]);
  const [products, setProducts] = useState([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [period, setPeriod] = useState("day");
  const [dateMode, setDateMode] = useState(false);
  const [reportAsked, setReportAsked] = useState(true);
  const [showLines, setShowLines] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [recentPage, setRecentPage] = useState(1);
  const [deletingId, setDeletingId] = useState(null);
  const warnedTxCap = useRef(false);

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
      dropDoisoatTx(row.id);
      setAllTx((list) => list.filter((item) => item.id !== row.id));
      showToast("Đã xóa khoản thu", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    const unsubProducts = subscribeProducts(
      (list) => setProducts(list.filter(isSellable)),
      (error) => {
        console.error(error);
        showToast(firestoreErrorMessage(error, "Không tải được giá vốn"), "error");
      }
    );
    return () => unsubProducts();
  }, [showToast]);

  const ranges = useMemo(() => {
    const pack = (preset, shortLabel) => {
      const { from, to } = presetRange(preset);
      return {
        from: parseRangeBound(from, false),
        to: parseRangeBound(to, true),
        label: formatRangeLabel(from, to),
        shortLabel,
      };
    };
    return {
      day: pack("day", ""),
      week: pack("week", "Tổng kết tuần"),
      month: pack("month", "Tổng kết tháng"),
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

  useEffect(() => {
    const todayOnly = !dateMode && period === "day";
    if (dateMode && !customRangeActive) {
      setLoadingTx(false);
      return undefined;
    }
    if (!todayOnly && !reportAsked && !customRangeActive) {
      setLoadingTx(false);
      return undefined;
    }
    let cancelled = false;
    warnedTxCap.current = false;
    if (todayOnly) {
      const cached = peekDoisoatToday();
      if (cached.length) {
        setAllTx(cached);
        setLoadingTx(false);
      } else {
        setLoadingTx(true);
      }
    } else {
      setLoadingTx(true);
    }
    const bounds = customRangeActive
      ? { from: dateFrom, to: dateTo || dateFrom }
      : presetRange(period);
    const job = todayOnly
      ? loadDoisoatToday()
      : readTransactionsInRange(bounds.from, bounds.to);
    job
      .then((rows) => {
        if (cancelled) return;
        setAllTx(rows);
        setLoadingTx(false);
        const cap = txLimitForRange(selectedRange.from, selectedRange.to);
        if (!todayOnly && rows.length >= cap && !warnedTxCap.current) {
          warnedTxCap.current = true;
          showToast(
            "Kỳ này nhiều phiếu hơn mức tải. Thu hẹp ngày để số liệu đủ.",
            "error"
          );
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        showToast(
          firestoreErrorMessage(error, "Không tải được giao dịch"),
          "error"
        );
        setLoadingTx(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    reportAsked,
    dateMode,
    period,
    customRangeActive,
    dateFrom,
    dateTo,
    selectedRange.from,
    selectedRange.to,
    showToast,
  ]);

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

  return (
    <AppShell title="Đối soát" subtitle="Doanh thu bán trong kỳ">
      <section className="glass-panel mb-4 p-3">
        <div className="grid grid-cols-4 gap-2">
          {PERIOD_BUTTONS.map((item) => {
            const active =
              item.id === "custom" ? dateMode : !dateMode && period === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setShowLines(false);
                  if (item.id === "custom") {
                    setDateMode(true);
                    return;
                  }
                  setDateMode(false);
                  setDateFrom("");
                  setDateTo("");
                  setPeriod(item.id);
                  setReportAsked(true);
                }}
                className={`touch-btn h-12 w-full rounded-2xl px-1 text-xs font-bold leading-tight ring-1 sm:text-sm ${
                  active ? item.on : item.idle
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {dateMode ? (
          <div className="mt-3 rounded-2xl bg-violet-50 p-2 ring-1 ring-violet-100">
            <DateRangeFilter
              dense
              dateFrom={dateFrom}
              dateTo={dateTo}
              onFromChange={(value) => {
                setDateFrom(value);
                setShowLines(false);
              }}
              onToChange={(value) => {
                setDateTo(value);
                setShowLines(false);
              }}
              onClear={() => {
                setDateMode(false);
                setDateFrom("");
                setDateTo("");
                setPeriod("day");
              }}
            />
          </div>
        ) : null}
      </section>


      <div className="mb-4 grid grid-cols-3 gap-2">
        {canViewInvestmentCapital ? (
          <Link
            href="/dashboard/capital"
            className="touch-btn h-12 gap-1 border border-white/70 bg-white/45 px-1 text-xs font-bold text-brand-900 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.85)] backdrop-blur-md"
          >
            <Landmark className="h-4 w-4 shrink-0" aria-hidden />
            Vốn
          </Link>
        ) : null}
        <Link
          href="/dashboard/monthly"
          className="touch-btn h-12 gap-1 border border-amber-200/80 bg-amber-100/55 px-1 text-xs font-bold text-amber-950 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.8)] backdrop-blur-md"
        >
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
          {canViewDividends ? "Cổ tức" : "Theo tháng"}
        </Link>
        <Link
          href="/manager/sales"
          className="touch-btn h-12 gap-1 border border-white/70 bg-slate-900/75 px-1 text-xs font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.18)] backdrop-blur-md"
        >
          <Receipt className="h-4 w-4 shrink-0" aria-hidden />
          Sổ bán
        </Link>
      </div>

      <section className="glass-panel mb-4 space-y-3 p-3">
        <div className="relative overflow-hidden rounded-[1.25rem] bg-gradient-to-br from-emerald-500/90 to-teal-700/90 px-5 py-6 text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.28),0_16px_40px_rgb(6_78_59_/_0.18)] ring-1 ring-white/25 backdrop-blur-md">
          {selectedRange.shortLabel ? (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/80">
              {selectedRange.shortLabel}
            </p>
          ) : null}
          <p className="text-sm font-medium capitalize text-white/90">
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

      <section className="glass-panel mb-4 space-y-3 border-sky-200/70 p-3">
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

      </section>

      <section className="glass-panel mb-4 space-y-3 border-amber-200/70 p-3">
        <SectionHeader title="Lãi theo giá vốn" hint={selectedRange.shortLabel} />
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

      <section className="glass-panel mb-4 space-y-3 p-3">
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
        {dateMode && !customRangeActive ? (
          <p className="text-sm text-slate-500">
            Chọn từ ngày và đến ngày để xem kỳ đó.
          </p>
        ) : !showLines ? (
          <button
            type="button"
            onClick={() => setShowLines(true)}
            className="touch-btn h-12 w-full rounded-2xl bg-slate-900 text-sm font-bold text-white"
          >
            Hiện danh sách phiếu
          </button>
        ) : loadingTx ? (
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
