'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  ClipboardList,
  History,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money, MetricTile, StatCard } from "@/components/StatusBadges";
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
import { receiveInventoryPaid, previewInventoryFundBackfill, backfillInventoryFundFromStock } from "@/lib/expenses";
import {
  fundSourceLabel,
  listProductReceiveHistory,
  paymentMethodLabel,
  summarizeProductReceiveHistory,
} from "@/lib/inventoryReceiveHistory";
import { subscribeCollection } from "@/lib/liveCollection";
import { db } from "@/lib/firebase";
import { subscribeShareholderCapital } from "@/lib/shareholderCapital";
import {
  buildIngredientPackUnits,
  defaultIngredientPackHint,
  defaultReceiveUnit,
  deriveReceiveCostUpdate,
  findUnit,
  largestPackUnit,
  normalizeProductUnits,
  receiveUnitChoices,
  withReceivePack,
} from "@/lib/packaging";
import {
  COST_MODE,
  PRODUCT_KIND,
  PRODUCT_UNITS,
  createProduct,
  deleteProduct,
  isSellable,
  recomputeRecipeCosts,
  subscribeProducts,
  updateProduct,
  zeroRecipeProductStocks,
} from "@/lib/products";
import { isInventoryReceivable, productUsesRecipe } from "@/lib/recipe";
import { lineStockCostValue, summarizeInventory } from "@/lib/stock";
import {
  buildStocktakeLine,
  isStocktakeTarget,
  summarizeStocktake,
} from "@/lib/stocktake";
import { commitStocktake } from "@/lib/stocktakeWrite";
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

function resolvePackPayload({
  packEnabled,
  packLabel,
  packFactor,
  unit,
  cost,
  canSell = false,
  sellPrice = 0,
}) {
  if (!packEnabled) return {};
  const factor = Math.max(0, Math.round(Number(packFactor) || 0));
  if (factor < 2) {
    throw new Error("Nhập hệ số kiện (vd 24 chai / thùng, 30 gói / thùng)");
  }
  const base = String(unit || "gói").trim() || "gói";
  const pack = String(packLabel || "thùng").trim() || "thùng";
  if (base.toLowerCase() === pack.toLowerCase()) {
    throw new Error("Đơn vị gốc phải khác kiện nhập (vd gốc chai, kiện thùng)");
  }
  return buildIngredientPackUnits({
    baseUnit: base,
    packLabel: pack,
    packFactor: factor,
    baseCost: cost,
    canSell,
    sellPrice,
  });
}

function isRecipeFinished(product) {
  return productUsesRecipe(product);
}

function stockLine(product) {
  const qty = Number(product.inStock) || 0;
  const base = product.packaging?.baseUnit || product.unit || "đv";
  const pack = largestPackUnit(product);
  if (!pack) return `${qty} ${base}`;
  return `${qty} ${base} ≈ ${formatUnitCount(qty / pack.factor)} ${pack.label}`;
}

function formatReceiveHistoryTime(row) {
  if (row?.dateMs) {
    try {
      return format(new Date(row.dateMs), "HH:mm · dd/MM/yyyy", { locale: vi });
    } catch {
      /* fall through */
    }
  }
  return row?.businessDate || "—";
}

const emptyForm = (kind = PRODUCT_KIND.INGREDIENT) => {
  const isFin = kind === PRODUCT_KIND.FINISHED;
  const unit = isFin ? "chai" : "g";
  const hint = defaultIngredientPackHint(unit);
  return {
    kind: isFin ? PRODUCT_KIND.FINISHED : PRODUCT_KIND.INGREDIENT,
    name: "",
    unit,
    inStock: "",
    cost: "",
    price: "",
    groupId: isFin ? "drinks" : "",
    packEnabled: false,
    packLabel: hint.packLabel,
    packFactor: hint.packFactor,
    receiveQty: "",
    fundSource: "shop",
    payMethod: "cash",
  };
};

