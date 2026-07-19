'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Loader2, Package, Save } from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money } from "@/components/StatusBadges";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import {
  DEFAULT_PRODUCT_GROUPS,
  ensureDefaultProductGroups,
  subscribeProductGroups,
} from "@/lib/productGroups";
import { isSellable } from "@/lib/products";
import { updateProductStocks } from "@/lib/reports";
import { cn } from "@/lib/utils";

function InventoryContent() {
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [groups, setGroups] = useState(DEFAULT_PRODUCT_GROUPS);
  const [stocks, setStocks] = useState({});
  const [activeGroupId, setActiveGroupId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    const q = query(collection(db, "products"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(isSellable);
        setProducts(list);
        setStocks((prev) => {
          const next = { ...prev };
          list.forEach((p) => {
            if (next[p.id] === undefined) next[p.id] = String(p.inStock ?? 0);
          });
          return next;
        });
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được tồn kho", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const knownGroupIds = useMemo(
    () => new Set(groups.map((g) => g.id)),
    [groups]
  );

  const visibleProducts = useMemo(() => {
    if (activeGroupId === "all") return products;
    if (activeGroupId === "other") {
      return products.filter(
        (p) => !p.groupId || !knownGroupIds.has(p.groupId)
      );
    }
    return products.filter((p) => p.groupId === activeGroupId);
  }, [products, activeGroupId, knownGroupIds]);

  const stockByGroup = useMemo(() => {
    return groups.map((g) => {
      const rows = products.filter((p) => p.groupId === g.id);
      const qty = rows.reduce(
        (sum, p) => sum + (Number(stocks[p.id] ?? p.inStock) || 0),
        0
      );
      return { id: g.id, name: g.name, count: rows.length, qty };
    });
  }, [groups, products, stocks]);

  const dirty = useMemo(() => {
    return products.some(
      (p) => Number(stocks[p.id]) !== Number(p.inStock ?? 0)
    );
  }, [products, stocks]);

  const handleSave = async () => {
    if (!dirty) {
      showToast("Chưa đổi tồn nào", "error");
      return;
    }
    setSaving(true);
    try {
      const n = await updateProductStocks({ products, endStocks: stocks });
      showToast(`Đã lưu tồn kho · ${n} món`, "success");
    } catch (error) {
      console.error(error);
      showToast("Lưu tồn thất bại", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Tồn kho"
      subtitle="Đối soát hàng còn theo nhóm"
      dense
    >
      <p className="mb-3 text-xs text-slate-500">
        Xem nhanh danh mục còn trong kho. Doanh thu ngày/tuần/tháng xem ở{" "}
        <Link href="/dashboard" className="font-bold text-brand-800 underline">
          Đối soát
        </Link>
        .
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2">
        {stockByGroup.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setActiveGroupId(g.id)}
            className={cn(
              "rounded-2xl px-3 py-2.5 text-left ring-1 transition",
              activeGroupId === g.id
                ? "bg-brand-700 text-white ring-brand-700"
                : "bg-white text-slate-800 ring-slate-200"
            )}
          >
            <p className="text-xs font-bold opacity-80">{g.name}</p>
            <p className="money text-lg font-extrabold leading-tight">
              {g.qty}
            </p>
            <p className="text-[11px] opacity-70">{g.count} món</p>
          </button>
        ))}
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setActiveGroupId("all")}
          className={cn(
            "touch-btn h-9 shrink-0 px-3 text-xs font-extrabold",
            activeGroupId === "all"
              ? "bg-slate-900 text-white"
              : "bg-white text-slate-700 ring-1 ring-slate-200"
          )}
        >
          Tất cả
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setActiveGroupId(g.id)}
            className={cn(
              "touch-btn h-9 shrink-0 px-3 text-xs font-extrabold",
              activeGroupId === g.id
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200"
            )}
          >
            {g.name}
          </button>
        ))}
      </div>

      <section className="mb-4 space-y-2">
        {loading ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : visibleProducts.length === 0 ? (
          <div className="card-panel text-sm text-slate-500">
            Nhóm này chưa có món.
          </div>
        ) : (
          visibleProducts.map((product) => (
            <div key={product.id} className="card-panel">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900">{product.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Giá <Money amount={product.price} /> · Đơn vị{" "}
                    {product.unit || "—"}
                  </p>
                </div>
                <Package className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Tồn hiện tại
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className="field-input money"
                  value={stocks[product.id] ?? ""}
                  onChange={(e) =>
                    setStocks((prev) => ({
                      ...prev,
                      [product.id]: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
          ))
        )}
      </section>

      <div className="h-28" aria-hidden />

      <div className="sticky-action-bar">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={handleSave}
          className="touch-btn h-14 w-full bg-brand-700 text-white disabled:opacity-40"
        >
          {saving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Save className="h-5 w-5" aria-hidden />
          )}
          {saving ? "Đang lưu..." : "Lưu tồn kho"}
        </button>
      </div>
    </AppShell>
  );
}

export default function InventoryPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "investor"]}>
      <InventoryContent />
    </ProtectedRoute>
  );
}
