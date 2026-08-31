'use client';

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import {
  Banknote,
  Box,
  Landmark,
  Loader2,
  Package,
  Pencil,
  Plus,
  Save,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { subscribeCollection } from "@/lib/liveCollection";
import { actorFields, formatActorLabel } from "@/lib/audit";
import {
  convertExistingCapitalExpenseToShopFund,
  transferCapitalToShopFund,
} from "@/lib/expenses";
import {
  createInvestment,
  filterInvestmentsForRole,
  isAssetInvestment,
  investmentTypeLabel,
  subscribeInvestments,
  summarizeAssets,
} from "@/lib/investments";
import {
  CAPITAL_KINDS,
  addCapitalContribution,
  addCapitalExpense,
  capitalKindLabel,
  displayNamesForRole,
  filterShareholderCapitalEntries,
  findInitialEntry,
  isShopManagerName,
  subscribeShareholderCapital,
  summarizeShareholderCapital,
  updateCapitalExpense,
  updateInitialCapitalAmount,
} from "@/lib/shareholderCapital";
import {
  cn,
  dateKeyToInputValue,
  formatCurrency,
  inputValueToDateKey,
  timestampForBusinessDate,
  todayInputValue,
} from "@/lib/utils";

const CapitalOwnershipChart = dynamic(
  () => import("@/components/CapitalOwnershipChart"),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
    ),
  }
);

const PIE_COLORS = [
  "#1e40af",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#4f46e5",
];

function formatEntryDate(row) {
  if (row.dateKey) return row.dateKey;
  const ms =
    row.timestamp?.toMillis?.() ??
    row.date?.toMillis?.() ??
    row.createdAt?.toMillis?.();
  if (!ms) return "—";
  return format(new Date(ms), "dd/MM/yyyy");
}

function typeChipClass(type) {
  if (type === "equipment") {
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
  }
  if (type === "goods") {
    return "bg-sky-50 text-sky-800 ring-1 ring-sky-100";
  }
  return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100";
}

function capitalKindChipClass(kind) {
  if (kind === CAPITAL_KINDS.expense) {
    return "bg-rose-50 text-rose-800 ring-1 ring-rose-100";
  }
  if (kind === CAPITAL_KINDS.initial) {
    return "bg-violet-50 text-violet-800 ring-1 ring-violet-100";
  }
  return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100";
}

