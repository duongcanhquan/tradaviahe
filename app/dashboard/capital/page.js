'use client';

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { format } from "date-fns";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import {
  Banknote,
  Box,
  Landmark,
  Loader2,
  Package,
  Save,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import {
  createInvestment,
  filterInvestmentsForRole,
  investmentTypeLabel,
  subscribeInvestments,
  summarizeAssets,
  summarizeInvestments,
} from "@/lib/investments";
import { cn, formatCurrency } from "@/lib/utils";

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

function formatInvestmentDate(row) {
  const ms = row.date?.toMillis?.() ?? row.createdAt?.toMillis?.();
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

function CapitalContent() {
  const { user, canManageShop, canViewInvestmentCapital } = useAuth();
  const { showToast } = useToast();

  const [investments, setInvestments] = useState([]);
  const [investorOptions, setInvestorOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [investorMode, setInvestorMode] = useState("select");
  const [investorSelect, setInvestorSelect] = useState("");
  const [investorCustom, setInvestorCustom] = useState("");
  const [type, setType] = useState(
    canViewInvestmentCapital ? "cash" : "goods"
  );
  const [equipmentName, setEquipmentName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const unsub = subscribeInvestments(
      (list) => {
        setInvestments(list);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được danh sách", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const names = snap.docs
          .map((d) => d.data())
          .filter((u) => u.role === "investor" || u.role === "manager")
          .map((u) => u.name || u.username || u.email)
          .filter(Boolean);
        setInvestorOptions(
          [...new Set(names)].sort((a, b) => a.localeCompare(b, "vi"))
        );
      },
      () => setInvestorOptions([])
    );
    return () => unsub();
  }, []);

  const visibleRows = useMemo(
    () =>
      filterInvestmentsForRole(investments, {
        canViewCapital: canViewInvestmentCapital,
      }),
    [canViewInvestmentCapital, investments]
  );

  const { total, shares } = useMemo(
    () => summarizeInvestments(investments),
    [investments]
  );

  const assets = useMemo(() => summarizeAssets(investments), [investments]);

  const pieData = useMemo(
    () =>
      shares.map((s) => ({
        name: s.name,
        value: s.value,
        percent: s.percent,
      })),
    [shares]
  );

  const typeOptions = canViewInvestmentCapital
    ? [
        { id: "cash", label: "Tiền đầu tư", icon: Banknote },
        { id: "goods", label: "Hàng hóa", icon: Package },
        { id: "equipment", label: "Thiết bị", icon: Box },
      ]
    : [
        { id: "goods", label: "Hàng hóa", icon: Package },
        { id: "equipment", label: "Thiết bị", icon: Box },
      ];

  const resetForm = () => {
    setType(canViewInvestmentCapital ? "cash" : "goods");
    setEquipmentName("");
    setAmount("");
    setNote("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!canViewInvestmentCapital && type === "cash") {
      showToast("Quản lý không được nhập tiền đầu tư", "error");
      return;
    }

    const investorName =
      investorMode === "custom" ? investorCustom.trim() : investorSelect.trim();

    if (!investorName) {
      showToast(
        type === "cash"
          ? "Chọn hoặc nhập tên cổ đông"
          : "Nhập nguồn / người phụ trách",
        "error"
      );
      return;
    }
    if (!amount || Number(amount) <= 0) {
      showToast("Nhập giá trị / số tiền hợp lệ", "error");
      return;
    }
    if ((type === "equipment" || type === "goods") && !equipmentName.trim()) {
      showToast(
        type === "goods" ? "Nhập tên hàng hóa" : "Nhập tên thiết bị",
        "error"
      );
      return;
    }

    setSaving(true);
    try {
      await createInvestment({
        investorName,
        type,
        amount,
        equipmentName,
        note,
        createdBy: user.uid,
      });
      showToast(
        type === "cash" ? "Đã lưu tiền đầu tư" : "Đã lưu hàng hóa / thiết bị",
        "success"
      );
      resetForm();
    } catch (error) {
      console.error(error);
      showToast("Lưu thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  const pageTitle = canViewInvestmentCapital ? "Vốn góp" : "Hàng hóa & thiết bị";
  const pageSubtitle = canViewInvestmentCapital
    ? "Tiền đầu tư · Hàng hóa · Thiết bị · Cổ phần"
    : "Nhập hàng hóa · Thiết bị (không gồm tiền đầu tư)";

  return (
    <AppShell title={pageTitle} subtitle={pageSubtitle}>
      {canManageShop ? (
        <section className="card-panel mb-4 space-y-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-brand-700" aria-hidden />
            <h2 className="section-title">
              {canViewInvestmentCapital
                ? "Nhập vốn / tài sản"
                : "Nhập hàng hóa / thiết bị"}
            </h2>
          </div>

          {!canViewInvestmentCapital ? (
            <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Bạn kiểm soát dòng tiền quán và nhập hàng hóa/thiết bị. Tiền đầu
              tư của cổ đông chỉ Chủ đầu tư / Super Admin xem được.
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
              {[
                { id: "select", label: "Chọn có sẵn" },
                { id: "custom", label: "Nhập tay" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setInvestorMode(item.id)}
                  className={cn(
                    "touch-btn h-11 rounded-xl text-sm",
                    investorMode === item.id
                      ? "bg-white text-brand-800 shadow-sm"
                      : "text-slate-500"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {investorMode === "select" ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  {type === "cash" ? "Cổ đông" : "Nguồn / phụ trách"}
                </span>
                <select
                  className="field-input"
                  value={investorSelect}
                  onChange={(e) => setInvestorSelect(e.target.value)}
                  required={investorMode === "select"}
                >
                  <option value="">— Chọn —</option>
                  {investorOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  {type === "cash" ? "Tên cổ đông" : "Nguồn / phụ trách"}
                </span>
                <input
                  className="field-input"
                  value={investorCustom}
                  onChange={(e) => setInvestorCustom(e.target.value)}
                  placeholder={
                    type === "cash" ? "VD: Nguyễn Văn A" : "VD: Nhà cung cấp A"
                  }
                  required={investorMode === "custom"}
                />
              </label>
            )}

            <div>
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Loại
              </span>
              <div
                className={cn(
                  "grid gap-2",
                  typeOptions.length === 3 ? "grid-cols-3" : "grid-cols-2"
                )}
              >
                {typeOptions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setType(item.id)}
                      className={cn(
                        "touch-btn h-14 flex-col gap-1 border px-2 text-xs sm:text-sm",
                        type === item.id
                          ? item.id === "cash"
                            ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                            : item.id === "goods"
                              ? "border-sky-600 bg-sky-50 text-sky-800"
                              : "border-amber-600 bg-amber-50 text-amber-800"
                          : "border-slate-200 bg-white text-slate-500"
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {type === "equipment" || type === "goods" ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  {type === "goods" ? "Tên hàng hóa" : "Tên thiết bị"}
                </span>
                <input
                  className="field-input"
                  value={equipmentName}
                  onChange={(e) => setEquipmentName(e.target.value)}
                  placeholder={
                    type === "goods"
                      ? "VD: Trà, ly, đường"
                      : "VD: Tủ lạnh, bàn ghế"
                  }
                  required
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Giá trị / Số tiền (VNĐ)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                className="field-input money"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5000000"
                required
              />
              {amount ? (
                <p className="mt-1.5 text-xs font-medium text-brand-700">
                  = <Money amount={amount} />
                </p>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Ghi chú
              </span>
              <input
                className="field-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Tuỳ chọn"
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="touch-btn h-14 w-full bg-brand-700 text-white"
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Save className="h-5 w-5" aria-hidden />
              )}
              {saving ? "Đang lưu..." : "Lưu"}
            </button>
          </form>
        </section>
      ) : null}

      {canViewInvestmentCapital ? (
        <section className="mb-4">
          <StatCard
            label="Tổng tiền đầu tư"
            value={loading ? 0 : total}
            tone="brand"
          />
        </section>
      ) : (
        <section className="mb-4 grid grid-cols-1 gap-3">
          <StatCard
            label="Tổng hàng hóa & thiết bị"
            value={loading ? 0 : assets.total}
            tone="brand"
          />
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Hàng hóa"
              value={loading ? 0 : assets.goods}
              tone="success"
            />
            <StatCard
              label="Thiết bị"
              value={loading ? 0 : assets.equipment}
              tone="muted"
            />
          </div>
        </section>
      )}

      {canViewInvestmentCapital ? (
        <section className="card-panel mb-4">
          <h2 className="section-title mb-1">Tỷ lệ cổ phần</h2>
          <p className="mb-3 text-xs text-slate-500">
            Tính theo tiền đầu tư (không gồm hàng hóa / thiết bị).
          </p>

          {loading ? (
            <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
          ) : pieData.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Chưa có tiền đầu tư.
            </div>
          ) : (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={88}
                      paddingAngle={2}
                    >
                      {pieData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name, props) => [
                        `${formatCurrency(value)} (${(props?.payload?.percent || 0).toFixed(1)}%)`,
                        name,
                      ]}
                    />
                    <Legend
                      verticalAlign="bottom"
                      formatter={(value) => (
                        <span className="text-xs text-slate-700">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <ul className="mt-2 space-y-2 border-t border-slate-100 pt-3">
                {shares.map((s, index) => (
                  <li
                    key={s.name}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{
                          backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                        }}
                        aria-hidden
                      />
                      <span className="truncate font-medium">{s.name}</span>
                    </span>
                    <span className="money shrink-0 font-bold text-slate-800">
                      {s.percent.toFixed(1)}% · <Money amount={s.value} />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      {canViewInvestmentCapital ? (
        <section className="mb-4 grid grid-cols-1 gap-3">
          <StatCard
            label="Hàng hóa & thiết bị (tài sản quán)"
            value={loading ? 0 : assets.total}
            tone="success"
          />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="section-title">
          {canViewInvestmentCapital ? "Lịch sử góp vốn & tài sản" : "Lịch sử nhập"}
        </h2>
        {loading ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : visibleRows.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            {canViewInvestmentCapital
              ? "Chưa có lần góp vốn nào."
              : "Chưa có hàng hóa / thiết bị."}
          </div>
        ) : (
          visibleRows.map((row) => (
            <article key={row.id} className="card-panel space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900">
                    {row.investorName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatInvestmentDate(row)}
                  </p>
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
              {row.note ? (
                <p className="text-xs text-slate-500">{row.note}</p>
              ) : null}
            </article>
          ))
        )}
      </section>
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
