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
import { actorFields, formatActorLabel } from "@/lib/audit";
import {
  createInvestment,
  isAssetInvestment,
  investmentTypeLabel,
  listCapitalInvestments,
  subscribeInvestments,
  summarizeAssets,
  summarizeInitialCapital,
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

function HistoryList({ rows, emptyText, showInitialBadge }) {
  if (!rows.length) {
    return <div className="card-panel text-sm text-slate-500">{emptyText}</div>;
  }

  return rows.map((row) => (
    <article key={row.id} className="card-panel space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-900">{row.investorName}</p>
          <p className="text-xs text-slate-500">{formatInvestmentDate(row)}</p>
        </div>
        <p className="money shrink-0 text-base font-extrabold text-brand-800">
          <Money amount={row.amount} />
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className={cn("chip", typeChipClass(row.type))}>
          {investmentTypeLabel(row.type)}
        </span>
        {showInitialBadge && row.isInitial ? (
          <span className="chip bg-violet-50 text-violet-800 ring-1 ring-violet-100">
            Vốn ban đầu
          </span>
        ) : null}
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

function CapitalContent() {
  const { user, profile, canManageShop, canViewInvestmentCapital } = useAuth();
  const { showToast } = useToast();

  const [investments, setInvestments] = useState([]);
  const [investorOptions, setInvestorOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(
    canViewInvestmentCapital ? "capital" : "assets"
  );

  // Form vốn đầu tư
  const [capMode, setCapMode] = useState("select");
  const [capSelect, setCapSelect] = useState("");
  const [capCustom, setCapCustom] = useState("");
  const [capAmount, setCapAmount] = useState("");
  const [capNote, setCapNote] = useState("");
  const [capInitial, setCapInitial] = useState(true);
  const [savingCap, setSavingCap] = useState(false);

  // Form hàng hóa / thiết bị
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
          .filter(
            (u) =>
              u.role === "investor" ||
              u.role === "manager" ||
              u.role === "superadmin"
          )
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

  const capitalRows = useMemo(
    () => listCapitalInvestments(investments),
    [investments]
  );
  const assetRows = useMemo(
    () => (investments || []).filter(isAssetInvestment),
    [investments]
  );

  const { total, shares } = useMemo(
    () => summarizeInvestments(investments),
    [investments]
  );
  const initialCap = useMemo(
    () => summarizeInitialCapital(investments),
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

  const saveCapital = async (e) => {
    e.preventDefault();
    if (!canViewInvestmentCapital) {
      showToast("Bạn không có quyền ghi nhận vốn đầu tư", "error");
      return;
    }

    const investorName =
      capMode === "custom" ? capCustom.trim() : capSelect.trim();
    if (!investorName) {
      showToast("Chọn hoặc nhập tên cổ đông", "error");
      return;
    }
    if (!capAmount || Number(capAmount) <= 0) {
      showToast("Nhập số tiền đầu tư hợp lệ", "error");
      return;
    }

    setSavingCap(true);
    try {
      const actor = actorFields(user, profile);
      await createInvestment({
        investorName,
        type: "cash",
        amount: capAmount,
        note: capNote,
        isInitial: capInitial,
        ...actor,
      });
      showToast(
        capInitial
          ? "Đã ghi nhận vốn đầu tư ban đầu"
          : "Đã ghi nhận vốn đầu tư thêm",
        "success"
      );
      setCapAmount("");
      setCapNote("");
    } catch (error) {
      console.error(error);
      showToast("Lưu vốn đầu tư thất bại", "error");
    } finally {
      setSavingCap(false);
    }
  };

  const saveAsset = async (e) => {
    e.preventDefault();
    if (!canManageShop) {
      showToast("Bạn không có quyền nhập hàng hóa / thiết bị", "error");
      return;
    }

    const investorName =
      assetMode === "custom" ? assetCustom.trim() : assetSelect.trim();
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
    } catch (error) {
      console.error(error);
      showToast("Lưu thất bại", "error");
    } finally {
      setSavingAsset(false);
    }
  };

  const pageTitle = canViewInvestmentCapital ? "Vốn & tài sản" : "Hàng hóa & thiết bị";
  const pageSubtitle = canViewInvestmentCapital
    ? "Ghi nhận vốn đầu tư · Cổ phần · Hàng hóa / thiết bị"
    : "Nhập hàng hóa · Thiết bị (không gồm tiền đầu tư)";

  return (
    <AppShell title={pageTitle} subtitle={pageSubtitle}>
      {canViewInvestmentCapital ? (
        <div
          role="tablist"
          className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200"
        >
          {[
            { id: "capital", label: "Vốn đầu tư" },
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

      {/* —— TAB / KHỐI VỐN ĐẦU TƯ —— */}
      {canViewInvestmentCapital && tab === "capital" ? (
        <>
          <section className="card-panel mb-4 space-y-4 border-emerald-100 bg-gradient-to-b from-emerald-50/80 to-white">
            <div className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-emerald-700" aria-hidden />
              <h2 className="section-title text-emerald-900">
                Ghi nhận vốn đầu tư
              </h2>
            </div>
            <p className="text-xs text-emerald-800/80">
              Nhập tiền góp của cổ đông (vốn ban đầu hoặc góp thêm). Dùng để tính
              tỷ lệ cổ phần và chia cổ tức. Quản lý quán không xem được mục này.
            </p>

            <form onSubmit={saveCapital} className="space-y-3">
              <PersonPicker
                mode={capMode}
                setMode={setCapMode}
                selectValue={capSelect}
                setSelectValue={setCapSelect}
                customValue={capCustom}
                setCustomValue={setCapCustom}
                options={investorOptions}
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
                  Số tiền đầu tư (VNĐ)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  className="field-input money"
                  value={capAmount}
                  onChange={(e) => setCapAmount(e.target.value)}
                  placeholder="50000000"
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
                  placeholder="VD: Góp đợt 1 mở quán"
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
                {savingCap ? "Đang lưu..." : "Lưu vốn đầu tư"}
              </button>
            </form>
          </section>

          <section className="mb-4 grid grid-cols-1 gap-3">
            <StatCard
              label="Tổng vốn đầu tư"
              value={loading ? 0 : total}
              tone="brand"
            />
            <StatCard
              label="Trong đó vốn ban đầu"
              value={loading ? 0 : initialCap.total}
              tone="success"
            />
          </section>

          <section className="card-panel mb-4">
            <h2 className="section-title mb-1">Tỷ lệ cổ phần</h2>
            <p className="mb-3 text-xs text-slate-500">
              Tính theo tổng tiền đầu tư đã ghi nhận.
            </p>

            {loading ? (
              <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
            ) : pieData.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                Chưa có vốn đầu tư. Hãy ghi nhận ở form phía trên.
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
                            backgroundColor:
                              PIE_COLORS[index % PIE_COLORS.length],
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
            <div className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-brand-700" aria-hidden />
              <h2 className="section-title">Lịch sử vốn đầu tư</h2>
            </div>
            {loading ? (
              <div className="card-panel h-24 animate-pulse bg-white/80" />
            ) : (
              <HistoryList
                rows={capitalRows}
                emptyText="Chưa có lần ghi nhận vốn đầu tư nào."
                showInitialBadge
              />
            )}
          </section>
        </>
      ) : null}

      {/* —— HÀNG HÓA / THIẾT BỊ —— */}
      {(!canViewInvestmentCapital || tab === "assets") && canManageShop ? (
        <>
          <section className="card-panel mb-4 space-y-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-brand-700" aria-hidden />
              <h2 className="section-title">Nhập hàng hóa / thiết bị</h2>
            </div>
            {!canViewInvestmentCapital ? (
              <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Bạn kiểm soát dòng tiền quán và nhập hàng hóa/thiết bị. Tiền đầu
                tư của cổ đông chỉ Chủ đầu tư / Super Admin xem được.
              </p>
            ) : null}

            <form onSubmit={saveAsset} className="space-y-3">
              <PersonPicker
                mode={assetMode}
                setMode={setAssetMode}
                selectValue={assetSelect}
                setSelectValue={setAssetSelect}
                customValue={assetCustom}
                setCustomValue={setAssetCustom}
                options={investorOptions}
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
                          "touch-btn h-14 gap-2 border",
                          assetType === item.id
                            ? item.id === "goods"
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

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">
                  {assetType === "goods" ? "Tên hàng hóa" : "Tên thiết bị"}
                </span>
                <input
                  className="field-input"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder={
                    assetType === "goods"
                      ? "VD: Trà, ly, đường"
                      : "VD: Tủ lạnh, bàn ghế"
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
                  placeholder="2000000"
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

          <section className="space-y-3">
            <h2 className="section-title">Lịch sử nhập</h2>
            {loading ? (
              <div className="card-panel h-24 animate-pulse bg-white/80" />
            ) : (
              <HistoryList
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
