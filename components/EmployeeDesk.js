'use client';

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import {
  Banknote,
  Loader2,
  Minus,
  Plus,
  QrCode,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { Money } from "@/components/StatusBadges";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { actorFields, formatActorLabel } from "@/lib/audit";
import { buildVietQrUrl, DEFAULT_BANK } from "@/lib/bank";
import { db } from "@/lib/firebase";
import { subscribeGlobalSettings } from "@/lib/settings";
import { cn, dateInfoCode, formatCurrency } from "@/lib/utils";

/**
 * Giao diện nhân viên tối giản:
 * - 1 màn hình: chạm món → +/- ngay trên ô
 * - Thanh dưới luôn có: Tổng · Tiền mặt · QR
 * - Không tab Thực đơn / Giỏ
 */
export default function EmployeeDesk() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [bank, setBank] = useState(DEFAULT_BANK);
  const [myRecent, setMyRecent] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

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
        showToast("Không tải được món", "error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    const unsub = subscribeGlobalSettings(
      (settings) => setBank(settings.bank),
      () => setBank(DEFAULT_BANK)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "transactions"),
      orderBy("timestamp", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((t) => t.type === "income" && t.createdBy === user.uid)
          .slice(0, 8);
        setMyRecent(rows);
      },
      () => setMyRecent([])
    );
    return () => unsub();
  }, [user?.uid]);

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

  const recordSale = async (paymentMethod) => {
    if (!cartItems.length) {
      showToast("Chưa chọn món", "error");
      return;
    }

    setSubmitting(true);
    try {
      const note = cartItems
        .map((item) => `${item.name} x${item.qty}`)
        .join(", ");
      const actor = actorFields(user, profile);

      await addDoc(collection(db, "transactions"), {
        amount: total,
        type: "income",
        category: "bán hàng",
        timestamp: serverTimestamp(),
        note,
        paymentMethod,
        ...actor,
      });

      setCart({});
      setShowQr(false);
      showToast(`Đã thu ${formatCurrency(total)}`, "success");
    } catch (error) {
      console.error(error);
      showToast("Ghi thu thất bại — thử lại", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const qrUrl = buildVietQrUrl({
    ...bank,
    amount: total,
    addInfo: `Trada_${dateInfoCode()}`,
  });

  const displayName = profile?.name || profile?.username || "Nhân viên";

  return (
    <AppShell
      title="Thu tiền"
      subtitle={`Xin chào, ${displayName}`}
      dense
      employeeMode
    >
      <p className="mb-3 text-center text-sm font-medium text-slate-600">
        Chạm món để thêm · chỉnh số dưới mỗi ô
      </p>

      <div className="grid grid-cols-2 gap-3 pb-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-[1.25rem] bg-white/80"
              />
            ))
          : products.map((product) => {
              const qty = cart[product.id] || 0;
              return (
                <div
                  key={product.id}
                  className={cn(
                    "card-panel flex min-h-[9.5rem] flex-col justify-between p-3 transition duration-200",
                    qty > 0 && "ring-2 ring-brand-700 bg-brand-50/40"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => changeQty(product.id, 1)}
                    className="min-h-16 w-full cursor-pointer text-left active:scale-[0.98]"
                  >
                    <p className="text-lg font-extrabold leading-snug text-slate-900">
                      {product.name}
                    </p>
                    <p className="money mt-1 text-base font-bold text-brand-700">
                      <Money amount={product.price} />
                    </p>
                  </button>

                  <div className="mt-2 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      aria-label={`Giảm ${product.name}`}
                      disabled={!qty}
                      onClick={() => changeQty(product.id, -1)}
                      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-800 transition active:scale-95 disabled:opacity-30"
                    >
                      <Minus className="h-6 w-6" />
                    </button>
                    <span className="money min-w-10 text-center text-2xl font-extrabold text-slate-900">
                      {qty}
                    </span>
                    <button
                      type="button"
                      aria-label={`Tăng ${product.name}`}
                      onClick={() => changeQty(product.id, 1)}
                      className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-white transition active:scale-95"
                    >
                      <Plus className="h-6 w-6" />
                    </button>
                  </div>
                </div>
              );
            })}
      </div>

      {!loading && products.length === 0 ? (
        <div className="card-panel text-center text-sm text-slate-500">
          Chưa có món. Nhờ quản lý thêm sản phẩm.
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        className="mb-3 w-full py-2 text-center text-sm font-semibold text-brand-800"
      >
        {showHistory ? "Ẩn lịch sử của tôi" : `Lịch sử của tôi (${myRecent.length})`}
      </button>

      {showHistory ? (
        <div className="mb-28 space-y-2">
          {myRecent.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Chưa có khoản thu</p>
          ) : (
            myRecent.map((row) => {
              const ms = row.timestamp?.toMillis?.() ?? 0;
              const timeLabel = ms
                ? new Date(ms).toLocaleString("vi-VN", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—";
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-100"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {row.note || "Thu"}
                    </p>
                    <p className="text-xs text-slate-400">{timeLabel}</p>
                  </div>
                  <p className="money shrink-0 font-extrabold text-emerald-700">
                    {formatCurrency(row.amount)}
                  </p>
                </div>
              );
            })
          )}
          <p className="pt-1 text-center text-[11px] text-slate-400">
            Ghi nhận: {formatActorLabel({ createdByName: displayName, createdByUsername: profile?.username })}
          </p>
        </div>
      ) : null}

      {/* Thanh thao tác cố định — luôn thấy */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[45] border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur-md">
        <div className="mx-auto max-w-lg space-y-2">
          <div className="flex items-end justify-between px-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tổng thu
              </p>
              <p className="money text-3xl font-extrabold leading-none text-slate-900">
                <Money amount={total} />
              </p>
            </div>
            <p className="text-sm font-semibold text-slate-500">
              {totalQty} món
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("cash")}
              className="touch-btn h-16 flex-col gap-0.5 bg-emerald-600 text-white disabled:opacity-40"
            >
              {submitting ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <Banknote className="h-6 w-6" aria-hidden />
              )}
              <span className="text-sm font-bold">Tiền mặt</span>
            </button>
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => setShowQr(true)}
              className="touch-btn h-16 flex-col gap-0.5 bg-brand-700 text-white disabled:opacity-40"
            >
              <QrCode className="h-6 w-6" aria-hidden />
              <span className="text-sm font-bold">QR / CK</span>
            </button>
          </div>
        </div>
      </div>

      {showQr ? (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-slate-950/60 p-0 sm:items-center sm:justify-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="employee-qr-title"
        >
          <div className="max-h-[95dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 id="employee-qr-title" className="text-xl font-extrabold">
                  Đưa QR cho khách
                </h2>
                <p className="money mt-1 text-lg font-bold text-brand-800">
                  <Money amount={total} />
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => setShowQr(false)}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 active:scale-95"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt="VietQR thanh toán"
                width={360}
                height={360}
                className="mx-auto h-auto w-full max-w-[340px]"
              />
            </div>

            <p className="mt-3 text-center text-sm text-slate-500">
              Sau khi khách chuyển xong, bấm nút bên dưới
            </p>

            <button
              type="button"
              disabled={submitting}
              onClick={() => recordSale("banking")}
              className="touch-btn mt-3 h-16 w-full bg-emerald-600 text-lg text-white"
            >
              {submitting ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                "Đã nhận tiền — ghi thu"
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowQr(false)}
              className="touch-btn mt-2 h-12 w-full bg-slate-100 text-slate-700"
            >
              Quay lại sửa món
            </button>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
