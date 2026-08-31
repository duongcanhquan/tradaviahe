'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import {
  ArrowLeftRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import DateRangeFilter from "@/components/DateRangeFilter";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { formatActorLabel } from "@/lib/audit";
import {
  CONSTRUCTION_EXPENSE_CATEGORIES,
  CONSTRUCTION_JOB_CATEGORIES,
  JOB_STATUS,
  JOB_STATUS_LABEL,
  constructionExpenseLabel,
  constructionJobCategoryLabel,
  createConstructionJob,
  deleteConstructionJob,
  deleteConstructionTransferGroup,
  deleteConstructionTx,
  isConstructionFundEntry,
  isConstructionFundIn,
  isConstructionServiceIncome,
  recordConstructionExpense,
  recordConstructionFundIn,
  recordConstructionServiceIncome,
  subscribeConstructionJobs,
  summarizeConstructionFund,
  summarizeConstructionJobs,
  sumConstructionIncomeByMethod,
  transferCapitalToConstructionFund,
  transferConstructionToShopFund,
  transferShopFundToConstruction,
  updateConstructionJob,
} from "@/lib/construction";
import {
  filterRowsByDateRange,
  formatRangeLabel,
  hasDateRange,
  rowBusinessMs,
} from "@/lib/dateRange";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { subscribeCollection } from "@/lib/liveCollection";
import { cn, formatCurrency, todayInputValue } from "@/lib/utils";

const PAGE_SIZE = 10;
const TABS = [
  { id: "overview", label: "Tổng quan" },
  { id: "fund", label: "Quỹ XD" },
  { id: "jobs", label: "Hạng mục" },
];

function formatTxTime(t) {
  const ms = t?.timestamp?.toMillis?.() ?? 0;
  if (!ms) return t?.businessDate || "—";
  try {
    return format(new Date(ms), "HH:mm · dd/MM/yyyy", { locale: vi });
  } catch {
    return t?.businessDate || "—";
  }
}

