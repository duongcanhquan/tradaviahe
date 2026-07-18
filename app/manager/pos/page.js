'use client';

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import {
  Minus,
  Plus,
  ShoppingCart,
  Banknote,
  QrCode,
  X,
  Loader2,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import ProtectedRoute from "@/components/ProtectedRoute";
import { Money } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { db } from "@/lib/firebase";
import { cn, dateInfoCode } from "@/lib/utils";

function PosContent() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [tab, setTab] = useState("menu");

  useEffect(() => {
    const q = query(collection(db, "products"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProducts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast("Không tải được sản phẩm", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  const cartItems = useMemo(() => {
    return products
      .filter((p) => cart[p.id] > 0)
      .map((p) => ({
        ...p,
        qty: cart[p.id],
        lineTotal: cart[p.id] * (Number(p.price) || 0),
      }));
  }, [cart, products]);

  const total = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const totalQty = cartItems.reduce((sum, item) => sum + item.qty, 0);

  const changeQty = (id, delta) => {
    setCart((prev) => {
      const next = { ...prev };
      const value = (next[id] || 0) + delta;
      if (value <= 0) delete next[id];
      else next[id] = value;
      return next;
    });
  };

  const createSaleTransaction = async (paymentMethod) => {
    if (!cartItems.length) {
      showToast("Giỏ hàng trống", "error");
      return false;
    }

    setSubmitting(true);
    try {
      const note = cartItems
        .map((item) => `${item.name} x${item.qty}`)
        .join(", ");

      await addDoc(collection(db, "transactions"), {
        amount: total,
        type: "income",
        category: "bán hàng",
        timestamp: serverTimestamp(),
        createdBy: user.uid,
        note,
        paymentMethod,
        createdByName: profile?.name || profile?.email || "",
      });

      setCart({});
      setShowQr(false);
      setTab("menu");
      showToast("Đã ghi nhận doanh thu", "success");
      return true;
    } catch (error) {
      console.error(error);
      showToast("Ghi giao dịch thất bại", "error");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const qrUrl = `https://api.vietqr.io/image/970436-0987654321-compact2.jpg?amount=${total}&addInfo=Trada_${dateInfoCode()}&accountName=QUAN_TRA_DA`;

  return (
    <AppShell
      title="Bán hàng"
      subtitle={loading ? "Đang tải thực đơn..." : `${products.length} món · chạm để thêm`}
      dense={tab === "cart" && cartItems.length > 0}
    >
      <div
        role="tablist"
        aria-label="Chuyển thực đơn / giỏ hàng"
        className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200"
      >
        {[
          { id: "menu", label: "Thực đơn" },
          { id: "cart", label: `Giỏ (${totalQty})` },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "touch-btn h-12 rounded-xl text-sm",
              tab === item.id
                ? "bg-brand-700 text-white shadow-sm"
                : "bg-transparent text-slate-500"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "menu" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-28 animate-pulse rounded-[1.25rem] bg-white/80"
                  />
                ))
              : products.map((product) => {
                  const qty = cart[product.id] || 0;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => changeQty(product.id, 1)}
                      className={cn(
                        "card-panel relative flex min-h-[7.5rem] cursor-pointer flex-col items-start justify-between text-left transition duration-200 active:scale-[0.97]",
                        qty > 0 && "ring-2 ring-brand-700"
                      )}
                    >
                      {qty > 0 ? (
                        <span className="absolute right-3 top-3 flex h-7 min-w-7 items-center justify-center rounded-full bg-brand-700 px-2 text-xs font-bold text-white">
                          {qty}
                        </span>
                      ) : null}
                      <div className="pr-8">
                        <p className="text-base font-bold leading-snug text-slate-900">
                          {product.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Tồn {product.inStock ?? 0}
                        </p>
                      </div>
                      <p className="money text-sm font-bold text-brand-700">
                        <Money amount={product.price} />
                      </p>
                    </button>
                  );
                })}
          </div>

          {!loading && products.length === 0 ? (
            <div className="card-panel mt-3 text-sm text-slate-500">
              Chưa có sản phẩm. Vào Cài đặt → Seed sản phẩm mẫu (tài khoản quản lý).
            </div>
          ) : null}

          {totalQty > 0 ? (
            <div className="sticky-action-bar">
              <button
                type="button"
                onClick={() => setTab("cart")}
                className="touch-btn h-14 w-full bg-brand-700 text-white"
              >
                <ShoppingCart className="h-5 w-5" aria-hidden />
                Xem giỏ · <Money amount={total} />
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-3">
          {cartItems.length === 0 ? (
            <div className="card-panel flex flex-col items-center gap-2 py-12 text-slate-500">
              <ShoppingCart className="h-8 w-8" aria-hidden />
              <p className="font-medium">Giỏ hàng trống</p>
              <button
                type="button"
                onClick={() => setTab("menu")}
                className="touch-btn mt-2 h-12 bg-slate-900 px-5 text-white"
              >
                Chọn món
              </button>
            </div>
          ) : (
            <>
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="card-panel flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold">{item.name}</p>
                    <p className="money text-sm font-semibold text-brand-700">
                      <Money amount={item.lineTotal} />
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Giảm ${item.name}`}
                      onClick={() => changeQty(item.id, -1)}
                      className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl bg-slate-100 transition active:scale-95"
                    >
                      <Minus className="h-5 w-5" />
                    </button>
                    <span className="money min-w-8 text-center text-lg font-bold">
                      {item.qty}
                    </span>
                    <button
                      type="button"
                      aria-label={`Tăng ${item.name}`}
                      onClick={() => changeQty(item.id, 1)}
                      className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl bg-brand-50 text-brand-700 transition active:scale-95"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="card-panel space-y-3 border-brand-100 bg-brand-50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600">
                    Tổng cộng
                  </span>
                  <span className="money text-2xl font-extrabold text-brand-800">
                    <Money amount={total} />
                  </span>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => createSaleTransaction("cash")}
                  className="touch-btn h-14 w-full bg-emerald-600 text-white"
                >
                  {submitting ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Banknote className="h-5 w-5" aria-hidden />
                  )}
                  Thanh toán tiền mặt
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowQr(true)}
                  className="touch-btn h-14 w-full bg-brand-700 text-white"
                >
                  <QrCode className="h-5 w-5" aria-hidden />
                  Chuyển khoản QR
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {showQr ? (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-slate-950/55 p-4 sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-title"
        >
          <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 id="qr-title" className="text-lg font-bold">
                  Quét mã VietQR
                </h2>
                <p className="money text-sm text-slate-500">
                  Số tiền: <Money amount={total} />
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => setShowQr(false)}
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-slate-100 transition active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt="Mã VietQR thanh toán quán trà đá"
                width={320}
                height={320}
                className="mx-auto h-auto w-full max-w-[320px]"
              />
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => createSaleTransaction("banking")}
              className="touch-btn mt-4 h-14 w-full bg-brand-700 text-white"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : null}
              {submitting ? "Đang xác nhận..." : "Xác nhận đã nhận tiền"}
            </button>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

export default function PosPage() {
  return (
    <ProtectedRoute allowRoles={["manager", "employee"]}>
      <PosContent />
    </ProtectedRoute>
  );
}
