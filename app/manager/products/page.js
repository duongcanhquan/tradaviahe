'use client';

import { useEffect, useMemo, useState } from "react";
import {
  Calculator,
  Package,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import {
  createProductGroup,
  deleteProductGroup,
  ensureDefaultProductGroups,
  groupsByIdMap,
  subscribeProductGroups,
  updateProductGroup,
} from "@/lib/productGroups";
import {
  COST_MODE,
  PRODUCT_KIND,
  PRODUCT_UNITS,
  computeRecipeCost,
  createProduct,
  deleteProduct,
  marginOf,
  productsByIdMap,
  recomputeRecipeCosts,
  resolveUnitCost,
  seedDefaultCatalog,
  subscribeProducts,
  updateProduct,
} from "@/lib/products";
import { cn, formatCurrency } from "@/lib/utils";

const emptyForm = {
  name: "",
  kind: PRODUCT_KIND.FINISHED,
  unit: "ly",
  price: "",
  cost: "",
  costMode: COST_MODE.MANUAL,
  groupId: "drinks",
  inStock: "0",
  active: true,
  recipe: [],
};

function ProductsContent() {
  const { canManageProducts, canDeleteProductGroups, role } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("finished");
  const [groupFilter, setGroupFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState(null);
  const [savingGroup, setSavingGroup] = useState(false);

  useEffect(() => {
    ensureDefaultProductGroups().catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = subscribeProducts(
      (rows) => {
        setProducts(rows);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được danh mục", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = subscribeProductGroups(
      (rows) => setGroups(rows.filter((g) => g.active !== false)),
      (error) => {
        console.error(error);
        showToast("Không tải được nhóm SP", "error");
      }
    );
    return () => unsub();
  }, [showToast]);

  const byId = useMemo(() => productsByIdMap(products), [products]);
  const groupMap = useMemo(() => groupsByIdMap(groups), [groups]);

  const ingredients = useMemo(
    () => products.filter((p) => p.kind === PRODUCT_KIND.INGREDIENT),
    [products]
  );

  const finished = useMemo(
    () => products.filter((p) => p.kind !== PRODUCT_KIND.INGREDIENT),
    [products]
  );

  const list = useMemo(() => {
    const base = tab === "ingredient" ? ingredients : finished;
    if (tab !== "finished" || groupFilter === "all") return base;
    if (groupFilter === "none") return base.filter((p) => !p.groupId);
    return base.filter((p) => p.groupId === groupFilter);
  }, [tab, ingredients, finished, groupFilter]);

  const openCreate = (kind) => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      kind,
      unit: kind === PRODUCT_KIND.INGREDIENT ? "g" : "ly",
      costMode: COST_MODE.MANUAL,
      groupId: groups[0]?.id || "drinks",
    });
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      name: row.name || "",
      kind: row.kind === PRODUCT_KIND.INGREDIENT
        ? PRODUCT_KIND.INGREDIENT
        : PRODUCT_KIND.FINISHED,
      unit: row.unit || "cái",
      price: row.price != null ? String(row.price) : "",
      cost: row.cost != null ? String(Math.round(Number(row.cost) || 0)) : "",
      costMode:
        row.costMode === COST_MODE.RECIPE ? COST_MODE.RECIPE : COST_MODE.MANUAL,
      groupId: row.groupId || "",
      inStock: row.inStock != null ? String(row.inStock) : "0",
      active: row.active !== false,
      recipe: Array.isArray(row.recipe)
        ? row.recipe.map((l) => ({
            productId: l.productId,
            qty: String(l.qty ?? ""),
          }))
        : [],
    });
    setOpen(true);
  };

  const recipePreviewCost = useMemo(() => {
    if (form.costMode !== COST_MODE.RECIPE) return 0;
    return computeRecipeCost(
      form.recipe.map((l) => ({
        productId: l.productId,
        qty: Number(l.qty) || 0,
      })),
      byId
    );
  }, [form.costMode, form.recipe, byId]);

  const addRecipeLine = () => {
    const first = ingredients[0];
    if (!first) {
      showToast("Thêm nguyên liệu trước", "info");
      return;
    }
    setForm((f) => ({
      ...f,
      recipe: [...f.recipe, { productId: first.id, qty: "1" }],
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        kind: form.kind,
        unit: form.unit,
        price: Number(form.price) || 0,
        cost:
          form.kind === PRODUCT_KIND.FINISHED &&
          form.costMode === COST_MODE.RECIPE
            ? recipePreviewCost
            : Number(form.cost) || 0,
        costMode: form.costMode,
        groupId:
          form.kind === PRODUCT_KIND.FINISHED
            ? form.groupId || null
            : null,
        inStock: Number(form.inStock) || 0,
        active: form.active,
        recipe:
          form.costMode === COST_MODE.RECIPE
            ? form.recipe.map((l) => ({
                productId: l.productId,
                qty: Number(l.qty) || 0,
              }))
            : [],
      };

      if (editingId) await updateProduct(editingId, payload);
      else await createProduct(payload);

      // Cập nhật cost các thành phẩm dùng công thức (khi đổi giá NL)
      await recomputeRecipeCosts();

      showToast(editingId ? "Đã lưu" : "Đã thêm", "success");
      setOpen(false);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Lưu thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (row.kind === PRODUCT_KIND.INGREDIENT) {
      const used = finished.some(
        (p) =>
          p.costMode === COST_MODE.RECIPE &&
          Array.isArray(p.recipe) &&
          p.recipe.some((l) => l.productId === row.id)
      );
      if (used) {
        const ok = window.confirm(
          `“${row.name}” đang dùng trong công thức. Xóa sẽ làm cost lệch — vẫn xóa?`
        );
        if (!ok) return;
      } else if (!window.confirm(`Xóa “${row.name}”?`)) {
        return;
      }
    } else if (!window.confirm(`Xóa “${row.name}”?`)) {
      return;
    }
    try {
      await deleteProduct(row.id);
      await recomputeRecipeCosts();
      showToast("Đã xóa", "info");
    } catch (error) {
      console.error(error);
      showToast("Xóa thất bại", "error");
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await seedDefaultCatalog();
      showToast("Đã tạo nhóm + NL + Trà đá mẫu", "success");
    } catch (error) {
      showToast(error?.message || "Seed thất bại", "error");
    } finally {
      setSeeding(false);
    }
  };

  const handleSaveGroup = async (e) => {
    e.preventDefault();
    setSavingGroup(true);
    try {
      if (editingGroup) {
        await updateProductGroup(editingGroup.id, { name: groupName });
        showToast("Đã sửa nhóm", "success");
      } else {
        await createProductGroup({
          name: groupName,
          sortOrder: groups.length,
        });
        showToast("Đã thêm nhóm", "success");
      }
      setGroupName("");
      setEditingGroup(null);
    } catch (error) {
      showToast(error?.message || "Lưu nhóm thất bại", "error");
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroup = async (g) => {
    if (!canDeleteProductGroups) {
      showToast("Chỉ Admin (Cổ đông / Super Admin) được xóa nhóm", "error");
      return;
    }
    if (!window.confirm(`Xóa nhóm “${g.name}”? Món trong nhóm sẽ thành chưa gắn nhóm.`)) {
      return;
    }
    try {
      await deleteProductGroup(g.id, { products });
      showToast("Đã xóa nhóm", "info");
    } catch (error) {
      showToast(error?.message || "Xóa nhóm thất bại", "error");
    }
  };

  if (!canManageProducts) {
    return (
      <AppShell title="Món & giá" subtitle="Không có quyền">
        <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Chỉ Quản lý, Chủ đầu tư (Admin) và Super Admin được setup món/giá.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Món & giá"
      subtitle={
        role === "manager"
          ? "Nhóm SP · giá bán · công thức"
          : "Admin — nhóm SP · giá · công thức"
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setTab("finished")}
          className={cn(
            "touch-btn h-12 px-1 text-xs sm:text-sm",
            tab === "finished"
              ? "bg-brand-700 text-white"
              : "bg-white text-slate-700 ring-1 ring-slate-200"
          )}
        >
          Thành phẩm ({finished.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("ingredient")}
          className={cn(
            "touch-btn h-12 px-1 text-xs sm:text-sm",
            tab === "ingredient"
              ? "bg-brand-700 text-white"
              : "bg-white text-slate-700 ring-1 ring-slate-200"
          )}
        >
          Nguyên liệu ({ingredients.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("groups")}
          className={cn(
            "touch-btn h-12 px-1 text-xs sm:text-sm",
            tab === "groups"
              ? "bg-brand-700 text-white"
              : "bg-white text-slate-700 ring-1 ring-slate-200"
          )}
        >
          Nhóm SP ({groups.length})
        </button>
      </div>

      {tab !== "groups" ? (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() =>
              openCreate(
                tab === "ingredient"
                  ? PRODUCT_KIND.INGREDIENT
                  : PRODUCT_KIND.FINISHED
              )
            }
            className="touch-btn h-12 flex-1 gap-2 bg-emerald-600 text-white"
          >
            <Plus className="h-5 w-5" />
            {tab === "ingredient" ? "Thêm nguyên liệu" : "Thêm món bán"}
          </button>
        </div>
      ) : null}

      {tab === "finished" ? (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setGroupFilter("all")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold",
              groupFilter === "all"
                ? "bg-brand-700 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200"
            )}
          >
            Tất cả
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroupFilter(g.id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold",
                groupFilter === g.id
                  ? "bg-brand-700 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200"
              )}
            >
              {g.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setGroupFilter("none")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold",
              groupFilter === "none"
                ? "bg-brand-700 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200"
            )}
          >
            Chưa nhóm
          </button>
        </div>
      ) : null}

      {products.length === 0 && !loading ? (
        <button
          type="button"
          disabled={seeding}
          onClick={handleSeed}
          className="touch-btn mb-4 h-14 w-full gap-2 border border-brand-200 bg-brand-50 text-brand-900"
        >
          <Package className="h-5 w-5" />
          {seeding ? "Đang tạo..." : "Tạo danh mục mẫu (Trà đá + NL)"}
        </button>
      ) : null}

      {tab === "groups" ? (
        <section className="mb-6 space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            POS chia theo nhóm (mặc định: Nước uống, Đồ ăn, Đồ dùng, Dịch vụ).
            Thêm/sửa được; <strong>xóa chỉ Admin</strong> (Cổ đông / Super Admin).
          </p>

          <form onSubmit={handleSaveGroup} className="flex gap-2">
            <input
              className="field-input flex-1"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={editingGroup ? "Đổi tên nhóm" : "Tên nhóm mới"}
              required
            />
            <button
              type="submit"
              disabled={savingGroup}
              className="touch-btn h-12 shrink-0 bg-emerald-600 px-4 text-white"
            >
              {editingGroup ? "Lưu" : "Thêm"}
            </button>
            {editingGroup ? (
              <button
                type="button"
                onClick={() => {
                  setEditingGroup(null);
                  setGroupName("");
                }}
                className="touch-btn h-12 shrink-0 bg-slate-100 px-3 text-slate-700"
              >
                Hủy
              </button>
            ) : null}
          </form>

          {groups.map((g) => (
            <div
              key={g.id}
              className="flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200"
            >
              <div className="min-w-0">
                <p className="truncate font-extrabold text-slate-900">{g.name}</p>
                <p className="text-xs text-slate-400">
                  {finished.filter((p) => p.groupId === g.id).length} món · thứ tự{" "}
                  {g.sortOrder ?? 0}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label="Sửa nhóm"
                  onClick={() => {
                    setEditingGroup(g);
                    setGroupName(g.name);
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {canDeleteProductGroups ? (
                  <button
                    type="button"
                    aria-label="Xóa nhóm"
                    onClick={() => handleDeleteGroup(g)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
          ))}

          {!canDeleteProductGroups ? (
            <p className="text-xs text-slate-400">
              Quản lý được thêm/sửa nhóm. Xóa nhóm cần quyền Admin.
            </p>
          ) : null}
        </section>
      ) : null}

      {tab !== "groups" ? (
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        {tab === "ingredient"
          ? "Nhập giá mua / đơn vị (vd: trà khô 2đ/g). Thành phẩm dùng công thức sẽ tự cộng cost."
          : "Chọn nhóm SP (Nước uống / Đồ ăn…). Giá bán dùng khi thu tiền."}
      </p>
      ) : null}

      {tab !== "groups" ? (
      <div className="space-y-3 pb-8">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl bg-white/80"
              />
            ))
          : list.map((row) => {
              const cost = resolveUnitCost(row, byId);
              const margin = marginOf(row, byId);
              const groupLabel = row.groupId
                ? groupMap[row.groupId]?.name || row.groupId
                : "Chưa nhóm";
              return (
                <div
                  key={row.id}
                  className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-extrabold text-slate-900">
                        {row.name}
                      </p>
                      <p className="text-xs font-medium text-slate-400">
                        {row.kind !== PRODUCT_KIND.INGREDIENT
                          ? `${groupLabel} · `
                          : ""}
                        Đơn vị: {row.unit || "—"} · Tồn: {row.inStock ?? 0}
                        {row.kind !== PRODUCT_KIND.INGREDIENT &&
                        row.costMode === COST_MODE.RECIPE
                          ? " · Cost theo CT"
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        aria-label="Sửa"
                        onClick={() => openEdit(row)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Xóa"
                        onClick={() => handleDelete(row)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {row.kind === PRODUCT_KIND.INGREDIENT ? (
                    <p className="money mt-2 text-base font-bold text-amber-800">
                      Giá nhập: <Money amount={cost} />
                      <span className="text-sm font-semibold text-slate-400">
                        {" "}
                        / {row.unit}
                      </span>
                    </p>
                  ) : (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-[11px] font-semibold text-slate-400">
                          Giá bán
                        </p>
                        <p className="money font-extrabold text-brand-800">
                          <Money amount={row.price} />
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-slate-400">
                          Cost
                        </p>
                        <p className="money font-extrabold text-amber-800">
                          <Money amount={cost} />
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-slate-400">
                          Lãi/đv
                        </p>
                        <p
                          className={cn(
                            "money font-extrabold",
                            margin >= 0 ? "text-emerald-700" : "text-rose-600"
                          )}
                        >
                          <Money amount={margin} />
                        </p>
                      </div>
                    </div>
                  )}

                  {row.kind !== PRODUCT_KIND.INGREDIENT &&
                  row.costMode === COST_MODE.RECIPE &&
                  Array.isArray(row.recipe) &&
                  row.recipe.length ? (
                    <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
                      {row.recipe.map((line) => {
                        const ing = byId[line.productId];
                        return (
                          <li key={`${row.id}-${line.productId}-${line.qty}`}>
                            {ing?.name || "?"} × {line.qty} {ing?.unit || ""}
                            {ing
                              ? ` (= ${formatCurrency(
                                  (Number(ing.cost) || 0) * (Number(line.qty) || 0)
                                )})`
                              : ""}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })}

        {!loading && list.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            Chưa có mục nào trong tab này.
          </p>
        ) : null}
      </div>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-slate-950/50 sm:items-center sm:justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSave}
            className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-extrabold">
                {editingId ? "Sửa" : "Thêm"}{" "}
                {form.kind === PRODUCT_KIND.INGREDIENT
                  ? "nguyên liệu"
                  : "thành phẩm"}
              </h2>
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => setOpen(false)}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-semibold">Tên</span>
              <input
                required
                className="field-input"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={
                  form.kind === PRODUCT_KIND.INGREDIENT
                    ? "vd: Trà khô"
                    : "vd: Trà đá"
                }
              />
            </label>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">Đơn vị</span>
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
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">Tồn kho</span>
                <input
                  type="number"
                  min="0"
                  className="field-input"
                  value={form.inStock}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, inStock: e.target.value }))
                  }
                />
              </label>
            </div>

            {form.kind === PRODUCT_KIND.FINISHED ? (
              <>
                <label className="mb-3 block">
                  <span className="mb-1 block text-sm font-semibold">
                    Nhóm sản phẩm (POS)
                  </span>
                  <select
                    className="field-input"
                    value={form.groupId || ""}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, groupId: e.target.value }))
                    }
                  >
                    <option value="">Chưa nhóm</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mb-3 flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, active: e.target.checked }))
                    }
                    className="h-5 w-5 accent-brand-700"
                  />
                  <span className="text-sm font-semibold text-slate-800">
                    Đang bán trên POS
                  </span>
                </label>
              </>
            ) : null}

            {form.kind === PRODUCT_KIND.INGREDIENT ? (
              <label className="mb-3 block">
                <span className="mb-1 block text-sm font-semibold">
                  Giá nhập / đơn vị
                </span>
                <input
                  type="number"
                  min="0"
                  required
                  className="field-input"
                  value={form.cost}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cost: e.target.value }))
                  }
                  placeholder="vd: 2"
                />
              </label>
            ) : (
              <>
                <label className="mb-3 block">
                  <span className="mb-1 block text-sm font-semibold">
                    Giá bán
                  </span>
                  <input
                    type="number"
                    min="0"
                    required
                    className="field-input"
                    value={form.price}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, price: e.target.value }))
                    }
                    placeholder="vd: 5000"
                  />
                </label>

                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, costMode: COST_MODE.MANUAL }))
                    }
                    className={cn(
                      "touch-btn h-12 text-sm",
                      form.costMode === COST_MODE.MANUAL
                        ? "bg-amber-600 text-white"
                        : "bg-slate-100 text-slate-700"
                    )}
                  >
                    Cost nhập tay
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, costMode: COST_MODE.RECIPE }))
                    }
                    className={cn(
                      "touch-btn h-12 gap-1 text-sm",
                      form.costMode === COST_MODE.RECIPE
                        ? "bg-amber-600 text-white"
                        : "bg-slate-100 text-slate-700"
                    )}
                  >
                    <Calculator className="h-4 w-4" />
                    Công thức
                  </button>
                </div>

                {form.costMode === COST_MODE.MANUAL ? (
                  <label className="mb-3 block">
                    <span className="mb-1 block text-sm font-semibold">
                      Giá nhập / cost
                    </span>
                    <input
                      type="number"
                      min="0"
                      className="field-input"
                      value={form.cost}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, cost: e.target.value }))
                      }
                      placeholder="vd: 8000 (nước ngọt nhập)"
                    />
                  </label>
                ) : (
                  <div className="mb-3 space-y-2 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-100">
                    <p className="text-sm font-bold text-amber-900">
                      Thành phần chế biến
                    </p>
                    {form.recipe.map((line, idx) => (
                      <div
                        key={`r-${idx}`}
                        className="grid grid-cols-[1fr_5rem_2.5rem] gap-2"
                      >
                        <select
                          className="field-input py-2 text-sm"
                          value={line.productId}
                          onChange={(e) =>
                            setForm((f) => {
                              const recipe = [...f.recipe];
                              recipe[idx] = {
                                ...recipe[idx],
                                productId: e.target.value,
                              };
                              return { ...f, recipe };
                            })
                          }
                        >
                          {ingredients.map((ing) => (
                            <option key={ing.id} value={ing.id}>
                              {ing.name} ({formatCurrency(ing.cost)}/{ing.unit})
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="field-input py-2 text-sm"
                          value={line.qty}
                          onChange={(e) =>
                            setForm((f) => {
                              const recipe = [...f.recipe];
                              recipe[idx] = {
                                ...recipe[idx],
                                qty: e.target.value,
                              };
                              return { ...f, recipe };
                            })
                          }
                          placeholder="SL"
                        />
                        <button
                          type="button"
                          aria-label="Xóa dòng"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              recipe: f.recipe.filter((_, i) => i !== idx),
                            }))
                          }
                          className="flex h-11 items-center justify-center rounded-xl bg-white text-rose-600 ring-1 ring-rose-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addRecipeLine}
                      className="touch-btn h-11 w-full gap-1 bg-white text-sm text-amber-900 ring-1 ring-amber-200"
                    >
                      <Plus className="h-4 w-4" />
                      Thêm nguyên liệu
                    </button>
                    <p className="money text-sm font-extrabold text-amber-950">
                      Cost tự tính: {formatCurrency(recipePreviewCost)}
                      {form.price ? (
                        <span className="ml-2 font-semibold text-emerald-800">
                          · Lãi{" "}
                          {formatCurrency(
                            (Number(form.price) || 0) - recipePreviewCost
                          )}
                        </span>
                      ) : null}
                    </p>
                  </div>
                )}
              </>
            )}

            <button
              type="submit"
              disabled={saving}
              className="touch-btn mt-2 h-14 w-full bg-brand-700 text-white disabled:opacity-50"
            >
              {saving ? "Đang lưu..." : "Lưu"}
            </button>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}

export default function ProductsPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor", "superadmin"]}>
      <ProductsContent />
    </ProtectedRoute>
  );
}
