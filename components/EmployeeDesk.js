'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import {
  Banknote,
  Loader2,
  Minus,
  Plus,
  QrCode,
  Smartphone,
  Trash2,
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
import {
  DEFAULT_PRODUCT_GROUPS,
  ensureDefaultProductGroups,
  subscribeProductGroups,
} from "@/lib/productGroups";
import { isSellable } from "@/lib/products";
import { deleteSaleTransaction } from "@/lib/sales";
import { cn, dateInfoCode, formatCurrency, todayKey } from "@/lib/utils";

/**
 * Bàn thu siêu nhanh (POS):
 * - Nhóm SP gọn trên cùng
 * - Mỗi món: chạm / + / − để chỉnh số lượng — ưu tiên SL
 * - Thu TM / CK bằng nút lớn ở thanh dưới (không nút bé trên từng món)
 * - Nhập CK theo ngày nằm ở Đối soát
 */
export default function EmployeeDesk() {
  const { user, profile, role, canDeleteSales } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [groups, setGroups] = useState(DEFAULT_PRODUCT_GROUPS);
  const [activeGroupId, setActiveGroupId] = useState("drinks");
  const [cart, setCart] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [bank, setBank] = useState(DEFAULT_BANK);
  const [myRecent, setMyRecent] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const flashTimer = useRef(null);

  useEffect(() => {
    ensureDefaultProductGroups().catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = subscribeProductGroups(
      (rows) => {
        const active = rows.filter((g) => g.active !== false);
        setGroups(active.length ? active : DEFAULT_PRODUCT_GROUPS);
        setActiveGroupId((prev) => {
          if (active.some((g) => g.id === prev)) return prev;
          return active[0]?.id || DEFAULT_PRODUCT_GROUPS[0].id;
        });
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
        setProducts(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter(isSellable)
        );
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
      where("createdBy", "==", user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((t) => t.type === "income")
          .sort(
            (a, b) =>
              (b.timestamp?.toMillis?.() || 0) -
              (a.timestamp?.toMillis?.() || 0)
          )
          .slice(0, 6);
        setMyRecent(rows);
      },
      () => setMyRecent([])
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  const knownGroupIds = useMemo(
    () => new Set(groups.map((g) => g.id)),
    [groups]
  );

  const isUngroupedProduct = (p) =>
    !p.groupId || !knownGroupIds.has(p.groupId);

  const visibleProducts = useMemo(() => {
    const inGroup = products.filter((p) => p.groupId === activeGroupId);
    if (activeGroupId === groups[0]?.id) {
      const ungrouped = products.filter(
        (p) => !p.groupId || !knownGroupIds.has(p.groupId)
      );
      const seen = new Set(inGroup.map((p) => p.id));
      return [...inGroup, ...ungrouped.filter((p) => !seen.has(p.id))];
    }
    return inGroup;
  }, [products, activeGroupId, groups, knownGroupIds]);

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

  const countInGroup = (groupId) => {
    const n = products.filter((p) => p.groupId === groupId).length;
    if (groupId === groups[0]?.id) {
      return n + products.filter(isUngroupedProduct).length;
    }
    return n;
  };

  const bumpFlash = (id) => {
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 220);
  };

  const changeQty = (id, delta) => {
    setCart((prev) => {
      const next = { ...prev };
      const value = (next[id] || 0) + delta;
      if (value <= 0) delete next[id];
      else next[id] = value;
      return next;
    });
    if (delta > 0) bumpFlash(id);
  };

  const writeSale = async ({ items, amount, paymentMethod }) => {
    const note = items.map((item) => `${item.name} x${item.qty}`).join(", ");
    const actor = actorFields(user, profile);
    await addDoc(collection(db, "transactions"), {
      amount,
      type: "income",
      category: "bán hàng",
      timestamp: serverTimestamp(),
      businessDate: todayKey(),
      note,
      paymentMethod,
      source: "pos",
      ...actor,
    });
  };

  const recordSale = async (paymentMethod) => {
    if (!cartItems.length) {
      showToast("Chạm món trước", "error");
      return;
    }

    const snapshot = {
      items: cartItems,
      amount: total,
    };
    setSubmitting(true);
    setCart({});
    setShowQr(false);
    try {
      await writeSale({ ...snapshot, paymentMethod });
      const via = paymentMethod === "banking" ? "CK" : "TM";
      showToast(
        `Đã thu ${via} · ${formatCurrency(snapshot.amount)}`,
        "success"
      );
    } catch (error) {
      console.error(error);
      setCart(
        snapshot.items.reduce((acc, item) => {
          acc[item.id] = item.qty;
          return acc;
        }, {})
      );
      showToast("Ghi thu thất bại — thử lại", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSale = async (row) => {
    if (!canDeleteSales || !row?.id) return;
    const ok = window.confirm(
      `Xóa "${row.note || "khoản thu"}" · ${formatCurrency(row.amount)}?\nChỉ xóa khi ghi nhầm.`
    );
    if (!ok) return;
    setDeletingId(row.id);
    try {
      await deleteSaleTransaction(row.id, role);
      showToast("Đã xóa khoản thu", "success");
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Xóa thất bại", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const qrUrl = buildVietQrUrl({
    ...bank,
    amount: total,
    addInfo: `Trada_${dateInfoCode()}`,
  });

  const displayName = profile?.name || profile?.username || "Nhân viên";

  return (
    <AppShell title="Thu tiền" subtitle={displayName} dense employeeMode>
      {/* Nhóm SP — hàng gọn trên cùng */}
      <div className="sticky top-0 z-10 -mx-1 mb-2 bg-slate-100/95 px-1 pb-2 pt-0.5 backdrop-blur-sm">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((g) => {
            const active = activeGroupId === g.id;
            const count = countInGroup(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveGroupId(g.id)}
                className={cn(
                  "touch-btn h-9 shrink-0 gap-1.5 px-3 text-xs font-extrabold",
                  active
                    ? "bg-brand-700 text-white shadow-sm"
                    : "bg-white text-slate-700 ring-1 ring-slate-200"
                )}
              >
                <span className="whitespace-nowrap">{g.name}</span>
                <span
                  className={cn(
                    "rounded-md px-1 text-[10px] font-bold",
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Lưới 2 món / hàng — tối ưu màn hình */}
      <div className="grid grid-cols-2 gap-2 pb-2">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[7.25rem] animate-pulse rounded-2xl bg-white/80"
              />
            ))
          : visibleProducts.map((product) => {
              const qty = cart[product.id] || 0;
              const price = Number(product.price) || 0;
              const active = qty > 0;
              const flashing = flashId === product.id;

              return (
                <div
                  key={product.id}
                  className={cn(
                    "relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition duration-150",
                    active
                      ? "ring-2 ring-brand-700 shadow-md"
                      : "ring-slate-200",
                    flashing && "scale-[0.98] bg-brand-50"
                  )}
                >
                  {/* Chạm thân thẻ: +1 */}
                  <button
                    type="button"
                    onClick={() => changeQty(product.id, 1)}
                    className="flex min-h-[4.75rem] flex-1 flex-col px-2.5 pb-1.5 pt-2 text-left active:bg-brand-50/80"
                  >
                    <p className="line-clamp-2 text-sm font-extrabold leading-snug text-slate-900">
                      {product.name}
                    </p>
                    <p className="money mt-1 text-sm font-bold text-brand-700">
                      <Money amount={price} />
                    </p>
                    <div
                      className={cn(
                        "mt-auto flex h-9 w-full items-center justify-center rounded-xl",
                        active
                          ? "bg-brand-700 text-white"
                          : "bg-slate-100 text-slate-500"
                      )}
                    >
                      <span className="mr-1 text-[10px] font-bold uppercase opacity-80">
                        SL
                      </span>
                      <span className="money text-xl font-extrabold leading-none">
                        {qty}
                      </span>
                    </div>
                  </button>

                  <div className="grid grid-cols-2 border-t border-slate-100">
                    <button
                      type="button"
                      aria-label={`Giảm ${product.name}`}
                      disabled={!qty || submitting}
                      onClick={() => changeQty(product.id, -1)}
                      className="flex h-10 items-center justify-center bg-slate-100 text-slate-700 transition active:bg-slate-200 disabled:opacity-25"
                    >
                      <Minus className="h-5 w-5" strokeWidth={2.75} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Thêm ${product.name}`}
                      disabled={submitting}
                      onClick={() => changeQty(product.id, 1)}
                      className="flex h-10 items-center justify-center bg-brand-700 text-white transition active:bg-brand-800 disabled:opacity-50"
                    >
                      <Plus className="h-5 w-5" strokeWidth={2.75} />
                    </button>
                  </div>
                </div>
              );
            })}
      </div>

      {!loading && products.length === 0 ? (
        <div className="rounded-[1.25rem] bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Chưa có món. Nhờ quản lý thêm ở Món giá.
        </div>
      ) : null}

      {!loading && products.length > 0 && visibleProducts.length === 0 ? (
        <div className="rounded-[1.25rem] bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Nhóm này chưa có món. Chọn nhóm khác.
        </div>
      ) : null}

      {totalQty > 0 ? (
        <div className="mt-2 rounded-xl bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-900 ring-1 ring-brand-100">
          {cartItems.map((item) => (
            <span key={item.id} className="mr-2.5 inline-block">
              {item.name} ×{item.qty}
            </span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        className="mt-2 w-full py-1.5 text-center text-xs font-semibold text-slate-400"
      >
        {showHistory ? "Ẩn lịch sử" : "Lịch sử vừa thu"}
      </button>

      {showHistory ? (
        <div className="mb-36 space-y-2">
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
              const isCk = row.paymentMethod === "banking";
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-100"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {row.note || "Thu"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {timeLabel}
                      {" · "}
                      <span
                        className={
                          isCk
                            ? "font-bold text-brand-700"
                            : "font-bold text-emerald-700"
                        }
                      >
                        {isCk ? "CK" : "TM"}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <p className="money font-extrabold text-emerald-700">
                      {formatCurrency(row.amount)}
                    </p>
                    {canDeleteSales ? (
                      <button
                        type="button"
                        aria-label="Xóa khoản thu"
                        disabled={deletingId === row.id}
                        onClick={() => handleDeleteSale(row)}
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-700 ring-1 ring-rose-100 disabled:opacity-50"
                      >
                        {deletingId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" aria-hidden />
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          <p className="pt-1 text-center text-[11px] text-slate-400">
            {formatActorLabel({
              createdByName: displayName,
              createdByUsername: profile?.username,
            })}
          </p>
        </div>
      ) : (
        <div className="h-44" aria-hidden />
      )}

      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[45] border-t border-slate-200 bg-white/95 px-3 py-2.5 shadow-[0_-10px_28px_rgba(15,23,42,0.1)] backdrop-blur-md">
        <div className="mx-auto max-w-lg space-y-2">
          <div className="flex items-end justify-between px-1">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Cần thu
              </p>
              <p className="money text-3xl font-extrabold leading-none text-slate-900">
                <Money amount={total} />
              </p>
            </div>
            <p className="pb-0.5 text-sm font-extrabold text-slate-600">
              {totalQty > 0 ? `${totalQty} phần` : "Chạm món"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("cash")}
              className="touch-btn h-[3.5rem] gap-2 bg-emerald-600 text-base text-white disabled:opacity-35"
            >
              {submitting ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <Banknote className="h-5 w-5" aria-hidden />
                  <span className="font-extrabold">Tiền mặt</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("banking")}
              className="touch-btn h-[3.5rem] gap-2 bg-brand-700 text-base text-white disabled:opacity-35"
            >
              {submitting ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <Smartphone className="h-5 w-5" aria-hidden />
                  <span className="font-extrabold">Chuyển khoản</span>
                </>
              )}
            </button>
          </div>
          <button
            type="button"
            disabled={submitting || totalQty === 0}
            onClick={() => setShowQr(true)}
            className="touch-btn h-10 w-full gap-2 border border-brand-200 bg-brand-50 text-sm font-bold text-brand-900 disabled:opacity-35"
          >
            <QrCode className="h-4 w-4" aria-hidden />
            Hiện QR rồi ghi CK
          </button>
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
                <p className="money mt-1 text-2xl font-extrabold text-brand-800">
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

            <button
              type="button"
              disabled={submitting}
              onClick={() => recordSale("banking")}
              className="touch-btn mt-4 h-[4.25rem] w-full bg-emerald-600 text-lg text-white"
            >
              {submitting ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                "Đã nhận — ghi thu"
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowQr(false)}
              className="touch-btn mt-2 h-12 w-full bg-slate-100 text-slate-700"
            >
              Quay lại
            </button>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
