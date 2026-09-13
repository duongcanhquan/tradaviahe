'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
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
} from "@/lib/products";
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
  return (
    product?.kind === PRODUCT_KIND.FINISHED &&
    product?.costMode === COST_MODE.RECIPE
  );
}

function stockLine(product) {
  const qty = Number(product.inStock) || 0;
  const base = product.packaging?.baseUnit || product.unit || "đv";
  const pack = largestPackUnit(product);
  if (!pack) return `${qty} ${base}`;
  return `${qty} ${base} ≈ ${formatUnitCount(qty / pack.factor)} ${pack.label}`;
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

  const backfillPreview = useMemo(
    () => previewInventoryFundBackfill(products, allTx),
    [products, allTx]
  );

  const visible = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    let list = products;
    if (filter === "ingredient") {
      list = products.filter((p) => p.kind === PRODUCT_KIND.INGREDIENT);
    } else if (filter === "finished") {
      list = products.filter((p) => isSellable(p));
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
    const receiveQty = Number(form.inStock) || 0;
    const receivePrice = parseUnitCostInput(form.cost);
    const baseQty = receiveQty * (packOn ? factor : 1);
    const baseCost =
      packOn && factor > 0 ? receivePrice / factor : receivePrice;

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
      await createProduct({
        name: form.name.trim(),
        kind: isFin ? PRODUCT_KIND.FINISHED : PRODUCT_KIND.INGREDIENT,
        unit: form.unit || (isFin ? "chai" : "g"),
        inStock: baseQty,
        cost: baseCost,
        costMode: COST_MODE.MANUAL,
        price: sellPrice,
        groupId: isFin ? form.groupId || "drinks" : null,
        recipe: [],
        active: true,
        ...pack,
      });
      showToast(
        packOn
          ? `Đã thêm “${form.name.trim()}” · +${receiveQty} ${form.packLabel || "kiện"} = ${baseQty} ${form.unit} · ${formatCurrency(baseCost)}/${form.unit}`
          : `Đã thêm “${form.name.trim()}” · tồn ${baseQty} · giá nhập ${formatCurrency(baseCost)}`,
        "success"
      );
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
    if (isRecipeFinished(product)) {
      const ok = window.confirm(
        `“${product.name}” đang có công thức. Nhập kho sẽ đổi thành hàng nhập (trừ tồn khi bán), bỏ CT. Tiếp tục?`
      );
      if (!ok) return;
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
          updateCost: true, // last-purchase always
          user,
          profile,
        });
        if (isRecipeFinished(product)) {
          await updateDoc(doc(db, "products", product.id), {
            costMode: COST_MODE.MANUAL,
            recipe: [],
            updatedAt: serverTimestamp(),
          });
        }
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
          payload.costMode = COST_MODE.MANUAL;
        }
        if (isRecipeFinished(product)) {
          payload.costMode = COST_MODE.MANUAL;
          payload.recipe = [];
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

  return (
    <AppShell
      title="Nhập hàng"
      subtitle="Tồn kho · giá nhập · giá trị"
      dense
    >
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        <strong>Nguyên liệu</strong> = đường, mì, trứng.{" "}
        <strong>Thành phẩm nhập</strong> = AVIA / chai nước… nhập thùng × số
        chai, bán lẻ POS. Món nấu/pha:{" "}
        <Link
          href="/manager/products"
          className="font-bold text-brand-800 underline"
        >
          Món · giá
        </Link>
        . Nhập trừ quỹ TM/CK.
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
          if (!showAdd) {
            setForm(
              emptyForm(
                filter === "finished"
                  ? PRODUCT_KIND.FINISHED
                  : PRODUCT_KIND.INGREDIENT
              )
            );
          }
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
            Thêm hàng kho
          </>
        )}
      </button>

      {showAdd ? (
        <section className="card-panel mb-4 space-y-3 border-emerald-100 bg-gradient-to-b from-emerald-50/80 to-white">
          <h2 className="section-title text-emerald-950">
            {form.kind === PRODUCT_KIND.FINISHED
              ? "Thêm thành phẩm nhập"
              : "Thêm nguyên liệu kho"}
          </h2>
          <p className="text-xs leading-relaxed text-slate-500">
            Thành phẩm = hàng mua sẵn (AVIA, thùng × 24 chai). Nguyên liệu =
            đường/mì trừ qua công thức. Món nấu:{" "}
            <Link
              href="/manager/products"
              className="font-bold text-brand-800 underline"
            >
              Món · giá
            </Link>
            .
          </p>
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: PRODUCT_KIND.INGREDIENT, label: "Nguyên liệu" },
                { id: PRODUCT_KIND.FINISHED, label: "Thành phẩm nhập" },
              ].map((k) => (
                <button
                  key={k.id}
                  type="button"
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
                  className={cn(
                    "touch-btn h-11 text-xs font-extrabold",
                    form.kind === k.id
                      ? "bg-emerald-800 text-white"
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
                  form.kind === PRODUCT_KIND.FINISHED
                    ? "VD: AVIA, Sting"
                    : "VD: Đường, Mì tôm, Trứng"
                }
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Đơn vị gốc (tồn / bán lẻ)
              </span>
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

            <label className="flex items-center gap-3 rounded-2xl bg-white px-3 py-3 ring-1 ring-emerald-100">
              <input
                type="checkbox"
                className="h-5 w-5 accent-emerald-700"
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
                  ? "Nhập theo thùng (vd AVIA 1 thùng = 24 chai)"
                  : "Nhập theo kiện (thùng mì × 30 gói, cây thuốc × 10 bao)"}
              </span>
            </label>

            {form.packEnabled ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Tên kiện
                  </span>
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
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    1 {form.packLabel || "kiện"} = ? số lẻ ({form.unit})
                  </span>
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

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  {form.packEnabled
                    ? `Số ${form.packLabel || "kiện"} nhập`
                    : "Số lượng nhập"}
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
                  {form.packEnabled
                    ? `Giá / ${form.packLabel || "kiện"}`
                    : "Giá nhập / ĐV"}
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
            {form.packEnabled &&
            Number(form.inStock) > 0 &&
            Number(form.packFactor) >= 2 &&
            parseUnitCostInput(form.cost) > 0 ? (
              <p className="text-[11px] font-semibold leading-snug text-emerald-800">
                {form.inStock} {form.packLabel} × {form.packFactor} {form.unit} = +
                {Number(form.inStock) * Number(form.packFactor)} {form.unit}
                {" · "}
                {formatCurrency(
                  parseUnitCostInput(form.cost) / Number(form.packFactor)
                )}
                /{form.unit}
              </p>
            ) : null}

            {form.kind === PRODUCT_KIND.FINISHED ? (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Giá bán / {form.unit || "chai"} (POS)
                </span>
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
              {savingAdd
                ? "Đang lưu..."
                : form.kind === PRODUCT_KIND.FINISHED
                  ? "Lưu thành phẩm"
                  : "Lưu nguyên liệu"}
            </button>
          </form>
        </section>
      ) : null}

      {editing ? (
        <section className="card-panel mb-4 space-y-3 border-amber-100 bg-gradient-to-b from-amber-50/80 to-white">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-title text-amber-950">
              {editing.kind === PRODUCT_KIND.FINISHED
                ? "Sửa thành phẩm nhập"
                : "Sửa nguyên liệu"}
            </h2>
            <button
              type="button"
              aria-label="Đóng"
              onClick={() => setEditing(null)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 ring-slate-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSaveEdit} className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Tên
              </span>
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
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Đơn vị gốc (tồn / CT)
              </span>
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
            <label className="flex items-center gap-3 rounded-2xl bg-white px-3 py-3 ring-1 ring-amber-100">
              <input
                type="checkbox"
                className="h-5 w-5 accent-amber-700"
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
                {editing.kind === PRODUCT_KIND.FINISHED
                  ? "Nhập theo thùng (vd 1 thùng = 24 chai)"
                  : "Nhập theo kiện (thùng × gói, cây thuốc × bao)"}
              </span>
            </label>
            {editForm.packEnabled ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    Tên kiện
                  </span>
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
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                    1 {editForm.packLabel || "kiện"} = ? {editForm.unit}
                  </span>
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
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                Giá nhập / {editForm.unit || "đơn vị gốc"}
              </span>
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
            {editing.kind === PRODUCT_KIND.FINISHED ? (
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Giá bán / {editForm.unit || "chai"} (POS)
                </span>
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
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Tồn kho (theo {editForm.unit || "gốc"}
                  {editForm.packEnabled
                    ? `, không phải ${editForm.packLabel || "kiện"}`
                    : ""}
                  )
                </span>
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
            <button
              type="submit"
              disabled={savingEdit}
              className="touch-btn h-14 w-full gap-2 bg-amber-700 text-white"
            >
              {savingEdit ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Save className="h-5 w-5" aria-hidden />
              )}
              {savingEdit ? "Đang lưu..." : "Lưu"}
            </button>
          </form>
        </section>
      ) : null}

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[
          { id: "all", label: "Tất cả" },
          { id: "ingredient", label: "Nguyên liệu" },
          { id: "finished", label: "Thành phẩm" },
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

      <label className="mb-3 block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">
          Chọn / tìm tên hàng
        </span>
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
              ? "bg-amber-800 text-white"
              : "bg-white text-slate-800 ring-1 ring-amber-200"
          )}
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          {stocktakeOn ? "Đóng kiểm kho" : "Kiểm kho · đối chiếu thực tế"}
        </button>
      ) : null}

      {stocktakeOn ? (
        <section className="mb-8 space-y-3">
          <div className="rounded-2xl bg-amber-50 px-3 py-3 text-xs leading-relaxed text-amber-950 ring-1 ring-amber-100">
            Đếm thực tế theo <strong>đơn vị gốc</strong> (gói, g, bao, chai).
            Để trống = bỏ qua. Nhập 0 = hết hàng. Lưu chỉ ghi món lệch —{" "}
            <strong>không trừ quỹ</strong>.
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <p className="font-semibold text-slate-500">Đã đếm</p>
              <p className="text-lg font-extrabold">{stocktakeSummary.counted}</p>
            </div>
            <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <p className="font-semibold text-slate-500">Món lệch</p>
              <p className="text-lg font-extrabold text-amber-800">
                {stocktakeSummary.mismatch}
              </p>
            </div>
            <div className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
              <p className="font-semibold text-slate-500">Giá trị lệch</p>
              <p
                className={cn(
                  "money text-lg font-extrabold",
                  stocktakeSummary.netValue < 0
                    ? "text-rose-700"
                    : stocktakeSummary.netValue > 0
                      ? "text-emerald-700"
                      : "text-slate-900"
                )}
              >
                <Money amount={stocktakeSummary.netValue} />
              </p>
            </div>
          </div>
          <p className="text-[11px] font-semibold text-slate-600">
            Thừa {formatUnitCount(stocktakeSummary.surplusQty)} ·{" "}
            <Money amount={stocktakeSummary.surplusValue} />
            {" · Thiếu "}
            {formatUnitCount(stocktakeSummary.shortageQty)} ·{" "}
            <Money amount={stocktakeSummary.shortageValue} />
          </p>
          <label className="flex items-center gap-3 rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200">
            <input
              type="checkbox"
              className="h-5 w-5 accent-amber-700"
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
            <div className="card-panel text-sm text-slate-500">
              Chưa có hàng để kiểm (món công thức không đếm tồn).
            </div>
          ) : (
            stocktakeRows.map((line) => {
              const product = products.find((p) => p.id === line.productId);
              if (!product) return null;
              const delta = line.skipped ? null : line.delta;
              return (
                <article key={line.productId} className="card-panel space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-extrabold text-slate-900">
                        {product.name}
                      </p>
                      <p className="text-xs text-slate-500">
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
                          "shrink-0 text-sm font-extrabold",
                          delta > 0 ? "text-emerald-700" : "text-rose-700"
                        )}
                      >
                        {delta > 0 ? "+" : ""}
                        {formatUnitCount(delta)} {line.unit}
                      </p>
                    ) : null}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Thực tế ({line.unit})
                    </span>
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
                    <p className="text-[11px] font-semibold text-slate-600">
                      Lệch {delta > 0 ? "thừa" : "thiếu"} · giá trị{" "}
                      <Money amount={line.value} />
                    </p>
                  ) : null}
                </article>
              );
            })
          )}
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">
              Ghi chú (tuỳ chọn)
            </span>
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
            className="touch-btn h-14 w-full gap-2 bg-amber-700 text-sm text-white disabled:opacity-50"
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
      <section className="mb-8 space-y-2">
        <h2 className="section-title">Nhập thêm vào món có sẵn</h2>
        {loading ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : visible.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Chưa có hàng. Bấm &quot;Thêm hàng kho&quot; ở trên.
          </div>
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
                    <p className="font-extrabold text-slate-900">
                      {product.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
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
                  <div className="flex shrink-0 gap-1">
                    {canManageProducts ? (
                      <button
                        type="button"
                        aria-label="Sửa"
                        onClick={() => openEditProduct(product)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    ) : null}
                    {isSuperAdmin ? (
                      <button
                        type="button"
                        aria-label="Xóa"
                        disabled={deletingId === product.id}
                        onClick={() => handleDeleteProduct(product)}
                        className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-700 disabled:opacity-50"
                      >
                        {deletingId === product.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isRecipeFinished(product) ? (
                  <p className="rounded-2xl bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-snug text-amber-950 ring-1 ring-amber-100">
                    Món nấu/pha — nhập hoặc lưu sửa sẽ đổi thành hàng nhập
                    (trừ tồn khi bán), bỏ công thức.
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Đơn vị nhập
                    </span>
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
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Số {selectedUnit?.label || "đv"}
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
                  {isPackUnit ? (
                    <label className="block col-span-2">
                      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        1 {selectedUnit?.label || "thùng"} = ? số lẻ (
                        {packaging.baseUnit})
                      </span>
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
                      <span className="mt-1 block text-[11px] text-slate-500">
                        Gói/chai là đơn vị nhỏ nhất: bán lẻ hoặc gắn công thức
                        món khác.
                      </span>
                    </label>
                  ) : null}
                  <label className="block col-span-2">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Giá / {selectedUnit?.label || "đv"}
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
                        <p className="mt-1 text-[11px] font-semibold leading-snug text-emerald-800">
                          {qty} {selectedUnit.label}
                          {packFactor > 1
                            ? ` × ${packFactor} ${packaging.baseUnit}`
                            : ""}
                          {" × "}
                          {formatCurrency(previewCost)}
                          {" → +"}
                          {preview.baseQty} {packaging.baseUnit}
                          {" · "}
                          {formatCurrency(preview.baseUnitCost)}/
                          {packaging.baseUnit}
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
                      {selectedUnit?.label || product.unit || "đv"}
                      {packFactor > 1
                        ? ` × ${packFactor} ${packaging.baseUnit}`
                        : ""}{" "}
                      = {formatUnitCount(baseQtyPreview)} {packaging.baseUnit}
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
      )}
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
