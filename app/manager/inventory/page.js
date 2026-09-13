'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  Loader2,
  Package,
  Plus,
  Save,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, StatCard } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { receiveInventoryPaid, previewInventoryFundBackfill, backfillInventoryFundFromStock } from "@/lib/expenses";
import { subscribeCollection } from "@/lib/liveCollection";
import { db } from "@/lib/firebase";
import { defaultReceiveUnit, deriveReceiveCostUpdate, findUnit, normalizeProductUnits } from "@/lib/packaging";
import {
  DEFAULT_PRODUCT_GROUPS,
  ensureDefaultProductGroups,
  subscribeProductGroups,
} from "@/lib/productGroups";
import {
  COST_MODE,
  PRODUCT_KIND,
  PRODUCT_UNITS,
  createProduct,
  isSellable,
  recomputeRecipeCosts,
  subscribeProducts,
} from "@/lib/products";
import { lineStockCostValue, summarizeInventory } from "@/lib/stock";
import { cn, formatCurrency } from "@/lib/utils";

/** Parse số tiền/giá nhập — giữ thập phân (0.5), bỏ khoảng trắng. */
function parseUnitCostInput(raw) {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/,/g, ".");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatUnitCount(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

const emptyForm = () => ({
  kind: PRODUCT_KIND.INGREDIENT,
  name: "",
  unit: "g",
  inStock: "",
  cost: "",
  price: "",
  groupId: "",
});

function InventoryContent() {
  const { showToast } = useToast();
  const { user, profile, canChooseInventoryFundSource } = useAuth();
  const [products, setProducts] = useState([]);
  const [groups, setGroups] = useState(DEFAULT_PRODUCT_GROUPS);
  const [filter, setFilter] = useState("ingredient"); // all | ingredient | finished | groupId
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [savingAdd, setSavingAdd] = useState(false);

  /** per product: { addQty, cost, payMethod, fundSource } */
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [allTx, setAllTx] = useState([]);
  const [backfillPay, setBackfillPay] = useState("cash");
  const [backfilling, setBackfilling] = useState(false);

  useEffect(() => {
    ensureDefaultProductGroups().catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = subscribeProductGroups(
      (rows) => {
        const active = rows.filter((g) => g.active !== false);
        setGroups(active.length ? active : DEFAULT_PRODUCT_GROUPS);
      },
      () => setGroups(DEFAULT_PRODUCT_GROUPS)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeProducts(
      (list) => {
        setProducts(list.filter((p) => p.active !== false));
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được hàng hóa", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = subscribeCollection(
      "transactions",
      (rows) => setAllTx(rows),
      () => setAllTx([])
    );
    return () => unsub();
  }, []);

  const backfillPreview = useMemo(
    () => previewInventoryFundBackfill(products, allTx),
    [products, allTx]
  );

  const visible = useMemo(() => {
    if (filter === "all") return products;
    if (filter === "ingredient") {
      return products.filter((p) => p.kind === PRODUCT_KIND.INGREDIENT);
    }
    if (filter === "finished") {
      return products.filter((p) => isSellable(p));
    }
    return products.filter((p) => p.groupId === filter);
  }, [products, filter]);

  const inventorySummary = useMemo(
    () => summarizeInventory(visible),
    [visible]
  );

  const allInventorySummary = useMemo(
    () => summarizeInventory(products),
    [products]
  );

  const setDraft = (id, patch) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        addQty: "",
        cost: "",
        payMethod: "cash",
        fundSource: "shop",
        ...prev[id],
        ...patch,
      },
    }));
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast("Nhập tên món / nguyên liệu", "error");
      return;
    }
    const qty = Number(form.inStock) || 0;
    const cost = parseUnitCostInput(form.cost);
    const price =
      form.kind === PRODUCT_KIND.FINISHED
        ? parseUnitCostInput(form.price)
        : 0;

    setSavingAdd(true);
    try {
      await createProduct({
        name: form.name.trim(),
        kind: form.kind,
        unit: form.unit || "cái",
        inStock: qty,
        cost,
        costMode: COST_MODE.MANUAL,
        price,
        groupId:
          form.kind === PRODUCT_KIND.FINISHED && form.groupId
            ? form.groupId
            : null,
        recipe: [],
        active: true,
      });
      showToast(
        `Đã thêm “${form.name.trim()}” · tồn ${qty} · giá nhập ${formatCurrency(cost)}`,
        "success"
      );
      setForm(emptyForm());
      setShowAdd(false);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Thêm món thất bại", "error");
    } finally {
      setSavingAdd(false);
    }
  };

  const handleReceive = async (product) => {
    const d = drafts[product.id] || {};
    const addQty = Number(d.addQty) || 0;
    const selectedUnit = findUnit(product, d.unitId) || defaultReceiveUnit(product);
    const hasCost = d.cost !== undefined && String(d.cost).trim() !== "";
    const nextCost = hasCost
      ? parseUnitCostInput(d.cost)
      : Math.round(Number(selectedUnit?.sellCost) || Number(product.cost) || 0);
    const payMethod = d.payMethod === "banking" ? "banking" : "cash";
    const fundSource =
      canChooseInventoryFundSource && d.fundSource === "capital"
        ? "capital"
        : "shop";

    if (addQty <= 0 && !hasCost) {
      showToast("Nhập số lượng nhập thêm hoặc giá nhập mới", "error");
      return;
    }

    if (addQty > 0 && nextCost <= 0) {
      showToast("Nhập giá nhập > 0 để trừ quỹ (TM/CK)", "error");
      return;
    }

    if (addQty > 0 && !selectedUnit) {
      showToast("Đơn vị nhập không hợp lệ", "error");
      return;
    }

    setSavingId(product.id);
    try {
      if (addQty > 0) {
        const result = await receiveInventoryPaid({
          fundSource,
          product,
          addQty,
          unitId: selectedUnit?.id,
          unitCost: nextCost,
          paymentMethod: payMethod,
          updateCost: true, // last-purchase always
          user,
          profile,
        });
        await recomputeRecipeCosts();
        const via = result.paymentMethod === "banking" ? "CK" : "TM";
        const fundLabel =
          result.fundSource === "capital" ? "quỹ đầu tư" : "quỹ cửa hàng";
        showToast(
          `Đã nhập +${result.qty} · trừ ${fundLabel} ${via} ${formatCurrency(result.amount)}` +
            (result.unitReceivePrice != null
              ? ` · ĐG gốc ${formatCurrency(
                  Math.round(
                    result.amount / Math.max(1, Number(result.baseQty) || 1)
                  )
                )}`
              : ""),
          "success"
        );
      } else {
        const payload = {
          updatedAt: serverTimestamp(),
        };
        if (hasCost) {
          payload.cost = nextCost;
          if (product.kind === PRODUCT_KIND.INGREDIENT) {
            payload.costMode = COST_MODE.MANUAL;
          } else if (product.costMode !== COST_MODE.RECIPE) {
            payload.costMode = COST_MODE.MANUAL;
          }
        }
        await updateDoc(doc(db, "products", product.id), payload);
        if (hasCost) {
          await recomputeRecipeCosts();
        }
        showToast(`Đã cập nhật giá nhập · ${product.name}`, "success");
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Nhập hàng thất bại", "error");
    } finally {
      setSavingId(null);
    }
  };

  const handleBackfill = async () => {
    if (backfillPreview.suggested <= 0 || backfillPreview.backfillDone) return;
    const via = backfillPay === "banking" ? "CK" : "TM";
    const ok = window.confirm(
      `Bù trừ quỹ ${via} ${formatCurrency(backfillPreview.suggested)}?\n\n` +
        `Giá trị tồn hiện tại: ${formatCurrency(backfillPreview.stockValue)}\n` +
        `Chi nhập hàng đã ghi: ${formatCurrency(backfillPreview.alreadyCharged)}\n\n` +
        `Đơn nhập cũ không có sổ — hệ thống trừ phần còn thiếu theo tồn × giá nhập.`
    );
    if (!ok) return;

    setBackfilling(true);
    try {
      const result = await backfillInventoryFundFromStock({
        products,
        transactions: allTx,
        paymentMethod: backfillPay,
        user,
        profile,
      });
      showToast(
        `Đã bù trừ quỹ ${via} ${formatCurrency(result.amount)}`,
        "success"
      );
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Bù trừ thất bại", "error");
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <AppShell
      title="Nhập hàng"
      subtitle="Tồn kho · giá nhập · giá trị"
      dense
    >
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        Quản lý nhập hàng luôn trừ <strong>quỹ cửa hàng</strong> (TM/CK). Admin /
        Super Admin chọn trừ quỹ cửa hàng hoặc <strong>quỹ đầu tư</strong>. Số
        tiền = SL × giá nhập. Setup công thức &amp; giá bán:{" "}
        <Link
          href="/manager/products"
          className="font-bold text-brand-800 underline"
        >
          Món · giá
        </Link>
        .
      </p>

      {!loading && !backfillPreview.backfillDone && backfillPreview.stockValue > 0 ? (
        <section className="mb-4 space-y-3 rounded-[1.25rem] bg-amber-50 px-4 py-4 ring-1 ring-amber-200">
          <div>
            <p className="text-sm font-extrabold text-amber-950">
              Bù trừ quỹ cho tồn / nhập cũ
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
              Trước đây nhập hàng chỉ cộng tồn, không trừ quỹ. Không còn sổ từng
              đơn — hệ thống ước lượng:{" "}
              <strong>giá trị tồn hiện tại − chi “Nhập hàng” đã ghi</strong>.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-xl bg-white/80 px-2.5 py-2">
              <p className="font-semibold text-slate-500">Giá trị tồn</p>
              <p className="money font-extrabold text-slate-900">
                <Money amount={backfillPreview.stockValue} />
              </p>
            </div>
            <div className="rounded-xl bg-white/80 px-2.5 py-2">
              <p className="font-semibold text-slate-500">Đã chi nhập</p>
              <p className="money font-extrabold text-slate-900">
                <Money amount={backfillPreview.alreadyCharged} />
              </p>
            </div>
            <div className="rounded-xl bg-rose-100 px-2.5 py-2">
              <p className="font-semibold text-rose-700">Cần bù trừ</p>
              <p className="money font-extrabold text-rose-800">
                <Money amount={backfillPreview.suggested} />
              </p>
            </div>
          </div>
          {backfillPreview.suggested > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBackfillPay("cash")}
                  className={cn(
                    "touch-btn h-10 text-xs font-extrabold",
                    backfillPay === "cash"
                      ? "bg-emerald-600 text-white"
                      : "bg-white text-slate-700 ring-1 ring-slate-200"
                  )}
                >
                  Tiền mặt
                </button>
                <button
                  type="button"
                  onClick={() => setBackfillPay("banking")}
                  className={cn(
                    "touch-btn h-10 text-xs font-extrabold",
                    backfillPay === "banking"
                      ? "bg-brand-700 text-white"
                      : "bg-white text-slate-700 ring-1 ring-slate-200"
                  )}
                >
                  Chuyển khoản
                </button>
              </div>
              <button
                type="button"
                disabled={backfilling}
                onClick={handleBackfill}
                className="touch-btn h-12 w-full gap-2 bg-rose-700 text-sm text-white disabled:opacity-50"
              >
                {backfilling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {backfilling
                  ? "Đang bù trừ..."
                  : `Bù trừ quỹ ${formatCurrency(backfillPreview.suggested)}`}
              </button>
            </>
          ) : (
            <p className="text-xs font-semibold text-emerald-800">
              Đã ghi đủ chi nhập hàng so với giá trị tồn — không cần bù.
            </p>
          )}
        </section>
      ) : null}

      {backfillPreview.backfillDone ? (
        <p className="mb-4 rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-100">
          Đã bù trừ tồn/nhập cũ vào quỹ. Lần nhập mới sẽ tự trừ khi chọn TM/CK.
        </p>
      ) : null}

      <section className="mb-4 grid grid-cols-1 gap-2">
        <StatCard
          label={
            filter === "all"
              ? "Tổng giá trị tồn (giá nhập)"
              : "Giá trị tồn (theo bộ lọc)"
          }
          value={loading ? 0 : inventorySummary.costValue}
          tone="brand"
        />
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-slate-800 px-3 py-3 text-white shadow-md">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
              Số món
            </p>
            <p className="mt-1 text-2xl font-extrabold leading-none">
              {loading ? "—" : inventorySummary.skuCount}
            </p>
          </div>
          <div className="rounded-2xl bg-emerald-700 px-3 py-3 text-white shadow-md">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
              Tổng SL tồn
            </p>
            <p className="mt-1 text-2xl font-extrabold leading-none">
              {loading ? "—" : inventorySummary.totalQty}
            </p>
          </div>
          <div className="rounded-2xl bg-rose-700 px-3 py-3 text-white shadow-md">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
              Sắp hết ≤5
            </p>
            <p className="mt-1 text-2xl font-extrabold leading-none">
              {loading ? "—" : inventorySummary.lowStockCount}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Nguyên liệu
            </p>
            <p className="mt-1 text-sm font-extrabold text-slate-900">
              SL {loading ? "—" : inventorySummary.ingredientQty}
            </p>
            <p className="money mt-0.5 text-xs font-bold text-amber-800">
              {loading ? (
                "—"
              ) : (
                <Money amount={inventorySummary.ingredientValue} />
              )}
            </p>
          </div>
          <div className="rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Thành phẩm
            </p>
            <p className="mt-1 text-sm font-extrabold text-slate-900">
              SL {loading ? "—" : inventorySummary.finishedQty}
            </p>
            <p className="money mt-0.5 text-xs font-bold text-amber-800">
              Nhập{" "}
              {loading ? (
                "—"
              ) : (
                <Money amount={inventorySummary.finishedCostValue} />
              )}
            </p>
            {inventorySummary.finishedSellValue > 0 ? (
              <p className="money mt-0.5 text-[11px] text-slate-500">
                Bán ước tính{" "}
                <Money amount={inventorySummary.finishedSellValue} />
              </p>
            ) : null}
          </div>
        </div>
        {filter !== "all" && !loading ? (
          <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-100">
            Toàn kho (không lọc):{" "}
            <span className="font-semibold">
              {allInventorySummary.skuCount} món
            </span>
            {" · "}
            SL {allInventorySummary.totalQty}
            {" · "}
            <span className="money font-semibold text-brand-800">
              <Money amount={allInventorySummary.costValue} />
            </span>
          </p>
        ) : null}
      </section>

      <button
        type="button"
        onClick={() => {
          setShowAdd((v) => !v);
          if (!showAdd) setForm(emptyForm());
        }}
        className={cn(
          "touch-btn mb-4 h-14 w-full gap-2 text-sm font-bold",
          showAdd ? "bg-slate-800 text-white" : "bg-emerald-600 text-white"
        )}
      >
        {showAdd ? (
          <>
            <X className="h-5 w-5" aria-hidden />
            Đóng form thêm
          </>
        ) : (
          <>
            <Plus className="h-5 w-5" aria-hidden />
            Thêm món / nguyên liệu mới
          </>
        )}
      </button>

      {showAdd ? (
        <section className="card-panel mb-4 space-y-3 border-emerald-100 bg-gradient-to-b from-emerald-50/80 to-white">
          <h2 className="section-title text-emerald-950">Thêm hàng mới</h2>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: PRODUCT_KIND.INGREDIENT, label: "Nguyên liệu" },
                { id: PRODUCT_KIND.FINISHED, label: "Thành phẩm bán" },
              ].map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      kind: k.id,
                      unit:
                        k.id === PRODUCT_KIND.INGREDIENT
                          ? f.kind === PRODUCT_KIND.INGREDIENT
                            ? f.unit
                            : "g"
                          : f.kind === PRODUCT_KIND.FINISHED
                            ? f.unit
                            : "ly",
                    }))
                  }
                  className={cn(
                    "touch-btn h-12 text-sm font-bold",
                    form.kind === k.id
                      ? "bg-brand-700 text-white"
                      : "bg-white text-slate-700 ring-1 ring-slate-200"
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Tên
              </span>
              <input
                className="field-input"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={
                  form.kind === PRODUCT_KIND.INGREDIENT
                    ? "VD: Trà khô, Đường, Ly"
                    : "VD: Trà đá, Trà chanh"
                }
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Đơn vị
              </span>
              <select
                className="field-input"
                value={form.unit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, unit: e.target.value }))
                }
              >
                {PRODUCT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Số lượng nhập
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className="field-input money"
                  value={form.inStock}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, inStock: e.target.value }))
                  }
                  placeholder="0"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Giá nhập / ĐV
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className="field-input money"
                  value={form.cost}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cost: e.target.value }))
                  }
                  placeholder="0"
                />
              </label>
            </div>

            {form.kind === PRODUCT_KIND.FINISHED ? (
              <>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Giá bán
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    className="field-input money"
                    value={form.price}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, price: e.target.value }))
                    }
                    placeholder="10000"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Nhóm POS
                  </span>
                  <select
                    className="field-input"
                    value={form.groupId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, groupId: e.target.value }))
                    }
                  >
                    <option value="">— Chọn nhóm —</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            <button
              type="submit"
              disabled={savingAdd}
              className="touch-btn h-14 w-full gap-2 bg-emerald-700 text-white"
            >
              {savingAdd ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Save className="h-5 w-5" aria-hidden />
              )}
              {savingAdd ? "Đang lưu..." : "Lưu món mới"}
            </button>
          </form>
        </section>
      ) : null}

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[
          { id: "all", label: "Tất cả" },
          { id: "ingredient", label: "Nguyên liệu" },
          { id: "finished", label: "Bán POS" },
          ...groups.map((g) => ({ id: g.id, label: g.name })),
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "touch-btn h-9 shrink-0 px-3 text-xs font-extrabold",
              filter === f.id
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="mb-8 space-y-2">
        <h2 className="section-title">Nhập thêm vào món có sẵn</h2>
        {loading ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : visible.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Chưa có món. Bấm &quot;Thêm món / nguyên liệu mới&quot; ở trên.
          </div>
        ) : (
          visible.map((product) => {
            const d = drafts[product.id] || {};
            const isIng = product.kind === PRODUCT_KIND.INGREDIENT;
            const busy = savingId === product.id;
            const packaging = normalizeProductUnits(product);
            const receiveUnits = packaging.units.filter(
              (unit) => unit.canReceive
            );
            const selectedUnit =
              findUnit(product, d.unitId) || defaultReceiveUnit(product);
            const baseQtyPreview = Math.round(
              (Number(d.addQty) || 0) * (Number(selectedUnit?.factor) || 1)
            );
            const previewCost = d.cost !== undefined && String(d.cost).trim() !== ""
              ? parseUnitCostInput(d.cost)
              : Math.round(
                  Number(selectedUnit?.sellCost) || Number(product.cost) || 0
                );
            return (
              <article key={product.id} className="card-panel space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold text-slate-900">
                      {product.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {isIng ? "Nguyên liệu" : "Thành phẩm"}
                      {" · "}
                      {product.unit || "—"}
                      {" · Tồn "}
                      <span className="font-bold text-slate-800">
                        {Number(product.inStock) || 0}
                      </span>
                    </p>
                    <p className="mt-1 text-xs font-semibold text-amber-800">
                      Giá nhập: <Money amount={product.cost} />
                      {!isIng ? (
                        <>
                          {" · Bán "}
                          <Money amount={product.price} />
                        </>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm font-extrabold text-brand-800">
                      Giá trị tồn:{" "}
                      <Money amount={lineStockCostValue(product)} />
                    </p>
                  </div>
                  <Package
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      + Số lượng nhập
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      className="field-input money"
                      placeholder="0"
                      value={d.addQty ?? ""}
                      onChange={(e) =>
                        setDraft(product.id, { addQty: e.target.value })
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Đơn vị nhập
                    </span>
                    <select
                      className="field-input"
                      value={d.unitId || selectedUnit?.id || ""}
                      onChange={(e) =>
                        setDraft(product.id, { unitId: e.target.value })
                      }
                    >
                      {receiveUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block col-span-2">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Giá nhập mới
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      className="field-input money"
                      placeholder={String(previewCost)}
                      value={d.cost ?? ""}
                      onChange={(e) =>
                        setDraft(product.id, { cost: e.target.value })
                      }
                    />
                    {(() => {
                      const qty = Number(d.addQty) || 0;
                      if (qty <= 0 || !selectedUnit || previewCost <= 0) {
                        return null;
                      }
                      let preview = null;
                      try {
                        preview = deriveReceiveCostUpdate(product, {
                          unit: selectedUnit,
                          receiveQty: qty,
                          unitReceivePrice: previewCost,
                        });
                      } catch {
                        return null;
                      }
                      return (
                        <p className="mt-1 text-[11px] font-semibold leading-snug text-slate-600">
                          {qty} {selectedUnit.label} ×{" "}
                          {formatCurrency(previewCost)}
                          {" → +"}
                          {preview.baseQty}{" "}
                          {product.packaging?.baseUnit || product.unit || "đv"}
                          {" · ĐG gốc "}
                          {formatCurrency(preview.baseUnitCost)}
                          {" · Trừ quỹ "}
                          {formatCurrency(preview.amount)}
                        </p>
                      );
                    })()}
                  </label>
                </div>

                {Number(d.addQty) > 0 ? (
                  <div className="space-y-2 rounded-2xl bg-rose-50 p-3 ring-1 ring-rose-100">
                    <p className="text-xs font-bold text-rose-800">
                      Nhập {Number(d.addQty) || 0}{" "}
                      {selectedUnit?.label || product.unit || "đv"} ={" "}
                      {formatUnitCount(baseQtyPreview)} {packaging.baseUnit}
                    </p>
                    {canChooseInventoryFundSource ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setDraft(product.id, { fundSource: "shop" })
                          }
                          className={cn(
                            "touch-btn h-10 text-xs font-extrabold",
                            (d.fundSource || "shop") === "shop"
                              ? "bg-rose-700 text-white"
                              : "bg-white text-slate-700 ring-1 ring-slate-200"
                          )}
                        >
                          Quỹ cửa hàng
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft(product.id, { fundSource: "capital" })
                          }
                          className={cn(
                            "touch-btn h-10 text-xs font-extrabold",
                            d.fundSource === "capital"
                              ? "bg-amber-700 text-white"
                              : "bg-white text-slate-700 ring-1 ring-slate-200"
                          )}
                        >
                          Quỹ đầu tư
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs font-semibold text-rose-900">
                        Trừ quỹ cửa hàng (bắt buộc với Quản lý)
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(product.id, { payMethod: "cash" })
                        }
                        className={cn(
                          "touch-btn h-10 text-xs font-extrabold",
                          (d.payMethod || "cash") === "cash"
                            ? "bg-emerald-600 text-white"
                            : "bg-white text-slate-700 ring-1 ring-slate-200"
                        )}
                      >
                        Tiền mặt
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(product.id, { payMethod: "banking" })
                        }
                        className={cn(
                          "touch-btn h-10 text-xs font-extrabold",
                          d.payMethod === "banking"
                            ? "bg-brand-700 text-white"
                            : "bg-white text-slate-700 ring-1 ring-slate-200"
                        )}
                      >
                        Chuyển khoản
                      </button>
                    </div>
                    <p className="text-xs font-bold text-rose-800">
                      Sẽ trừ{" "}
                      {canChooseInventoryFundSource && d.fundSource === "capital"
                        ? "quỹ đầu tư"
                        : "quỹ cửa hàng"}{" "}
                      ≈{" "}
                      <Money
                        amount={Math.round((Number(d.addQty) || 0) * previewCost)}
                      />
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleReceive(product)}
                  className="touch-btn h-12 w-full gap-2 bg-brand-700 text-sm text-white disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" aria-hidden />
                  )}
                  {busy
                    ? "Đang lưu..."
                    : Number(d.addQty) > 0
                      ? "Lưu nhập + trừ quỹ"
                      : "Lưu nhập hàng"}
                </button>
              </article>
            );
          })
        )}
      </section>
    </AppShell>
  );
}

export default function InventoryPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor", "superadmin"]}>
      <InventoryContent />
    </ProtectedRoute>
  );
}
