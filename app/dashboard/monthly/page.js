'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import { format } from "date-fns";
import {
  CalendarDays,
  Loader2,
  Percent,
  Settings2,
  Wallet,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import { subscribeInvestments } from "@/lib/investments";
import {
  calculateMonthlyReport,
  filterTransactionsByMonth,
} from "@/lib/monthly";
import {
  DEFAULT_RELATION_FUND_PERCENT,
  subscribeGlobalSettings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

function monthInputValue(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function parseMonthInput(value) {
  const [y, m] = String(value || "").split("-").map(Number);
  if (!y || !m) {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }
  return { year: y, monthIndex: m - 1 };
}

function MonthlyContent() {
  const { canManageShop, canViewInvestmentCapital } = useAuth();
  const { showToast } = useToast();
  const now = new Date();
  const [monthValue, setMonthValue] = useState(
    monthInputValue(now.getFullYear(), now.getMonth())
  );
  const [transactions, setTransactions] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [relationFundPercent, setRelationFundPercent] = useState(
    DEFAULT_RELATION_FUND_PERCENT
  );
  const [loadingTx, setLoadingTx] = useState(true);
  const [loadingInv, setLoadingInv] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(true);

  const { year, monthIndex } = useMemo(
    () => parseMonthInput(monthValue),
    [monthValue]
  );

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "transactions"),
      (snap) => {
        setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingTx(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được giao dịch", "error");
        setLoadingTx(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = subscribeInvestments(
      (list) => {
        setInvestments(list);
        setLoadingInv(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được vốn góp", "error");
        setLoadingInv(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = subscribeGlobalSettings(
      (settings) => {
        setRelationFundPercent(settings.relationFundPercent);
        setLoadingSettings(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được cấu hình quỹ", "error");
        setLoadingSettings(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const monthTx = useMemo(
    () => filterTransactionsByMonth(transactions, year, monthIndex),
    [transactions, year, monthIndex]
  );

  const report = useMemo(
    () =>
      calculateMonthlyReport({
        transactions: monthTx,
        investments,
        relationFundPercent,
      }),
    [monthTx, investments, relationFundPercent]
  );

  const loading = loadingTx || loadingInv || loadingSettings;
  const monthLabel = format(new Date(year, monthIndex, 1), "MM/yyyy");

  return (
    <AppShell title="Tổng kết tháng" subtitle={`Báo cáo ${monthLabel}`}>
      <section className="card-panel mb-4 space-y-3">
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CalendarDays className="h-4 w-4 text-brand-700" aria-hidden />
            Chọn tháng / năm
          </span>
          <input
            type="month"
            className="field-input"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
          />
        </label>

        {canManageShop ? (
          <Link
            href="/dashboard/settings"
            className="touch-btn h-12 w-full gap-2 border border-slate-200 bg-slate-50 text-slate-800"
          >
            <Settings2 className="h-5 w-5" aria-hidden />
            Cấu hình % quỹ đối ngoại
          </Link>
        ) : null}
      </section>

      {loading ? (
        <div className="card-panel flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Đang tính báo cáo...
        </div>
      ) : (
        <>
          {/* Khối 1 */}
          <section className="card-panel mb-4 space-y-3">
            <h2 className="section-title">Kết quả kinh doanh</h2>

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
              <span className="text-sm font-medium text-emerald-800">
                Doanh thu tổng
              </span>
              <span className="money text-lg font-extrabold text-emerald-700">
                <Money amount={report.totalRevenue} />
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3">
              <span className="text-sm font-medium text-rose-800">
                Tổng chi phí
                <span className="mt-0.5 block text-[11px] font-normal text-rose-600/80">
                  Gồm chi phí đối ngoại tiền mặt
                </span>
              </span>
              <span className="money text-lg font-extrabold text-rose-700">
                <Money amount={report.totalExpenses} />
              </span>
            </div>

            <div
              className={cn(
                "rounded-[1.25rem] px-4 py-5 text-white shadow-md",
                report.isLoss
                  ? "bg-gradient-to-br from-rose-600 to-rose-700"
                  : "bg-gradient-to-br from-brand-700 to-brand-800"
              )}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/75">
                Lợi nhuận gộp
              </p>
              <p className="money mt-2 text-3xl font-extrabold leading-none">
                <Money amount={report.grossProfit} />
              </p>
              {report.isLoss ? (
                <p className="mt-3 text-sm font-semibold text-white/90">
                  Tháng này lỗ, không chia
                </p>
              ) : null}
            </div>
          </section>

          {/* Khối 2 */}
          <section className="card-panel mb-4 space-y-3">
            <div className="flex items-center gap-2">
              <Percent className="h-5 w-5 text-brand-700" aria-hidden />
              <h2 className="section-title">Quỹ đối ngoại & dự phòng</h2>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-2xl bg-slate-50 px-3 py-3">
                <p className="text-xs text-slate-500">Tỷ lệ trích lập</p>
                <p className="money mt-1 text-xl font-extrabold text-slate-900">
                  {report.relationFundPercent}%
                </p>
              </div>
              <div className="rounded-2xl bg-amber-50 px-3 py-3">
                <p className="text-xs text-amber-700/80">Trích vào quỹ</p>
                <p className="money mt-1 text-lg font-extrabold text-amber-800">
                  <Money amount={report.relationsFund} />
                </p>
              </div>
            </div>

            <div className="rounded-[1.25rem] bg-gradient-to-br from-emerald-600 to-emerald-700 px-4 py-5 text-white shadow-md">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">
                Lợi nhuận ròng phân bổ
              </p>
              <p className="money mt-2 text-4xl font-extrabold leading-none">
                <Money amount={report.netProfit} />
              </p>
              <p className="mt-2 text-xs text-white/80">
                Số tiền thật để chia cổ tức
              </p>
            </div>
          </section>

          {/* Khối 3 — chỉ Chủ ĐT / SA (có tiền đầu tư) */}
          {canViewInvestmentCapital ? (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-brand-700" aria-hidden />
                <h2 className="section-title">Bảng chia cổ tức</h2>
              </div>

              {report.isLoss ? (
                <div className="card-panel border-rose-100 bg-rose-50 text-center text-sm font-semibold text-rose-700">
                  Tháng này lỗ, không chia
                </div>
              ) : null}

              {report.investorShares.length === 0 ? (
                <div className="card-panel text-sm text-slate-500">
                  Chưa có dữ liệu tiền đầu tư. Vào mục Vốn để khai báo trước.
                </div>
              ) : (
                report.investorShares.map((row) => (
                  <article key={row.name} className="card-panel space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-900">
                          {row.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          Tỷ lệ sở hữu:{" "}
                          <strong>{row.ownershipPercent.toFixed(1)}%</strong>
                          {" · "}
                          Vốn: <Money amount={row.capital} />
                        </p>
                      </div>
                      <p
                        className={cn(
                          "money shrink-0 text-lg font-extrabold",
                          report.isLoss ? "text-rose-600" : "text-emerald-700"
                        )}
                      >
                        <Money amount={row.dividend} />
                      </p>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Thực nhận = LN ròng ×{" "}
                      {(row.ownershipRatio * 100).toFixed(1)}%
                    </p>
                  </article>
                ))
              )}
            </section>
          ) : (
            <section className="card-panel text-sm text-slate-600">
              Bạn xem được kết quả kinh doanh và dòng tiền quán. Tiền đầu tư /
              bảng chia cổ tức chỉ Chủ đầu tư và Super Admin xem được.
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}

export default function MonthlyPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor"]}>
      <MonthlyContent />
    </ProtectedRoute>
  );
}
