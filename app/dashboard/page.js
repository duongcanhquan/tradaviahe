'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import {
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  subDays,
  format,
  parse,
  isValid,
} from "date-fns";
import { vi } from "date-fns/locale";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  CalendarDays,
  ClipboardCheck,
  Landmark,
  Percent,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import BankingByDateForm from "@/components/BankingByDateForm";
import ProtectedRoute from "@/components/ProtectedRoute";
import { DiscrepancyBadge, Money, StatCard } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { formatActorLabel } from "@/lib/audit";
import { db } from "@/lib/firebase";
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
  const [reports, setReports] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [loadingReports, setLoadingReports] = useState(true);
  const [period, setPeriod] = useState("day");

  useEffect(() => {
    // Không orderBy — tránh kẹt khi thiếu index / field
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

    const unsubReports = onSnapshot(
      collection(db, "daily_reports"),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const da = parse(a.date || "", "dd/MM/yyyy", new Date());
          const dbDate = parse(b.date || "", "dd/MM/yyyy", new Date());
          const ta = isValid(da) ? da.getTime() : 0;
          const tb = isValid(dbDate) ? dbDate.getTime() : 0;
          return tb - ta;
        });
        setReports(rows);
        setLoadingReports(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được báo cáo chốt ca", "error");
        setLoadingReports(false);
      }
    );

    return () => {
      unsubTx();
      unsubReports();
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
        shortLabel: "Hôm nay",
      },
      week: {
        from: weekFrom.getTime(),
        to: weekTo.getTime(),
        label: `${format(weekFrom, "dd/MM")} – ${format(weekTo, "dd/MM")}`,
        shortLabel: "Tuần này",
      },
      month: {
        from: startOfMonth(now).getTime(),
        to: endOfMonth(now).getTime(),
        label: format(now, "MM/yyyy"),
        shortLabel: "Tháng này",
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

  const chartData = useMemo(() => {
    return Array.from({ length: 7 }).map((_, index) => {
      const day = subDays(new Date(), 6 - index);
      const key = format(day, "dd/MM/yyyy");
      const report = reports.find((r) => r.date === key);
      return {
        date: format(day, "dd/MM"),
        fullDate: key,
        discrepancy: report ? Number(report.discrepancy) || 0 : 0,
        hasReport: Boolean(report),
        cash: report ? Number(report.endCashActual) || 0 : 0,
        banking: report ? Number(report.bankingActual) || 0 : 0,
      };
    });
  }, [reports]);

  const sortedReports = useMemo(() => reports.slice(0, 12), [reports]);

  const recentIncome = useMemo(() => {
    return periodTx
      .filter((t) =>
        canViewDividends ? t.type === "income" : isGoodsIncome(t)
      )
      .slice(0, 15);
  }, [periodTx, canViewDividends]);

  return (
    <AppShell
      title="Đối soát"
      subtitle="Thu TM / CK · Chốt ca · Tổng kết"
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
              : "Tổng thu hàng hóa theo tháng"}
          </span>
          <span className="text-sm font-medium text-white/80">Mở →</span>
        </Link>

        {canCloseShift ? (
          <Link
            href="/manager/inventory"
            className="touch-btn h-14 w-full justify-between bg-slate-900 px-5 text-white"
          >
            <span className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" aria-hidden />
              Chốt ca · tồn kho & quỹ thực tế
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

      {/* Doanh thu nhanh: Ngày / Tuần / Tháng */}
      <section className="mb-4 space-y-3">
        <h2 className="section-title">Doanh thu hàng hóa</h2>
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
            Quản lý xem doanh thu hàng hóa (TM/CK) theo ngày / tuần / tháng.
          </p>
        )}
      </section>

      {canCloseShift ? (
        <BankingByDateForm className="mb-4" />
      ) : null}

      <section className="card-panel mb-4">
        <h2 className="section-title mb-1">Chênh lệch chốt ca · 7 ngày</h2>
        <p className="mb-3 text-xs text-slate-500">
          Lấy từ Chốt ca (TM + CK thực tế so với DT hệ thống). Chưa chốt = chưa
          có số.
        </p>
        {loadingReports ? (
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
        ) : (
          <>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: "#64748b" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#64748b" }}
                    tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(value)}
                    labelFormatter={(label, payload) =>
                      payload?.[0]?.payload?.fullDate || label
                    }
                  />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                  <Line
                    type="monotone"
                    dataKey="discrepancy"
                    name="Chênh lệch"
                    stroke="#1e40af"
                    strokeWidth={3}
                    dot={{ r: 4, fill: "#1e40af" }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  Bảng chênh lệch quỹ 7 ngày gần nhất
                </caption>
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Ngày</th>
                    <th className="px-3 py-2 font-semibold">TM</th>
                    <th className="px-3 py-2 font-semibold">CK</th>
                    <th className="px-3 py-2 font-semibold">Chênh</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row) => (
                    <tr key={row.fullDate} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">
                        {row.fullDate}
                      </td>
                      <td className="px-3 py-2">
                        {row.hasReport ? (
                          <Money amount={row.cash} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.hasReport ? (
                          <Money amount={row.banking} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.hasReport ? (
                          <DiscrepancyBadge value={row.discrepancy} />
                        ) : (
                          <span className="text-slate-400">Chưa chốt</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      <section className="space-y-3">
        <h2 className="section-title">Lịch sử chốt ca</h2>
        {loadingReports ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : sortedReports.length === 0 ? (
          <div className="card-panel space-y-2 text-sm text-slate-500">
            <p>Chưa có báo cáo chốt ca.</p>
            {canCloseShift ? (
              <Link
                href="/manager/inventory"
                className="font-bold text-brand-800 underline"
              >
                Mở Chốt ca để nhập TM + CK thực tế →
              </Link>
            ) : null}
          </div>
        ) : (
          sortedReports.map((report) => (
            <article key={report.id} className="card-panel space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-bold">{report.date}</p>
                  <p className="text-xs text-slate-500">
                    {report.status || "đã chốt"}
                    {report.checkedByName || report.checkedByUsername ? (
                      <>
                        {" · "}
                        Chốt bởi:{" "}
                        <strong>
                          {formatActorLabel({
                            createdByName: report.checkedByName,
                            createdByUsername: report.checkedByUsername,
                          })}
                        </strong>
                      </>
                    ) : null}
                  </p>
                </div>
                <DiscrepancyBadge value={report.discrepancy} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                <p>
                  Đầu ca: <Money amount={report.startCash} />
                </p>
                <p>
                  Tiền mặt cuối: <Money amount={report.endCashActual} />
                </p>
                <p>
                  CK thực tế: <Money amount={report.bankingActual} />
                </p>
                <p>
                  DT hệ thống: <Money amount={report.systemRevenue} />
                </p>
              </div>
            </article>
          ))
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
