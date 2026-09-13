'use client';

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
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
  comparePosOrder,
  createProduct,
  deleteProduct,
  marginOf,
  moveProductInOrder,
  productsByIdMap,
  recomputeRecipeCosts,
  resolveUnitCost,
  seedDefaultCatalog,
  subscribeProducts,
  summarizeRecipeCosts,
  updateProduct,
} from "@/lib/products";
import {
  isRecipeStockSource,
  migrateRecipeQty,
  recipeLineCost,
} from "@/lib/recipe";
import { normalizeProductUnits } from "@/lib/packaging";
import { formatBaseQty, toIngredientBaseQty, usageUnitsForIngredient } from "@/lib/units";
import { cn, formatCurrency } from "@/lib/utils";

function makeUnitId(label) {
  return (
    String(label || "unit")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-") || "unit"
  );
}

function createUnitRow(overrides = {}) {
  const label = String(overrides.label || overrides.id || "đv").trim() || "đv";
  return {
    id: String(overrides.id || makeUnitId(label)),
    label,
    factor: Math.max(1, Math.round(Number(overrides.factor) || 1)),
    sellPrice: Number(overrides.sellPrice) || 0,
    sellCost: Number(overrides.sellCost) || 0,
    canSell: overrides.canSell !== false,
    canReceive: overrides.canReceive !== false,
  };
}

function ensureBaseUnitRow(units, baseUnit, sellPrice, sellCost) {
  const rows = (Array.isArray(units) ? units : []).map((row) =>
    createUnitRow(row)
  );
  const baseIndex = rows.findIndex((row) => Number(row.factor) === 1);
  const baseRow = createUnitRow({
    id: baseIndex >= 0 ? rows[baseIndex].id : makeUnitId(baseUnit),
    label: baseUnit,
    factor: 1,
    sellPrice,
    sellCost,
    canSell: true,
    canReceive: true,
  });

  if (baseIndex >= 0) {
    rows[baseIndex] = { ...rows[baseIndex], ...baseRow, factor: 1 };
    return rows;
  }

  return [baseRow, ...rows];
}

