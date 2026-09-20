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
} from "@/components/ui/MobileUI";
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
  const [jobPage, setJobPage] = useState(1);
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

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const jobTotalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  const jobSafePage = Math.min(jobPage, jobTotalPages);
  const jobPageRows = useMemo(() => {
    const start = (jobSafePage - 1) * PAGE_SIZE;
    return jobs.slice(start, start + PAGE_SIZE);
  }, [jobs, jobSafePage]);

  useEffect(() => {
    setJobPage(1);
  }, [jobs.length]);

  useEffect(() => {
    if (jobPage > jobTotalPages) setJobPage(jobTotalPages);
  }, [jobPage, jobTotalPages]);

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

  const closeFundForm = () => {
    setMode(null);
    resetFundForm();
  };

  return (
    <AppShell
      title="Mảng xây dựng"
      subtitle="Tách biệt · không lẫn bán hàng trà đá"
    >
      <div className="space-y-4">
      <p className="text-sm leading-snug text-slate-500">
        Thu TM → quỹ XD · Thu CK → vốn CĐT · có thể nhận từ vốn / quỹ quán.
      </p>

      <ChipRow>
        {TABS.map((t) => (
          <FilterChip
            key={t.id}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </FilterChip>
        ))}
      </ChipRow>

      {tab === "overview" ? (
        <section className="space-y-4">
          <StatCard
            label="Số dư quỹ xây dựng"
            value={loadingTx ? 0 : fundSummary.balance}
            tone={fundSummary.balance >= 0 ? "brand" : "danger"}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="card-panel !p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Thu TM
              </p>
              <p className="money mt-1 text-sm font-bold text-emerald-700">
                <Money amount={loadingTx ? 0 : fundSummary.cashService} />
              </p>
            </div>
            <div className="card-panel !p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Thu CK
              </p>
              <p className="money mt-1 text-sm font-bold text-brand-800">
                <Money amount={loadingTx ? 0 : incomeAll.banking} />
              </p>
            </div>
            <div className="card-panel !p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Đã nạp
              </p>
              <p className="money mt-1 text-sm font-bold text-emerald-700">
                <Money amount={loadingTx ? 0 : fundSummary.fundIn} />
              </p>
            </div>
            <div className="card-panel !p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Đã chi
              </p>
              <p className="money mt-1 text-sm font-bold text-rose-700">
                <Money amount={loadingTx ? 0 : fundSummary.expense} />
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setTab("fund")}
              className="touch-btn h-14 flex-col gap-0.5 bg-brand-700 text-white"
            >
              <Wallet className="h-4 w-4" />
              <span className="text-sm font-bold">Quỹ xây dựng</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("jobs")}
              className="touch-btn h-14 flex-col gap-0.5 bg-slate-900 text-white"
            >
              <Building2 className="h-4 w-4" />
              <span className="text-sm font-bold">
                Hạng mục · {jobsSummary.activeCount} đang
              </span>
            </button>
          </div>
          <div className="card-panel">
            <p className="text-xs font-semibold text-slate-500">
              Tổng hợp hạng mục
            </p>
            <p className="mt-1 text-sm text-slate-800">
              {jobsSummary.count} việc · HĐ{" "}
              <span className="font-bold">
                <Money amount={jobsSummary.contractTotal} />
              </span>
              {" · "}
              Lãi ước{" "}
              <span className="font-bold text-emerald-700">
                <Money amount={jobsSummary.expectedProfitTotal} />
              </span>
            </p>
          </div>
          <Link
            href="/manager/expenses"
            className="touch-btn h-11 w-full justify-center text-sm font-bold text-brand-800 ring-1 ring-slate-200"
          >
            ← Quỹ cửa hàng (trà đá)
          </Link>
        </section>
      ) : null}

      {tab === "fund" ? (
        <section className="space-y-4">
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
                    setMode(b.id);
                  }}
                  className={cn(
                    "touch-btn h-12 text-xs font-bold text-white disabled:opacity-40",
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
                  setMode("fund_in");
                }}
                className="touch-btn h-12 bg-brand-700 text-xs font-bold text-white"
              >
                Nạp tay
              </button>
              <button
                type="button"
                onClick={() => {
                  resetFundForm();
                  setMode("to_shop");
                }}
                className="touch-btn h-12 gap-1 bg-white text-xs font-bold text-slate-800 ring-1 ring-slate-200"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                XD → quán
              </button>
            </div>
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
                    <span className="font-bold">
                      <Money amount={periodFund.net} />
                    </span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Chọn khoảng ngày để tổng kết kỳ mảng XD.
                </p>
              )
            }
          />

          <ChipRow>
            {[
              { id: "all", label: "Tất cả" },
              { id: "income", label: "Thu" },
              { id: "fund_in", label: "Nạp" },
              { id: "expense", label: "Chi" },
            ].map((f) => (
              <FilterChip
                key={f.id}
                active={fundFilter === f.id}
                onClick={() => setFundFilter(f.id)}
              >
                {f.label}
              </FilterChip>
            ))}
          </ChipRow>

          {loadingTx ? (
            <div className="card-panel flex h-20 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-brand-700" />
            </div>
          ) : pageRows.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Chưa có giao dịch"
              description="Ghi thu, chi hoặc nạp quỹ để bắt đầu sổ XD."
            />
          ) : (
            <ul className="space-y-2">
              {pageRows.map((row) => {
                const income = isConstructionServiceIncome(row);
                const fundIn = isConstructionFundIn(row);
                const isCk = row.paymentMethod === "banking";
                return (
                  <li key={row.id} className="card-panel !py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold uppercase text-slate-500">
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
                            "money text-base font-bold",
                            row.type === "expense"
                              ? "text-rose-700"
                              : "text-emerald-700"
                          )}
                        >
                          {row.type === "expense" ? "−" : "+"}
                          <Money amount={row.amount} />
                        </p>
                        {row.note ? (
                          <p className="truncate text-sm text-slate-600">
                            {row.note}
                          </p>
                        ) : null}
                        <p className="text-sm text-slate-400">
                          {formatTxTime(row)} · {formatActorLabel(row)}
                        </p>
                      </div>
                      {canManageShop ? (
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => handleDeleteTx(row)}
                          className="touch-btn h-11 w-11 shrink-0 rounded-2xl bg-slate-50 p-0 text-slate-500 ring-1 ring-slate-200"
                        >
                          <Trash2 className="h-4 w-4" />
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
                className="touch-btn h-11 flex-1 bg-white text-sm ring-1 ring-slate-200 disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" /> Trước
              </button>
              <span className="self-center text-sm text-slate-500">
                {safePage}/{totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="touch-btn h-11 flex-1 bg-white text-sm ring-1 ring-slate-200 disabled:opacity-35"
              >
                Sau <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "jobs" ? (
        <section className="space-y-4">
          {canManageShop ? (
            <button
              type="button"
              onClick={openNewJob}
              className="touch-btn h-12 w-full gap-2 bg-brand-700 text-sm font-bold text-white"
            >
              <Plus className="h-4 w-4" /> Thêm hạng mục / việc
            </button>
          ) : null}

          <div className="card-panel !py-3 text-sm text-slate-600">
            {jobsSummary.count} việc
            {jobs.length > PAGE_SIZE
              ? ` · trang ${jobSafePage}/${jobTotalPages}`
              : ""}{" "}
            · HĐ <Money amount={jobsSummary.contractTotal} /> · Lãi ước{" "}
            <Money amount={jobsSummary.expectedProfitTotal} />
          </div>

          {loadingJobs ? (
            <div className="card-panel h-20 animate-pulse" />
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="Chưa có hạng mục"
              description="Thêm việc để theo dõi CĐT, tiền, lãi, số ngày."
              action={
                canManageShop ? (
                  <button
                    type="button"
                    onClick={openNewJob}
                    className="touch-btn h-11 w-full bg-brand-700 text-sm font-bold text-white"
                  >
                    <Plus className="h-4 w-4" /> Thêm hạng mục
                  </button>
                ) : null
              }
            />
          ) : (
            <>
              {jobPageRows.map((job) => (
              <article
                key={job.id}
                className="card-panel space-y-2 !py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">{job.title}</p>
                    <p className="text-sm text-slate-500">
                      {constructionJobCategoryLabel(job.category)}
                      {" · "}
                      {JOB_STATUS_LABEL[job.status] || job.status}
                    </p>
                    {job.clientName ? (
                      <p className="mt-0.5 text-sm font-semibold text-brand-800">
                        CĐT: {job.clientName}
                      </p>
                    ) : null}
                  </div>
                  {canManageShop ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => openEditJob(job)}
                        className="touch-btn h-11 w-11 rounded-2xl bg-slate-100 p-0"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteJob(job)}
                        className="touch-btn h-11 w-11 rounded-2xl bg-rose-50 p-0 text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
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
                  <p className="text-sm text-slate-500">
                    Thời gian: {job.startDate || "?"} → {job.endDate || "?"}
                  </p>
                )}
                {job.note ? (
                  <p className="text-sm text-slate-600">{job.note}</p>
                ) : null}
              </article>
              ))}

              {jobTotalPages > 1 ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={jobSafePage <= 1}
                    onClick={() => setJobPage((p) => Math.max(1, p - 1))}
                    className="touch-btn h-11 flex-1 bg-white text-sm ring-1 ring-slate-200 disabled:opacity-35"
                  >
                    <ChevronLeft className="h-4 w-4" /> Trước
                  </button>
                  <span className="self-center text-sm text-slate-500">
                    {jobSafePage}/{jobTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={jobSafePage >= jobTotalPages}
                    onClick={() =>
                      setJobPage((p) => Math.min(jobTotalPages, p + 1))
                    }
                    className="touch-btn h-11 flex-1 bg-white text-sm ring-1 ring-slate-200 disabled:opacity-35"
                  >
                    Sau <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      </div>

      <BottomSheet
        open={canManageShop && Boolean(mode)}
        onClose={closeFundForm}
        title={modeTitle[mode] || "Giao dịch quỹ"}
        labelledBy="construction-fund-sheet"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeFundForm}
              className="touch-btn h-12 flex-1 border border-slate-200 bg-white text-slate-700"
            >
              Hủy
            </button>
            <button
              type="submit"
              form="construction-fund-form"
              disabled={saving}
              className="touch-btn h-12 flex-[1.4] bg-brand-700 text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Lưu"}
            </button>
          </div>
        }
      >
        <form
          id="construction-fund-form"
          onSubmit={handleFundSave}
          className="space-y-4"
        >
          {mode === "income" ? (
            <label className="block">
              <FieldLabel>Hình thức</FieldLabel>
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
              <FieldLabel>Hạng mục chi</FieldLabel>
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
            <FieldLabel>Số tiền</FieldLabel>
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
            <FieldLabel>Ngày</FieldLabel>
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
            <FieldLabel optional>Ghi chú</FieldLabel>
            <input
              className="field-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note…"
            />
          </label>
        </form>
      </BottomSheet>

      <BottomSheet
        open={canManageShop && jobOpen}
        onClose={() => setJobOpen(false)}
        title={editingJobId ? "Sửa hạng mục" : "Hạng mục mới"}
        labelledBy="construction-job-sheet"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setJobOpen(false)}
              className="touch-btn h-12 flex-1 border border-slate-200 bg-white text-slate-700"
            >
              Hủy
            </button>
            <button
              type="submit"
              form="construction-job-form"
              disabled={savingJob}
              className="touch-btn h-12 flex-[1.4] bg-brand-700 text-white disabled:opacity-50"
            >
              {savingJob ? "Đang lưu…" : "Lưu hạng mục"}
            </button>
          </div>
        }
      >
        <form
          id="construction-job-form"
          onSubmit={handleSaveJob}
          className="space-y-4"
        >
          <label className="block">
            <FieldLabel>Tên việc</FieldLabel>
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
              <FieldLabel>Hạng mục</FieldLabel>
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
              <FieldLabel>Trạng thái</FieldLabel>
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
            <FieldLabel optional>Chủ đầu tư</FieldLabel>
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
              <FieldLabel>Số tiền HĐ</FieldLabel>
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
              <FieldLabel>Lãi ước</FieldLabel>
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
              <FieldLabel optional>Lãi thực</FieldLabel>
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
              <FieldLabel optional>Số ngày</FieldLabel>
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
              <FieldLabel>Từ ngày</FieldLabel>
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
              <FieldLabel optional>Đến ngày</FieldLabel>
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
            <FieldLabel optional>Ghi chú</FieldLabel>
            <textarea
              className="field-input min-h-[4rem]"
              value={jobForm.note}
              onChange={(e) =>
                setJobForm((f) => ({ ...f, note: e.target.value }))
              }
            />
          </label>
        </form>
      </BottomSheet>
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
