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
  BottomSheet,
  ChipRow,
  EmptyState,
  FieldLabel,
  FilterChip,
  SectionHeader,
} from "@/components/ui/MobileUI";
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
  ensureRecipeDraftLines,
  isRecipeStockSource,
  migrateRecipeQty,
  productUsesRecipe,
  recipeLineCost,
} from "@/lib/recipe";
import { normalizeProductUnits } from "@/lib/packaging";
import {
  PACKAGING_PRESETS,
  buildRetailPackPreset,
  defaultIngredientPackHint,
} from "@/lib/packaging";
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

  const openEdit = (row, { addRecipe = false } = {}) => {
    setEditingId(row.id);
    setRecipeSearch("");
    const useRecipe =
      row.kind !== PRODUCT_KIND.INGREDIENT &&
      (addRecipe || productUsesRecipe(row));
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
    if (useRecipe) {
      recipe = ensureRecipeDraftLines(recipe);
    }
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
  }, [form.kind, form.costMode, form.recipe, form.price, byId]);

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
      const retail = Number(f.price) || 0;
      const cost = Number(f.cost) || 0;
      const isFinishedBought =
        f.kind === PRODUCT_KIND.FINISHED && f.costMode !== COST_MODE.RECIPE;
      const hasPack = (Array.isArray(f.units) ? f.units : []).some(
        (u) => Number(u.factor) > 1
      );
      if (hasPack) {
        return {
          ...f,
          packaging: { enabled: true, baseUnit },
          units: ensureBaseUnitRow(f.units, baseUnit, retail, cost),
        };
      }
      const preset = buildRetailPackPreset({
        baseUnit,
        retailPrice: retail,
        baseCost: cost,
        canSellPack: isFinishedBought || f.kind === PRODUCT_KIND.INGREDIENT,
      });
      // NL: mặc định bán lẻ tắt trên kiện (chỉ nhập); thành phẩm: bán cả lẻ + kiện.
      if (f.kind === PRODUCT_KIND.INGREDIENT) {
        preset.units = preset.units.map((u) =>
          Number(u.factor) > 1 ? { ...u, canSell: false } : u
        );
      }
      return {
        ...f,
        unit: preset.unit,
        packaging: preset.packaging,
        units: preset.units,
      };
    });
  };

  const applyPackagingPreset = (presetId) => {
    const meta = PACKAGING_PRESETS.find((p) => p.id === presetId);
    if (!meta) return;
    setForm((f) => {
      const preset = buildRetailPackPreset({
        baseUnit: meta.baseUnit,
        packLabel: meta.packLabel,
        packFactor: meta.packFactor,
        retailPrice: Number(f.price) || 0,
        packPrice: 0,
        baseCost: Number(f.cost) || 0,
        canSellPack:
          f.kind === PRODUCT_KIND.FINISHED && f.costMode !== COST_MODE.RECIPE
            ? true
            : f.kind === PRODUCT_KIND.INGREDIENT
              ? false
              : true,
      });
      if (f.kind === PRODUCT_KIND.INGREDIENT) {
        preset.units = preset.units.map((u) =>
          Number(u.factor) > 1 ? { ...u, canSell: false } : { ...u, canSell: false }
        );
      }
      return {
        ...f,
        unit: preset.unit,
        price: String(preset.price || f.price || ""),
        packaging: preset.packaging,
        units: preset.units,
      };
    });
  };

  const addPackagingUnit = () => {
    setForm((f) => {
      const hint = defaultIngredientPackHint(
        f.packaging?.baseUnit || f.unit || "cái"
      );
      const nextRow = createUnitRow({
        id: makeUnitId(`unit-${f.units.length + 1}-${Date.now()}`),
        label: hint.packLabel || "thùng",
        factor: Number(hint.packFactor) || 10,
        sellPrice: 0,
        sellCost:
          (Number(f.cost) || 0) * (Number(hint.packFactor) || 10),
        canSell:
          f.kind === PRODUCT_KIND.FINISHED && f.costMode !== COST_MODE.RECIPE,
        canReceive: true,
      });
      return { ...f, units: [...f.units, nextRow] };
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

      // Sửa món: không ghi đè tồn — Super Admin được sửa tồn hàng nhập;
      // món CT luôn inStock = 0
      if (editingId) {
        if (boughtFinished || form.kind === PRODUCT_KIND.INGREDIENT) {
          if (isSuperAdmin) {
            payload.inStock = Number(form.inStock) || 0;
          }
        } else {
          payload.inStock = 0;
        }
        await updateProduct(editingId, payload);
      } else {
        // Tồn chỉ qua Nhập hàng (trừ quỹ) — không seed tồn khi tạo món.
        await createProduct({
          ...payload,
          inStock: 0,
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
          className="touch-btn h-14 gap-2 bg-slate-800 px-3 text-white"
        >
          <Plus className="h-5 w-5" aria-hidden />
          <span className="text-sm font-bold">Thêm nguyên liệu</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("finished");
            openCreate(PRODUCT_KIND.FINISHED);
          }}
          className="touch-btn h-14 gap-2 bg-brand-700 px-3 text-white"
        >
          <Plus className="h-5 w-5" aria-hidden />
          <span className="text-sm font-bold">Thêm món bán</span>
        </button>
      </div>

      <ChipRow className="mb-4">
        <FilterChip
          active={tab === "finished"}
          onClick={() => setTab("finished")}
        >
          Thành phẩm ({finished.length})
        </FilterChip>
        <FilterChip
          active={tab === "ingredient"}
          onClick={() => setTab("ingredient")}
        >
          Nguyên liệu ({ingredients.length})
        </FilterChip>
        <FilterChip
          active={tab === "groups"}
          onClick={() => setTab("groups")}
        >
          Nhóm SP ({groups.length})
        </FilterChip>
      </ChipRow>

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
            className="touch-btn h-14 flex-1 gap-2 bg-brand-700 text-white"
          >
            <Plus className="h-5 w-5" />
            {tab === "ingredient" ? "Thêm nguyên liệu" : "Thêm món bán"}
          </button>
        </div>
      ) : null}

      {tab === "finished" ? (
        <ChipRow className="mb-3">
          <FilterChip
            active={groupFilter === "all"}
            onClick={() => setGroupFilter("all")}
          >
            Tất cả
          </FilterChip>
          {groups.map((g) => (
            <FilterChip
              key={g.id}
              active={groupFilter === g.id}
              onClick={() => setGroupFilter(g.id)}
            >
              {g.name}
            </FilterChip>
          ))}
          <FilterChip
            active={groupFilter === "none"}
            onClick={() => setGroupFilter("none")}
          >
            Chưa nhóm
          </FilterChip>
        </ChipRow>
      ) : null}

      {products.length === 0 && !loading ? (
        <EmptyState
          className="mb-4"
          icon={Package}
          title="Chưa có danh mục"
          description="Tạo nhanh trà đá + nguyên liệu mẫu."
          action={
            <button
              type="button"
              disabled={seeding}
              onClick={handleSeed}
              className="touch-btn h-12 w-full gap-2 bg-brand-700 text-white"
            >
              <Package className="h-5 w-5" />
              {seeding ? "Đang tạo..." : "Tạo danh mục mẫu"}
            </button>
          }
        />
      ) : null}

      {tab === "groups" ? (
        <section className="mb-6 space-y-3">
          <SectionHeader
            title="Nhóm sản phẩm"
            hint="POS chia theo nhóm · xóa chỉ Admin"
          />

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
              className="touch-btn h-14 shrink-0 bg-brand-700 px-4 text-white"
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
                className="touch-btn h-14 shrink-0 bg-slate-100 px-3 text-slate-700"
              >
                Hủy
              </button>
            ) : null}
          </form>

          {groups.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Chưa có nhóm"
              description="Thêm nhóm để chia POS."
            />
          ) : (
            groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200"
              >
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-slate-900">
                    {g.name}
                  </p>
                  <p className="text-sm text-slate-400">
                    {finished.filter((p) => p.groupId === g.id).length} món · thứ
                    tự {g.sortOrder ?? 0}
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
                    className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {canDeleteProductGroups ? (
                    <button
                      type="button"
                      aria-label="Xóa nhóm"
                      onClick={() => handleDeleteGroup(g)}
                      className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </section>
      ) : null}

      {tab !== "groups" ? (
        <p className="mb-3 text-sm text-slate-500">
          {tab === "ingredient"
            ? "Giá mua / đơn vị · CT tự cộng cost."
            : "↑↓ sắp thứ tự POS · món gọi nhiều để trên."}
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
                      <p className="truncate text-lg font-bold text-slate-900">
                        {row.name}
                      </p>
                      <p className="text-sm font-medium text-slate-400">
                        {row.kind !== PRODUCT_KIND.INGREDIENT
                          ? `${groupLabel} · `
                          : ""}
                        {productUsesRecipe(row)
                          ? "Không tồn món · trừ NL/TP trong CT"
                          : packaging
                            ? `Tồn: ${stockSummary || `${stockBase} ${packaging.baseUnit}`}`
                            : `Đơn vị: ${row.unit || "—"} · Tồn: ${row.inStock ?? 0}`}
                        {row.kind !== PRODUCT_KIND.INGREDIENT &&
                        productUsesRecipe(row)
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
                            className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Đưa xuống"
                            onClick={() => handleMoveProduct(row, "down")}
                            className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Sửa món"
                        onClick={() => openEdit(row)}
                        className="flex h-12 items-center gap-1 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-800"
                      >
                        <Pencil className="h-4 w-4" />
                        Sửa
                      </button>
                      {row.kind !== PRODUCT_KIND.INGREDIENT || isSuperAdmin ? (
                      <button
                        type="button"
                        aria-label="Xóa"
                        onClick={() => handleDelete(row)}
                        className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      ) : null}
                    </div>
                  </div>

                  {row.kind === PRODUCT_KIND.INGREDIENT ? (
                    <p className="money mt-2 text-lg font-bold text-brand-800">
                      <Money amount={cost} />
                      <span className="text-sm font-semibold text-slate-400">
                        {" "}
                        / {row.unit}
                      </span>
                    </p>
                  ) : (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-sm font-semibold text-slate-400">
                          Giá bán
                        </p>
                        <p className="money text-base font-bold text-brand-800">
                          <Money amount={row.price} />
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-400">
                          Cost
                        </p>
                        <p className="money text-base font-bold text-slate-800">
                          <Money amount={cost} />
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-400">
                          Lãi/đv
                        </p>
                        <p
                          className={cn(
                            "money text-base font-bold",
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
                      onClick={() => openEdit(row, { addRecipe: true })}
                      className="mt-2 w-full rounded-xl bg-white px-3 py-3 text-left text-sm font-bold text-brand-800 ring-1 ring-brand-100"
                    >
                      Chưa có CT — bấm để thêm
                    </button>
                  ) : null}

                  {row.kind !== PRODUCT_KIND.INGREDIENT &&
                  productUsesRecipe(row) &&
                  Array.isArray(row.recipe) &&
                  row.recipe.length ? (
                    <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-500">
                      {row.recipe.map((line, lineIdx) => {
                        if (line.virtual) {
                          return (
                            <li key={`${row.id}-v-${lineIdx}-${line.name}`}>
                              {line.name || "Ước tay"} × {line.qty} ·{" "}
                              {formatCurrency(line.unitCost || 0)}
                              <span className="ml-1 font-semibold text-slate-600">
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
          <EmptyState
            icon={Package}
            title="Chưa có mục nào"
            description="Thêm món hoặc đổi bộ lọc nhóm."
            action={
              <button
                type="button"
                onClick={() =>
                  openCreate(
                    tab === "ingredient"
                      ? PRODUCT_KIND.INGREDIENT
                      : PRODUCT_KIND.FINISHED
                  )
                }
                className="touch-btn h-12 w-full gap-2 bg-brand-700 text-white"
              >
                <Plus className="h-5 w-5" />
                {tab === "ingredient" ? "Thêm nguyên liệu" : "Thêm món bán"}
              </button>
            }
          />
        ) : null}
      </div>
      ) : null}

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={`${editingId ? "Sửa" : "Thêm"} ${
          form.kind === PRODUCT_KIND.INGREDIENT ? "nguyên liệu" : "món bán"
        }`}
        labelledBy="products-form-sheet"
        footer={
          <button
            type="submit"
            form="products-form"
            disabled={saving}
            className="touch-btn h-14 w-full bg-brand-700 text-white disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        }
      >
          <form id="products-form" onSubmit={handleSave} className="space-y-3">
            <ChipRow>
              {[
                { id: PRODUCT_KIND.INGREDIENT, label: "Nguyên liệu kho" },
                { id: PRODUCT_KIND.FINISHED, label: "Món bán POS" },
              ].map((k) => (
                <FilterChip
                  key={k.id}
                  active={form.kind === k.id}
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
                >
                  {k.label}
                </FilterChip>
              ))}
            </ChipRow>
            {editingId &&
            byId[editingId]?.kind !== form.kind ? (
              <p className="alert-soft">
                Đang đổi loại hàng — lưu để áp dụng.
              </p>
            ) : null}

            <label className="block">
              <FieldLabel>Tên</FieldLabel>
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

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <FieldLabel>
                  {form.packaging?.enabled ? "Đơn vị gốc" : "Đơn vị"}
                </FieldLabel>
                {form.packaging?.enabled ? (
                  <>
                    <input
                      className="field-input"
                      list="product-units-list"
                      value={form.unit}
                      onChange={(e) =>
                        updateBaseUnitField("unit", e.target.value)
                      }
                      placeholder="vd: quả"
                    />
                    <datalist id="product-units-list">
                      {PRODUCT_UNITS.map((u) => (
                        <option key={u} value={u} />
                      ))}
                    </datalist>
                  </>
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
                <FieldLabel>
                  {form.kind === PRODUCT_KIND.FINISHED &&
                  form.costMode === COST_MODE.RECIPE
                    ? "Tồn kho"
                    : editingId
                      ? "Tồn kho (xem)"
                      : "Tồn kho"}
                </FieldLabel>
                {form.kind === PRODUCT_KIND.FINISHED &&
                form.costMode === COST_MODE.RECIPE ? (
                  <p className="hint-line rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
                    Món CT không giữ tồn — bán trừ NL/TP trong CT.
                  </p>
                ) : (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="field-input"
                      value={editingId ? form.inStock : "0"}
                      disabled={
                        !editingId ||
                        (Boolean(editingId) &&
                          !(
                            isSuperAdmin &&
                            (form.kind === PRODUCT_KIND.INGREDIENT ||
                              form.costMode !== COST_MODE.RECIPE)
                          ))
                      }
                      onChange={(e) =>
                        setForm((f) => ({ ...f, inStock: e.target.value }))
                      }
                    />
                    {editingId ? (
                      <span className="mt-1 block text-sm text-slate-500">
                        {isSuperAdmin &&
                        (form.kind === PRODUCT_KIND.INGREDIENT ||
                          form.costMode !== COST_MODE.RECIPE)
                          ? "Super Admin được sửa tồn."
                          : "Đổi tồn tại Nhập hàng / POS."}
                      </span>
                    ) : (
                      <span className="mt-1 block text-sm text-slate-500">
                        Tạo món tồn = 0 · nhập tại kho.
                      </span>
                    )}
                  </>
                )}
              </label>
            </div>

            {form.kind === PRODUCT_KIND.FINISHED ? (
              <>
                <label className="block">
                  <FieldLabel>Nhóm sản phẩm (POS)</FieldLabel>
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
                <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
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
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-100">
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
                      recipe: bought
                        ? f.recipe
                        : ensureRecipeDraftLines(f.recipe),
                    }));
                  }}
                  className="h-5 w-5 accent-brand-700"
                />
                <span className="text-sm font-semibold text-slate-800">
                  Hàng nhập bán nguyên (AVIA…). Bỏ tick để dùng công thức.
                </span>
              </label>
            ) : null}
            {form.kind === PRODUCT_KIND.FINISHED &&
            form.costMode !== COST_MODE.RECIPE ? (
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    costMode: COST_MODE.RECIPE,
                    packaging: { enabled: false, baseUnit: f.unit || "ly" },
                    units: [],
                    recipe: ensureRecipeDraftLines(f.recipe),
                  }))
                }
                className="w-full rounded-2xl bg-white px-3 py-3 text-left text-sm font-bold text-brand-800 ring-1 ring-brand-100"
              >
                Thêm / sửa công thức
              </button>
            ) : null}

            {form.kind === PRODUCT_KIND.INGREDIENT ||
            (form.kind === PRODUCT_KIND.FINISHED &&
              form.costMode !== COST_MODE.RECIPE) ? (
              <label className="block">
                <FieldLabel>Giá nhập / đơn vị</FieldLabel>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  className="field-input money"
                  value={form.cost}
                  onChange={(e) => updateBaseUnitField("cost", e.target.value)}
                  placeholder="vd: 2 hoặc 0.5"
                />
              </label>
            ) : null}

            {form.kind === PRODUCT_KIND.FINISHED ? (
                <label className="block">
                  <FieldLabel>Giá bán</FieldLabel>
                  <input
                    type="number"
                    min="0"
                    required
                    className="field-input money"
                    value={form.price}
                    onChange={(e) => updateBaseUnitField("price", e.target.value)}
                    placeholder="vd: 5000"
                  />
                </label>
            ) : null}

            {form.kind === PRODUCT_KIND.FINISHED &&
            form.costMode === COST_MODE.RECIPE ? (
                <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                    <p className="text-sm font-bold text-slate-900">
                      Công thức mỗi suất · {recipeStockItems.length} hàng kho
                    </p>
                    <p className="hint-line">
                      Chọn NL/TP từ kho hoặc thêm dòng ước tay (không trừ kho).
                    </p>
                    <input
                      type="search"
                      className="field-input text-sm"
                      placeholder="Tìm NL / thành phẩm…"
                      value={recipeSearch}
                      onChange={(e) => setRecipeSearch(e.target.value)}
                    />

                    <div className="space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-100">
                      {form.recipe.map((line, idx) =>
                        line.virtual ? (
                          <div
                            key={`r-v-${idx}`}
                            className="space-y-1.5 rounded-xl bg-white p-2 ring-1 ring-slate-200"
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
                                className="flex h-12 items-center justify-center rounded-xl bg-white text-rose-600 ring-1 ring-rose-100"
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
                              <span className="shrink-0 text-sm font-bold text-slate-600">
                                Không trừ kho
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div
                            key={`r-${idx}`}
                            className="space-y-1.5 rounded-xl bg-white p-2 ring-1 ring-slate-200"
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
                                className="flex h-12 items-center justify-center rounded-xl bg-white text-rose-600 ring-1 ring-rose-100"
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
                                <p className="text-sm font-semibold text-slate-600">
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
                          className="touch-btn h-12 w-full gap-1 bg-brand-700 text-sm font-bold text-white"
                        >
                          <Plus className="h-4 w-4" />
                          Từ kho
                        </button>
                        <button
                          type="button"
                          onClick={() => addRecipeLine({ virtual: true })}
                          className="touch-btn h-12 w-full gap-1 bg-white text-sm font-bold text-slate-800 ring-1 ring-slate-200"
                        >
                          <Plus className="h-4 w-4" />
                          Ước tay
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-900 ring-1 ring-slate-100">
                      <p className="font-bold">Cost / suất</p>
                      <p className="money text-lg font-bold">
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
              <div className="space-y-3">
                <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={Boolean(form.packaging?.enabled)}
                    onChange={(e) => setPackagingEnabled(e.target.checked)}
                    className="h-5 w-5 accent-brand-700"
                  />
                  <span className="text-sm font-semibold text-slate-800">
                    Nhiều đơn vị — bán lẻ &amp; kiện
                  </span>
                </label>

                {form.packaging?.enabled ? (
                  <div className="space-y-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">
                        Giá theo từng đơn vị
                      </p>
                      <button
                        type="button"
                        onClick={addPackagingUnit}
                        className="touch-btn h-11 shrink-0 bg-white px-3 text-sm font-bold text-slate-700 ring-1 ring-slate-200"
                      >
                        <Plus className="h-4 w-4" />
                        Thêm dòng
                      </button>
                    </div>
                    <ChipRow>
                      {PACKAGING_PRESETS.map((p) => (
                        <FilterChip
                          key={p.id}
                          onClick={() => applyPackagingPreset(p.id)}
                        >
                          {p.label}
                        </FilterChip>
                      ))}
                    </ChipRow>
                    <div className="hidden grid-cols-2 gap-2 text-xs font-bold uppercase tracking-wide text-slate-400 sm:grid sm:grid-cols-[1.4fr_5.5rem_6rem_6rem_4rem_4rem_2.75rem]">
                      <span>Tên ĐV</span>
                      <span>Hệ số</span>
                      <span>Giá bán</span>
                      <span>Giá vốn</span>
                      <span className="text-center">Bán</span>
                      <span className="text-center">Nhập</span>
                      <span />
                    </div>
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
                              placeholder={isBase ? "bao / gói" : "cây / thùng"}
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
                              title="1 kiện = ? đơn vị gốc"
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
                              placeholder={
                                isBase ? "Giá bán lẻ" : "Giá bán kiện"
                              }
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
                            <label className="flex items-center justify-center gap-1 rounded-xl bg-white px-2 ring-1 ring-slate-200">
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
                              <span className="text-xs font-bold text-slate-600 sm:sr-only">
                                Bán
                              </span>
                            </label>
                            <label className="flex items-center justify-center gap-1 rounded-xl bg-white px-2 ring-1 ring-slate-200">
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
                              <span className="text-xs font-bold text-slate-600 sm:sr-only">
                                Nhập
                              </span>
                            </label>
                            <button
                              type="button"
                              aria-label="Xóa đơn vị"
                              disabled={isBase}
                              onClick={() => removePackagingUnit(index)}
                              className={cn(
                                "flex h-12 items-center justify-center rounded-xl ring-1",
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
          </form>
      </BottomSheet>
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
