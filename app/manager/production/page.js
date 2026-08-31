'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { Beaker, Loader2, Plus, Save, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { formatActorLabel } from "@/lib/audit";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import {
  COST_MODE,
  RECIPE_PHASE,
  filterRecipeByPhase,
  isSellable,
  subscribeProducts,
} from "@/lib/products";
import {
  defaultBatchDateInput,
  recordProductionBatch,
  subscribeProductionBatches,
} from "@/lib/production";
import { cn, formatCurrency, todayInputValue } from "@/lib/utils";

const PAGE_SIZE = 10;

function ProductionContent() {
  const { user, profile, canManageShop } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);

  const [productId, setProductId] = useState("");
  const [batchCount, setBatchCount] = useState("1");
  const [estimatedServings, setEstimatedServings] = useState("");
  const [dateInput, setDateInput] = useState(defaultBatchDateInput);
  const [note, setNote] = useState("");

  useEffect(() => {
    const unsub = subscribeProducts(
      (list) => setProducts(list),
      (error) => {
        console.error(error);
        showToast(firestoreErrorMessage(error, "Không tải món"), "error");
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = subscribeProductionBatches(
      (list) => {
        setBatches(list);
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast(firestoreErrorMessage(error, "Không tải sổ pha"), "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const recipeProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          isSellable(p) &&
          p.costMode === COST_MODE.RECIPE &&
          filterRecipeByPhase(p.recipe, RECIPE_PHASE.BATCH).length > 0
      ),
    [products]
  );

  const selected = useMemo(
    () => recipeProducts.find((p) => p.id === productId) || null,
    [recipeProducts, productId]
  );

  const previewDeductions = useMemo(() => {
    if (!selected) return [];
    const n = Math.max(1, Number(batchCount) || 1);
    return filterRecipeByPhase(selected.recipe, RECIPE_PHASE.BATCH).map(
      (line) => {
        const ing = products.find((p) => p.id === line.productId);
        return {
          name: ing?.name || "?",
          unit: ing?.unit || "",
          qty: (Number(line.qty) || 0) * n,
          stock: Number(ing?.inStock) || 0,
        };
      }
    );
  }, [selected, batchCount, products]);

  const totalPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = batches.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const resetForm = () => {
    setProductId("");
    setBatchCount("1");
    setEstimatedServings("");
    setDateInput(defaultBatchDateInput());
    setNote("");
  };

  const onSelectProduct = (id) => {
    setProductId(id);
    const p = recipeProducts.find((x) => x.id === id);
    if (p) {
      const per = Math.max(1, Number(p.estimatedServings) || 100);
      const n = Math.max(1, Number(batchCount) || 1);
      setEstimatedServings(String(per * n));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canManageShop) {
      showToast("Không có quyền ghi mẻ", "error");
      return;
    }
    if (!selected) {
      showToast("Chọn món có công thức pha mẻ", "error");
      return;
    }
    setSaving(true);
    try {
      const result = await recordProductionBatch({
        product: selected,
        batchCount,
        estimatedServings: estimatedServings || undefined,
        note,
        dateInput,
        user,
        profile,
      });
      showToast(
        `Đã ghi ${result.batchCount} mẻ · ước ${result.estimatedServings} suất · trừ kho NL pha`,
        "success"
      );
      setOpen(false);
      resetForm();
      setPage(1);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Ghi mẻ thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Pha mẻ · ủ trà"
      subtitle="Ghi nhận mẻ · trừ NL pha ngay"
    >
      <div className="mb-3 rounded-2xl bg-teal-50 px-3 py-2.5 text-xs leading-relaxed text-teal-950 ring-1 ring-teal-100">
        <p className="font-extrabold">Quy trình</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>
            Setup công thức tại{" "}
            <Link
              href="/manager/products"
              className="font-bold text-teal-800 underline"
            >
              Món · Công thức mẻ
            </Link>{" "}
            (NL pha + số suất/mẻ + NL kèm mỗi cốc).
          </li>
          <li>Mỗi lần ủ / pha bình → ghi mẻ bên dưới → trừ trà, nước…</li>
          <li>Bán POS chỉ trừ đá, đường, ly… (NL kèm).</li>
        </ol>
      </div>

      {canManageShop ? (
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            if (!open) resetForm();
          }}
          className={cn(
            "touch-btn mb-4 h-14 w-full gap-2 text-sm font-bold",
            open ? "bg-slate-800 text-white" : "bg-teal-700 text-white"
          )}
        >
          {open ? (
            <>
              <X className="h-5 w-5" />
              Đóng form
            </>
          ) : (
            <>
              <Plus className="h-5 w-5" />
              Ghi mẻ pha / ủ hôm nay
            </>
          )}
        </button>
      ) : null}

      {open && canManageShop ? (
        <section className="card-panel mb-4 space-y-3 border-brand-100 bg-gradient-to-b from-brand-50/80 to-white">
          <div className="flex items-center gap-2">
            <Beaker className="h-5 w-5 text-brand-700" aria-hidden />
            <h2 className="section-title text-brand-950">Ghi nhận mẻ pha</h2>
          </div>

          {recipeProducts.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-amber-900">
                Chưa có món nào có <strong>NL pha mẻ</strong>. Trà đá đang để
                &quot;cost nhập tay&quot; thì chưa ghi được mẻ.
              </p>
              <Link
                href="/manager/products"
                className="touch-btn h-12 w-full bg-amber-600 text-sm font-bold text-white"
              >
                Mở Món · chọn Công thức mẻ
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  Món bán
                </span>
                <select
                  className="field-input"
                  value={productId}
                  onChange={(e) => onSelectProduct(e.target.value)}
                  required
                >
                  <option value="">— Chọn —</option>
                  {recipeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (1 mẻ ≈{" "}
                      {Math.max(1, Number(p.estimatedServings) || 100)} suất)
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">
                    Số mẻ / bình
                  </span>
                  <input
                    type="number"
                    min="1"
                    className="field-input"
                    value={batchCount}
                    onChange={(e) => {
                      setBatchCount(e.target.value);
                      if (selected) {
                        const per = Math.max(
                          1,
                          Number(selected.estimatedServings) || 100
                        );
                        const n = Math.max(1, Number(e.target.value) || 1);
                        setEstimatedServings(String(per * n));
                      }
                    }}
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold">
                    Ước số suất
                  </span>
                  <input
                    type="number"
                    min="1"
                    className="field-input"
                    value={estimatedServings}
                    onChange={(e) => setEstimatedServings(e.target.value)}
                    placeholder="100"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Ngày</span>
                <input
                  type="date"
                  className="field-input"
                  value={dateInput}
                  max={todayInputValue()}
                  onChange={(e) => setDateInput(e.target.value)}
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">
                  Ghi chú
                </span>
                <input
                  className="field-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: Bình trà đá sáng 12L"
                />
              </label>

              {previewDeductions.length ? (
                <div className="rounded-2xl bg-rose-50 px-3 py-2.5 text-xs text-rose-950 ring-1 ring-rose-100">
                  <p className="mb-1 font-extrabold">Sẽ trừ kho ngay:</p>
                  <ul className="space-y-0.5">
                    {previewDeductions.map((d) => {
                      const short = d.qty > d.stock;
                      return (
                        <li
                          key={d.name}
                          className={short ? "font-bold text-rose-700" : ""}
                        >
                          {d.name}: −{d.qty} {d.unit}
                          <span className="text-rose-700/70">
                            {" "}
                            (tồn {d.stock}
                            {short ? " — thiếu!" : ""})
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={saving || !productId}
                className="touch-btn h-14 w-full gap-2 bg-brand-700 text-white disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Save className="h-5 w-5" />
                )}
                {saving ? "Đang lưu..." : "Lưu mẻ & trừ kho"}
              </button>
            </form>
          )}
        </section>
      ) : null}

      <section className="mb-8 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title mb-0">Lịch sử mẻ</h2>
          <p className="text-xs text-slate-500">
            {batches.length} dòng
            {batches.length > PAGE_SIZE
              ? ` · ${safePage}/${totalPages}`
              : ""}
          </p>
        </div>

        {loading ? (
          <div className="card-panel h-24 animate-pulse" />
        ) : pageRows.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Chưa ghi mẻ nào.
          </div>
        ) : (
          pageRows.map((row) => (
            <article key={row.id} className="card-panel space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-extrabold text-slate-900">
                    {row.productName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.businessDate || "—"}
                    {" · "}
                    {row.batchCount || 1} mẻ · ước {row.estimatedServings} suất
                  </p>
                </div>
                <Beaker className="h-4 w-4 shrink-0 text-brand-600" />
              </div>
              {Array.isArray(row.deductions) && row.deductions.length ? (
                <ul className="space-y-0.5 text-xs text-rose-800">
                  {row.deductions.map((d) => (
                    <li key={`${row.id}-${d.productId}`}>
                      −{d.qty} {d.unit} {d.name}
                    </li>
                  ))}
                </ul>
              ) : null}
              {row.note ? (
                <p className="text-xs text-slate-600">{row.note}</p>
              ) : null}
              <p className="text-[11px] text-slate-400">
                {formatActorLabel(row)}
                {row.createdAt?.toDate
                  ? ` · ${format(row.createdAt.toDate(), "HH:mm", {
                      locale: vi,
                    })}`
                  : ""}
              </p>
            </article>
          ))
        )}

        {totalPages > 1 ? (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="touch-btn h-11 flex-1 bg-white text-sm ring-1 ring-slate-200 disabled:opacity-35"
            >
              Trước
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="touch-btn h-11 flex-1 bg-white text-sm ring-1 ring-slate-200 disabled:opacity-35"
            >
              Sau
            </button>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

export default function ProductionPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor", "superadmin"]}>
      <ProductionContent />
    </ProtectedRoute>
  );
}
