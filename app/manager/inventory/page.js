'use client';

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Calculator, Loader2, Send } from "lucide-react";
import AppShell from "@/components/AppShell";
import BankingByDateForm from "@/components/BankingByDateForm";
import ProtectedRoute from "@/components/ProtectedRoute";
import { DiscrepancyBadge, Money } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import { isSellable } from "@/lib/products";
import {
  calculateReconciliation,
  submitDailyReport,
} from "@/lib/reports";
import { todayKey } from "@/lib/utils";

function InventoryContent() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [endStocks, setEndStocks] = useState({});
  const [startCash, setStartCash] = useState("");
  const [endCashActual, setEndCashActual] = useState("");
  const [bankingActual, setBankingActual] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "products"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(isSellable);
        setProducts(list);
        setEndStocks((prev) => {
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

  const previewRows = useMemo(() => {
    return products.map((product) => {
      const start = Number(product.inStock) || 0;
      const end = Number(endStocks[product.id] ?? start) || 0;
      const sold = Math.max(0, start - end);
      return {
        id: product.id,
        name: product.name,
        start,
        end,
        sold,
        revenue: sold * (Number(product.price) || 0),
      };
    });
  }, [endStocks, products]);

  const handleCalculate = () => {
    try {
      const calc = calculateReconciliation({
        products,
        endStocks,
        startCash,
        endCashActual,
        bankingActual,
      });
      setResult(calc);
      showToast("Đã tính đối chiếu", "success");
    } catch (error) {
      console.error(error);
      showToast("Không tính được đối chiếu", "error");
    }
  };

  const handleSubmit = async () => {
    if (!result) {
      showToast("Hãy tính đối chiếu trước", "error");
      return;
    }

    setSubmitting(true);
    try {
      await submitDailyReport({
        products,
        endStocks,
        startCash,
        endCashActual,
        bankingActual,
        systemRevenue: result.systemRevenue,
        discrepancy: result.discrepancy,
        checkedBy: user.uid,
        checkedByName: profile?.name || profile?.username || "",
        checkedByUsername: profile?.username || "",
        checkedByRole: profile?.role || null,
      });
      showToast(
        `Đã gửi chốt ca ${todayKey()} · ${profile?.name || profile?.username || ""}`,
        "success"
      );
      setResult(null);
    } catch (error) {
      console.error(error);
      showToast("Gửi chốt ca thất bại", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell title="Chốt ca" subtitle={`Đối soát ngày ${todayKey()}`} dense>
      <BankingByDateForm className="mb-4" />

      <section className="card-panel mb-4 space-y-3">
        <h2 className="section-title">1. Tiền quỹ thực tế</h2>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            Tiền lẻ đầu ca
          </span>
          <input
            type="number"
            inputMode="numeric"
            className="field-input money"
            value={startCash}
            onChange={(e) => {
              setStartCash(e.target.value);
              setResult(null);
            }}
            placeholder="0"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            Tiền mặt đếm thực tế
          </span>
          <input
            type="number"
            inputMode="numeric"
            className="field-input money"
            value={endCashActual}
            onChange={(e) => {
              setEndCashActual(e.target.value);
              setResult(null);
            }}
            placeholder="0"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">
            Chuyển khoản thực tế (app NH)
          </span>
          <input
            type="number"
            inputMode="numeric"
            className="field-input money"
            value={bankingActual}
            onChange={(e) => {
              setBankingActual(e.target.value);
              setResult(null);
            }}
            placeholder="0"
          />
        </label>
      </section>

      <section className="mb-4 space-y-3">
        <h2 className="section-title">2. Tồn cuối ngày</h2>
        {loading ? (
          <div className="card-panel h-24 animate-pulse bg-white/80" />
        ) : (
          products.map((product) => (
            <div key={product.id} className="card-panel">
              <div className="mb-3">
                <p className="font-bold text-slate-900">{product.name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Tồn đầu: {product.inStock ?? 0} · Giá{" "}
                  <Money amount={product.price} />
                </p>
              </div>
              <label className="block">
                <span className="sr-only">Tồn cuối {product.name}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className="field-input money"
                  value={endStocks[product.id] ?? ""}
                  onChange={(e) => {
                    setEndStocks((prev) => ({
                      ...prev,
                      [product.id]: e.target.value,
                    }));
                    setResult(null);
                  }}
                  placeholder="Số lượng tồn cuối ngày"
                />
              </label>
            </div>
          ))
        )}
      </section>

      {result ? (
        <section className="card-panel mb-4 space-y-3 border-brand-100 bg-brand-50">
          <h2 className="section-title">Kết quả đối chiếu</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip bg-white text-slate-700 ring-1 ring-slate-200">
              DT hệ thống: <Money amount={result.systemRevenue} />
            </span>
            <DiscrepancyBadge value={result.discrepancy} />
          </div>
          <div className="space-y-1 border-t border-brand-100 pt-3 text-xs text-slate-600">
            {previewRows.map((row) => (
              <p key={row.id} className="flex justify-between gap-3">
                <span>
                  {row.name}: bán {row.sold}
                </span>
                <span className="money font-semibold">
                  <Money amount={row.revenue} />
                </span>
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <div className="h-36" aria-hidden />

      <div className="sticky-action-bar space-y-2">
        <button
          type="button"
          onClick={handleCalculate}
          className="touch-btn h-14 w-full bg-slate-900 text-white"
        >
          <Calculator className="h-5 w-5" aria-hidden />
          Tính toán đối chiếu
        </button>
        <button
          type="button"
          disabled={submitting || !result}
          onClick={handleSubmit}
          className="touch-btn h-14 w-full bg-brand-700 text-white"
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" aria-hidden />
          )}
          {submitting ? "Đang gửi..." : "Gửi chốt ca ngày"}
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
