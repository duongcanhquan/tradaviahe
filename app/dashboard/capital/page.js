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
  subscribeInvestments,
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

function CapitalContent() {
  const { user, isManager } = useAuth();
  const { showToast } = useToast();

  const [investments, setInvestments] = useState([]);
  const [investorOptions, setInvestorOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [investorMode, setInvestorMode] = useState("select"); // select | custom
  const [investorSelect, setInvestorSelect] = useState("");
  const [investorCustom, setInvestorCustom] = useState("");
  const [type, setType] = useState("cash");
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
        showToast("Không tải được danh sách vốn góp", "error");
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
          .map((u) => u.name || u.email)
          .filter(Boolean);
        setInvestorOptions([...new Set(names)].sort((a, b) => a.localeCompare(b, "vi")));
      },
      () => setInvestorOptions([])
    );
    return () => unsub();
  }, []);

  const { total, shares } = useMemo(
    () => summarizeInvestments(investments),
    [investments]
  );

  const pieData = useMemo(
    () =>
      shares.map((s) => ({
        name: s.name,
        value: s.value,
        percent: s.percent,
      })),
    [shares]
  );

  const resetForm = () => {
    setType("cash");
    setEquipmentName("");
    setAmount("");
    setNote("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const investorName =
      investorMode === "custom" ? investorCustom.trim() : investorSelect.trim();

    if (!investorName) {
      showToast("Chọn hoặc nhập tên cổ đông", "error");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      showToast("Nhập giá trị / số tiền hợp lệ", "error");
      return;
    }
    if (type === "equipment" && !equipmentName.trim()) {
      showToast("Nhập tên thiết bị", "error");
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
      showToast("Đã lưu vốn góp", "success");
      resetForm();
    } catch (error) {
      console.error(error);
      showToast("Lưu vốn góp thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="Vốn góp" subtitle="Cổ phần · Tiền mặt · Thiết bị">
      {isManager ? (
        <section className="card-panel mb-4 space-y-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-brand-700" aria-hidden />
            <h2 className="section-title">Nhập vốn góp</h2>
          </div>

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
                  Cổ đông
                </span>
                <select
                  className="field-input"
                  value={investorSelect}
                  onChange={(e) => setInvestorSelect(e.target.value)}
                  required={investorMode === "select"}
                >
                  <option value="">— Chọn cổ đông —</option>
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
                  Tên cổ đông
                </span>
                <input
                  className="field-input"
                  value={investorCustom}
                  onChange={(e) => setInvestorCustom(e.target.value)}
                  placeholder="VD: Nguyễn Văn A"
                  required={investorMode === "custom"}
                />
              </label>
            )}

            <div>
              <span className="mb-2 block text-sm font-semibold text-slate-700">
                Hình thức góp
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType("cash")}
                  className={cn(
                    "touch-btn h-14 gap-2 border",
                    type === "cash"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-500"
                  )}
                >
                  <Banknote className="h-5 w-5" aria-hidden />
                  Tiền mặt
                </button>
                <button
                  type="button"
                  onClick={() => setType("equipment")}
                  className={cn(
                    "touch-btn h-14 gap-2 border",
                    type === "equipment"
                      ? "border-amber-600 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-white text-slate-500"
                  )}
                >
                  <Box className="h-5 w-5" aria-hidden />
                  Thiết bị
                </button>
              </div>
            </div>

            {type === "equipment" ? (
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  Tên thiết bị
                </span>
                <input
                  className="field-input"
                  value={equipmentName}
                  onChange={(e) => setEquipmentName(e.target.value)}
                  placeholder="VD: Tủ lạnh, Bàn ghế"
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
              {saving ? "Đang lưu..." : "Lưu vốn góp"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="mb-4">
        <StatCard
          label="Tổng vốn đầu tư"
          value={loading ? 0 : total}
          tone="brand"
        />
      </section>

      <section className="card-panel mb-4">
        <h2 className="section-title mb-1">Tỷ lệ cổ phần</h2>
        <p className="mb-3 text-xs text-slate-500">
          Tính theo tổng giá trị đã góp (tiền mặt + thiết bị quy đổi).
        </p>

        {loading ? (
          <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
        ) : pieData.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            Chưa có dữ liệu vốn góp.
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

      <section className="space-y-3">
        <h2 className="section-title">Lịch sử góp vốn</h2>
        {loading ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : investments.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Chưa có lần góp vốn nào.
          </div>
        ) : (
          investments.map((row) => (
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
                <span
                  className={cn(
                    "chip",
                    row.type === "equipment"
                      ? "bg-amber-50 text-amber-800 ring-1 ring-amber-100"
                      : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
                  )}
                >
                  {row.type === "equipment" ? "Thiết bị" : "Tiền mặt"}
                </span>
                {row.type === "equipment" && row.equipmentName ? (
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
