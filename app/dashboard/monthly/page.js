'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Banknote,
  CalendarDays,
  Loader2,
  Settings2,
  Trash2,
  Wallet,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import DateRangeFilter from "@/components/DateRangeFilter";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import {
  BottomSheet,
  ChipRow,
  EmptyState,
  FieldLabel,
  FilterChip,
  SectionHeader,
} from "@/components/ui/MobileUI";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import {
  filterRowsByDateRange,
  formatRangeLabel,
  monthInputBounds,
} from "@/lib/dateRange";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { subscribeCollection } from "@/lib/liveCollection";
import {
  filterShareholderCapitalEntries,
  subscribeShareholderCapital,
  summarizeShareholderCapital,
} from "@/lib/shareholderCapital";
import {
  calculateMonthlyReport,
} from "@/lib/monthly";
import { summarizeShopPnl } from "@/lib/pnl";
import { productsByIdMap, subscribeProducts } from "@/lib/products";
import {
  RECEIPT_METHODS,
  addShareholderReceipt,
  deleteShareholderReceipt,
  monthKeyFromParts,
  subscribeReceiptsByMonth,
  sumGoodsIncomeByMethod,
  summarizeReceipts,
} from "@/lib/receipts";
import { isShopOperatingExpense } from "@/lib/expenses";
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
  const initialBounds = monthInputBounds(now.getFullYear(), now.getMonth());
  const [dateFrom, setDateFrom] = useState(initialBounds.from);
  const [dateTo, setDateTo] = useState(initialBounds.to);
  const [allTx, setAllTx] = useState([]);
  const [products, setProducts] = useState([]);
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
  const [receiptSheetOpen, setReceiptSheetOpen] = useState(false);

  const { year, monthIndex } = useMemo(
    () => parseMonthInput(monthValue),
    [monthValue]
  );
  const monthKey = monthKeyFromParts(year, monthIndex);

  useEffect(() => {
    const bounds = monthInputBounds(year, monthIndex);
    setDateFrom(bounds.from);
    setDateTo(bounds.to);
  }, [year, monthIndex]);

  useEffect(() => {
    setLoadingTx(true);
    const unsub = subscribeCollection(
      "transactions",
      (list) => {
        setAllTx(list);
        setLoadingTx(false);
      },
      (error) => {
        console.error(error);
        showToast(firestoreErrorMessage(error, "Không tải được giao dịch"), "error");
        setLoadingTx(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = subscribeProducts(
      (list) => setProducts(list),
      () => setProducts([])
    );
    return () => unsub();
  }, []);

  const monthTx = useMemo(
    () => filterRowsByDateRange(allTx, dateFrom, dateTo),
    [allTx, dateFrom, dateTo]
  );

  const productsById = useMemo(() => productsByIdMap(products), [products]);

  const shopPnl = useMemo(
    () => summarizeShopPnl(monthTx, productsById),
    [monthTx, productsById]
  );

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
    const unsubUsers = subscribeCollection(
      "users",
      (rows) => setUsers(rows),
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

  const goodsIncome = useMemo(
    () => sumGoodsIncomeByMethod(monthTx),
    [monthTx]
  );

  const periodExpense = useMemo(
    () =>
      monthTx
        .filter(isShopOperatingExpense)
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
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
      setReceiptSheetOpen(false);
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
      <div className="space-y-4">
      <section className="card-panel space-y-4">
        <label className="block">
          <FieldLabel>
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-brand-700" aria-hidden />
              Chọn tháng / năm
            </span>
          </FieldLabel>
          <input
            type="month"
            className="field-input"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
          />
        </label>

        <DateRangeFilter
          dense
          dateFrom={dateFrom}
          dateTo={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
          onClear={() => {
            const bounds = monthInputBounds(year, monthIndex);
            setDateFrom(bounds.from);
            setDateTo(bounds.to);
          }}
          summary={
            <p className="text-sm text-slate-600">
              Kỳ ·{" "}
              <span className="font-semibold">
                {formatRangeLabel(dateFrom, dateTo)}
              </span>
            </p>
          }
        />

        {canViewDividends && canManageSystem ? (
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
          Đang tải...
        </div>
      ) : !canViewDividends ? (
        <section className="space-y-4">
          <StatCard
            label={`Tổng thu hàng hóa · ${formatRangeLabel(dateFrom, dateTo)}`}
            value={goodsIncome.total}
            tone="success"
          />

            <div className="grid grid-cols-2 gap-2">
            <div className="card-panel !p-3">
              <p className="text-xs font-semibold text-slate-500">Tiền mặt</p>
              <p className="money mt-1 text-lg font-bold text-slate-900">
                <Money amount={goodsIncome.cash} />
              </p>
            </div>
            <div className="card-panel !p-3">
              <p className="text-xs font-semibold text-slate-500">Chuyển khoản</p>
              <p className="money mt-1 text-lg font-bold text-brand-800">
                <Money amount={goodsIncome.banking} />
              </p>
            </div>
            <div className="card-panel !p-3">
              <p className="text-xs font-semibold text-slate-500">Chi quỹ</p>
              <p className="money mt-1 text-lg font-bold text-rose-700">
                <Money amount={periodExpense} />
              </p>
            </div>
            <div className="card-panel !p-3">
              <p className="text-xs font-semibold text-slate-500">Thu − chi</p>
              <p className="money mt-1 text-lg font-bold text-emerald-700">
                <Money amount={goodsIncome.total - periodExpense} />
              </p>
            </div>
          </div>

          <p className="text-sm leading-snug text-slate-500">
            Cổ tức / chia lãi / vốn góp chỉ Cổ đông & Super Admin xem.
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-4">
            <SectionHeader
              title="Kết quả kinh doanh"
              hint={`Kỳ · ${formatRangeLabel(dateFrom, dateTo)}`}
            />

            <StatCard
              label="Lợi nhuận gộp"
              value={report.grossProfit}
              tone={report.isLoss ? "danger" : "brand"}
            />
            {report.isLoss ? (
              <p className="alert-soft font-semibold">
                Tháng này lỗ, không chia
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="card-panel !p-3">
                <p className="text-xs text-slate-500">Thu TM</p>
                <p className="money font-bold text-emerald-700">
                  <Money amount={goodsIncome.cash} />
                </p>
              </div>
              <div className="card-panel !p-3">
                <p className="text-xs text-slate-500">Thu CK</p>
                <p className="money font-bold text-brand-800">
                  <Money amount={goodsIncome.banking} />
                </p>
              </div>
            </div>

            <div className="card-panel flex items-center justify-between gap-3 !py-3">
              <span className="text-sm font-medium text-slate-700">
                Doanh thu bán hàng
              </span>
              <span className="money text-lg font-bold text-emerald-700">
                <Money amount={report.totalRevenue} />
              </span>
            </div>

            <div className="card-panel flex items-center justify-between gap-3 !py-3">
              <span className="text-sm font-medium text-slate-700">
                Chi quỹ cửa hàng
              </span>
              <span className="money text-lg font-bold text-rose-700">
                <Money amount={report.totalExpenses} />
              </span>
            </div>

            <div className="card-panel space-y-3">
              <h3 className="section-title mb-0">
                Tham khảo · Lãi kinh doanh
              </h3>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="card-panel !p-3">
                  <p className="text-xs text-slate-500">Giá vốn</p>
                  <p className="money mt-1 text-lg font-bold text-rose-700">
                    <Money amount={shopPnl.cogs} />
                  </p>
                </div>
                <div className="card-panel !p-3">
                  <p className="text-xs text-slate-500">Lãi gộp</p>
                  <p className="money mt-1 text-lg font-bold text-emerald-700">
                    <Money amount={shopPnl.grossMargin} />
                  </p>
                </div>
                <div className="card-panel !p-3">
                  <p className="text-xs text-slate-500">Lãi KD</p>
                  <p className="money mt-1 text-lg font-bold text-brand-800">
                    <Money amount={shopPnl.operatingProfit} />
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-500">
                Cổ tức dưới đây vẫn theo Thu − chi (Lens 1).
              </p>
            </div>
          </section>

          <section className="card-panel space-y-4">
            <SectionHeader title="Quỹ đối ngoại & dự phòng" />

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="card-panel !p-3">
                <p className="text-xs text-slate-500">Tỷ lệ trích lập</p>
                <p className="money mt-1 text-xl font-bold text-slate-900">
                  {report.relationFundPercent}%
                </p>
              </div>
              <div className="card-panel !p-3">
                <p className="text-xs text-slate-500">Trích vào quỹ</p>
                <p className="money mt-1 text-lg font-bold text-slate-900">
                  <Money amount={report.relationsFund} />
                </p>
              </div>
            </div>

            <StatCard
              label="Lợi nhuận ròng phân bổ"
              value={report.netProfit}
              tone={report.isLoss ? "danger" : "success"}
            />
            <p className="hint-line -mt-2">
              Số tiền thật để chia cổ tức
            </p>
          </section>

          <section className="space-y-4">
            <SectionHeader title="Bảng chia cổ tức" />

            {report.isLoss ? (
              <div className="alert-soft text-center font-semibold">
                Tháng này lỗ, không chia
              </div>
            ) : null}

            {report.investorShares.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Chưa có dữ liệu vốn"
                description="Vào mục Vốn để khai báo trước khi chia."
              />
            ) : (
              report.investorShares.map((row) => (
                <article key={row.name} className="card-panel space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">
                        {row.name}
                      </p>
                      <p className="text-sm text-slate-500">
                        Sở hữu{" "}
                        <strong>{row.ownershipPercent.toFixed(1)}%</strong>
                        {" · "}
                        Vốn: <Money amount={row.capital} />
                      </p>
                    </div>
                    <p
                      className={cn(
                        "money shrink-0 text-lg font-bold",
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

          {canManageShareholderReceipts ? (
            <section className="space-y-4">
              <SectionHeader
                title="Tiền cổ đông đã nhận"
                hint="Cập nhật số đã nhận TM / CK theo tháng."
                action={
                  <button
                    type="button"
                    onClick={() => setReceiptSheetOpen(true)}
                    className="touch-btn h-11 gap-1 bg-brand-700 px-3 text-sm font-bold text-white"
                  >
                    <Banknote className="h-4 w-4" />
                    Ghi nhận
                  </button>
                }
              />

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="card-panel !p-3">
                  <p className="text-xs text-slate-500">Tổng nhận</p>
                  <p className="money font-bold">
                    <Money amount={receiptSummary.total} />
                  </p>
                </div>
                <div className="card-panel !p-3">
                  <p className="text-xs text-emerald-700/80">Tiền mặt</p>
                  <p className="money font-bold text-emerald-800">
                    <Money amount={receiptSummary.cash} />
                  </p>
                </div>
                <div className="card-panel !p-3">
                  <p className="text-xs text-brand-700/80">Tài khoản</p>
                  <p className="money font-bold text-brand-800">
                    <Money amount={receiptSummary.banking} />
                  </p>
                </div>
              </div>

              {loadingReceipts ? (
                <div className="card-panel flex h-20 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-700" />
                </div>
              ) : receipts.length === 0 ? (
                <EmptyState
                  icon={Banknote}
                  title="Chưa có dòng nhận"
                  description="Ghi số tiền cổ đông đã nhận trong tháng này."
                  action={
                    <button
                      type="button"
                      onClick={() => setReceiptSheetOpen(true)}
                      className="touch-btn h-11 w-full bg-brand-700 text-sm font-bold text-white"
                    >
                      Ghi tiền nhận
                    </button>
                  }
                />
              ) : (
                receipts.map((row) => {
                  const ms = row.timestamp?.toMillis?.() || 0;
                  return (
                    <div
                      key={row.id}
                      className="card-panel flex items-center justify-between gap-2 !py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-900">
                          {row.investorName}
                        </p>
                        <p className="text-sm text-slate-500">
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
                        <p className="money font-bold text-emerald-700">
                          {formatCurrency(row.amount)}
                        </p>
                        <button
                          type="button"
                          aria-label="Xóa"
                          onClick={() => handleDeleteReceipt(row.id)}
                          className="touch-btn h-11 w-11 rounded-2xl bg-rose-50 p-0 text-rose-700"
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
      </div>

      {canManageShareholderReceipts ? (
        <BottomSheet
          open={receiptSheetOpen}
          onClose={() => setReceiptSheetOpen(false)}
          title="Ghi tiền cổ đông nhận"
          subtitle={`Tháng ${monthLabel}`}
          labelledBy="monthly-receipt-sheet"
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReceiptSheetOpen(false)}
                className="touch-btn h-12 flex-1 border border-slate-200 bg-white text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                form="monthly-receipt-form"
                disabled={savingReceipt}
                className="touch-btn h-12 flex-[1.4] bg-brand-700 text-white disabled:opacity-50"
              >
                {savingReceipt ? "Đang lưu..." : "Cập nhật"}
              </button>
            </div>
          }
        >
          <form
            id="monthly-receipt-form"
            onSubmit={handleAddReceipt}
            className="space-y-4"
          >
            <label className="block">
              <FieldLabel>Cổ đông</FieldLabel>
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
              <FieldLabel>Số tiền nhận</FieldLabel>
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

            <div>
              <FieldLabel>Hình thức</FieldLabel>
              <ChipRow>
                {RECEIPT_METHODS.map((m) => (
                  <FilterChip
                    key={m.value}
                    active={receiptMethod === m.value}
                    onClick={() => setReceiptMethod(m.value)}
                  >
                    {m.label}
                  </FilterChip>
                ))}
              </ChipRow>
            </div>

            <label className="block">
              <FieldLabel optional>Ghi chú</FieldLabel>
              <input
                className="field-input"
                value={receiptNote}
                onChange={(e) => setReceiptNote(e.target.value)}
                placeholder="vd: CK về STK ACB"
              />
            </label>
          </form>
        </BottomSheet>
      ) : null}
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
