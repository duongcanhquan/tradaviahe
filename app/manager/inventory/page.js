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
import { receiveInventoryFromShopFund } from "@/lib/expenses";
import { db } from "@/lib/firebase";
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

const emptyForm = () => ({
  kind: PRODUCT_KIND.INGREDIENT,
  name: "",
  unit: "cái",
  inStock: "",
  cost: "",
  price: "",
  groupId: "",
});

function InventoryContent() {
  const { showToast } = useToast();
  const { user, profile } = useAuth();
  const [products, setProducts] = useState([]);
  const [groups, setGroups] = useState(DEFAULT_PRODUCT_GROUPS);
  const [filter, setFilter] = useState("all"); // all | ingredient | finished | groupId
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [savingAdd, setSavingAdd] = useState(false);

  /** per product: { addQty, cost, payMethod, chargeFund } */
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);

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
        chargeFund: true,
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
    const hasCost = d.cost !== undefined && String(d.cost).trim() !== "";
    const nextCost = hasCost
      ? parseUnitCostInput(d.cost)
      : Number(product.cost) || 0;
    const chargeFund = d.chargeFund !== false;
    const payMethod = d.payMethod === "banking" ? "banking" : "cash";

    if (addQty <= 0 && !hasCost) {
      showToast("Nhập số lượng nhập thêm hoặc giá nhập mới", "error");
      return;
    }

    setSavingId(product.id);
    try {
      if (addQty > 0 && chargeFund) {
        const result = await receiveInventoryFromShopFund({
          product,
          addQty,
          unitCost: nextCost,
          paymentMethod: payMethod,
          updateCost: hasCost,
          user,
          profile,
        });
        if (hasCost) {
          await recomputeRecipeCosts();
        }
        const via = result.paymentMethod === "banking" ? "CK" : "TM";
        showToast(
          `Đã nhập +${result.qty} · trừ quỹ ${via} ${formatCurrency(result.amount)}`,
          "success"
        );
      } else {
        const payload = {
          updatedAt: serverTimestamp(),
        };
        if (addQty > 0) {
          payload.inStock = (Number(product.inStock) || 0) + addQty;
        }
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
        showToast(
          addQty > 0
            ? `Đã nhập +${addQty} · ${product.name} (không trừ quỹ)`
            : `Đã cập nhật giá nhập · ${product.name}`,
          "success"
        );
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

  return (
    <AppShell
      title="Nhập hàng"
      subtitle="Tồn kho · giá nhập · giá trị"
      dense
    >
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        Nhập số lượng + chọn TM/CK để trừ quỹ cửa hàng (số tiền = SL × giá
        nhập). Có thể tắt trừ quỹ nếu hàng biếu / đã chi trước. Setup công
        thức &amp; giá bán:{" "}
        <Link
          href="/manager/products"
          className="font-bold text-brand-800 underline"
        >
          Món · giá
        </Link>
        {" · "}
        <Link
          href="/manager/production"
          className="font-bold text-brand-800 underline"
        >
          Sổ pha / mẻ
        </Link>
        .
      </p>

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
                  onClick={() => setForm((f) => ({ ...f, kind: k.id }))}
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
                      Giá nhập mới
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      className="field-input money"
                      placeholder={String(Number(product.cost) || 0)}
                      value={d.cost ?? ""}
                      onChange={(e) =>
                        setDraft(product.id, { cost: e.target.value })
                      }
                    />
                  </label>
                </div>

                {Number(d.addQty) > 0 ? (
                  <div className="space-y-2 rounded-2xl bg-rose-50 p-3 ring-1 ring-rose-100">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-rose-700"
                        checked={d.chargeFund !== false}
                        onChange={(e) =>
                          setDraft(product.id, {
                            chargeFund: e.target.checked,
                          })
                        }
                      />
                      <span className="text-xs font-semibold leading-snug text-rose-900">
                        Trả từ quỹ cửa hàng (trừ TM hoặc CK trong quỹ)
                      </span>
                    </label>
                    {d.chargeFund !== false ? (
                      <>
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
                          Sẽ trừ quỹ ≈{" "}
                          <Money
                            amount={Math.round(
                              (Number(d.addQty) || 0) *
                                (d.cost !== undefined &&
                                String(d.cost).trim() !== ""
                                  ? parseUnitCostInput(d.cost)
                                  : Number(product.cost) || 0)
                            )}
                          />
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-slate-600">
                        Chỉ cộng tồn — không trừ quỹ (hàng biếu / đã chi trước).
                      </p>
                    )}
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
                    : Number(d.addQty) > 0 && d.chargeFund !== false
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