function PersonPicker({
  mode,
  setMode,
  selectValue,
  setSelectValue,
  customValue,
  setCustomValue,
  options,
  selectLabel,
  customLabel,
  customPlaceholder,
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        {[
          { id: "select", label: "Chọn có sẵn" },
          { id: "custom", label: "Nhập tay" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMode(item.id)}
            className={cn(
              "touch-btn h-11 rounded-xl text-sm",
              mode === item.id
                ? "bg-white text-brand-800 shadow-sm"
                : "text-slate-500"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === "select" ? (
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            {selectLabel}
          </span>
          <select
            className="field-input"
            value={selectValue}
            onChange={(e) => setSelectValue(e.target.value)}
            required={mode === "select"}
          >
            <option value="">— Chọn —</option>
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            {customLabel}
          </span>
          <input
            className="field-input"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            placeholder={customPlaceholder}
            required={mode === "custom"}
          />
        </label>
      )}
    </>
  );
}

function AssetHistoryList({ rows, emptyText }) {
  if (!rows.length) {
    return <div className="card-panel text-sm text-slate-500">{emptyText}</div>;
  }

  return rows.map((row) => (
    <article key={row.id} className="card-panel space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-900">{row.investorName}</p>
          <p className="text-xs text-slate-500">{formatEntryDate(row)}</p>
        </div>
        <p className="money shrink-0 text-base font-extrabold text-brand-800">
          <Money amount={row.amount} />
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className={cn("chip", typeChipClass(row.type))}>
          {investmentTypeLabel(row.type)}
        </span>
        {(row.type === "equipment" || row.type === "goods") &&
        row.equipmentName ? (
          <span className="chip bg-slate-50 text-slate-700 ring-1 ring-slate-200">
            {row.equipmentName}
          </span>
        ) : null}
      </div>
      {row.note ? <p className="text-xs text-slate-500">{row.note}</p> : null}
      {row.createdByName || row.createdByUsername ? (
        <p className="text-xs font-medium text-brand-800">
          Nhập bởi: {formatActorLabel(row)}
        </p>
      ) : null}
    </article>
  ));
}

function CapitalHistoryList({
  rows,
  emptyText,
  canEditExpense = false,
  onEditExpense,
}) {
  if (!rows.length) {
    return <div className="card-panel text-sm text-slate-500">{emptyText}</div>;
  }

  return rows.map((row) => {
    const isExpense = row.kind === CAPITAL_KINDS.expense;
    const title = isExpense
      ? formatActorLabel(row)
      : row.investorName || "—";
    const linkedFund = Boolean(row.toShopFund || row.shopFundTxId);
    return (
      <article key={row.id} className="card-panel space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">{formatEntryDate(row)}</p>
          </div>
          <p
            className={cn(
              "money shrink-0 text-base font-extrabold",
              isExpense ? "text-rose-700" : "text-emerald-800"
            )}
          >
            {isExpense ? "−" : "+"}
            <Money amount={row.amount} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={cn("chip", capitalKindChipClass(row.kind))}>
            {capitalKindLabel(row.kind)}
          </span>
          {isExpense && linkedFund ? (
            <span className="chip bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100">
              Đã vào quỹ cửa hàng
            </span>
          ) : null}
          {isExpense && !linkedFund ? (
            <span className="chip bg-amber-50 text-amber-900 ring-1 ring-amber-100">
              Chưa vào quỹ
            </span>
          ) : null}
        </div>
        {row.note ? <p className="text-xs text-slate-500">{row.note}</p> : null}
        {!isExpense && (row.createdByName || row.createdByUsername) ? (
          <p className="text-xs font-medium text-brand-800">
            Nhập bởi: {formatActorLabel(row)}
          </p>
        ) : null}
        {isExpense ? (
          <p className="text-xs font-medium text-rose-800">
            Người gửi: {formatActorLabel(row)} · {formatEntryDate(row)}
          </p>
        ) : null}
        {isExpense && canEditExpense ? (
          <button
            type="button"
            onClick={() => onEditExpense?.(row)}
            className="touch-btn h-11 w-full gap-2 bg-slate-900 text-sm text-white"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Sửa / chuyển quỹ
          </button>
        ) : null}
      </article>
    );
  });
}

function CapitalContent() {
  const {
    user,
    profile,
    canManageShop,
    canViewInvestmentCapital,
    canManageShareholderCapital,
  } = useAuth();
  const { showToast } = useToast();

  const [investments, setInvestments] = useState([]);
  const [capitalEntries, setCapitalEntries] = useState([]);
  const [users, setUsers] = useState([]);
  /** Chỉ Chủ đầu tư (investor) — không gồm quản lý quán */
  const [shareholderOptions, setShareholderOptions] = useState([]);
  /** Nguồn/phụ trách hàng hóa-TB: quản lý + cổ đông + … */
  const [assetPersonOptions, setAssetPersonOptions] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadingCapital, setLoadingCapital] = useState(true);
  const [tab, setTab] = useState(
    canViewInvestmentCapital ? "capital" : "assets"
  );

  const [capMode, setCapMode] = useState("select");
  const [capSelect, setCapSelect] = useState("");
  const [capCustom, setCapCustom] = useState("");
  const [capAmount, setCapAmount] = useState("");
  const [capNote, setCapNote] = useState("");
  const [capInitial, setCapInitial] = useState(true);
  const [savingCap, setSavingCap] = useState(false);

  const [expAmount, setExpAmount] = useState("");
  const [expNote, setExpNote] = useState("");
  const [expDate, setExpDate] = useState(todayInputValue());
  /** Mặc định bật: chi vốn đồng thời nạp vào quỹ cửa hàng */
  const [expToShopFund, setExpToShopFund] = useState(true);
  /** Tiền mặt | chuyển khoản khi nạp quỹ từ vốn */
  const [expPayMethod, setExpPayMethod] = useState("cash");
  const [savingExp, setSavingExp] = useState(false);

  /** Sửa dòng chi tiêu vốn đã có (SA) */
  const [editingExpense, setEditingExpense] = useState(null);
  const [editExpAmount, setEditExpAmount] = useState("");
  const [editExpNote, setEditExpNote] = useState("");
  const [editExpDate, setEditExpDate] = useState(todayInputValue());
  const [editExpPayMethod, setEditExpPayMethod] = useState("cash");
  const [savingEditExp, setSavingEditExp] = useState(false);
  const [convertingExp, setConvertingExp] = useState(false);

  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  /** null | contribute | expense | edit — form ghi chỉ mở khi bấm */
  const [capitalWrite, setCapitalWrite] = useState(null);
  const [assetWriteOpen, setAssetWriteOpen] = useState(false);

  const [assetMode, setAssetMode] = useState("select");
  const [assetSelect, setAssetSelect] = useState("");
  const [assetCustom, setAssetCustom] = useState("");
  const [assetType, setAssetType] = useState("goods");
  const [assetName, setAssetName] = useState("");
  const [assetAmount, setAssetAmount] = useState("");
  const [assetNote, setAssetNote] = useState("");
  const [savingAsset, setSavingAsset] = useState(false);

  useEffect(() => {
    const unsub = subscribeInvestments(
      (list) => {
        setInvestments(
          filterInvestmentsForRole(list, {
            canViewCapital: false,
          })
        );
        setLoadingAssets(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được hàng hóa / thiết bị", "error");
        setLoadingAssets(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    if (!canViewInvestmentCapital) {
      setLoadingCapital(false);
      return undefined;
    }
    const unsub = subscribeShareholderCapital(
      (list) => {
        setCapitalEntries(list);
        setLoadingCapital(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được sổ vốn cổ đông", "error");
        setLoadingCapital(false);
      }
    );
    return () => unsub();
  }, [canViewInvestmentCapital, showToast]);

  useEffect(() => {
    const unsub = subscribeCollection(
      "users",
      (list) => {
        setUsers(list);

        // Cổ đông = chỉ role investor (quản lý / NV không vào danh sách)
        setShareholderOptions(displayNamesForRole(list, "investor"));

        const assetPeople = [
          ...displayNamesForRole(list, "investor"),
          ...displayNamesForRole(list, "manager"),
          ...displayNamesForRole(list, "employee"),
        ];
        setAssetPersonOptions(
          [...new Set(assetPeople)].sort((a, b) => a.localeCompare(b, "vi"))
        );
      },
      () => {
        setUsers([]);
        setShareholderOptions([]);
        setAssetPersonOptions([]);
      }
    );
    return () => unsub();
  }, []);

  const shareholderCapitalEntries = useMemo(
    () => filterShareholderCapitalEntries(capitalEntries, users),
    [capitalEntries, users]
  );

  const assetRows = useMemo(
    () => (investments || []).filter(isAssetInvestment),
    [investments]
  );

  const capitalSummary = useMemo(
    () => summarizeShareholderCapital(shareholderCapitalEntries),
    [shareholderCapitalEntries]
  );

  const assets = useMemo(() => summarizeAssets(investments), [investments]);

  const pieData = useMemo(
    () =>
      capitalSummary.shares.map((s) => ({
        name: s.name,
        value: s.contributed,
        percent: s.percent,
      })),
    [capitalSummary.shares]
  );

  const resolveName = (mode, selectValue, customValue) =>
    mode === "custom" ? customValue.trim() : selectValue.trim();

  const saveCapital = async (e) => {
    e.preventDefault();
    if (!canManageShareholderCapital) {
      showToast("Chỉ tài khoản quản trị được ghi vốn cổ đông", "error");
      return;
    }

    const investorName = resolveName(capMode, capSelect, capCustom);
    if (!investorName) {
      showToast("Chọn hoặc nhập tên cổ đông", "error");
      return;
    }
    if (isShopManagerName(investorName, users)) {
      showToast("Quản lý cửa hàng không phải cổ đông — chọn Chủ đầu tư", "error");
      return;
    }
    if (!capAmount || Number(capAmount) <= 0) {
      showToast("Nhập số tiền đầu tư hợp lệ", "error");
      return;
    }

    if (capInitial && findInitialEntry(shareholderCapitalEntries, investorName)) {
      showToast(
        "Cổ đông này đã có vốn ban đầu — dùng form Sửa vốn ban đầu bên dưới",
        "error"
      );
      return;
    }

    setSavingCap(true);
    try {
      await addCapitalContribution({
        investorName,
        amount: capAmount,
        kind: capInitial ? CAPITAL_KINDS.initial : CAPITAL_KINDS.contribution,
        note: capNote,
        user,
        profile,
      });
      showToast(
        capInitial ? "Đã ghi vốn đầu tư ban đầu" : "Đã ghi vốn góp thêm",
        "success"
      );
      setCapAmount("");
      setCapNote("");
      setCapitalWrite(null);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Lưu vốn thất bại", "error");
    } finally {
      setSavingCap(false);
    }
  };

  const saveExpense = async (e) => {
    e.preventDefault();
    if (!canManageShareholderCapital) {
      showToast("Chỉ tài khoản quản trị được ghi chi tiêu vốn", "error");
      return;
    }
    if (!expAmount || Number(expAmount) <= 0) {
      showToast("Nhập số tiền chi hợp lệ", "error");
      return;
    }
    if (!expDate) {
      showToast("Chọn ngày chi", "error");
      return;
    }

    setSavingExp(true);
    try {
      if (expToShopFund) {
        await transferCapitalToShopFund({
          amount: expAmount,
          note: expNote,
          dateInput: expDate,
          paymentMethod: expPayMethod,
          user,
          profile,
        });
        showToast(
          expPayMethod === "banking"
            ? "Đã chi vốn và nạp quỹ (chuyển khoản)"
            : "Đã chi vốn và nạp vào quỹ cửa hàng",
          "success"
        );
      } else {
        await addCapitalExpense({
          amount: expAmount,
          note: expNote,
          dateKey: inputValueToDateKey(expDate),
          expenseDate: timestampForBusinessDate(expDate),
          user,
          profile,
        });
        showToast("Đã ghi chi tiêu vốn (không nạp quỹ)", "success");
      }
      setExpAmount("");
      setExpNote("");
      setExpDate(todayInputValue());
      setExpToShopFund(true);
      setExpPayMethod("cash");
      setCapitalWrite(null);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Lưu chi tiêu thất bại", "error");
    } finally {
      setSavingExp(false);
    }
  };

  const openEditExpense = (row) => {
    if (!canManageShareholderCapital || row?.kind !== CAPITAL_KINDS.expense) {
      return;
    }
    setCapitalWrite(null);
    setEditingExpense(row);
    setEditExpAmount(String(row.amount ?? ""));
    setEditExpNote(row.note || "");
    setEditExpDate(
      row.dateKey ? dateKeyToInputValue(row.dateKey) : todayInputValue()
    );
  };

  const saveEditExpense = async (e) => {
    e.preventDefault();
    if (!canManageShareholderCapital || !editingExpense?.id) {
      showToast("Chỉ tài khoản quản trị được sửa chi tiêu vốn", "error");
      return;
    }
    if (!editExpAmount || Number(editExpAmount) <= 0) {
      showToast("Nhập số tiền hợp lệ", "error");
      return;
    }
    if (!editExpDate) {
      showToast("Chọn ngày chi", "error");
      return;
    }

    setSavingEditExp(true);
    try {
      await updateCapitalExpense({
        entryId: editingExpense.id,
        amount: editExpAmount,
        note: editExpNote,
        dateKey: inputValueToDateKey(editExpDate),
        expenseDate: timestampForBusinessDate(editExpDate),
        role: profile?.role,
      });
      showToast("Đã cập nhật chi tiêu vốn", "success");
      setEditingExpense(null);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Sửa thất bại", "error");
    } finally {
      setSavingEditExp(false);
    }
  };

  const convertEditExpenseToFund = async () => {
    if (!canManageShareholderCapital || !editingExpense?.id) return;
    if (editingExpense.toShopFund || editingExpense.shopFundTxId) {
      showToast("Dòng này đã vào quỹ rồi", "info");
      return;
    }
    const ok = window.confirm(
      `Chuyển khoản chi vốn này vào quỹ cửa hàng?\n${formatCurrency(editingExpense.amount)}\nKhông tạo dòng chi vốn mới — chỉ nạp két quán.`
    );
    if (!ok) return;

    setConvertingExp(true);
    try {
      // Dùng bản đã sửa trên form nếu user vừa đổi số tiền/ghi chú nhưng chưa lưu
      const draft = {
        ...editingExpense,
        amount: editExpAmount || editingExpense.amount,
        note: editExpNote,
        dateKey: inputValueToDateKey(editExpDate),
      };
      await updateCapitalExpense({
        entryId: editingExpense.id,
        amount: draft.amount,
        note: draft.note,
        dateKey: draft.dateKey,
        expenseDate: timestampForBusinessDate(editExpDate),
        role: profile?.role,
      });
      await convertExistingCapitalExpenseToShopFund({
        entry: { ...editingExpense, ...draft },
        paymentMethod: editExpPayMethod,
        user,
        profile,
      });
      showToast(
        editExpPayMethod === "banking"
          ? "Đã chuyển vào quỹ (chuyển khoản)"
          : "Đã chuyển vào quỹ cửa hàng",
        "success"
      );
      setEditingExpense(null);
      setEditExpPayMethod("cash");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Chuyển quỹ thất bại", "error");
    } finally {
      setConvertingExp(false);
    }
  };

  const saveEditInitial = async (e) => {
    e.preventDefault();
    if (!canManageShareholderCapital) {
      showToast("Chỉ tài khoản quản trị được sửa vốn ban đầu", "error");
      return;
    }
    const name = editName.trim();
    const entry = findInitialEntry(shareholderCapitalEntries, name);
    if (!entry) {
      showToast("Chưa có dòng vốn ban đầu cho cổ đông này", "error");
      return;
    }
    if (!editAmount || Number(editAmount) <= 0) {
      showToast("Nhập số tiền hợp lệ", "error");
      return;
    }

    setSavingEdit(true);
    try {
      await updateInitialCapitalAmount(entry.id, editAmount);
      showToast("Đã cập nhật vốn đầu tư ban đầu", "success");
      setEditAmount("");
      setCapitalWrite(null);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Sửa vốn ban đầu thất bại", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const saveAsset = async (e) => {
    e.preventDefault();
    if (!canManageShop) {
      showToast("Bạn không có quyền nhập hàng hóa / thiết bị", "error");
      return;
    }

    const investorName = resolveName(assetMode, assetSelect, assetCustom);
    if (!investorName) {
      showToast("Nhập nguồn / người phụ trách", "error");
      return;
    }
    if (!assetAmount || Number(assetAmount) <= 0) {
      showToast("Nhập giá trị hợp lệ", "error");
      return;
    }
    if (!assetName.trim()) {
      showToast(
        assetType === "goods" ? "Nhập tên hàng hóa" : "Nhập tên thiết bị",
        "error"
      );
      return;
    }

    setSavingAsset(true);
    try {
      const actor = actorFields(user, profile);
      await createInvestment({
        investorName,
        type: assetType,
        amount: assetAmount,
        equipmentName: assetName,
        note: assetNote,
        ...actor,
      });
      showToast("Đã lưu hàng hóa / thiết bị", "success");
      setAssetName("");
      setAssetAmount("");
      setAssetNote("");
      setAssetWriteOpen(false);
    } catch (error) {
      console.error(error);
      showToast("Lưu thất bại", "error");
    } finally {
      setSavingAsset(false);
    }
  };

  const shareholdersWithInitial = useMemo(
    () =>
      capitalSummary.shares
        .filter((s) => s.initialEntryId)
        .map((s) => s.name),
    [capitalSummary.shares]
  );

  useEffect(() => {
    if (!editName && shareholdersWithInitial[0]) {
      setEditName(shareholdersWithInitial[0]);
    }
  }, [shareholdersWithInitial, editName]);

  useEffect(() => {
    const entry = findInitialEntry(shareholderCapitalEntries, editName);
    if (entry) setEditAmount(String(entry.amount ?? ""));
  }, [editName, shareholderCapitalEntries]);

  const pageTitle = canViewInvestmentCapital
    ? "Vốn & tài sản"
    : "Hàng hóa & thiết bị";
  const pageSubtitle = canViewInvestmentCapital
    ? "Xem sổ trước · bấm để ghi vốn / chi"
    : "Xem tồn tài sản · bấm để nhập mới";

  return (
    <AppShell title={pageTitle} subtitle={pageSubtitle}>
      {canManageShop ? (
        <Link
          href="/manager/inventory"
          className="touch-btn mb-4 h-14 w-full justify-between gap-2 bg-slate-900 px-4 text-white"
        >
          <span className="flex items-center gap-2 text-left">
            <Package className="h-5 w-5 shrink-0" aria-hidden />
            <span>
              <span className="block text-sm font-extrabold">Nhập hàng</span>
              <span className="block text-xs font-medium text-white/75">
                Cập nhật tồn kho món bán (giống quản lý)
              </span>
            </span>
          </span>
          <span className="text-sm text-white/80">Mở →</span>
        </Link>
      ) : null}

      {canViewInvestmentCapital ? (
        <div
          role="tablist"
          className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200"
        >
          {[
            { id: "capital", label: "Vốn cổ đông" },
            { id: "assets", label: "Hàng hóa / TB" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "touch-btn h-12 rounded-xl text-sm",
                tab === item.id
                  ? "bg-brand-700 text-white shadow-sm"
                  : "bg-transparent text-slate-500"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {canViewInvestmentCapital && tab === "capital" ? (
        <>
          <section className="mb-4 grid grid-cols-1 gap-3">
            <StatCard
              label="Tổng đã góp"
              value={loadingCapital ? 0 : capitalSummary.totalContributed}
              tone="brand"
            />
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Đã chi từ vốn"
                value={loadingCapital ? 0 : capitalSummary.totalExpenses}
                tone="muted"
              />
              <StatCard
                label="Số dư vốn"
                value={loadingCapital ? 0 : capitalSummary.totalBalance}
                tone="success"
              />
            </div>
          </section>

          <Link
            href="/manager/expenses"
            className="touch-btn mb-4 h-14 w-full justify-between gap-2 bg-emerald-700 px-4 text-white"
          >
            <span className="flex items-center gap-2 text-left">
              <Wallet className="h-5 w-5 shrink-0" aria-hidden />
              <span>
                <span className="block text-sm font-extrabold">
                  Quỹ cửa hàng
                </span>
                <span className="block text-xs font-medium text-white/80">
                  Xem số dư · nạp · chi tiêu quán
                </span>
              </span>
            </span>
            <span className="text-sm text-white/80">Mở →</span>
          </Link>

          {canManageShareholderCapital ? (
            <div className="mb-4 grid grid-cols-1 gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Ghi sổ vốn
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() =>
                    setCapitalWrite((w) =>
                      w === "contribute" ? null : "contribute"
                    )
                  }
                  className={cn(
                    "touch-btn h-12 justify-start gap-2 px-3 text-sm",
                    capitalWrite === "contribute"
                      ? "bg-emerald-700 text-white"
                      : "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100"
                  )}
                >
                  <Banknote className="h-4 w-4" aria-hidden />
                  Ghi vốn góp
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCapitalWrite((w) => (w === "expense" ? null : "expense"))
                  }
                  className={cn(
                    "touch-btn h-12 justify-start gap-2 px-3 text-sm",
                    capitalWrite === "expense"
                      ? "bg-rose-700 text-white"
                      : "bg-rose-50 text-rose-900 ring-1 ring-rose-100"
                  )}
                >
                  <Wallet className="h-4 w-4" aria-hidden />
                  Chi tiêu vốn
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCapitalWrite((w) => (w === "edit" ? null : "edit"))
                  }
                  className={cn(
                    "touch-btn h-12 justify-start gap-2 px-3 text-sm",
                    capitalWrite === "edit"
                      ? "bg-violet-700 text-white"
                      : "bg-violet-50 text-violet-900 ring-1 ring-violet-100"
                  )}
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                  Sửa vốn ban đầu
                </button>
              </div>
            </div>
          ) : (
            <p className="card-panel mb-4 text-sm text-slate-600">
              Bạn đang xem sổ vốn cổ đông (đã góp · đã chi · số dư · % cổ phần).
              Chỉ tài khoản quản trị được ghi/sửa vốn và chi tiêu vốn.
            </p>
          )}

          {canManageShareholderCapital && capitalWrite === "contribute" ? (
<section className="card-panel mb-4 space-y-4 border-emerald-100 bg-gradient-to-b from-emerald-50/80 to-white">
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCapitalWrite(null)}
                    className="touch-btn h-10 gap-1 rounded-xl bg-white/80 px-3 text-sm text-slate-600 ring-1 ring-slate-200"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Đóng
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Banknote className="h-5 w-5 text-emerald-700" aria-hidden />
                  <h2 className="section-title text-emerald-900">
                    Ghi nhận vốn góp
                  </h2>
                </div>
                <p className="text-xs text-emerald-800/80">
                  Sổ riêng cổ đông — không trộn với thu/chi bán hàng hay nhập
                  hàng quán. % cổ phần tính theo tổng đã góp.
                </p>

                <form onSubmit={saveCapital} className="space-y-3">
                  <PersonPicker
                    mode={capMode}
                    setMode={setCapMode}
                    selectValue={capSelect}
                    setSelectValue={setCapSelect}
                    customValue={capCustom}
                    setCustomValue={setCapCustom}
                    options={shareholderOptions}
                    selectLabel="Cổ đông"
                    customLabel="Tên cổ đông"
                    customPlaceholder="VD: Nguyễn Văn A"
                  />

                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3">
                    <input
                      type="checkbox"
                      checked={capInitial}
                      onChange={(e) => setCapInitial(e.target.checked)}
                      className="h-5 w-5 rounded border-slate-300 text-emerald-700"
                    />
                    <span className="text-sm font-semibold text-slate-800">
                      Đây là vốn đầu tư ban đầu
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Số tiền (VNĐ)
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      className="field-input money"
                      value={capAmount}
                      onChange={(e) => setCapAmount(e.target.value)}
                      placeholder="300000000"
                      required
                    />
                    {capAmount ? (
                      <p className="mt-1.5 text-xs font-medium text-emerald-700">
                        = <Money amount={capAmount} />
                      </p>
                    ) : null}
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Ghi chú
                    </span>
                    <input
                      className="field-input"
                      value={capNote}
                      onChange={(e) => setCapNote(e.target.value)}
                      placeholder="VD: Góp đợt mở quán"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={savingCap}
                    className="touch-btn h-14 w-full bg-emerald-700 text-white"
                  >
                    {savingCap ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Save className="h-5 w-5" aria-hidden />
                    )}
                    {savingCap ? "Đang lưu..." : "Lưu vốn góp"}
                  </button>
                </form>
              </section>
          ) : null}

          {canManageShareholderCapital && capitalWrite === "expense" ? (
<section className="card-panel mb-4 space-y-4 border-rose-100 bg-gradient-to-b from-rose-50/70 to-white">
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCapitalWrite(null)}
                    className="touch-btn h-10 gap-1 rounded-xl bg-white/80 px-3 text-sm text-slate-600 ring-1 ring-slate-200"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Đóng
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-rose-700" aria-hidden />
                  <h2 className="section-title text-rose-900">
                    Chi tiêu từ vốn
                  </h2>
                </div>
                <p className="text-xs text-rose-800/80">
                  Chi từ sổ vốn cổ đông. Bật &quot;Chuyển vào quỹ cửa hàng&quot;
                  để trừ vốn và nạp két quán cùng lúc (không tính doanh thu).
                  Tắt nếu chỉ ghi chi vốn, không đụng quỹ quán.
                </p>

                <form onSubmit={saveExpense} className="space-y-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Ngày chi
                    </span>
                    <input
                      type="date"
                      className="field-input"
                      value={expDate}
                      onChange={(e) => setExpDate(e.target.value)}
                      max={todayInputValue()}
                      required
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Số tiền chi (VNĐ)
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      className="field-input money"
                      value={expAmount}
                      onChange={(e) => setExpAmount(e.target.value)}
                      placeholder="50000000"
                      required
                    />
                    {expAmount ? (
                      <p className="mt-1.5 text-xs font-medium text-rose-700">
                        = <Money amount={expAmount} />
                      </p>
                    ) : null}
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Ghi chú
                    </span>
                    <input
                      className="field-input"
                      value={expNote}
                      onChange={(e) => setExpNote(e.target.value)}
                      placeholder="VD: Chuyển 30tr vào quỹ vận hành"
                    />
                  </label>

                  <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5 accent-emerald-700"
                      checked={expToShopFund}
                      onChange={(e) => setExpToShopFund(e.target.checked)}
                    />
                    <span>
                      <span className="block text-sm font-bold text-emerald-900">
                        Chuyển vào quỹ cửa hàng
                      </span>
                      <span className="mt-0.5 block text-xs text-emerald-800/80">
                        Trừ sổ vốn + tăng số dư tab Quỹ (cùng số tiền). Hỗ trợ
                        tiền mặt và chuyển khoản.
                      </span>
                    </span>
                  </label>

                  {expToShopFund ? (
                    <div>
                      <span className="mb-2 block text-sm font-semibold text-slate-700">
                        Hình thức chuyển vào quỹ
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: "cash", label: "Tiền mặt" },
                          { id: "banking", label: "Chuyển khoản" },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setExpPayMethod(item.id)}
                            className={cn(
                              "touch-btn h-12 rounded-xl text-sm",
                              expPayMethod === item.id
                                ? "bg-emerald-700 text-white"
                                : "bg-slate-100 text-slate-600"
                            )}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <p className="rounded-2xl bg-white/80 px-3 py-2 text-xs text-slate-600">
                    Người gửi:{" "}
                    <span className="font-semibold text-slate-900">
                      {profile?.name ||
                        profile?.username ||
                        user?.email ||
                        "—"}
                    </span>
                  </p>

                  <button
                    type="submit"
                    disabled={savingExp}
                    className="touch-btn h-14 w-full bg-rose-700 text-white"
                  >
                    {savingExp ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Save className="h-5 w-5" aria-hidden />
                    )}
                    {savingExp
                      ? "Đang lưu..."
                      : expToShopFund
                        ? "Chi vốn → nạp quỹ"
                        : "Lưu chi tiêu vốn"}
                  </button>
                </form>
              </section>
          ) : null}

          {canManageShareholderCapital && capitalWrite === "edit" ? (
<section className="card-panel mb-4 space-y-4 border-violet-100 bg-gradient-to-b from-violet-50/70 to-white">
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCapitalWrite(null)}
                    className="touch-btn h-10 gap-1 rounded-xl bg-white/80 px-3 text-sm text-slate-600 ring-1 ring-slate-200"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Đóng
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Pencil className="h-5 w-5 text-violet-700" aria-hidden />
                  <h2 className="section-title text-violet-900">
                    Sửa vốn đầu tư ban đầu
                  </h2>
                </div>
                <p className="text-xs text-violet-800/80">
                  Ghi đè số vốn ban đầu của từng cổ đông. Vẫn thêm vốn góp sau
                  này bình thường.
                </p>

                {shareholdersWithInitial.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Chưa có dòng vốn ban đầu để sửa.
                  </p>
                ) : (
                  <form onSubmit={saveEditInitial} className="space-y-3">
                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">
                        Cổ đông
                      </span>
                      <select
                        className="field-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        required
                      >
                        {shareholdersWithInitial.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">
                        Số vốn ban đầu mới (VNĐ)
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1"
                        className="field-input money"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        required
                      />
                      {editAmount ? (
                        <p className="mt-1.5 text-xs font-medium text-violet-700">
                          = <Money amount={editAmount} />
                        </p>
                      ) : null}
                    </label>

                    <button
                      type="submit"
                      disabled={savingEdit}
                      className="touch-btn h-14 w-full bg-violet-700 text-white"
                    >
                      {savingEdit ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Pencil className="h-5 w-5" aria-hidden />
                      )}
                      {savingEdit ? "Đang lưu..." : "Cập nhật vốn ban đầu"}
                    </button>
                  </form>
                )}
              </section>
          ) : null}

          <section className="card-panel mb-4">
            <h2 className="section-title mb-1">Tỷ lệ cổ phần</h2>
            <p className="mb-3 text-xs text-slate-500">
              Theo tổng vốn đã góp (không trừ chi tiêu).
            </p>

            {loadingCapital ? (
              <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
            ) : pieData.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                Chưa có vốn góp trên sổ cổ đông.
              </div>
            ) : (
              <>
                <CapitalOwnershipChart data={pieData} />

                <ul className="mt-2 space-y-2 border-t border-slate-100 pt-3">
                  {capitalSummary.shares.map((s, index) => (
                    <li
                      key={s.name}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              PIE_COLORS[index % PIE_COLORS.length],
                          }}
                          aria-hidden
                        />
                        <span className="truncate font-medium">{s.name}</span>
                      </span>
                      <span className="money shrink-0 text-right font-bold text-slate-800">
                        {s.percent.toFixed(1)}% ·{" "}
                        <Money amount={s.contributed} />
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-brand-700" aria-hidden />
              <h2 className="section-title">Lịch sử sổ vốn cổ đông</h2>
            </div>

            {canManageShareholderCapital && editingExpense ? (
              <section className="card-panel space-y-3 border-amber-100 bg-gradient-to-b from-amber-50/80 to-white">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Pencil className="h-5 w-5 text-amber-800" aria-hidden />
                    <h3 className="section-title text-amber-950">
                      Sửa chi tiêu vốn
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingExpense(null)}
                    className="touch-btn h-10 gap-1 rounded-xl bg-white px-3 text-sm text-slate-600 ring-1 ring-slate-200"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    Đóng
                  </button>
                </div>

                <form onSubmit={saveEditExpense} className="space-y-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Ngày chi
                    </span>
                    <input
                      type="date"
                      className="field-input"
                      value={editExpDate}
                      onChange={(e) => setEditExpDate(e.target.value)}
                      max={todayInputValue()}
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Số tiền (VNĐ)
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      className="field-input money"
                      value={editExpAmount}
                      onChange={(e) => setEditExpAmount(e.target.value)}
                      required
                    />
                    {editExpAmount ? (
                      <p className="mt-1.5 text-xs font-medium text-amber-800">
                        = <Money amount={editExpAmount} />
                      </p>
                    ) : null}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">
                      Ghi chú
                    </span>
                    <input
                      className="field-input"
                      value={editExpNote}
                      onChange={(e) => setEditExpNote(e.target.value)}
                      placeholder="VD: Chuyển 30tr vào quỹ vận hành"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={savingEditExp || convertingExp}
                    className="touch-btn h-14 w-full bg-slate-900 text-white"
                  >
                    {savingEditExp ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Save className="h-5 w-5" aria-hidden />
                    )}
                    {savingEditExp ? "Đang lưu..." : "Lưu nội dung chi tiêu"}
                  </button>
                </form>

                {editingExpense.toShopFund || editingExpense.shopFundTxId ? (
                  <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-100">
                    Dòng này đã gắn quỹ cửa hàng — không chuyển lần nữa.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <span className="mb-2 block text-sm font-semibold text-slate-700">
                        Hình thức nạp quỹ
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: "cash", label: "Tiền mặt" },
                          { id: "banking", label: "Chuyển khoản" },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setEditExpPayMethod(item.id)}
                            className={cn(
                              "touch-btn h-12 rounded-xl text-sm",
                              editExpPayMethod === item.id
                                ? "bg-emerald-700 text-white"
                                : "bg-slate-100 text-slate-600"
                            )}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={savingEditExp || convertingExp}
                      onClick={convertEditExpenseToFund}
                      className="touch-btn h-14 w-full gap-2 bg-emerald-700 text-white"
                    >
                      {convertingExp ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Wallet className="h-5 w-5" aria-hidden />
                      )}
                      {convertingExp
                        ? "Đang chuyển..."
                        : "Chuyển giao dịch này → quỹ cửa hàng"}
                    </button>
                  </div>
                )}
              </section>
            ) : null}

            {loadingCapital ? (
              <div className="card-panel h-24 animate-pulse bg-white/80" />
            ) : (
              <CapitalHistoryList
                rows={shareholderCapitalEntries}
                emptyText="Chưa có giao dịch trên sổ vốn cổ đông."
                canEditExpense={canManageShareholderCapital}
                onEditExpense={openEditExpense}
              />
            )}
          </section>
        </>
      ) : null}

      {(!canViewInvestmentCapital || tab === "assets") && canManageShop ? (
        <>
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setAssetWriteOpen((o) => !o)}
              className={cn(
                "touch-btn h-12 w-full justify-between gap-2 px-4 text-sm",
                assetWriteOpen
                  ? "bg-brand-700 text-white"
                  : "bg-white text-brand-800 ring-1 ring-brand-100"
              )}
            >
              <span className="flex items-center gap-2">
                <Package className="h-4 w-4" aria-hidden />
                {assetWriteOpen ? "Đóng form nhập" : "Nhập hàng hóa / thiết bị"}
              </span>
              {assetWriteOpen ? (
                <X className="h-4 w-4" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>

          {assetWriteOpen ? (
          <section className="card-panel mb-4 space-y-4">
            <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {!canViewInvestmentCapital
                ? "Nhập hàng hóa/thiết bị quán. Vốn cổ đông chỉ Chủ đầu tư xem được."
                : "Tài sản quán nhập tay — tách với sổ vốn cổ đông."}
            </p>

            <form onSubmit={saveAsset} className="space-y-3">
              <PersonPicker
                mode={assetMode}
                setMode={setAssetMode}
                selectValue={assetSelect}
                setSelectValue={setAssetSelect}
                customValue={assetCustom}
                setCustomValue={setAssetCustom}
                options={assetPersonOptions}
                selectLabel="Nguồn / phụ trách"
                customLabel="Nguồn / phụ trách"
                customPlaceholder="VD: Nhà cung cấp A"
              />

              <div>
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Loại
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "goods", label: "Hàng hóa", icon: Package },
                    { id: "equipment", label: "Thiết bị", icon: Box },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setAssetType(item.id)}
                        className={cn(
                          "touch-btn flex h-12 items-center justify-center gap-2 rounded-xl text-sm",
                          assetType === item.id
                            ? "bg-brand-700 text-white"
                            : "bg-slate-100 text-slate-600"
                        )}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  {assetType === "goods" ? "Tên hàng hóa" : "Tên thiết bị"}
                </span>
                <input
                  className="field-input"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder={
                    assetType === "goods" ? "VD: Trà Thái" : "VD: Tủ lạnh"
                  }
                  required
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Giá trị (VNĐ)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  className="field-input money"
                  value={assetAmount}
                  onChange={(e) => setAssetAmount(e.target.value)}
                  placeholder="5000000"
                  required
                />
                {assetAmount ? (
                  <p className="mt-1.5 text-xs font-medium text-brand-700">
                    = <Money amount={assetAmount} />
                  </p>
                ) : null}
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Ghi chú
                </span>
                <input
                  className="field-input"
                  value={assetNote}
                  onChange={(e) => setAssetNote(e.target.value)}
                  placeholder="Tuỳ chọn"
                />
              </label>

              <button
                type="submit"
                disabled={savingAsset}
                className="touch-btn h-14 w-full bg-brand-700 text-white"
              >
                {savingAsset ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Save className="h-5 w-5" aria-hidden />
                )}
                {savingAsset ? "Đang lưu..." : "Lưu hàng hóa / thiết bị"}
              </button>
            </form>
          </section>
          ) : null}

          <section className="mb-4 grid grid-cols-1 gap-3">
            <StatCard
              label="Tổng hàng hóa & thiết bị"
              value={loadingAssets ? 0 : assets.total}
              tone="brand"
            />
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Hàng hóa"
                value={loadingAssets ? 0 : assets.goods}
                tone="success"
              />
              <StatCard
                label="Thiết bị"
                value={loadingAssets ? 0 : assets.equipment}
                tone="muted"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="section-title">Lịch sử nhập</h2>
            {loadingAssets ? (
              <div className="card-panel h-24 animate-pulse bg-white/80" />
            ) : (
              <AssetHistoryList
                rows={assetRows}
                emptyText="Chưa có hàng hóa / thiết bị."
              />
            )}
          </section>
        </>
      ) : null}
    </AppShell>
  );
}

export default function CapitalPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor"]}>
      <CapitalContent />
    </ProtectedRoute>
  );
}
