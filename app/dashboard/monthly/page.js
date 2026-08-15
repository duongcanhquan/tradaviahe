'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Timestamp,
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { format } from "date-fns";
import {
  Banknote,
  CalendarDays,
  Loader2,
  Percent,
  Settings2,
  Trash2,
  Wallet,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import {
  filterShareholderCapitalEntries,
  subscribeShareholderCapital,
  summarizeShareholderCapital,
} from "@/lib/shareholderCapital";
import {
  calculateMonthlyReport,
} from "@/lib/monthly";
import {
  RECEIPT_METHODS,
  addShareholderReceipt,
  deleteShareholderReceipt,
  monthKeyFromParts,
  subscribeReceiptsByMonth,
  sumGoodsIncomeByMethod,
  summarizeReceipts,
} from "@/lib/receipts";
import {
  DEFAULT_RELATION_FUND_PERCENT,
  subscribeGlobalSettings,
} from "@/lib/settings";
import { cn, formatCurrency } from "@/lib/utils";

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
  const {
    user,
    profile,
    canViewDividends,
    canManageShareholderReceipts,
    canManageSystem,
  } = useAuth();
  const { showToast } = useToast();
  const now = new Date();
  const [monthValue, setMonthValue] = useState(
    monthInputValue(now.getFullYear(), now.getMonth())
  );
  const [transactions, setTransactions] = useState([]);
  const [capitalEntries, setCapitalEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [relationFundPercent, setRelationFundPercent] = useState(
    DEFAULT_RELATION_FUND_PERCENT
  );
  const [loadingTx, setLoadingTx] = useState(true);
  const [loadingInv, setLoadingInv] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [savingReceipt, setSavingReceipt] = useState(false);

  const [receiptName, setReceiptName] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptMethod, setReceiptMethod] = useState("banking");
  const [receiptNote, setReceiptNote] = useState("");

  const { year, monthIndex } = useMemo(
    () => parseMonthInput(monthValue),
    [monthValue]
  );
  const monthKey = monthKeyFromParts(year, monthIndex);

  useEffect(() => {
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);
    setLoadingTx(true);
    const monthQuery = query(
      collection(db, "transactions"),
      where("timestamp", ">=", Timestamp.fromDate(start)),
      where("timestamp", "<", Timestamp.fromDate(end))
    );
    const unsub = onSnapshot(
      monthQuery,
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
  }, [monthIndex, showToast, year]);

  useEffect(() => {
    if (!canViewDividends) {
      setLoadingInv(false);
      setLoadingSettings(false);
      return undefined;
    }
    const unsubInv = subscribeShareholderCapital(
      (list) => {
        setCapitalEntries(list);
        setLoadingInv(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được vốn góp", "error");
        setLoadingInv(false);
      }
    );
    const unsubUsers = onSnapshot(
      collection(db, "users"),
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      () => setUsers([])
    );
    const unsubSettings = subscribeGlobalSettings(
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
    return () => {
      unsubInv();
      unsubUsers();
      unsubSettings();
    };
  }, [canViewDividends, showToast]);

  useEffect(() => {
    if (!canManageShareholderReceipts) {
      setLoadingReceipts(false);
      return undefined;
    }
    setLoadingReceipts(true);
    const unsub = subscribeReceiptsByMonth(
      monthKey,
      (rows) => {
        setReceipts(rows);
        setLoadingReceipts(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được tiền đã nhận", "error");
        setLoadingReceipts(false);
      }
    );
    return () => unsub();
  }, [canManageShareholderReceipts, monthKey, showToast]);

  const monthTx = transactions;

  const goodsIncome = useMemo(
    () => sumGoodsIncomeByMethod(monthTx),
    [monthTx]
  );

  const shareholderCapitalEntries = useMemo(
    () => filterShareholderCapitalEntries(capitalEntries, users),
    [capitalEntries, users]
  );

  const report = useMemo(
    () =>
      canViewDividends
        ? calculateMonthlyReport({
            transactions: monthTx,
            capitalEntries: shareholderCapitalEntries,
            relationFundPercent,
          })
        : null,
    [canViewDividends, monthTx, shareholderCapitalEntries, relationFundPercent]
  );

  const investorNames = useMemo(() => {
    const { shares } = summarizeShareholderCapital(shareholderCapitalEntries);
    return shares.map((s) => s.name).filter(Boolean);
  }, [shareholderCapitalEntries]);

  useEffect(() => {
    if (!receiptName && investorNames[0]) {
      setReceiptName(investorNames[0]);
    }
  }, [investorNames, receiptName]);

  const receiptSummary = useMemo(
    () => summarizeReceipts(receipts),
    [receipts]
  );

  const loading = canViewDividends
    ? loadingTx || loadingInv || loadingSettings
    : loadingTx;

  const monthLabel = format(new Date(year, monthIndex, 1), "MM/yyyy");

  const handleAddReceipt = async (e) => {
    e.preventDefault();
    setSavingReceipt(true);
    try {
      await addShareholderReceipt({
        monthKey,
        investorName: receiptName,
        amount: receiptAmount,
        method: receiptMethod,
        note: receiptNote,
        user,
        profile,
      });
      setReceiptAmount("");
      setReceiptNote("");
      showToast("Đã ghi tiền nhận", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Ghi thất bại", "error");
    } finally {
      setSavingReceipt(false);
    }
  };

  const handleDeleteReceipt = async (id) => {
    if (!window.confirm("Xóa dòng tiền nhận này?")) return;
    try {
      await deleteShareholderReceipt(id);
      showToast("Đã xóa", "info");
    } catch (error) {
      console.error(error);
      showToast("Xóa thất bại", "error");
    }
  };

  return (
    <AppShell
      title={canViewDividends ? "Tổng kết tháng" : "Thu hàng hóa"}
      subtitle={
        canViewDividends
          ? `Cổ đông · ${monthLabel}`
          : `Quản lý · chỉ tổng thu món · ${monthLabel}`
      }
    >
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

        {canViewDividends && canManageSystem ? (
          <Link
            href="/dashboard/settings"
            className="touch-btn h-12 w-full gap-2 border border-slate-200 bg-slate-50 text-slate-800"
          >
            <Settings2 className="h-5 w-5" aria-hidden />
            Cấu hình % quỹ đối ngoại (trước chia lãi)
          </Link>
        ) : null}
      </section>

      {loading ? (
        <div className="card-panel flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Đang tải...
        </div>
      ) : !canViewDividends ? (
        /* —— Quản lý: chỉ thu hàng hóa —— */
        <section className="space-y-3">
          <div className="rounded-[1.25rem] bg-gradient-to-br from-emerald-600 to-emerald-700 px-4 py-6 text-white shadow-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">
              Tổng thu hàng hóa tháng này
            </p>
            <p className="money mt-2 text-4xl font-extrabold leading-none">
              <Money amount={goodsIncome.total} />
            </p>
            <p className="mt-3 text-sm text-white/85">
              Chỉ doanh thu bán món — không gồm cổ tức / chia lãi
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white px-4 py-4 ring-1 ring-slate-200">
              <p className="text-xs font-semibold text-slate-500">Tiền mặt</p>
              <p className="money mt-1 text-xl font-extrabold text-slate-900">
                <Money amount={goodsIncome.cash} />
              </p>
            </div>
            <div className="rounded-2xl bg-white px-4 py-4 ring-1 ring-slate-200">
              <p className="text-xs font-semibold text-slate-500">Chuyển khoản</p>
              <p className="money mt-1 text-xl font-extrabold text-brand-800">
                <Money amount={goodsIncome.banking} />
              </p>
            </div>
          </div>

          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-100">
            Cổ tức, chia lãi và vốn góp chỉ Cổ đông / Super Admin xem và cập nhật.
          </p>
        </section>
      ) : (
        /* —— Cổ đông / SA —— */
        <>
          <section className="card-panel mb-4 space-y-3">
            <h2 className="section-title">Kết quả kinh doanh</h2>

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
              <span className="text-sm font-medium text-emerald-800">
                Doanh thu bán hàng
              </span>
              <span className="money text-lg font-extrabold text-emerald-700">
                <Money amount={report.totalRevenue} />
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3">
              <span className="text-sm font-medium text-rose-800">
                Chi quỹ cửa hàng
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

          <section className="mb-6 space-y-3">
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
                </article>
              ))
            )}
          </section>

          {/* Tiền cổ đông đã nhận — TM hoặc CK vào tài khoản */}
          {canManageShareholderReceipts ? (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-emerald-700" aria-hidden />
                <h2 className="section-title">Tiền cổ đông đã nhận</h2>
              </div>
              <p className="text-sm text-slate-500">
                Khách trả tiền mặt hoặc chuyển khoản — cổ đông cập nhật số đã
                nhận vào tay / tài khoản theo tháng.
              </p>

              <form
                onSubmit={handleAddReceipt}
                className="card-panel space-y-3"
              >
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">
                    Cổ đông
                  </span>
                  {investorNames.length ? (
                    <select
                      className="field-input"
                      value={receiptName}
                      onChange={(e) => setReceiptName(e.target.value)}
                      required
                    >
                      {investorNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="field-input"
                      value={receiptName}
                      onChange={(e) => setReceiptName(e.target.value)}
                      placeholder="Tên cổ đông"
                      required
                    />
                  )}
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">
                    Số tiền nhận
                  </span>
                  <input
                    type="number"
                    min="1"
                    required
                    className="field-input"
                    value={receiptAmount}
                    onChange={(e) => setReceiptAmount(e.target.value)}
                    placeholder="vd: 500000"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  {RECEIPT_METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setReceiptMethod(m.value)}
                      className={cn(
                        "touch-btn h-12 text-sm",
                        receiptMethod === m.value
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-700"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">
                    Ghi chú
                  </span>
                  <input
                    className="field-input"
                    value={receiptNote}
                    onChange={(e) => setReceiptNote(e.target.value)}
                    placeholder="vd: CK về STK ACB"
                  />
                </label>

                <button
                  type="submit"
                  disabled={savingReceipt}
                  className="touch-btn h-14 w-full bg-brand-700 text-white disabled:opacity-50"
                >
                  {savingReceipt ? "Đang lưu..." : "Cập nhật tiền nhận"}
                </button>
              </form>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-2xl bg-slate-50 px-3 py-3">
                  <p className="text-[11px] text-slate-500">Tổng nhận</p>
                  <p className="money font-extrabold">
                    <Money amount={receiptSummary.total} />
                  </p>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-3 py-3">
                  <p className="text-[11px] text-emerald-700/80">Tiền mặt</p>
                  <p className="money font-extrabold text-emerald-800">
                    <Money amount={receiptSummary.cash} />
                  </p>
                </div>
                <div className="rounded-2xl bg-brand-50 px-3 py-3">
                  <p className="text-[11px] text-brand-700/80">Tài khoản</p>
                  <p className="money font-extrabold text-brand-800">
                    <Money amount={receiptSummary.banking} />
                  </p>
                </div>
              </div>

              {loadingReceipts ? (
                <p className="text-center text-sm text-slate-400">Đang tải...</p>
              ) : receipts.length === 0 ? (
                <p className="text-center text-sm text-slate-500">
                  Chưa có dòng nhận tháng này
                </p>
              ) : (
                receipts.map((row) => {
                  const ms = row.timestamp?.toMillis?.() || 0;
                  return (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-900">
                          {row.investorName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {row.method === "banking"
                            ? "Chuyển khoản / TK"
                            : "Tiền mặt"}
                          {row.note ? ` · ${row.note}` : ""}
                          {ms
                            ? ` · ${new Date(ms).toLocaleString("vi-VN", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <p className="money font-extrabold text-emerald-700">
                          {formatCurrency(row.amount)}
                        </p>
                        <button
                          type="button"
                          aria-label="Xóa"
                          onClick={() => handleDeleteReceipt(row.id)}
                          className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          ) : null}
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
