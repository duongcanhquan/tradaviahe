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
  QrCode,
  Smartphone,
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
import { cn, dateInfoCode, formatCurrency } from "@/lib/utils";

/**
 * Bàn thu siêu nhanh:
 * - 4 nhóm SP — chạm món = +1
 * - Thu tiền mặt hoặc chuyển khoản (ghi paymentMethod rõ)
 * - QR phụ: hiện mã rồi xác nhận CK
 */
export default function EmployeeDesk() {
  const { user, profile, hasManagerAccess } = useAuth();
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
    // Chỉ giao dịch của mình — sort phía client
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
    // Món chưa nhóm / nhóm đã xóa: hiện ở nhóm đầu để không mất món
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
  const fewProducts = visibleProducts.length > 0 && visibleProducts.length <= 4;

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
      note,
      paymentMethod,
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
      showToast(`Đã thu ${formatCurrency(snapshot.amount)}`, "success");
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

  /** 1 chạm: thu ngay 1 phần (tiền mặt hoặc CK) */
  const quickPayOne = async (product, paymentMethod) => {
    if (submitting) return;
    const price = Number(product.price) || 0;
    if (price <= 0) {
      showToast("Món chưa có giá", "error");
      return;
    }
    setSubmitting(true);
    bumpFlash(product.id);
    try {
      await writeSale({
        items: [{ ...product, qty: 1 }],
        amount: price,
        paymentMethod,
      });
      const via = paymentMethod === "banking" ? "CK" : "TM";
      showToast(
        `Đã thu ${via} · ${product.name} · ${formatCurrency(price)}`,
        "success"
      );
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
      subtitle={displayName}
      dense
      employeeMode
    >
      <p className="mb-2 text-center text-xs font-semibold text-slate-500">
        Chạm món = +1 ·{" "}
        <span className="text-emerald-700">TM</span> /{" "}
        <span className="text-brand-700">CK</span> = ghi ngay · hoặc thu cả giỏ bên dưới
      </p>

      {/* 4 nhóm sản phẩm */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {groups.map((g) => {
          const active = activeGroupId === g.id;
          const count = countInGroup(g.id);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setActiveGroupId(g.id)}
              className={cn(
                "touch-btn min-h-[3.25rem] flex-col gap-0 px-2 py-2 text-sm font-extrabold leading-tight",
                active
                  ? "bg-brand-700 text-white shadow-md"
                  : "bg-white text-slate-700 ring-1 ring-slate-200"
              )}
            >
              <span className="truncate">{g.name}</span>
              <span
                className={cn(
                  "text-[11px] font-semibold",
                  active ? "text-white/80" : "text-slate-400"
                )}
              >
                {count} món
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 pb-2">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-[1.5rem] bg-white/80"
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
                    "relative overflow-hidden rounded-[1.5rem] bg-white shadow-sm ring-1 transition duration-150",
                    active
                      ? "ring-2 ring-brand-700 shadow-md"
                      : "ring-slate-200",
                    flashing && "scale-[0.985] bg-brand-50"
                  )}
                >
                  <div className="flex items-stretch">
                    {/* Vùng chạm chính: +1 */}
                    <button
                      type="button"
                      onClick={() => changeQty(product.id, 1)}
                      className={cn(
                        "min-h-[7.5rem] flex-1 cursor-pointer px-4 py-3 text-left active:bg-brand-50/80",
                        fewProducts && "min-h-[8.5rem] py-4"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "font-extrabold leading-tight text-slate-900",
                              fewProducts ? "text-2xl" : "text-xl"
                            )}
                          >
                            {product.name}
                          </p>
                          <p className="money mt-1 text-lg font-bold text-brand-700">
                            <Money amount={price} />
                          </p>
                          <p className="mt-1 text-xs font-medium text-slate-400">
                            Chạm để thêm
                          </p>
                        </div>
                        <div
                          className={cn(
                            "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl transition",
                            active
                              ? "bg-brand-700 text-white"
                              : "bg-slate-100 text-slate-500"
                          )}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">
                            SL
                          </span>
                          <span className="money text-3xl font-extrabold leading-none">
                            {qty}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Cột thao tác nhanh: TM / CK / − */}
                    <div className="flex w-[4.75rem] flex-col border-l border-slate-100">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => quickPayOne(product, "cash")}
                        className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-emerald-600 px-1 text-white transition active:bg-emerald-700 disabled:opacity-50"
                      >
                        <Banknote className="h-4 w-4" aria-hidden />
                        <span className="text-[11px] font-extrabold">TM</span>
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => quickPayOne(product, "banking")}
                        className="flex flex-1 flex-col items-center justify-center gap-0.5 bg-brand-700 px-1 text-white transition active:bg-brand-800 disabled:opacity-50"
                      >
                        <Smartphone className="h-4 w-4" aria-hidden />
                        <span className="text-[11px] font-extrabold">CK</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Giảm ${product.name}`}
                        disabled={!qty || submitting}
                        onClick={() => changeQty(product.id, -1)}
                        className="flex h-11 items-center justify-center bg-slate-100 text-slate-700 transition active:bg-slate-200 disabled:opacity-25"
                      >
                        <Minus className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
      </div>

      {!loading && products.length === 0 ? (
        <div className="rounded-[1.5rem] bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Chưa có món. Nhờ quản lý thêm ở Món giá.
        </div>
      ) : null}

      {!loading && products.length > 0 && visibleProducts.length === 0 ? (
        <div className="rounded-[1.5rem] bg-white px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Nhóm này chưa có món. Chọn nhóm khác hoặc thêm món ở Món giá.
        </div>
      ) : null}

      {totalQty > 0 ? (
        <div className="mt-3 rounded-2xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900 ring-1 ring-brand-100">
          {cartItems.map((item) => (
            <span key={item.id} className="mr-3 inline-block">
              {item.name} ×{item.qty}
            </span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        className="mt-3 w-full py-2 text-center text-xs font-semibold text-slate-400"
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
                  className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-100"
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
                  <p className="money shrink-0 font-extrabold text-emerald-700">
                    {formatCurrency(row.amount)}
                  </p>
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

      {/* Thanh thu: Tiền mặt · Chuyển khoản · QR */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[45] border-t border-slate-200 bg-white/95 px-3 py-3 shadow-[0_-10px_28px_rgba(15,23,42,0.1)] backdrop-blur-md">
        <div className="mx-auto max-w-lg space-y-2">
          <div className="flex items-end justify-between px-1">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Cần thu
              </p>
              <p className="money text-4xl font-extrabold leading-none text-slate-900">
                <Money amount={total} />
              </p>
            </div>
            <p className="pb-1 text-base font-extrabold text-slate-600">
              {totalQty > 0 ? `${totalQty} phần` : "Chạm món"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("cash")}
              className="touch-btn h-[3.75rem] gap-2 bg-emerald-600 text-base text-white disabled:opacity-35"
            >
              {submitting ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <Banknote className="h-6 w-6" aria-hidden />
                  <span className="font-extrabold">Tiền mặt</span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("banking")}
              className="touch-btn h-[3.75rem] gap-2 bg-brand-700 text-base text-white disabled:opacity-35"
            >
              {submitting ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <Smartphone className="h-6 w-6" aria-hidden />
                  <span className="font-extrabold">Chuyển khoản</span>
                </>
              )}
            </button>
          </div>
          <button
            type="button"
            disabled={submitting || totalQty === 0}
            onClick={() => setShowQr(true)}
            className="touch-btn h-11 w-full gap-2 border border-brand-200 bg-brand-50 text-sm font-bold text-brand-900 disabled:opacity-35"
          >
            <QrCode className="h-5 w-5" aria-hidden />
            Hiện QR rồi ghi CK
            {hasManagerAccess ? " (tuỳ chọn)" : ""}
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