function formatUnitCount(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

const emptyForm = {
  name: "",
  kind: PRODUCT_KIND.FINISHED,
  unit: "ly",
  price: "",
  cost: "",
  costMode: COST_MODE.RECIPE,
  groupId: "drinks",
  inStock: "0",
  active: true,
  packaging: {
    enabled: false,
    baseUnit: "ly",
  },
  units: [],
  recipe: [],
};

function ProductsContent() {
  const { canManageProducts, canDeleteProductGroups, role, isSuperAdmin } =
    useAuth();
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
  const [recipeSearch, setRecipeSearch] = useState("");

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

  /** CT: NL kho + thành phẩm nhập (gói mì, chai…) — trừ tồn lúc bán */
  const recipeStockItems = useMemo(
    () =>
      products
        .filter((p) => isRecipeStockSource(p, editingId))
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), "vi")
        ),
    [products, editingId]
  );

  const list = useMemo(() => {
    const base = tab === "ingredient" ? ingredients : finished;
    let rows = base;
    if (tab === "finished") {
      if (groupFilter === "none") rows = base.filter((p) => !p.groupId);
      else if (groupFilter !== "all") {
        rows = base.filter((p) => p.groupId === groupFilter);
      }
      return [...rows].sort(comparePosOrder);
    }
    return rows;
  }, [tab, ingredients, finished, groupFilter]);

  const handleMoveProduct = async (row, direction) => {
    try {
      const ok = await moveProductInOrder(list, row.id, direction);
      if (!ok) return;
      showToast(direction === "up" ? "Đã đưa lên" : "Đã đưa xuống", "success");
    } catch (error) {
      console.error(error);
      showToast("Không đổi được thứ tự", "error");
    }
  };

  const openCreate = (kind) => {
    setEditingId(null);
    const isFinished = kind !== PRODUCT_KIND.INGREDIENT;
    setForm({
      ...emptyForm,
      kind,
      unit: kind === PRODUCT_KIND.INGREDIENT ? "g" : "ly",
      // Thành phẩm mặc định công thức để cost = tổng NL mỗi suất
      costMode: isFinished ? COST_MODE.RECIPE : COST_MODE.MANUAL,
      groupId: groups[0]?.id || "drinks",
      packaging: {
        enabled: false,
        baseUnit: kind === PRODUCT_KIND.INGREDIENT ? "g" : "ly",
      },
      units: [],
      recipe: [],
    });
    setRecipeSearch("");
    setOpen(true);
  };

  const recipeSourceOptions = (selectedId) => {
    const q = recipeSearch.trim().toLowerCase();
    const rows = recipeStockItems.filter(
      (p) => !q || String(p.name || "").toLowerCase().includes(q)
    );
    const selected = selectedId ? byId[selectedId] : null;
    if (selected && !rows.some((p) => p.id === selectedId)) {
      rows.unshift(selected);
    }
    return rows;
  };

  const openEdit = (row) => {
    setEditingId(row.id);
    setRecipeSearch("");
    const useRecipe =
      row.kind !== PRODUCT_KIND.INGREDIENT &&
      row.costMode === COST_MODE.RECIPE;
    const servings = Math.max(1, Number(row.estimatedServings) || 100);
    let recipe = Array.isArray(row.recipe)
      ? row.recipe.map((l) =>
          l.virtual
            ? {
                virtual: true,
                name: l.name || "",
                qty: String(migrateRecipeQty(l, servings) || l.qty || "1"),
                unitCost: String(l.unitCost ?? "0"),
                productId: "",
              }
            : {
                productId: l.productId,
                qty: String(migrateRecipeQty(l, servings) || ""),
                unitId: l.unitId || byId[l.productId]?.unit || "",
                virtual: false,
              }
        )
      : [];
    const packagingEnabled =
      (row.kind === PRODUCT_KIND.INGREDIENT || !useRecipe) &&
      Boolean(row.packaging?.enabled);
    const normalizedPackaging = normalizeProductUnits(row);
    const baseUnit =
      row.packaging?.baseUnit ||
      row.unit ||
      normalizedPackaging.baseUnit ||
      "cái";
    setForm({
      name: row.name || "",
      kind: row.kind === PRODUCT_KIND.INGREDIENT
        ? PRODUCT_KIND.INGREDIENT
        : PRODUCT_KIND.FINISHED,
      unit: row.unit || "cái",
      price: row.price != null ? String(row.price) : "",
      cost: row.cost != null ? String(Number(row.cost) || 0) : "",
      costMode: useRecipe ? COST_MODE.RECIPE : COST_MODE.MANUAL,
      groupId: row.groupId || "",
      inStock: row.inStock != null ? String(row.inStock) : "0",
      active: row.active !== false,
      packaging: {
        enabled: packagingEnabled,
        baseUnit,
      },
      units: packagingEnabled
        ? normalizedPackaging.units.map((unit) => ({ ...unit }))
        : [],
      recipe,
    });
    setOpen(true);
  };

  const recipePreview = useMemo(() => {
    if (form.kind !== PRODUCT_KIND.FINISHED) {
      return { unitCost: 0, margin: 0 };
    }
    return summarizeRecipeCosts(
      {
        price: Number(form.price) || 0,
        recipe: form.recipe.map((l) =>
          l.virtual
            ? {
                virtual: true,
                name: l.name || "",
                qty: Number(l.qty) || 0,
                unitCost: Number(l.unitCost) || 0,
              }
            : {
                productId: l.productId,
                qty: Number(l.qty) || 0,
                unitId: l.unitId || "",
              }
        ),
      },
      byId
    );
  }, [form.costMode, form.recipe, form.price, byId]);

  const addRecipeLine = ({ virtual = false } = {}) => {
    if (virtual) {
      setForm((f) => ({
        ...f,
        recipe: [
          ...f.recipe,
          {
            virtual: true,
            name: "",
            qty: "1",
            unitCost: "0",
            productId: "",
          },
        ],
      }));
      return;
    }
    if (!recipeStockItems.length) {
      showToast(
        "Chưa có hàng kho — thêm nguyên liệu hoặc thành phẩm nhập",
        "info"
      );
      return;
    }
    setForm((f) => ({
      ...f,
      recipe: [
        ...f.recipe,
        {
          productId: "",
          qty: "1",
          unitId: "",
          virtual: false,
        },
      ],
    }));
  };

  const setPackagingEnabled = (enabled) => {
    setForm((f) => {
      if (f.costMode === COST_MODE.RECIPE) {
        return {
          ...f,
          packaging: { ...f.packaging, enabled: false },
        };
      }
      if (!enabled) {
        return {
          ...f,
          packaging: { ...f.packaging, enabled: false },
        };
      }
      const baseUnit =
        String(f.packaging?.baseUnit || f.unit || "cái").trim() || "cái";
      return {
        ...f,
        packaging: { enabled: true, baseUnit },
        units: ensureBaseUnitRow(
          f.units,
          baseUnit,
          Number(f.price) || 0,
          Number(f.cost) || 0
        ),
      };
    });
  };

  const updateBaseUnitField = (field, value) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (!f.packaging?.enabled) {
        return next;
      }
      const baseUnit =
        String(field === "unit" ? value : f.packaging?.baseUnit || f.unit || "cái")
          .trim() || "cái";
      const price = field === "price" ? Number(value) || 0 : Number(f.price) || 0;
      const cost = field === "cost" ? Number(value) || 0 : Number(f.cost) || 0;
      return {
        ...next,
        unit: baseUnit,
        price: field === "price" ? value : f.price,
        cost: field === "cost" ? value : f.cost,
        packaging: { ...f.packaging, baseUnit },
        units: ensureBaseUnitRow(f.units, baseUnit, price, cost),
      };
    });
  };

  const updatePackagingUnit = (index, patch) => {
    setForm((f) => {
      const nextPatch = { ...patch };
      const current = f.units[index];
      if (
        Object.prototype.hasOwnProperty.call(nextPatch, "factor") &&
        Number(current?.factor) !== 1
      ) {
        nextPatch.factor = Math.max(2, Math.round(Number(nextPatch.factor) || 2));
      }
      const units = f.units.map((unit, i) =>
        i === index ? { ...unit, ...nextPatch } : unit
      );
      const nextCurrent = units[index];
      if (Number(nextCurrent?.factor) === 1) {
        const baseUnit =
          String(nextCurrent?.label || f.packaging?.baseUnit || f.unit || "cái")
            .trim() || "cái";
        const price = Number(nextCurrent?.sellPrice) || 0;
        const cost = Number(nextCurrent?.sellCost) || 0;
        return {
          ...f,
          unit: baseUnit,
          price: String(price),
          cost: String(cost),
          packaging: { ...f.packaging, baseUnit },
          units: ensureBaseUnitRow(units, baseUnit, price, cost),
        };
      }
      return { ...f, units };
    });
  };

  const addPackagingUnit = () => {
    setForm((f) => {
      const nextRow = createUnitRow({
        id: makeUnitId(`unit-${f.units.length + 1}-${Date.now()}`),
        label: "cây",
        factor: 10,
        sellPrice: Number(f.price) || 0,
        sellCost: Number(f.cost) || 0,
      });
      return { ...f, units: [...f.units, nextRow] };
    });
  };

  const removePackagingUnit = (index) => {
    setForm((f) => {
      const target = f.units[index];
      if (!target || Number(target.factor) === 1) return f;
      return {
        ...f,
        units: f.units.filter((_, i) => i !== index),
      };
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const prev = editingId ? byId[editingId] : null;
      if (
        prev?.kind === PRODUCT_KIND.INGREDIENT &&
        form.kind === PRODUCT_KIND.FINISHED
      ) {
        const usedIn = finished.filter(
          (p) =>
            Array.isArray(p.recipe) &&
            p.recipe.some((l) => l.productId === editingId)
        );
        if (usedIn.length) {
          const ok = window.confirm(
            `“${prev.name}” đang nằm trong công thức: ${usedIn
              .map((p) => p.name)
              .join(", ")}. Đổi thành món bán sẽ hiện trên POS. Vẫn lưu?`
          );
          if (!ok) {
            setSaving(false);
            return;
          }
        }
      }

      const boughtFinished =
        form.kind === PRODUCT_KIND.FINISHED &&
        form.costMode !== COST_MODE.RECIPE;

      if (form.kind === PRODUCT_KIND.FINISHED && !boughtFinished) {
        const lines = form.recipe.filter(
          (l) =>
            (l.virtual &&
              String(l.name || "").trim() &&
              Number(l.qty) > 0) ||
            (l.productId && Number(l.qty) > 0)
        );
        if (!lines.length) {
          showToast(
            "Công thức trống — thêm NL kho hoặc dòng ước tay",
            "error"
          );
          setSaving(false);
          return;
        }
      }

      const allowPack =
        form.kind === PRODUCT_KIND.INGREDIENT || boughtFinished;

      const payload = {
        name: form.name,
        kind: form.kind,
        unit: form.unit,
        price: Number(form.price) || 0,
        cost: boughtFinished
          ? Number(form.cost) || 0
          : form.kind === PRODUCT_KIND.FINISHED
            ? recipePreview.unitCost
            : Number(form.cost) || 0,
        costMode: boughtFinished
          ? COST_MODE.MANUAL
          : form.kind === PRODUCT_KIND.FINISHED
            ? COST_MODE.RECIPE
            : COST_MODE.MANUAL,
        groupId:
          form.kind === PRODUCT_KIND.FINISHED
            ? form.groupId || null
            : null,
        active: form.active,
        packaging:
          allowPack && form.packaging?.enabled
            ? {
                enabled: true,
                baseUnit:
                  String(form.packaging?.baseUnit || form.unit || "cái").trim() ||
                  "cái",
              }
            : { enabled: false },
        units: Array.isArray(form.units) ? form.units : [],
        recipe:
          form.kind === PRODUCT_KIND.FINISHED && !boughtFinished
            ? form.recipe.map((l) =>
                l.virtual
                  ? {
                      virtual: true,
                      name: String(l.name || "").trim(),
                      qty: Number(l.qty) || 0,
                      unitCost: Math.max(0, Math.round(Number(l.unitCost) || 0)),
                      productId: "",
                    }
                  : {
                      productId: l.productId,
                      qty: Number(l.qty) || 0,
                      unitId: l.unitId || "",
                      virtual: false,
                    }
              )
            : [],
        _productsById: byId,
      };

      // Sửa món: không ghi đè tồn — Super Admin được sửa tồn nguyên liệu
      if (editingId) {
        if (
          isSuperAdmin &&
          (form.kind === PRODUCT_KIND.INGREDIENT ||
            form.costMode !== COST_MODE.RECIPE)
        ) {
          payload.inStock = Number(form.inStock) || 0;
        }
        await updateProduct(editingId, payload);
      } else {
        await createProduct({
          ...payload,
          inStock: Number(form.inStock) || 0,
        });
      }

      // Cập nhật cost các thành phẩm dùng công thức (khi đổi giá NL)
      await recomputeRecipeCosts();

      showToast(editingId ? "Đã lưu" : "Đã thêm", "success");
      setTab(
        form.kind === PRODUCT_KIND.INGREDIENT ? "ingredient" : "finished"
      );
      setOpen(false);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Lưu thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (row.kind === PRODUCT_KIND.INGREDIENT && !isSuperAdmin) {
      showToast("Chỉ Super Admin được xóa nguyên liệu kho", "error");
      return;
    }
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
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            setTab("ingredient");
            openCreate(PRODUCT_KIND.INGREDIENT);
          }}
          className="touch-btn h-14 flex-col gap-0.5 bg-slate-800 px-2 text-white"
        >
          <span className="text-sm font-extrabold">Thêm nguyên liệu</span>
          <span className="text-[10px] font-medium text-white/80">
            Đường, thùng mì × 30 gói…
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("finished");
            openCreate(PRODUCT_KIND.FINISHED);
          }}
          className="touch-btn h-14 flex-col gap-0.5 bg-amber-600 px-2 text-white"
        >
          <span className="text-sm font-extrabold">Thêm món bán</span>
          <span className="text-[10px] font-medium text-white/80">
            Giá bán · tách gói bán lẻ
          </span>
        </button>
      </div>
      <p className="mb-3 rounded-xl bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-950 ring-1 ring-teal-100">
        <span className="font-extrabold">Cách làm:</span> kho chọn hàng → thùng
        / gói. Thùng: nhập số lẻ + giá thùng, hệ thống chia ra từng gói/chai
        (ĐV nhỏ nhất — bán lẻ hoặc gắn CT món khác). Đá/nước: ước tay.
      </p>
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
          : "Chọn nhóm SP. ↑↓ sắp thứ tự POS — món gọi nhiều để trên."}
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
              const packaging = row.packaging?.enabled
                ? normalizeProductUnits(row)
                : null;
              const stockBase = Number(row.inStock) || 0;
              const stockSummary =
                packaging?.enabled && packaging.units.length > 1
                  ? (() => {
                      const extraUnits = packaging.units
                        .filter((unit) => Number(unit.factor) > 1)
                        .sort((a, b) => b.factor - a.factor);
                      const best = extraUnits[0];
                      if (!best) return `${stockBase} ${packaging.baseUnit}`;
                      return `${stockBase} ${packaging.baseUnit} ≈ ${formatUnitCount(
                        stockBase / best.factor
                      )} ${best.label}`;
                    })()
                  : null;
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
                        {packaging
                          ? `Tồn: ${stockSummary || `${stockBase} ${packaging.baseUnit}`}`
                          : `Đơn vị: ${row.unit || "—"} · Tồn: ${row.inStock ?? 0}`}
                        {row.kind !== PRODUCT_KIND.INGREDIENT &&
                        row.costMode === COST_MODE.RECIPE
                          ? " · Cost theo CT"
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {tab === "finished" ? (
                        <>
                          <button
                            type="button"
                            aria-label="Đưa lên"
                            onClick={() => handleMoveProduct(row, "up")}
                            className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Đưa xuống"
                            onClick={() => handleMoveProduct(row, "down")}
                            className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Sửa"
                        onClick={() => openEdit(row)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {row.kind !== PRODUCT_KIND.INGREDIENT || isSuperAdmin ? (
                      <button
                        type="button"
                        aria-label="Xóa"
                        onClick={() => handleDelete(row)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      ) : null}
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
                  (!Array.isArray(row.recipe) || !row.recipe.length) ? (
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="mt-2 w-full rounded-xl bg-amber-50 px-3 py-2 text-left text-xs font-bold text-amber-950 ring-1 ring-amber-200"
                    >
                      Chưa có công thức — bấm để chọn NL từ kho
                    </button>
                  ) : null}

                  {row.kind !== PRODUCT_KIND.INGREDIENT &&
                  row.costMode === COST_MODE.RECIPE &&
                  Array.isArray(row.recipe) &&
                  row.recipe.length ? (
                    <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
                      {row.recipe.map((line, lineIdx) => {
                        if (line.virtual) {
                          return (
                            <li key={`${row.id}-v-${lineIdx}-${line.name}`}>
                              {line.name || "Ước tay"} × {line.qty} ·{" "}
                              {formatCurrency(line.unitCost || 0)}
                              <span className="ml-1 font-semibold text-amber-700">
                                (không trừ kho)
                              </span>
                            </li>
                          );
                        }
                        const ing = byId[line.productId];
                        const useUnit = line.unitId || ing?.unit || "";
                        const baseQty = ing
                          ? toIngredientBaseQty(ing, line.qty, useUnit)
                          : Number(line.baseQty) || Number(line.qty) || 0;
                        return (
                          <li
                            key={`${row.id}-${line.productId}-${line.qty}-${lineIdx}`}
                          >
                            {ing?.name || "?"} × {line.qty} {useUnit}
                            {ing?.unit && useUnit !== ing.unit ? (
                              <span className="text-slate-400">
                                {" "}
                                = {formatBaseQty(baseQty)} {ing.unit}
                              </span>
                            ) : null}
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

            <div className="mb-3 grid grid-cols-2 gap-2">
              {[
                { id: PRODUCT_KIND.INGREDIENT, label: "Nguyên liệu kho" },
                { id: PRODUCT_KIND.FINISHED, label: "Món bán POS" },
              ].map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() =>
                    setForm((f) => {
                      if (f.kind === k.id) return f;
                      if (k.id === PRODUCT_KIND.INGREDIENT) {
                        return {
                          ...f,
                          kind: PRODUCT_KIND.INGREDIENT,
                          costMode: COST_MODE.MANUAL,
                          price: "",
                          groupId: "",
                          recipe: [],
                          active: true,
                          packaging: {
                            enabled: Boolean(f.packaging?.enabled),
                            baseUnit: f.unit || "g",
                          },
                        };
                      }
                      return {
                        ...f,
                        kind: PRODUCT_KIND.FINISHED,
                        costMode: COST_MODE.RECIPE,
                        groupId: f.groupId || groups[0]?.id || "",
                        packaging: { enabled: false, baseUnit: f.unit || "ly" },
                        units: [],
                        active: true,
                      };
                    })
                  }
                  className={cn(
                    "touch-btn h-11 px-2 text-xs font-bold sm:text-sm",
                    form.kind === k.id
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700"
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {editingId &&
            byId[editingId]?.kind !== form.kind ? (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950 ring-1 ring-amber-100">
                Đang đổi loại hàng. Lưu để áp dụng — món bán mất khỏi POS nếu
                thành nguyên liệu; nguyên liệu lên POS nếu thành món bán.
              </p>
            ) : null}

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
                <span className="mb-1 block text-sm font-semibold">
                  {form.packaging?.enabled ? "Đơn vị gốc" : "Đơn vị"}
                </span>
                {form.packaging?.enabled ? (
                  <input
                    className="field-input"
                    value={form.unit}
                    onChange={(e) => updateBaseUnitField("unit", e.target.value)}
                    placeholder="vd: bao"
                  />
                ) : (
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
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">
                  {editingId ? "Tồn kho (xem)" : "Tồn kho ban đầu"}
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="field-input"
                  value={form.inStock}
                  disabled={
                    Boolean(editingId) &&
                    !(
                      isSuperAdmin &&
                      (form.kind === PRODUCT_KIND.INGREDIENT ||
                        form.costMode !== COST_MODE.RECIPE)
                    )
                  }
                  onChange={(e) =>
                    setForm((f) => ({ ...f, inStock: e.target.value }))
                  }
                />
                {editingId ? (
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {isSuperAdmin &&
                    (form.kind === PRODUCT_KIND.INGREDIENT ||
                      form.costMode !== COST_MODE.RECIPE)
                      ? "Super Admin được sửa tồn hàng nhập."
                      : "Đổi tồn tại Nhập hàng / POS — không ghi đè khi lưu món."}
                  </span>
                ) : null}
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

            {form.kind === PRODUCT_KIND.FINISHED ? (
              <label className="mb-3 flex items-center gap-3 rounded-2xl bg-emerald-50 px-3 py-3 ring-1 ring-emerald-100">
                <input
                  type="checkbox"
                  checked={form.costMode !== COST_MODE.RECIPE}
                  onChange={(e) => {
                    const bought = e.target.checked;
                    setForm((f) => ({
                      ...f,
                      costMode: bought ? COST_MODE.MANUAL : COST_MODE.RECIPE,
                      packaging: bought
                        ? {
                            enabled: Boolean(f.packaging?.enabled),
                            baseUnit: f.unit || "chai",
                          }
                        : { enabled: false, baseUnit: f.unit || "ly" },
                      units: bought ? f.units : [],
                    }));
                  }}
                  className="h-5 w-5 accent-emerald-700"
                />
                <span className="text-sm font-semibold text-slate-800">
                  Hàng nhập bán nguyên (AVIA, thùng × chai — không công thức)
                </span>
              </label>
            ) : null}

            {form.kind === PRODUCT_KIND.INGREDIENT ||
            (form.kind === PRODUCT_KIND.FINISHED &&
              form.costMode !== COST_MODE.RECIPE) ? (
              <label className="mb-3 block">
                <span className="mb-1 block text-sm font-semibold">
                  Giá nhập / đơn vị
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  className="field-input"
                  value={form.cost}
                  onChange={(e) => updateBaseUnitField("cost", e.target.value)}
                  placeholder="vd: 2 hoặc 0.5"
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  {form.kind === PRODUCT_KIND.FINISHED
                    ? "Giá nhập / 1 chai (hoặc ĐV gốc). Thùng × 24: bật kiện bên dưới."
                    : "Giá / 1 đơn vị gốc (g, gói, quả). Thùng mì / túi đường: bật nhập kiện bên dưới."}
                </span>
              </label>
            ) : null}

            {form.kind === PRODUCT_KIND.FINISHED ? (
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
                    onChange={(e) => updateBaseUnitField("price", e.target.value)}
                    placeholder="vd: 5000"
                  />
                </label>
            ) : null}

            {form.kind === PRODUCT_KIND.FINISHED &&
            form.costMode === COST_MODE.RECIPE ? (
                <div className="mb-3 space-y-3 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-100">
                    <p className="text-sm font-bold text-amber-900">
                      Công thức mỗi suất
                    </p>
                    <p className="text-xs leading-relaxed text-amber-900/80">
                      Chọn nguyên liệu hoặc thành phẩm nhập (gói mì, chai…).
                      Gói mì vừa bán lẻ POS vừa gắn CT: bát mì = 1 gói + nước
                      sôi; mì 1 trứng = 1 gói + 1 trứng + nước. Đá/nước: Ước
                      tay.
                    </p>
                    <p className="text-[11px] font-semibold text-amber-950">
                      Kho: {recipeStockItems.length} hàng (NL + thành phẩm)
                    </p>
                    <input
                      type="search"
                      className="field-input py-2 text-sm"
                      placeholder="Tìm NL / thành phẩm…"
                      value={recipeSearch}
                      onChange={(e) => setRecipeSearch(e.target.value)}
                    />

                    <div className="space-y-2 rounded-xl bg-white/80 p-2.5 ring-1 ring-amber-100">
                      {form.recipe.map((line, idx) =>
                        line.virtual ? (
                          <div
                            key={`r-v-${idx}`}
                            className="space-y-1.5 rounded-xl bg-amber-50/80 p-2 ring-1 ring-amber-100"
                          >
                            <div className="grid grid-cols-[1fr_4.5rem_2.5rem] gap-2">
                              <input
                                className="field-input py-2 text-sm"
                                placeholder="Tên (Đá, Nước sôi…)"
                                value={line.name || ""}
                                onChange={(e) =>
                                  setForm((f) => {
                                    const recipe = [...f.recipe];
                                    recipe[idx] = {
                                      ...recipe[idx],
                                      name: e.target.value,
                                      virtual: true,
                                    };
                                    return { ...f, recipe };
                                  })
                                }
                              />
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
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className="field-input money flex-1 py-2 text-sm"
                                placeholder="Cost ước (đ)"
                                value={line.unitCost ?? ""}
                                onChange={(e) =>
                                  setForm((f) => {
                                    const recipe = [...f.recipe];
                                    recipe[idx] = {
                                      ...recipe[idx],
                                      unitCost: e.target.value,
                                    };
                                    return { ...f, recipe };
                                  })
                                }
                              />
                              <span className="shrink-0 text-[10px] font-bold text-amber-800">
                                Không trừ kho
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div
                            key={`r-${idx}`}
                            className="space-y-1.5 rounded-xl bg-white p-2 ring-1 ring-amber-100"
                          >
                            {(() => {
                              const items = recipeSourceOptions(line.productId);
                              const nls = items.filter(
                                (p) => p.kind === PRODUCT_KIND.INGREDIENT
                              );
                              const tps = items.filter(
                                (p) => p.kind !== PRODUCT_KIND.INGREDIENT
                              );
                              return (
                                  <select
                                    className="field-input w-full py-2 text-sm"
                                    value={line.productId || ""}
                                    onChange={(e) =>
                                      setForm((f) => {
                                        const nextId = e.target.value;
                                        const ing = byId[nextId];
                                        const recipe = [...f.recipe];
                                        recipe[idx] = {
                                          ...recipe[idx],
                                          productId: nextId,
                                          unitId: ing?.unit || "",
                                        };
                                        return { ...f, recipe };
                                      })
                                    }
                                  >
                                    <option value="">
                                      — Chọn NL / thành phẩm —
                                    </option>
                                    {nls.length ? (
                                      <optgroup label="Nguyên liệu">
                                        {nls.map((ing) => (
                                          <option key={ing.id} value={ing.id}>
                                            {ing.name} ·{" "}
                                            {formatCurrency(ing.cost)}/{ing.unit}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ) : null}
                                    {tps.length ? (
                                      <optgroup label="Thành phẩm nhập">
                                        {tps.map((ing) => (
                                          <option key={ing.id} value={ing.id}>
                                            {ing.name} ·{" "}
                                            {formatCurrency(ing.cost)}/{ing.unit}
                                          </option>
                                        ))}
                                      </optgroup>
                                    ) : null}
                                  </select>
                              );
                            })()}
                            <div className="grid grid-cols-[1fr_5.5rem_2.5rem] gap-2">
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
                              <select
                                className="field-input py-2 text-sm"
                                value={
                                  line.unitId ||
                                  byId[line.productId]?.unit ||
                                  ""
                                }
                                onChange={(e) =>
                                  setForm((f) => {
                                    const recipe = [...f.recipe];
                                    recipe[idx] = {
                                      ...recipe[idx],
                                      unitId: e.target.value,
                                    };
                                    return { ...f, recipe };
                                  })
                                }
                              >
                                {usageUnitsForIngredient(
                                  byId[line.productId] || { unit: "g" }
                                ).map((u) => (
                                  <option key={`${u.id}-${u.label}`} value={u.id}>
                                    {u.label}
                                  </option>
                                ))}
                              </select>
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
                            {(() => {
                              const ing = byId[line.productId];
                              if (!ing) return null;
                              const useUnit = line.unitId || ing.unit;
                              const baseQty = toIngredientBaseQty(
                                ing,
                                line.qty,
                                useUnit
                              );
                              const lineCost = recipeLineCost(
                                {
                                  ...line,
                                  qty: Number(line.qty) || 0,
                                  unitId: useUnit,
                                },
                                ing
                              );
                              return (
                                <p className="text-[11px] font-semibold text-amber-900/80">
                                  {line.qty || 0} {useUnit} ={" "}
                                  {formatBaseQty(baseQty)} {ing.unit} ·{" "}
                                  {formatCurrency(lineCost)}
                                </p>
                              );
                            })()}
                          </div>
                        )
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => addRecipeLine()}
                          className="touch-btn h-10 w-full gap-1 bg-amber-100 text-xs font-bold text-amber-950"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Từ kho
                        </button>
                        <button
                          type="button"
                          onClick={() => addRecipeLine({ virtual: true })}
                          className="touch-btn h-10 w-full gap-1 bg-white text-xs font-bold text-amber-950 ring-1 ring-amber-200"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Ước tay
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 rounded-xl bg-amber-100/80 px-3 py-2.5 text-sm text-amber-950">
                      <p className="font-extrabold">Cost / suất</p>
                      <p className="money text-base font-extrabold">
                        {formatCurrency(recipePreview.unitCost)}
                        {form.price ? (
                          <span className="ml-2 font-semibold text-emerald-800">
                            · Giá bán {formatCurrency(Number(form.price) || 0)}
                            {" · "}Lãi {formatCurrency(recipePreview.margin)}
                            {Number(form.price) > 0 ? (
                              <span className="font-semibold">
                                {" "}
                                (
                                {Math.round(
                                  (recipePreview.margin / Number(form.price)) *
                                    100
                                )}
                                %)
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
            ) : null}

            {form.kind === PRODUCT_KIND.INGREDIENT ||
            (form.kind === PRODUCT_KIND.FINISHED &&
              form.costMode !== COST_MODE.RECIPE) ? (
              <div className="mb-3 space-y-3">
                <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={Boolean(form.packaging?.enabled)}
                    onChange={(e) => setPackagingEnabled(e.target.checked)}
                    className="h-5 w-5 accent-brand-700"
                  />
                  <span className="text-sm font-semibold text-slate-800">
                    {form.kind === PRODUCT_KIND.FINISHED
                      ? "Nhập thùng (vd AVIA 1 thùng = 24 chai)"
                      : "Nhập kiện (thùng × gói, cây thuốc × bao)"}
                  </span>
                </label>

                {form.packaging?.enabled ? (
                  <div className="space-y-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">
                        Đơn vị bán / nhập
                      </p>
                      <button
                        type="button"
                        onClick={addPackagingUnit}
                        className="touch-btn h-10 shrink-0 bg-white px-3 text-xs font-bold text-slate-700 ring-1 ring-slate-200"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Thêm dòng
                      </button>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Dòng hệ số 1 = gốc tồn/CT (gói). Dòng thùng ×30 = nhập
                      kiện. Bán lẻ gói: tạo món POS + CT 1 gói, không bán NL.
                    </p>
                    <div className="space-y-2">
                      {form.units.map((unit, index) => {
                        const isBase = Number(unit.factor) === 1;
                        return (
                          <div
                            key={unit.id || `${index}`}
                            className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_5.5rem_6rem_6rem_4rem_4rem_2.75rem]"
                          >
                            <input
                              className="field-input py-2 text-sm"
                              value={unit.label}
                              onChange={(e) =>
                                updatePackagingUnit(index, {
                                  label: e.target.value,
                                })
                              }
                              placeholder="Tên đơn vị"
                            />
                            <input
                              type="number"
                              min={isBase ? 1 : 2}
                              step="1"
                              className="field-input py-2 text-sm"
                              value={unit.factor}
                              disabled={isBase}
                              onChange={(e) =>
                                updatePackagingUnit(index, {
                                  factor: e.target.value,
                                })
                              }
                              placeholder="Hệ số"
                            />
                            <input
                              type="number"
                              min="0"
                              step="any"
                              className="field-input py-2 text-sm"
                              value={unit.sellPrice}
                              onChange={(e) =>
                                updatePackagingUnit(index, {
                                  sellPrice: e.target.value,
                                })
                              }
                              placeholder="Giá bán"
                            />
                            <input
                              type="number"
                              min="0"
                              step="any"
                              className="field-input py-2 text-sm"
                              value={unit.sellCost}
                              onChange={(e) =>
                                updatePackagingUnit(index, {
                                  sellCost: e.target.value,
                                })
                              }
                              placeholder="Giá vốn"
                            />
                            <label className="flex items-center justify-center rounded-xl bg-white px-2 ring-1 ring-slate-200">
                              <input
                                type="checkbox"
                                checked={unit.canSell !== false}
                                onChange={(e) =>
                                  updatePackagingUnit(index, {
                                    canSell: e.target.checked,
                                  })
                                }
                                className="h-4 w-4 accent-brand-700"
                              />
                              <span className="sr-only">Bán</span>
                            </label>
                            <label className="flex items-center justify-center rounded-xl bg-white px-2 ring-1 ring-slate-200">
                              <input
                                type="checkbox"
                                checked={unit.canReceive !== false}
                                onChange={(e) =>
                                  updatePackagingUnit(index, {
                                    canReceive: e.target.checked,
                                  })
                                }
                                className="h-4 w-4 accent-brand-700"
                              />
                              <span className="sr-only">Nhập</span>
                            </label>
                            <button
                              type="button"
                              aria-label="Xóa đơn vị"
                              disabled={isBase}
                              onClick={() => removePackagingUnit(index)}
                              className={cn(
                                "flex h-11 items-center justify-center rounded-xl ring-1",
                                isBase
                                  ? "bg-slate-100 text-slate-300 ring-slate-200"
                                  : "bg-white text-rose-600 ring-rose-100"
                              )}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

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