function InventoryContent() {
  const { showToast } = useToast();
  const {
    user,
    profile,
    canChooseInventoryFundSource,
    canManageProducts,
    canStocktake,
    isSuperAdmin,
  } = useAuth();
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState("ingredient"); // all | ingredient | finished
  const [nameQuery, setNameQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [savingAdd, setSavingAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    unit: "g",
    cost: "",
    price: "",
    inStock: "",
    packEnabled: false,
    packLabel: "thùng",
    packFactor: "30",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [stocktakeOn, setStocktakeOn] = useState(false);
  const [stockCounts, setStockCounts] = useState({});
  const [stocktakeNote, setStocktakeNote] = useState("");
  const [onlyMismatch, setOnlyMismatch] = useState(false);
  const [savingTake, setSavingTake] = useState(false);

  /** per product: { addQty, cost, payMethod, fundSource } */
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [allTx, setAllTx] = useState([]);
  const [capitalEntries, setCapitalEntries] = useState([]);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [backfillPay, setBackfillPay] = useState("cash");
  const [backfilling, setBackfilling] = useState(false);

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

  useEffect(() => {
    const unsub = subscribeShareholderCapital(
      (rows) => setCapitalEntries(rows),
      () => setCapitalEntries([])
    );
    return () => unsub();
  }, []);

  const backfillPreview = useMemo(
    () => previewInventoryFundBackfill(products, allTx),
    [products, allTx]
  );

  const productReceiveHistory = useMemo(() => {
    if (!historyProduct?.id) return [];
    return listProductReceiveHistory(historyProduct.id, {
      transactions: allTx,
      capitalEntries,
    });
  }, [historyProduct, allTx, capitalEntries]);

  const productReceiveSummary = useMemo(
    () => summarizeProductReceiveHistory(productReceiveHistory),
    [productReceiveHistory]
  );

  const visible = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    // Chỉ NL + thành phẩm nhập — ẩn món POS công thức (bát mì…)
    let list = products.filter(isInventoryReceivable);
    if (filter === "ingredient") {
      list = list.filter((p) => p.kind === PRODUCT_KIND.INGREDIENT);
    } else if (filter === "finished") {
      list = list.filter((p) => p.kind === PRODUCT_KIND.FINISHED);
    }
    if (!q) return list;
    return list.filter((p) => String(p.name || "").toLowerCase().includes(q));
  }, [products, filter, nameQuery]);

  const stocktakeAllLines = useMemo(
    () =>
      visible
        .filter(isStocktakeTarget)
        .map((p) => buildStocktakeLine(p, stockCounts[p.id])),
    [visible, stockCounts]
  );

  const stocktakeRows = useMemo(
    () =>
      stocktakeAllLines.filter(
        (line) => !onlyMismatch || (!line.skipped && line.delta !== 0)
      ),
    [stocktakeAllLines, onlyMismatch]
  );

  const stocktakeSummary = useMemo(
    () => summarizeStocktake(stocktakeAllLines),
    [stocktakeAllLines]
  );

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
      showToast("Nhập tên hàng", "error");
      return;
    }
    const nameKey = String(form.name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const dup = products.find(
      (p) =>
        p.active !== false &&
        String(p.name || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ") === nameKey
    );
    if (dup) {
      showToast(
        `Đã có “${dup.name}” trong danh mục — tìm và nhập trên hàng đó, đừng tạo trùng`,
        "error"
      );
      setShowAdd(false);
      setNameQuery(dup.name);
      return;
    }
    const isFin = form.kind === PRODUCT_KIND.FINISHED;
    const sellPrice = isFin ? parseUnitCostInput(form.price) : 0;
    if (isFin && sellPrice <= 0) {
      showToast("Thành phẩm cần giá bán (POS)", "error");
      return;
    }
    const packOn = Boolean(form.packEnabled);
    const factor = packOn
      ? Math.max(0, Math.round(Number(form.packFactor) || 0))
      : 1;
    const receiveQty = Number(form.receiveQty) || 0;
    const receivePrice = parseUnitCostInput(form.cost);
    const baseCost =
      packOn && factor > 0 ? receivePrice / factor : receivePrice;

    if (receiveQty > 0) {
      if (receivePrice <= 0) {
        showToast("Nhập giá > 0 để trừ quỹ khi cộng tồn lần đầu", "error");
        return;
      }
      if (packOn && factor < 2) {
        showToast("Nhập số lẻ trong 1 kiện (vd 24 chai, 30 gói)", "error");
        return;
      }
    }

    const fundSource =
      canChooseInventoryFundSource && form.fundSource === "capital"
        ? "capital"
        : "shop";
    const payMethod = form.payMethod === "banking" ? "banking" : "cash";

    setSavingAdd(true);
    try {
      const pack = resolvePackPayload({
        packEnabled: packOn,
        packLabel: form.packLabel,
        packFactor: form.packFactor,
        unit: form.unit,
        cost: baseCost,
        canSell: isFin,
        sellPrice,
      });
      const name = form.name.trim();
      const productId = await createProduct({
        name,
        kind: isFin ? PRODUCT_KIND.FINISHED : PRODUCT_KIND.INGREDIENT,
        unit: form.unit || (isFin ? "chai" : "g"),
        inStock: 0,
        cost: baseCost,
        costMode: COST_MODE.MANUAL,
        price: sellPrice,
        groupId: isFin ? form.groupId || "drinks" : null,
        recipe: [],
        active: true,
        ...pack,
      });

      if (receiveQty > 0) {
        const created = {
          id: productId,
          name,
          kind: isFin ? PRODUCT_KIND.FINISHED : PRODUCT_KIND.INGREDIENT,
          unit: form.unit || (isFin ? "chai" : "g"),
          inStock: 0,
          cost: baseCost,
          costMode: COST_MODE.MANUAL,
          price: sellPrice,
          ...pack,
        };
        const { product: ready, unitId } = withReceivePack(created, {
          unitLabel: packOn ? form.packLabel || "thùng" : created.unit,
          packFactor: packOn ? factor : 1,
        });
        const result = await receiveInventoryPaid({
          fundSource,
          product: ready,
          addQty: receiveQty,
          unitId,
          unitCost: receivePrice,
          paymentMethod: payMethod,
          updateCost: true,
          user,
          profile,
        });
        await recomputeRecipeCosts();
        const via = result.paymentMethod === "banking" ? "CK" : "TM";
        const fundLabel =
          result.fundSource === "capital" ? "quỹ đầu tư" : "quỹ cửa hàng";
        showToast(
          `Đã thêm “${name}” · +${result.qty} · trừ ${fundLabel} ${via} ${formatCurrency(result.amount)}`,
          "success"
        );
      } else {
        showToast(
          `Đã thêm “${name}” · tồn 0 · nhập số lượng bên dưới để cộng tồn + trừ quỹ`,
          "success"
        );
      }
      setForm(emptyForm());
      setShowAdd(false);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Thêm nguyên liệu thất bại", "error");
    } finally {
      setSavingAdd(false);
    }
  };

  const openEditProduct = (product) => {
    setShowAdd(false);
    setStocktakeOn(false);
    setEditing(product);
    const pack = largestPackUnit(product);
    setEditForm({
      name: product.name || "",
      unit: product.unit || "g",
      cost:
        product.cost != null && product.cost !== ""
          ? String(product.cost)
          : "",
      inStock:
        product.inStock != null ? String(product.inStock) : "0",
      price:
        product.price != null && product.price !== ""
          ? String(product.price)
          : "",
      packEnabled: Boolean(pack),
      packLabel: pack?.label || defaultIngredientPackHint(product.unit).packLabel,
      packFactor: pack
        ? String(pack.factor)
        : defaultIngredientPackHint(product.unit).packFactor,
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editing?.id) return;
    if (!editForm.name.trim()) {
      showToast("Nhập tên hàng", "error");
      return;
    }
    const isFin = editing.kind === PRODUCT_KIND.FINISHED;
    const sellPrice = isFin ? parseUnitCostInput(editForm.price) : 0;
    if (isFin && sellPrice <= 0) {
      showToast("Thành phẩm cần giá bán (POS)", "error");
      return;
    }
    if (isRecipeFinished(editing)) {
      const ok = window.confirm(
        `“${editing.name}” đang có công thức (trừ NL lúc bán). Lưu trên kho sẽ đổi thành hàng nhập — tồn trừ khi bán, bỏ CT. Tiếp tục?`
      );
      if (!ok) return;
    }
    setSavingEdit(true);
    try {
      const baseCost = parseUnitCostInput(editForm.cost);
      const pack = resolvePackPayload({
        packEnabled: editForm.packEnabled,
        packLabel: editForm.packLabel,
        packFactor: editForm.packFactor,
        unit: editForm.unit,
        cost: baseCost,
        canSell: isFin,
        sellPrice,
      });
      const payload = {
        name: editForm.name.trim(),
        kind: isFin ? PRODUCT_KIND.FINISHED : PRODUCT_KIND.INGREDIENT,
        unit: editForm.unit || (isFin ? "chai" : "g"),
        cost: baseCost,
        costMode: COST_MODE.MANUAL,
        price: sellPrice,
        groupId: isFin ? editing.groupId || "drinks" : null,
        recipe: [],
        active: editing.active !== false,
        packaging: editForm.packEnabled
          ? pack.packaging
          : { enabled: false },
        units: pack.units,
      };
      if (isSuperAdmin) {
        payload.inStock = Number(editForm.inStock) || 0;
      }
      await updateProduct(editing.id, payload);
      await recomputeRecipeCosts();
      showToast(isFin ? "Đã sửa thành phẩm" : "Đã sửa nguyên liệu", "success");
      setEditing(null);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Sửa thất bại", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!isSuperAdmin || !product?.id) return;
    const used = products.some(
      (p) =>
        p.id !== product.id &&
        p.costMode === COST_MODE.RECIPE &&
        Array.isArray(p.recipe) &&
        p.recipe.some((l) => l.productId === product.id)
    );
    const ok = window.confirm(
      used
        ? `“${product.name}” đang dùng trong công thức. Xóa sẽ làm cost lệch — vẫn xóa?`
        : `Xóa “${product.name}” khỏi kho?`
    );
    if (!ok) return;
    setDeletingId(product.id);
    try {
      await deleteProduct(product.id);
      await recomputeRecipeCosts();
      if (editing?.id === product.id) setEditing(null);
      showToast("Đã xóa nguyên liệu", "info");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const handleReceive = async (product) => {
    if (productUsesRecipe(product)) {
      showToast(
        "Món công thức POS không nhập kho — nhập nguyên liệu / thành phẩm mua về",
        "error"
      );
      return;
    }
    const d = drafts[product.id] || {};
    const addQty = Number(d.addQty) || 0;
    const choices = receiveUnitChoices(product);
    const picked =
      choices.find((u) => u.id === d.unitId) ||
      [...choices].sort((a, b) => b.factor - a.factor)[0] ||
      defaultReceiveUnit(product);
    const isPack = Number(picked?.factor) > 1;
    const factor = isPack
      ? Math.max(0, Math.round(Number(d.packFactor) || picked?.factor || 0))
      : 1;
    const { product: ready, unitId } = withReceivePack(product, {
      unitLabel: picked?.label,
      packFactor: factor,
    });
    const selectedUnit = findUnit(ready, unitId) || picked;
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

    if (addQty > 0 && isPack && factor < 2) {
      showToast("Nhập số lẻ trong 1 thùng (vd 24 chai, 30 gói)", "error");
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
          product: ready,
          addQty,
          unitId: selectedUnit?.id,
          unitCost: nextCost,
          paymentMethod: payMethod,
          updateCost: true, // WAC / giá vốn BQ always
          user,
          profile,
        });
        await recomputeRecipeCosts();
        const via = result.paymentMethod === "banking" ? "CK" : "TM";
        const fundLabel =
          result.fundSource === "capital" ? "quỹ đầu tư" : "quỹ cửa hàng";
        showToast(
          `Đã nhập +${result.qty} · trừ ${fundLabel} ${via} ${formatCurrency(result.amount)}` +
            (result.baseUnitCost != null
              ? result.costMethod === "wac"
                ? ` · Giá vốn BQ ${formatCurrency(result.baseUnitCost)}`
                : ` · Giá vốn ${formatCurrency(result.baseUnitCost)}`
              : ""),
          "success"
        );
      } else {
        const payload = {
          updatedAt: serverTimestamp(),
        };
        if (hasCost) {
          const baseCost = nextCost;
          payload.cost = baseCost;
          payload.costMode = COST_MODE.MANUAL;
          const norm = normalizeProductUnits(product);
          if (norm.enabled && norm.units.length) {
            payload.units = norm.units.map((u) => ({
              ...u,
              sellCost: Math.round(
                baseCost * Math.max(1, Number(u.factor) || 1)
              ),
            }));
            payload.packaging = {
              enabled: true,
              baseUnit: norm.baseUnit,
            };
            payload.unit = norm.baseUnit;
          }
        }
        await updateDoc(doc(db, "products", product.id), payload);
        if (hasCost) {
          await recomputeRecipeCosts();
        }
        showToast(
          hasCost
            ? `Đã cập nhật giá vốn · ${product.name}`
            : `Đã cập nhật · ${product.name}`,
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

  const handleStocktake = async () => {
    if (!canStocktake) {
      showToast("Quản lý mới được kiểm kho", "error");
      return;
    }
    const targets = visible.filter(isStocktakeTarget);
    const ok = window.confirm(
      `Ghi tồn thực tế ${stocktakeSummary.mismatch} món lệch?\n\n` +
        `Thừa ${stocktakeSummary.surplusQty} · Thiếu ${stocktakeSummary.shortageQty}\n` +
        `Giá trị lệch: ${formatCurrency(stocktakeSummary.netValue)}\n\n` +
        `Không trừ quỹ — chỉ sửa sổ kho.`
    );
    if (!ok) return;
    setSavingTake(true);
    try {
      const result = await commitStocktake({
        products: targets,
        counts: stockCounts,
        note: stocktakeNote,
        user,
        profile,
      });
      showToast(
        `Đã kiểm kho · ${result.summary.mismatch} món lệch · giá trị lệch ${formatCurrency(result.summary.netValue)}`,
        "success"
      );
      setStockCounts({});
      setStocktakeNote("");
      setOnlyMismatch(false);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Kiểm kho thất bại", "error");
    } finally {
      setSavingTake(false);
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

  const handleZeroRecipeStocks = async () => {
    if (!isSuperAdmin) return;
    const ghost = products.filter(
      (p) => productUsesRecipe(p) && (Number(p.inStock) || 0) !== 0
    );
    if (!ghost.length) {
      showToast("Không có món CT nào còn tồn ảo", "info");
      return;
    }
    const ok = window.confirm(
      `Đưa tồn về 0 cho ${ghost.length} món công thức?\n\n` +
        ghost
          .slice(0, 8)
          .map((p) => `• ${p.name}: ${p.inStock}`)
          .join("\n") +
        (ghost.length > 8 ? `\n… (+${ghost.length - 8})` : "") +
        `\n\nMón nấu không nhập kho — tồn chỉ trừ NL/thành phẩm trong CT.`
    );
    if (!ok) return;
    try {
      const n = await zeroRecipeProductStocks(products);
      showToast(`Đã xóa tồn ảo ${n} món công thức`, "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Không xóa được tồn ảo", "error");
    }
  };

  return (
    <AppShell
      title="Nhập hàng"
      subtitle="Chọn hàng có sẵn · cộng tồn · trừ quỹ"
      dense
    >
      <p className="mb-3 text-sm text-slate-500">
        Chọn hàng có sẵn rồi nhập SL · món nấu tại{" "}
        <Link
          href="/manager/products"
          className="font-semibold text-brand-800 underline"
        >
          Món · giá
        </Link>
        .
      </p>

      {!loading && !backfillPreview.backfillDone && backfillPreview.stockValue > 0 ? (
        <section className="alert-soft mb-4 space-y-3">
          <p className="text-sm font-bold">
            Bù trừ quỹ · tồn cũ chưa trừ tiền
          </p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <MetricTile
              label="Giá trị tồn"
              value={
                <Money amount={backfillPreview.stockValue} />
              }
            />
            <MetricTile
              label="Đã chi nhập"
              value={
                <Money amount={backfillPreview.alreadyCharged} />
              }
            />
            <MetricTile
              label="Cần bù trừ"
              value={
                <span className="text-rose-700">
                  <Money amount={backfillPreview.suggested} />
                </span>
              }
            />
          </div>
          {backfillPreview.suggested > 0 ? (
            <>
              <ChipRow>
                <FilterChip
                  active={backfillPay === "cash"}
                  onClick={() => setBackfillPay("cash")}
                >
                  Tiền mặt
                </FilterChip>
                <FilterChip
                  active={backfillPay === "banking"}
                  onClick={() => setBackfillPay("banking")}
                >
                  Chuyển khoản
                </FilterChip>
              </ChipRow>
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
            <p className="text-sm font-semibold text-emerald-800">
              Đã ghi đủ — không cần bù.
            </p>
          )}
        </section>
      ) : null}

      {backfillPreview.backfillDone ? (
        <p className="mb-4 text-sm font-semibold text-emerald-800">
          Đã bù trừ tồn cũ. Lần nhập mới tự trừ quỹ.
        </p>
      ) : null}

      {isSuperAdmin &&
      products.some(
        (p) => productUsesRecipe(p) && (Number(p.inStock) || 0) !== 0
      ) ? (
        <section className="card-panel mb-4 space-y-2">
          <p className="text-sm font-bold text-slate-900">
            Tồn ảo món CT — đưa về 0
          </p>
          <button
            type="button"
            onClick={handleZeroRecipeStocks}
            className="touch-btn h-12 w-full bg-brand-700 text-sm font-bold text-white"
          >
            Đưa tồn món CT về 0
          </button>
        </section>
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
          <MetricTile
            label="Số món"
            value={loading ? "—" : inventorySummary.skuCount}
          />
          <MetricTile
            label="Tổng SL tồn"
            value={loading ? "—" : inventorySummary.totalQty}
          />
          <MetricTile
            label="Sắp hết ≤5"
            value={
              loading ? (
                "—"
              ) : (
                <span
                  className={
                    inventorySummary.lowStockCount > 0
                      ? "text-amber-800"
                      : undefined
                  }
                >
                  {inventorySummary.lowStockCount}
                </span>
              )
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="card-panel !p-3">
            <p className="text-xs font-semibold text-slate-500">
              Nguyên liệu
            </p>
            <p className="mt-1 text-sm font-bold text-slate-900">
              SL {loading ? "—" : inventorySummary.ingredientQty}
            </p>
            <p className="money mt-0.5 text-xs font-bold text-slate-700">
              {loading ? (
                "—"
              ) : (
                <Money amount={inventorySummary.ingredientValue} />
              )}
            </p>
          </div>
          <div className="card-panel !p-3">
            <p className="text-xs font-semibold text-slate-500">
              Thành phẩm
            </p>
            <p className="mt-1 text-sm font-bold text-slate-900">
              SL {loading ? "—" : inventorySummary.finishedQty}
            </p>
            <p className="money mt-0.5 text-xs font-bold text-slate-700">
              Nhập{" "}
              {loading ? (
                "—"
              ) : (
                <Money amount={inventorySummary.finishedCostValue} />
              )}
            </p>
            {inventorySummary.finishedSellValue > 0 ? (
              <p className="money mt-0.5 text-xs text-slate-500">
                Bán ước tính{" "}
                <Money amount={inventorySummary.finishedSellValue} />
              </p>
            ) : null}
          </div>
        </div>
        {filter !== "all" && !loading ? (
          <p className="hint-line">
            Toàn kho (không lọc):{" "}
            <span className="font-semibold text-slate-700">
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
          setShowAdd(true);
          setForm(
            emptyForm(
              filter === "finished"
                ? PRODUCT_KIND.FINISHED
                : PRODUCT_KIND.INGREDIENT
            )
          );
        }}
        className="touch-btn mb-3 h-12 w-full gap-2 bg-white text-sm font-bold text-slate-700 ring-1 ring-slate-200"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Thêm hàng kho mới
      </button>

      <BottomSheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={
          form.kind === PRODUCT_KIND.FINISHED
            ? "Thêm thành phẩm nhập"
            : "Thêm nguyên liệu kho"
        }
        subtitle="Chỉ tạo khi chưa có trong danh mục"
        labelledBy="inventory-add-sheet"
        footer={
          <button
            type="submit"
            form="inventory-add-form"
            disabled={savingAdd}
            className="touch-btn h-14 w-full gap-2 bg-brand-700 text-white"
          >
            {savingAdd ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" aria-hidden />
            )}
            {savingAdd
              ? "Đang lưu..."
              : (Number(form.receiveQty) || 0) > 0
                ? "Lưu + nhập hàng + trừ quỹ"
                : form.kind === PRODUCT_KIND.FINISHED
                  ? "Lưu thành phẩm (tồn 0)"
                  : "Lưu nguyên liệu (tồn 0)"}
          </button>
        }
      >
          <form id="inventory-add-form" onSubmit={handleAdd} className="space-y-3">
            <ChipRow>
              {[
                { id: PRODUCT_KIND.INGREDIENT, label: "Nguyên liệu" },
                { id: PRODUCT_KIND.FINISHED, label: "Thành phẩm nhập" },
              ].map((k) => (
                <FilterChip
                  key={k.id}
                  active={form.kind === k.id}
                  onClick={() => {
                    const next = emptyForm(k.id);
                    setForm((f) => ({
                      ...next,
                      name: f.name,
                      inStock: f.inStock,
                      cost: f.cost,
                      price: f.price,
                    }));
                  }}
                >
                  {k.label}
                </FilterChip>
              ))}
            </ChipRow>
            <label className="block">
              <FieldLabel>Tên</FieldLabel>
              <input
                className="field-input"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={
                  form.kind === PRODUCT_KIND.FINISHED
                    ? "VD: AVIA, Sting"
                    : "VD: Đường, Mì tôm, Trứng"
                }
                required
              />
            </label>

            <label className="block">
              <FieldLabel>Đơn vị gốc (tồn / bán lẻ)</FieldLabel>
              <select
                className="field-input"
                value={form.unit}
                onChange={(e) => {
                  const unit = e.target.value;
                  const hint = defaultIngredientPackHint(unit);
                  setForm((f) => ({
                    ...f,
                    unit,
                    ...(f.packEnabled
                      ? { packLabel: hint.packLabel, packFactor: hint.packFactor }
                      : {}),
                  }));
                }}
              >
                {PRODUCT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-700"
                checked={form.packEnabled}
                onChange={(e) => {
                  const on = e.target.checked;
                  setForm((f) => {
                    const hint = defaultIngredientPackHint(f.unit);
                    return {
                      ...f,
                      packEnabled: on,
                      ...(on
                        ? {
                            packLabel: hint.packLabel,
                            packFactor: hint.packFactor,
                          }
                        : {}),
                    };
                  });
                }}
              />
              <span className="text-sm font-semibold text-slate-800">
                {form.kind === PRODUCT_KIND.FINISHED
                  ? "Nhập theo thùng"
                  : "Nhập theo kiện"}
              </span>
            </label>

            {form.packEnabled ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <FieldLabel>Tên kiện</FieldLabel>
                  <input
                    className="field-input"
                    value={form.packLabel}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, packLabel: e.target.value }))
                    }
                    placeholder="thùng"
                  />
                </label>
                <label className="block">
                  <FieldLabel>
                    1 {form.packLabel || "kiện"} = ? ({form.unit})
                  </FieldLabel>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="2"
                    className="field-input money"
                    value={form.packFactor}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, packFactor: e.target.value }))
                    }
                    placeholder="30"
                  />
                </label>
              </div>
            ) : null}

            <label className="block">
              <FieldLabel>
                {form.packEnabled
                  ? `Giá / ${form.packLabel || "kiện"}`
                  : "Giá nhập / ĐV"}
              </FieldLabel>
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

            <label className="block">
              <FieldLabel optional>Số lượng nhập lần đầu</FieldLabel>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                className="field-input money"
                value={form.receiveQty}
                onChange={(e) =>
                  setForm((f) => ({ ...f, receiveQty: e.target.value }))
                }
                placeholder={
                  form.packEnabled
                    ? `Số ${form.packLabel || "kiện"}`
                    : `Số ${form.unit || "đv"}`
                }
              />
            </label>

            <div className="space-y-2 rounded-2xl bg-rose-50 p-3 ring-1 ring-rose-100">
              <p className="text-sm font-bold text-rose-950">
                Trừ tiền từ đâu?
              </p>
              {canChooseInventoryFundSource ? (
                <ChipRow>
                  <FilterChip
                    active={(form.fundSource || "shop") === "shop"}
                    onClick={() =>
                      setForm((f) => ({ ...f, fundSource: "shop" }))
                    }
                  >
                    Quỹ cửa hàng
                  </FilterChip>
                  <FilterChip
                    active={form.fundSource === "capital"}
                    onClick={() =>
                      setForm((f) => ({ ...f, fundSource: "capital" }))
                    }
                  >
                    Quỹ đầu tư
                  </FilterChip>
                </ChipRow>
              ) : (
                <p className="text-sm font-semibold text-rose-900">
                  Quản lý chỉ trừ quỹ cửa hàng.
                </p>
              )}
              <p className="text-sm font-semibold text-rose-800/80">
                Hình thức thanh toán
              </p>
              <ChipRow>
                <FilterChip
                  active={(form.payMethod || "cash") === "cash"}
                  onClick={() =>
                    setForm((f) => ({ ...f, payMethod: "cash" }))
                  }
                >
                  Tiền mặt
                </FilterChip>
                <FilterChip
                  active={form.payMethod === "banking"}
                  onClick={() =>
                    setForm((f) => ({ ...f, payMethod: "banking" }))
                  }
                >
                  Chuyển khoản
                </FilterChip>
              </ChipRow>
              {(Number(form.receiveQty) || 0) > 0 ? (
                <p className="text-sm font-bold text-rose-800">
                  Lưu sẽ cộng tồn và trừ{" "}
                  {canChooseInventoryFundSource &&
                  form.fundSource === "capital"
                    ? "quỹ đầu tư"
                    : "quỹ cửa hàng"}{" "}
                  ≈{" "}
                  <Money
                    amount={Math.round(
                      (Number(form.receiveQty) || 0) *
                        (parseUnitCostInput(form.cost) || 0)
                    )}
                  />
                </p>
              ) : (
                <p className="text-sm text-rose-900/80">
                  Để trống SL = chỉ tạo tên (tồn 0).
                </p>
              )}
            </div>

            {form.kind === PRODUCT_KIND.FINISHED ? (
              <label className="block">
                <FieldLabel>Giá bán / {form.unit || "chai"} (POS)</FieldLabel>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  required
                  className="field-input money"
                  value={form.price}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, price: e.target.value }))
                  }
                  placeholder="8000"
                />
              </label>
            ) : null}
          </form>
      </BottomSheet>

      <BottomSheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          editing?.kind === PRODUCT_KIND.FINISHED
            ? "Sửa thành phẩm nhập"
            : "Sửa nguyên liệu"
        }
        labelledBy="inventory-edit-sheet"
        footer={
          <button
            type="submit"
            form="inventory-edit-form"
            disabled={savingEdit}
            className="touch-btn h-14 w-full gap-2 bg-brand-700 text-white"
          >
            {savingEdit ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Save className="h-5 w-5" aria-hidden />
            )}
            {savingEdit ? "Đang lưu..." : "Lưu"}
          </button>
        }
      >
          <form id="inventory-edit-form" onSubmit={handleSaveEdit} className="space-y-3">
            <label className="block">
              <FieldLabel>Tên</FieldLabel>
              <input
                className="field-input"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, name: e.target.value }))
                }
                required
              />
            </label>
            <label className="block">
              <FieldLabel>Đơn vị gốc (tồn / CT)</FieldLabel>
              <select
                className="field-input"
                value={editForm.unit}
                onChange={(e) => {
                  const unit = e.target.value;
                  const hint = defaultIngredientPackHint(unit);
                  setEditForm((f) => ({
                    ...f,
                    unit,
                    ...(f.packEnabled
                      ? { packLabel: hint.packLabel, packFactor: hint.packFactor }
                      : {}),
                  }));
                }}
              >
                {PRODUCT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-700"
                checked={editForm.packEnabled}
                onChange={(e) => {
                  const on = e.target.checked;
                  setEditForm((f) => {
                    const hint = defaultIngredientPackHint(f.unit);
                    return {
                      ...f,
                      packEnabled: on,
                      ...(on
                        ? {
                            packLabel: hint.packLabel,
                            packFactor: hint.packFactor,
                          }
                        : {}),
                    };
                  });
                }}
              />
              <span className="text-sm font-semibold text-slate-800">
                {editing?.kind === PRODUCT_KIND.FINISHED
                  ? "Nhập theo thùng"
                  : "Nhập theo kiện"}
              </span>
            </label>
            {editForm.packEnabled ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <FieldLabel>Tên kiện</FieldLabel>
                  <input
                    className="field-input"
                    value={editForm.packLabel}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, packLabel: e.target.value }))
                    }
                    placeholder="thùng"
                  />
                </label>
                <label className="block">
                  <FieldLabel>
                    1 {editForm.packLabel || "kiện"} = ? {editForm.unit}
                  </FieldLabel>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="2"
                    className="field-input money"
                    value={editForm.packFactor}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        packFactor: e.target.value,
                      }))
                    }
                    placeholder="30"
                  />
                </label>
              </div>
            ) : null}
            <label className="block">
              <FieldLabel>
                Giá nhập / {editForm.unit || "đơn vị gốc"}
              </FieldLabel>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className="field-input money"
                value={editForm.cost}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, cost: e.target.value }))
                }
              />
            </label>
            {editing?.kind === PRODUCT_KIND.FINISHED ? (
              <label className="block">
                <FieldLabel>
                  Giá bán / {editForm.unit || "chai"} (POS)
                </FieldLabel>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className="field-input money"
                  value={editForm.price}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, price: e.target.value }))
                  }
                />
              </label>
            ) : null}
            {isSuperAdmin ? (
              <label className="block">
                <FieldLabel>
                  Tồn kho (theo {editForm.unit || "gốc"}
                  {editForm.packEnabled
                    ? `, không phải ${editForm.packLabel || "kiện"}`
                    : ""}
                  )
                </FieldLabel>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="field-input money"
                  value={editForm.inStock}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, inStock: e.target.value }))
                  }
                />
              </label>
            ) : null}
          </form>
      </BottomSheet>

      <ChipRow className="mb-3">
        {[
          { id: "all", label: "Tất cả" },
          { id: "ingredient", label: "Nguyên liệu" },
          { id: "finished", label: "Thành phẩm nhập" },
        ].map((f) => (
          <FilterChip
            key={f.id}
            active={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </FilterChip>
        ))}
      </ChipRow>

      <label className="mb-3 block">
        <FieldLabel>Chọn / tìm tên hàng</FieldLabel>
        <input
          type="search"
          className="field-input"
          placeholder="VD: AVIA, mì tôm, đường…"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
        />
      </label>

      {canStocktake ? (
        <button
          type="button"
          onClick={() => {
            setStocktakeOn((v) => !v);
            setShowAdd(false);
            setEditing(null);
          }}
          className={cn(
            "touch-btn mb-4 h-12 w-full gap-2 text-sm font-bold",
            stocktakeOn
              ? "bg-brand-700 text-white"
              : "bg-white text-slate-800 ring-1 ring-slate-200"
          )}
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          {stocktakeOn ? "Đóng kiểm kho" : "Kiểm kho · đối chiếu thực tế"}
        </button>
      ) : null}

      {stocktakeOn ? (
        <section className="mb-8 space-y-3">
          <p className="hint-line">
            Đếm theo đơn vị gốc · để trống = bỏ qua · lưu không trừ quỹ.
          </p>
          {stocktakeSummary.mismatch > 0 ? (
            <p className="alert-soft">
              {stocktakeSummary.mismatch} món lệch ·{" "}
              <span className="money font-bold">
                <Money amount={stocktakeSummary.netValue} />
              </span>
            </p>
          ) : null}
          <div className="grid grid-cols-3 gap-2 text-sm">
            <MetricTile label="Đã đếm" value={stocktakeSummary.counted} />
            <MetricTile
              label="Món lệch"
              value={
                <span
                  className={
                    stocktakeSummary.mismatch > 0 ? "text-amber-800" : undefined
                  }
                >
                  {stocktakeSummary.mismatch}
                </span>
              }
            />
            <MetricTile
              label="Giá trị lệch"
              value={
                <span
                  className={
                    stocktakeSummary.netValue < 0
                      ? "text-rose-700"
                      : stocktakeSummary.netValue > 0
                        ? "text-emerald-700"
                        : undefined
                  }
                >
                  <Money amount={stocktakeSummary.netValue} />
                </span>
              }
            />
          </div>
          <p className="text-sm font-semibold text-slate-600">
            Thừa {formatUnitCount(stocktakeSummary.surplusQty)} ·{" "}
            <Money amount={stocktakeSummary.surplusValue} />
            {" · Thiếu "}
            {formatUnitCount(stocktakeSummary.shortageQty)} ·{" "}
            <Money amount={stocktakeSummary.shortageValue} />
          </p>
          <label className="flex items-center gap-3 rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200">
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand-700"
              checked={onlyMismatch}
              onChange={(e) => setOnlyMismatch(e.target.checked)}
            />
            <span className="text-sm font-semibold text-slate-800">
              Chỉ hiện món đã lệch
            </span>
          </label>
          {loading ? (
            <div className="card-panel h-24 animate-pulse bg-white/80" />
          ) : stocktakeRows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Chưa có hàng để kiểm"
              description="Món công thức không đếm tồn."
            />
          ) : (
            stocktakeRows.map((line) => {
              const product = products.find((p) => p.id === line.productId);
              if (!product) return null;
              const delta = line.skipped ? null : line.delta;
              return (
                <article key={line.productId} className="card-panel space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-900">
                        {product.name}
                      </p>
                      <p className="text-sm text-slate-500">
                        Sổ:{" "}
                        <span className="font-bold text-slate-800">
                          {stockLine(product)}
                        </span>
                        {" · Đếm theo "}
                        {line.unit}
                      </p>
                    </div>
                    {delta != null && delta !== 0 ? (
                      <p
                        className={cn(
                          "shrink-0 text-sm font-bold",
                          delta > 0 ? "text-emerald-700" : "text-rose-700"
                        )}
                      >
                        {delta > 0 ? "+" : ""}
                        {formatUnitCount(delta)} {line.unit}
                      </p>
                    ) : null}
                  </div>
                  <label className="block">
                    <FieldLabel>Thực tế ({line.unit})</FieldLabel>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      className="field-input money"
                      placeholder={`Sổ ${line.book}`}
                      value={stockCounts[product.id] ?? ""}
                      onChange={(e) =>
                        setStockCounts((prev) => ({
                          ...prev,
                          [product.id]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  {delta != null && delta !== 0 ? (
                    <p className="text-sm font-semibold text-slate-600">
                      Lệch {delta > 0 ? "thừa" : "thiếu"} · giá trị{" "}
                      <Money amount={line.value} />
                    </p>
                  ) : null}
                </article>
              );
            })
          )}
          <label className="block">
            <FieldLabel optional>Ghi chú</FieldLabel>
            <input
              className="field-input"
              value={stocktakeNote}
              onChange={(e) => setStocktakeNote(e.target.value)}
              placeholder="VD: Kiểm sau setup lại CT mì"
            />
          </label>
          <button
            type="button"
            disabled={savingTake || stocktakeSummary.mismatch === 0}
            onClick={handleStocktake}
            className="touch-btn h-14 w-full gap-2 bg-brand-700 text-sm text-white disabled:opacity-50"
          >
            {savingTake ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ClipboardList className="h-5 w-5" aria-hidden />
            )}
            {savingTake
              ? "Đang ghi..."
              : stocktakeSummary.mismatch === 0
                ? "Nhập số thực tế để thấy lệch"
                : `Ghi tồn thực tế · ${stocktakeSummary.mismatch} món lệch`}
          </button>
        </section>
      ) : (
      <section className="mb-8 space-y-3">
        <SectionHeader title="Nhập thêm vào món có sẵn" />
        {loading ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="Chưa có hàng trong bộ lọc"
            description="Đổi lọc / tìm tên, hoặc thêm hàng kho mới."
            action={
              <button
                type="button"
                onClick={() => {
                  setShowAdd(true);
                  setForm(
                    emptyForm(
                      filter === "finished"
                        ? PRODUCT_KIND.FINISHED
                        : PRODUCT_KIND.INGREDIENT
                    )
                  );
                }}
                className="touch-btn h-12 w-full gap-2 bg-brand-700 text-white"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Thêm hàng kho mới
              </button>
            }
          />
        ) : (
          visible.map((product) => {
            const d = drafts[product.id] || {};
            const isIng = product.kind === PRODUCT_KIND.INGREDIENT;
            const busy = savingId === product.id;
            const packaging = normalizeProductUnits(product);
            const receiveUnits = receiveUnitChoices(product);
            const selectedUnit =
              receiveUnits.find((unit) => unit.id === d.unitId) ||
              [...receiveUnits].sort((a, b) => b.factor - a.factor)[0] ||
              defaultReceiveUnit(product);
            const isPackUnit = Number(selectedUnit?.factor) > 1;
            const packFactor = isPackUnit
              ? Math.max(
                  1,
                  Math.round(
                    Number(d.packFactor) || Number(selectedUnit?.factor) || 1
                  )
                )
              : 1;
            const baseQtyPreview = Math.round(
              (Number(d.addQty) || 0) * packFactor
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
                    <button
                      type="button"
                      onClick={() => setHistoryProduct(product)}
                      className="text-left text-lg font-bold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-brand-800 hover:decoration-brand-400"
                    >
                      {product.name}
                    </button>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {isIng
                        ? "Nguyên liệu"
                        : isRecipeFinished(product)
                          ? "Món công thức"
                          : "Thành phẩm nhập"}
                      {" · Tồn "}
                      <span className="font-bold text-slate-800">
                        {stockLine(product)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">
                      Giá vốn BQ: <Money amount={product.cost} />
                      {!isIng ? (
                        <>
                          {" · Bán "}
                          <Money amount={product.price} />
                        </>
                      ) : null}
                    </p>
                    <p className="money mt-1 text-base font-bold text-brand-800">
                      <Money amount={lineStockCostValue(product)} />
                    </p>
                  </div>
                </div>
                <div className="relative z-10 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setHistoryProduct(product)}
                      className="touch-btn h-12 flex-1 bg-slate-50 text-sm font-bold text-slate-800 ring-1 ring-slate-200"
                    >
                      <History className="h-4 w-4" aria-hidden />
                      Lịch sử
                    </button>
                    {canManageProducts ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openEditProduct(product);
                        }}
                        className="touch-btn h-12 flex-1 bg-slate-100 text-sm font-bold text-slate-800"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                        Sửa
                      </button>
                    ) : null}
                    {isSuperAdmin ? (
                      <button
                        type="button"
                        aria-label="Xóa"
                        disabled={deletingId === product.id}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDeleteProduct(product);
                        }}
                        className="touch-btn h-12 w-14 bg-rose-50 p-0 text-rose-700 disabled:opacity-50"
                      >
                        {deletingId === product.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <FieldLabel>Đơn vị nhập</FieldLabel>
                    <select
                      className="field-input"
                      value={d.unitId || selectedUnit?.id || ""}
                      onChange={(e) => {
                        const next = receiveUnits.find(
                          (unit) => unit.id === e.target.value
                        );
                        setDraft(product.id, {
                          unitId: e.target.value,
                          packFactor:
                            Number(next?.factor) > 1
                              ? String(next.factor)
                              : "",
                        });
                      }}
                    >
                      {receiveUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                          {unit.factor > 1 ? ` (×${unit.factor})` : " · lẻ"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <FieldLabel>Số {selectedUnit?.label || "đv"}</FieldLabel>
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
                  {isPackUnit ? (
                    <label className="block col-span-2">
                      <FieldLabel>
                        1 {selectedUnit?.label || "thùng"} = ? (
                        {packaging.baseUnit})
                      </FieldLabel>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="2"
                        className="field-input money"
                        placeholder={String(selectedUnit?.factor || 24)}
                        value={
                          d.packFactor !== undefined && d.packFactor !== ""
                            ? d.packFactor
                            : String(selectedUnit?.factor || "")
                        }
                        onChange={(e) =>
                          setDraft(product.id, { packFactor: e.target.value })
                        }
                      />
                    </label>
                  ) : null}
                  <label className="block col-span-2">
                    <FieldLabel>
                      Giá / {selectedUnit?.label || "đv"}
                    </FieldLabel>
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
                        const { product: ready, unitId } = withReceivePack(
                          product,
                          {
                            unitLabel: selectedUnit.label,
                            packFactor,
                          }
                        );
                        preview = deriveReceiveCostUpdate(ready, {
                          unit: findUnit(ready, unitId) || {
                            ...selectedUnit,
                            factor: packFactor,
                          },
                          receiveQty: qty,
                          unitReceivePrice: previewCost,
                        });
                      } catch {
                        return null;
                      }
                      return (
                        <p className="mt-1 text-sm font-semibold leading-snug text-emerald-800">
                          {qty} {selectedUnit.label}
                          {packFactor > 1
                            ? ` × ${packFactor} ${packaging.baseUnit}`
                            : ""}
                          {" × "}
                          {formatCurrency(previewCost)}
                          {" → +"}
                          {preview.baseQty} {packaging.baseUnit}
                          {" · Trừ quỹ "}
                          {formatCurrency(preview.amount)}
                          {preview.costMethod === "wac" ? (
                            <>
                              {" · Giá vốn BQ "}
                              {formatCurrency(preview.baseUnitCost)}/
                              {packaging.baseUnit}
                            </>
                          ) : (
                            <>
                              {" · Giá vốn "}
                              {formatCurrency(preview.baseUnitCost)}/
                              {packaging.baseUnit}
                            </>
                          )}
                        </p>
                      );
                    })()}
                  </label>
                </div>

                <div className="space-y-2 rounded-2xl bg-rose-50 p-3 ring-1 ring-rose-100">
                  <p className="text-sm font-bold text-rose-950">
                    Trừ tiền từ đâu?
                  </p>
                  {canChooseInventoryFundSource ? (
                    <ChipRow>
                      <FilterChip
                        active={(d.fundSource || "shop") === "shop"}
                        onClick={() =>
                          setDraft(product.id, { fundSource: "shop" })
                        }
                      >
                        Quỹ cửa hàng
                      </FilterChip>
                      <FilterChip
                        active={d.fundSource === "capital"}
                        onClick={() =>
                          setDraft(product.id, { fundSource: "capital" })
                        }
                      >
                        Quỹ đầu tư
                      </FilterChip>
                    </ChipRow>
                  ) : (
                    <p className="text-sm font-semibold text-rose-900">
                      Quản lý chỉ trừ quỹ cửa hàng.
                    </p>
                  )}
                  <p className="text-sm font-semibold text-rose-800/80">
                    Hình thức thanh toán
                  </p>
                  <ChipRow>
                    <FilterChip
                      active={(d.payMethod || "cash") === "cash"}
                      onClick={() =>
                        setDraft(product.id, { payMethod: "cash" })
                      }
                    >
                      Tiền mặt
                    </FilterChip>
                    <FilterChip
                      active={d.payMethod === "banking"}
                      onClick={() =>
                        setDraft(product.id, { payMethod: "banking" })
                      }
                    >
                      Chuyển khoản
                    </FilterChip>
                  </ChipRow>
                  {Number(d.addQty) > 0 ? (
                    <p className="text-sm font-bold text-rose-800">
                      Nhập {Number(d.addQty) || 0}{" "}
                      {selectedUnit?.label || product.unit || "đv"}
                      {packFactor > 1
                        ? ` × ${packFactor} ${packaging.baseUnit}`
                        : ""}{" "}
                      = {formatUnitCount(baseQtyPreview)} {packaging.baseUnit}
                      {" · Sẽ trừ "}
                      {canChooseInventoryFundSource &&
                      d.fundSource === "capital"
                        ? "quỹ đầu tư"
                        : "quỹ cửa hàng"}{" "}
                      ≈{" "}
                      <Money
                        amount={Math.round(
                          (Number(d.addQty) || 0) * previewCost
                        )}
                      />
                    </p>
                  ) : (
                    <p className="text-sm text-rose-900/80">
                      Nhập SL rồi bấm Lưu — trừ quỹ đã chọn.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleReceive(product)}
                  className="relative z-10 touch-btn h-14 w-full gap-2 bg-brand-700 text-sm text-white disabled:opacity-50"
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
      )}

      <BottomSheet
        open={Boolean(historyProduct)}
        onClose={() => setHistoryProduct(null)}
        title="Lịch sử nhập"
        subtitle={
          historyProduct
            ? `${historyProduct.name} · ${productReceiveSummary.count} lần · ${formatCurrency(productReceiveSummary.totalAmount)}`
            : null
        }
        labelledBy="receive-history-title"
      >
            {productReceiveHistory.length === 0 ? (
              <EmptyState
                icon={History}
                title="Chưa có lần nhập"
                description="Chưa ghi nhận nhập hàng cho món này."
              />
            ) : (
              <ul className="space-y-2">
                {productReceiveHistory.map((row) => (
                  <li
                    key={`${row.fundSource}-${row.id}`}
                    className="rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-500">
                          {formatReceiveHistoryTime(row)}
                        </p>
                        <p className="mt-0.5 text-sm font-bold text-slate-900">
                          +{formatUnitCount(row.receiveQty)} {row.unit}
                          {row.unitReceivePrice > 0 ? (
                            <span className="font-semibold text-slate-600">
                              {" · "}
                              <Money amount={row.unitReceivePrice} />/{row.unit}
                            </span>
                          ) : null}
                        </p>
                        <p className="money mt-1 text-lg font-bold text-rose-800">
                          <Money amount={row.amount} />
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-lg px-2 py-1 text-xs font-bold uppercase tracking-wide",
                          row.fundSource === "capital"
                            ? "bg-brand-50 text-brand-800"
                            : "bg-emerald-50 text-emerald-800"
                        )}
                      >
                        {fundSourceLabel(row.fundSource)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      <span className="font-bold text-slate-800">
                        {row.actorLabel}
                      </span>
                      {" · "}
                      {paymentMethodLabel(row.paymentMethod)}
                      {row.qtyBefore != null && row.qtyAfter != null ? (
                        <>
                          {" · Tồn "}
                          {formatUnitCount(row.qtyBefore)} →{" "}
                          {formatUnitCount(row.qtyAfter)}
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
      </BottomSheet>
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