function ConstructionContent() {
  const { user, profile, role, canManageShop, canManageShareholderCapital } =
    useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState("overview");
  const [allTx, setAllTx] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(true);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [fundFilter, setFundFilter] = useState("all");

  const [mode, setMode] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [dateInput, setDateInput] = useState(todayInputValue());
  const [payMethod, setPayMethod] = useState("cash");
  const [expenseCat, setExpenseCat] = useState(
    CONSTRUCTION_EXPENSE_CATEGORIES[0].value
  );
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [jobOpen, setJobOpen] = useState(false);
  const [editingJobId, setEditingJobId] = useState(null);
  const [jobForm, setJobForm] = useState({
    title: "",
    category: "xay_dung",
    clientName: "",
    contractAmount: "",
    expectedProfit: "",
    actualProfit: "",
    durationDays: "",
    startDate: todayInputValue(),
    endDate: "",
    status: JOB_STATUS.planned,
    note: "",
  });
  const [savingJob, setSavingJob] = useState(false);

  useEffect(() => {
    const unsub = subscribeCollection(
      "transactions",
      (list) => {
        setAllTx(list);
        setLoadingTx(false);
      },
      (error) => {
        console.error(error);
        showToast(firestoreErrorMessage(error, "Không tải sổ XD"), "error");
        setLoadingTx(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = subscribeConstructionJobs(
      (list) => {
        setJobs(list.filter((j) => j.active !== false));
        setLoadingJobs(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải hạng mục xây dựng", "error");
        setLoadingJobs(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const constructionTx = useMemo(
    () =>
      allTx
        .filter(
          (t) =>
            isConstructionFundEntry(t) || isConstructionServiceIncome(t)
        )
        .sort((a, b) => rowBusinessMs(b) - rowBusinessMs(a)),
    [allTx]
  );

  const incomeAll = useMemo(
    () => sumConstructionIncomeByMethod(allTx),
    [allTx]
  );

  const fundSummary = useMemo(
    () =>
      summarizeConstructionFund(
        constructionTx.filter(isConstructionFundEntry),
        incomeAll.cash
      ),
    [constructionTx, incomeAll.cash]
  );

  const rangedTx = useMemo(
    () => filterRowsByDateRange(constructionTx, dateFrom, dateTo),
    [constructionTx, dateFrom, dateTo]
  );

  const periodIncome = useMemo(
    () => sumConstructionIncomeByMethod(rangedTx),
    [rangedTx]
  );

  const periodFund = useMemo(() => {
    const base = summarizeConstructionFund(
      rangedTx.filter(isConstructionFundEntry),
      periodIncome.cash
    );
    return { ...base, banking: periodIncome.banking, net: base.balance };
  }, [rangedTx, periodIncome]);

  const ledgerRows = useMemo(() => {
    let list = rangedTx;
    if (fundFilter === "income") {
      list = list.filter(isConstructionServiceIncome);
    } else if (fundFilter === "fund_in") {
      list = list.filter(isConstructionFundIn);
    } else if (fundFilter === "expense") {
      list = list.filter((t) => t.type === "expense");
    }
    return list;
  }, [rangedTx, fundFilter]);

  const totalPages = Math.max(1, Math.ceil(ledgerRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return ledgerRows.slice(start, start + PAGE_SIZE);
  }, [ledgerRows, safePage]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, fundFilter]);

  const jobsSummary = useMemo(
    () => summarizeConstructionJobs(jobs),
    [jobs]
  );

  const resetFundForm = () => {
    setAmount("");
    setNote("");
    setDateInput(todayInputValue());
    setPayMethod("cash");
    setExpenseCat(CONSTRUCTION_EXPENSE_CATEGORIES[0].value);
  };

  const handleFundSave = async (e) => {
    e.preventDefault();
    if (!canManageShop) {
      showToast("Không có quyền", "error");
      return;
    }
    setSaving(true);
    try {
      if (mode === "income") {
        const r = await recordConstructionServiceIncome({
          amount,
          paymentMethod: payMethod,
          note,
          dateInput,
          user,
          profile,
        });
        showToast(
          r.toCapital
            ? "Đã thu CK — cộng số dư vốn CĐT"
            : "Đã thu TM — cộng quỹ xây dựng",
          "success"
        );
      } else if (mode === "expense") {
        await recordConstructionExpense({
          amount,
          category: expenseCat,
          note,
          dateInput,
          user,
          profile,
        });
        showToast("Đã ghi chi xây dựng", "success");
      } else if (mode === "fund_in") {
        await recordConstructionFundIn({
          amount,
          note,
          dateInput,
          user,
          profile,
        });
        showToast("Đã nạp quỹ xây dựng", "success");
      } else if (mode === "from_capital") {
        await transferCapitalToConstructionFund({
          amount,
          note,
          dateInput,
          user,
          profile,
        });
        showToast("Đã chuyển từ vốn → quỹ XD", "success");
      } else if (mode === "from_shop") {
        await transferShopFundToConstruction({
          amount,
          note,
          dateInput,
          user,
          profile,
        });
        showToast("Đã chuyển từ quỹ quán → quỹ XD", "success");
      } else if (mode === "to_shop") {
        await transferConstructionToShopFund({
          amount,
          note,
          dateInput,
          user,
          profile,
        });
        showToast("Đã chuyển quỹ XD → quỹ quán", "success");
      }
      setMode(null);
      resetFundForm();
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Lưu thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTx = async (row) => {
    if (!canManageShop || !row?.id) return;

    if (row.transferGroupId) {
      const siblings = allTx.filter(
        (t) => t.transferGroupId === row.transferGroupId
      );
      const ok = window.confirm(
        `Đây là lệnh chuyển quỹ (${siblings.length} bút toán + có thể kèm dòng vốn).\nXóa cả cặp để sổ không lệch?`
      );
      if (!ok) return;
      setDeletingId(row.id);
      try {
        await deleteConstructionTransferGroup({
          siblingTxs: siblings,
          transferGroupId: row.transferGroupId,
          role,
        });
        showToast("Đã xóa cả cặp chuyển quỹ", "success");
      } catch (error) {
        console.error(error);
        showToast(error?.message || "Xóa thất bại", "error");
      } finally {
        setDeletingId(null);
      }
      return;
    }

    if (!window.confirm(`Xóa dòng · ${formatCurrency(row.amount)}?`)) return;
    setDeletingId(row.id);
    try {
      await deleteConstructionTx(row.id, role);
      showToast("Đã xóa", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const openNewJob = () => {
    setEditingJobId(null);
    setJobForm({
      title: "",
      category: "xay_dung",
      clientName: "",
      contractAmount: "",
      expectedProfit: "",
      actualProfit: "",
      durationDays: "",
      startDate: todayInputValue(),
      endDate: "",
      status: JOB_STATUS.planned,
      note: "",
    });
    setJobOpen(true);
  };

  const openEditJob = (job) => {
    setEditingJobId(job.id);
    setJobForm({
      title: job.title || "",
      category: job.category || "xay_dung",
      clientName: job.clientName || "",
      contractAmount: job.contractAmount != null ? String(job.contractAmount) : "",
      expectedProfit:
        job.expectedProfit != null ? String(job.expectedProfit) : "",
      actualProfit:
        job.actualProfit != null && job.actualProfit !== ""
          ? String(job.actualProfit)
          : "",
      durationDays: job.durationDays != null ? String(job.durationDays) : "",
      startDate: job.startDate || todayInputValue(),
      endDate: job.endDate || "",
      status: job.status || JOB_STATUS.planned,
      note: job.note || "",
    });
    setJobOpen(true);
  };

  const handleSaveJob = async (e) => {
    e.preventDefault();
    setSavingJob(true);
    try {
      if (editingJobId) {
        await updateConstructionJob(editingJobId, jobForm, profile);
        showToast("Đã cập nhật hạng mục", "success");
      } else {
        await createConstructionJob(jobForm, user, profile);
        showToast("Đã thêm hạng mục", "success");
      }
      setJobOpen(false);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Lưu thất bại", "error");
    } finally {
      setSavingJob(false);
    }
  };

  const handleDeleteJob = async (job) => {
    if (!window.confirm(`Xóa hạng mục “${job.title}”?`)) return;
    try {
      await deleteConstructionJob(job.id, profile);
      showToast("Đã xóa", "info");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    }
  };

  const modeTitle = {
    income: "Thu dịch vụ xây dựng",
    expense: "Chi xây dựng",
    fund_in: "Nạp quỹ xây dựng",
    from_capital: "Chuyển từ vốn CĐT → quỹ XD",
    from_shop: "Chuyển từ quỹ quán → quỹ XD",
    to_shop: "Chuyển quỹ XD → quỹ quán",
  };

  return (
    <AppShell
      title="Mảng xây dựng"
      subtitle="Tách biệt · không lẫn bán hàng trà đá"
    >
      <p className="mb-3 rounded-xl bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-950 ring-1 ring-teal-100">
        Thu <strong>TM</strong> → quỹ xây dựng · Thu <strong>CK</strong> → số
        dư vốn CĐT. Quỹ có thể nhận chuyển từ vốn hoặc quỹ cửa hàng.
      </p>

      <div className="mb-4 grid grid-cols-3 gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "touch-btn h-11 text-xs font-bold sm:text-sm",
              tab === t.id
                ? "bg-teal-700 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <section className="mb-6 space-y-3">
          <StatCard
            label="Số dư quỹ xây dựng"
            value={loadingTx ? 0 : fundSummary.balance}
            tone={fundSummary.balance >= 0 ? "brand" : "danger"}
          />
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Thu TM (quỹ XD)"
              value={loadingTx ? 0 : fundSummary.cashService}
              tone="success"
            />
            <StatCard
              label="Thu CK (vào vốn)"
              value={loadingTx ? 0 : incomeAll.banking}
              tone="brand"
            />
            <StatCard
              label="Đã nạp / chuyển vào"
              value={loadingTx ? 0 : fundSummary.fundIn}
              tone="success"
            />
            <StatCard
              label="Đã chi XD"
              value={loadingTx ? 0 : fundSummary.expense}
              tone="danger"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTab("fund")}
              className="touch-btn h-14 flex-col gap-0.5 bg-teal-700 text-white"
            >
              <Wallet className="h-4 w-4" />
              <span className="text-sm font-extrabold">Quỹ xây dựng</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("jobs")}
              className="touch-btn h-14 flex-col gap-0.5 bg-slate-900 text-white"
            >
              <Building2 className="h-4 w-4" />
              <span className="text-sm font-extrabold">
                Hạng mục · {jobsSummary.activeCount} đang
              </span>
            </button>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
            <p className="text-xs font-semibold text-slate-500">
              Tổng hợp hạng mục
            </p>
            <p className="mt-1 text-sm text-slate-800">
              {jobsSummary.count} việc · HĐ{" "}
              <span className="font-extrabold">
                <Money amount={jobsSummary.contractTotal} />
              </span>
              {" · "}
              Lãi ước{" "}
              <span className="font-extrabold text-emerald-700">
                <Money amount={jobsSummary.expectedProfitTotal} />
              </span>
            </p>
          </div>
          <Link
            href="/manager/expenses"
            className="block text-center text-xs font-bold text-brand-800 underline"
          >
            ← Quỹ cửa hàng (trà đá)
          </Link>
        </section>
      ) : null}

      {tab === "fund" ? (
        <section className="mb-8 space-y-3">
          <StatCard
            label="Số dư quỹ xây dựng"
            value={loadingTx ? 0 : fundSummary.balance}
            tone="brand"
          />

          {canManageShop ? (
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "income", label: "Thu dịch vụ", cls: "bg-emerald-700" },
                { id: "expense", label: "Chi", cls: "bg-rose-700" },
                { id: "from_capital", label: "Từ vốn CĐT", cls: "bg-brand-700" },
                { id: "from_shop", label: "Từ quỹ quán", cls: "bg-slate-800" },
              ].map((b) => (
                <button
                  key={b.id}
                  type="button"
                  disabled={
                    b.id === "from_capital" && !canManageShareholderCapital
                  }
                  onClick={() => {
                    resetFundForm();
                    setMode((m) => (m === b.id ? null : b.id));
                  }}
                  className={cn(
                    "touch-btn h-12 text-xs font-bold text-white disabled:opacity-40",
                    mode === b.id ? "ring-2 ring-offset-1 ring-teal-400" : "",
                    b.cls
                  )}
                >
                  {b.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  resetFundForm();
                  setMode((m) => (m === "fund_in" ? null : "fund_in"));
                }}
                className="touch-btn h-12 bg-teal-600 text-xs font-bold text-white"
              >
                Nạp tay
              </button>
              <button
                type="button"
                onClick={() => {
                  resetFundForm();
                  setMode((m) => (m === "to_shop" ? null : "to_shop"));
                }}
                className="touch-btn h-12 gap-1 bg-white text-xs font-bold text-slate-800 ring-1 ring-slate-200"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                XD → quán
              </button>
            </div>
          ) : null}

          {mode && canManageShop ? (
            <form
              onSubmit={handleFundSave}
              className="card-panel space-y-3 border-teal-100"
            >
              <div className="flex items-center justify-between">
                <h2 className="section-title mb-0 text-teal-950">
                  {modeTitle[mode]}
                </h2>
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="rounded-lg p-2 text-slate-500"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {mode === "income" ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">
                    Hình thức
                  </span>
                  <select
                    className="field-input"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  >
                    <option value="cash">Tiền mặt → quỹ XD</option>
                    <option value="banking">Chuyển khoản → vốn CĐT</option>
                  </select>
                </label>
              ) : null}
              {mode === "expense" ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold">
                    Hạng mục chi
                  </span>
                  <select
                    className="field-input"
                    value={expenseCat}
                    onChange={(e) => setExpenseCat(e.target.value)}
                  >
                    {CONSTRUCTION_EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">Số tiền</span>
                <input
                  type="number"
                  min="1"
                  required
                  className="field-input money"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">Ngày</span>
                <input
                  type="date"
                  className="field-input"
                  value={dateInput}
                  max={todayInputValue()}
                  onChange={(e) => setDateInput(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">Ghi chú</span>
                <input
                  className="field-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note…"
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                className="touch-btn h-12 w-full bg-teal-700 text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Lưu"}
              </button>
            </form>
          ) : null}

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
            summary={
              hasDateRange(dateFrom, dateTo) ? (
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <p>
                    TM:{" "}
                    <span className="font-bold text-emerald-700">
                      <Money amount={periodFund.cashService} />
                    </span>
                  </p>
                  <p>
                    CK (vốn):{" "}
                    <span className="font-bold text-brand-800">
                      <Money amount={periodFund.banking} />
                    </span>
                  </p>
                  <p>
                    Nạp:{" "}
                    <span className="font-bold">
                      <Money amount={periodFund.fundIn} />
                    </span>
                  </p>
                  <p>
                    Chi:{" "}
                    <span className="font-bold text-rose-700">
                      <Money amount={periodFund.expense} />
                    </span>
                  </p>
                  <p className="col-span-2">
                    Kỳ · {formatRangeLabel(dateFrom, dateTo)} · biến động quỹ:{" "}
                    <span className="font-extrabold">
                      <Money amount={periodFund.net} />
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">
                  Chọn khoảng ngày để tổng kết kỳ mảng XD.
                </p>
              )
            }
          />

          <div className="flex gap-1 overflow-x-auto pb-1">
            {[
              { id: "all", label: "Tất cả" },
              { id: "income", label: "Thu" },
              { id: "fund_in", label: "Nạp" },
              { id: "expense", label: "Chi" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFundFilter(f.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold",
                  fundFilter === f.id
                    ? "bg-teal-800 text-white"
                    : "bg-slate-100 text-slate-600"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loadingTx ? (
            <div className="card-panel flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : pageRows.length === 0 ? (
            <div className="card-panel text-sm text-slate-500">
              Chưa có giao dịch.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {pageRows.map((row) => {
                const income = isConstructionServiceIncome(row);
                const fundIn = isConstructionFundIn(row);
                const isCk = row.paymentMethod === "banking";
                return (
                  <li
                    key={row.id}
                    className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase text-slate-500">
                          {income
                            ? isCk
                              ? "Thu CK → vốn"
                              : "Thu TM → quỹ"
                            : fundIn
                              ? "Nạp / chuyển vào"
                              : constructionExpenseLabel(row.category)}
                        </p>
                        <p
                          className={cn(
                            "money text-base font-extrabold",
                            row.type === "expense"
                              ? "text-rose-700"
                              : "text-emerald-700"
                          )}
                        >
                          {row.type === "expense" ? "−" : "+"}
                          <Money amount={row.amount} />
                        </p>
                        {row.note ? (
                          <p className="truncate text-xs text-slate-600">
                            {row.note}
                          </p>
                        ) : null}
                        <p className="text-[11px] text-slate-400">
                          {formatTxTime(row)} · {formatActorLabel(row)}
                        </p>
                      </div>
                      {canManageShop ? (
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => handleDeleteTx(row)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="touch-btn h-10 flex-1 bg-white text-sm ring-1 ring-slate-200 disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" /> Trước
              </button>
              <span className="self-center text-xs text-slate-500">
                {safePage}/{totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="touch-btn h-10 flex-1 bg-white text-sm ring-1 ring-slate-200 disabled:opacity-35"
              >
                Sau <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "jobs" ? (
        <section className="mb-8 space-y-3">
          {canManageShop ? (
            <button
              type="button"
              onClick={() => (jobOpen ? setJobOpen(false) : openNewJob())}
              className={cn(
                "touch-btn h-12 w-full gap-2 text-sm font-bold text-white",
                jobOpen ? "bg-slate-800" : "bg-teal-700"
              )}
            >
              {jobOpen ? (
                <>
                  <X className="h-4 w-4" /> Đóng form
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Thêm hạng mục / việc
                </>
              )}
            </button>
          ) : null}

          {jobOpen && canManageShop ? (
            <form onSubmit={handleSaveJob} className="card-panel space-y-2.5">
              <h2 className="section-title">
                {editingJobId ? "Sửa hạng mục" : "Hạng mục mới"}
              </h2>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold">Tên việc</span>
                <input
                  className="field-input"
                  required
                  value={jobForm.title}
                  onChange={(e) =>
                    setJobForm((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder="VD: Xây nhà anh A · Thuê NC công trình B"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    Hạng mục
                  </span>
                  <select
                    className="field-input"
                    value={jobForm.category}
                    onChange={(e) =>
                      setJobForm((f) => ({ ...f, category: e.target.value }))
                    }
                  >
                    {CONSTRUCTION_JOB_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    Trạng thái
                  </span>
                  <select
                    className="field-input"
                    value={jobForm.status}
                    onChange={(e) =>
                      setJobForm((f) => ({ ...f, status: e.target.value }))
                    }
                  >
                    {Object.entries(JOB_STATUS_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold">
                  Chủ đầu tư (khách / bên A)
                </span>
                <input
                  className="field-input"
                  value={jobForm.clientName}
                  onChange={(e) =>
                    setJobForm((f) => ({ ...f, clientName: e.target.value }))
                  }
                  placeholder="Tên khách"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    Số tiền HĐ
                  </span>
                  <input
                    type="number"
                    min="0"
                    className="field-input money"
                    value={jobForm.contractAmount}
                    onChange={(e) =>
                      setJobForm((f) => ({
                        ...f,
                        contractAmount: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    Lãi ước
                  </span>
                  <input
                    type="number"
                    className="field-input money"
                    value={jobForm.expectedProfit}
                    onChange={(e) =>
                      setJobForm((f) => ({
                        ...f,
                        expectedProfit: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    Lãi thực
                  </span>
                  <input
                    type="number"
                    className="field-input money"
                    value={jobForm.actualProfit}
                    onChange={(e) =>
                      setJobForm((f) => ({
                        ...f,
                        actualProfit: e.target.value,
                      }))
                    }
                    placeholder="Khi quyết toán"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    Số ngày
                  </span>
                  <input
                    type="number"
                    min="0"
                    className="field-input"
                    value={jobForm.durationDays}
                    onChange={(e) =>
                      setJobForm((f) => ({
                        ...f,
                        durationDays: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    Từ ngày
                  </span>
                  <input
                    type="date"
                    className="field-input"
                    value={jobForm.startDate}
                    onChange={(e) =>
                      setJobForm((f) => ({ ...f, startDate: e.target.value }))
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold">
                    Đến ngày
                  </span>
                  <input
                    type="date"
                    className="field-input"
                    value={jobForm.endDate}
                    onChange={(e) =>
                      setJobForm((f) => ({ ...f, endDate: e.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold">Ghi chú</span>
                <textarea
                  className="field-input min-h-[4rem]"
                  value={jobForm.note}
                  onChange={(e) =>
                    setJobForm((f) => ({ ...f, note: e.target.value }))
                  }
                />
              </label>
              <button
                type="submit"
                disabled={savingJob}
                className="touch-btn h-12 w-full bg-teal-700 text-white disabled:opacity-50"
              >
                {savingJob ? "Đang lưu…" : "Lưu hạng mục"}
              </button>
            </form>
          ) : null}

          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {jobsSummary.count} việc · HĐ{" "}
            <Money amount={jobsSummary.contractTotal} /> · Lãi ước{" "}
            <Money amount={jobsSummary.expectedProfitTotal} />
          </div>

          {loadingJobs ? (
            <div className="card-panel h-20 animate-pulse" />
          ) : jobs.length === 0 ? (
            <div className="card-panel text-sm text-slate-500">
              Chưa có hạng mục. Thêm việc để theo dõi CĐT, tiền, lãi, số ngày.
            </div>
          ) : (
            jobs.map((job) => (
              <article
                key={job.id}
                className="card-panel space-y-2 !py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold text-slate-900">{job.title}</p>
                    <p className="text-xs text-slate-500">
                      {constructionJobCategoryLabel(job.category)}
                      {" · "}
                      {JOB_STATUS_LABEL[job.status] || job.status}
                    </p>
                    {job.clientName ? (
                      <p className="mt-0.5 text-xs font-semibold text-teal-800">
                        CĐT: {job.clientName}
                      </p>
                    ) : null}
                  </div>
                  {canManageShop ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => openEditJob(job)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteJob(job)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-slate-400">Tiền HĐ</p>
                    <p className="money font-bold">
                      <Money amount={job.contractAmount} />
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Lãi ước</p>
                    <p className="money font-bold text-emerald-700">
                      <Money amount={job.expectedProfit} />
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Số ngày</p>
                    <p className="font-bold">{job.durationDays || "—"}</p>
                  </div>
                </div>
                {(job.startDate || job.endDate) && (
                  <p className="text-[11px] text-slate-500">
                    Thời gian: {job.startDate || "?"} → {job.endDate || "?"}
                  </p>
                )}
                {job.note ? (
                  <p className="text-xs text-slate-600">{job.note}</p>
                ) : null}
              </article>
            ))
          )}
        </section>
      ) : null}
    </AppShell>
  );
}

export default function ConstructionPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor", "superadmin"]}>
      <ConstructionContent />
    </ProtectedRoute>
  );
}
