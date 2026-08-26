'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
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
import { formatActorLabel } from "@/lib/audit";
import { buildVietQrUrl, DEFAULT_BANK } from "@/lib/bank";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { isGoodsIncome } from "@/lib/receipts";
import { subscribeGlobalSettings } from "@/lib/settings";
import {
  DEFAULT_PRODUCT_GROUPS,
  subscribeProductGroups,
} from "@/lib/productGroups";
import { subscribeCollection } from "@/lib/liveCollection";
import {
  comparePosOrder,
  isSellable,
  moveProductInOrder,
  subscribeProducts,
} from "@/lib/products";
import { deleteSaleTransaction, recordPosSale } from "@/lib/sales";
import { cn, dateInfoCode, formatCurrency, todayKey } from "@/lib/utils";

/**
 * Bàn thu siêu nhanh (POS):
 * - Danh mục nhóm nằm trong header (nút nhỏ) — ưu tiên diện tích món
 * - Mỗi món: chạm / + / − chỉnh SL
 * - Thanh dưới: TM · CK · QR một hàng
 */
export default function EmployeeDesk() {
  const { user, profile, role, canDeleteSales, canManageProducts } = useAuth();
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
  const [sortMode, setSortMode] = useState(false);
  const flashTimer = useRef(null);

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
    const unsub = subscribeProducts(
      (list) => {
        setProducts(list.filter(isSellable));
        setLoading(false);
      },
      (error) => {
        console.error(error);
        showToast(firestoreErrorMessage(error, "Không tải được món"), "error");
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
    const today = todayKey();
    // POS chỉ hiển thị lịch sử hôm nay: để Firestore lọc trước thay vì tải
    // toàn bộ transactions rồi mới lọc trên điện thoại.
    const unsub = subscribeCollection(
      "transactions",
      (list) => {
        let rows = list
          .filter((t) => (t.businessDate || todayKey()) === today)
          .filter(isGoodsIncome)
          .sort(
            (a, b) =>
              (b.timestamp?.toMillis?.() || 0) -
              (a.timestamp?.toMillis?.() || 0)
          );

        // Quản lý / chủ ĐT / SA: xem mọi lần thu hôm nay để kiểm soát & xóa
        // Nhân viên: chỉ khoản mình ghi (gần đây)
        if (canDeleteSales) {
          rows = rows.slice(0, 20);
        } else {
          rows = rows
            .filter((t) => t.createdBy === user.uid)
            .slice(0, 6);
        }
        setMyRecent(rows);
      },
      () => setMyRecent([])
    );
    return () => unsub();
  }, [user?.uid, canDeleteSales]);

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
    let rows;
    const inGroup = products.filter((p) => p.groupId === activeGroupId);
    if (activeGroupId === groups[0]?.id) {
      const ungrouped = products.filter(
        (p) => !p.groupId || !knownGroupIds.has(p.groupId)
      );
      const seen = new Set(inGroup.map((p) => p.id));
      rows = [...inGroup, ...ungrouped.filter((p) => !seen.has(p.id))];
    } else {
      rows = inGroup;
    }
    return [...rows].sort(comparePosOrder);
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
    await recordPosSale({
      amount,
      paymentMethod,
      items,
      user,
      profile,
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

  const handleMoveProduct = async (productId, direction) => {
    if (!canManageProducts || submitting) return;
    setSubmitting(true);
    try {
      const ok = await moveProductInOrder(
        visibleProducts,
        productId,
        direction
      );
      if (ok) {
        showToast(direction === "up" ? "Đã đưa lên" : "Đã đưa xuống", "success");
      }
    } catch (error) {
      console.error(error);
      showToast("Không đổi được thứ tự", "error");
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

  const groupHeader = (
    <div className="flex items-center gap-1">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((g) => {
          const active = activeGroupId === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setActiveGroupId(g.id)}
              className={cn(
                "h-7 shrink-0 rounded-lg px-2 text-[10px] font-extrabold leading-none transition active:scale-95",
                active
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
              )}
            >
              {g.name}
              <span
                className={cn(
                  "ml-1 opacity-80",
                  active ? "text-white" : "text-slate-400"
                )}
              >
                {countInGroup(g.id)}
              </span>
            </button>
          );
        })}
      </div>
      {canManageProducts ? (
        <button
          type="button"
          onClick={() => setSortMode((v) => !v)}
          className={cn(
            "h-7 shrink-0 rounded-lg px-2 text-[10px] font-extrabold",
            sortMode
              ? "bg-amber-500 text-white"
              : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
          )}
        >
          {sortMode ? "Xong" : "TT"}
        </button>
      ) : null}
    </div>
  );

  return (
    <AppShell
      title="Thu tiền"
      subtitle={displayName}
      dense
      employeeMode
      headerExtra={groupHeader}
    >
      {sortMode ? (
        <p className="mb-1 text-[10px] font-semibold text-amber-800">
          ↑↓ đưa món gọi nhiều lên trên
        </p>
      ) : null}

      {/* Lưới món — tối đa diện tích màn hình */}
      <div className="grid grid-cols-2 gap-1.5 pb-1">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-[4.75rem] animate-pulse rounded-xl bg-white/80"
              />
            ))
          : visibleProducts.map((product, index) => {
              const qty = cart[product.id] || 0;
              const price = Number(product.price) || 0;
              const active = qty > 0;
              const flashing = flashId === product.id;

              return (
                <div
                  key={product.id}
                  className={cn(
                    "relative flex h-[4.75rem] overflow-hidden rounded-xl bg-white ring-1 transition duration-150",
                    active
                      ? "ring-2 ring-brand-700"
                      : "ring-slate-200",
                    flashing && "scale-[0.98] bg-brand-50"
                  )}
                >
                  {sortMode ? (
                    <>
                      <div className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1">
                        <p className="truncate text-base font-extrabold leading-tight text-slate-900">
                          {product.name}
                        </p>
                        <p className="money mt-0.5 text-[11px] font-bold text-brand-700">
                          <Money amount={price} />
                          <span className="ml-1 font-semibold text-slate-400">
                            #{index + 1}
                          </span>
                        </p>
                      </div>
                      <div className="flex w-9 flex-col border-l border-slate-100">
                        <button
                          type="button"
                          aria-label="Đưa lên"
                          disabled={submitting || index === 0}
                          onClick={() => handleMoveProduct(product.id, "up")}
                          className="flex flex-1 items-center justify-center bg-amber-500 text-white disabled:opacity-25"
                        >
                          <ArrowUp className="h-4 w-4" strokeWidth={2.75} />
                        </button>
                        <button
                          type="button"
                          aria-label="Đưa xuống"
                          disabled={
                            submitting || index >= visibleProducts.length - 1
                          }
                          onClick={() => handleMoveProduct(product.id, "down")}
                          className="flex flex-1 items-center justify-center bg-slate-200 text-slate-700 disabled:opacity-25"
                        >
                          <ArrowDown className="h-4 w-4" strokeWidth={2.75} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => changeQty(product.id, 1)}
                        className="flex h-full min-w-0 flex-1 flex-col justify-center px-2 py-1 text-left active:bg-brand-50/80"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <p className="line-clamp-2 min-w-0 flex-1 text-base font-extrabold leading-tight text-slate-900">
                            {product.name}
                          </p>
                          <span
                            className={cn(
                              "money flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-md px-1 text-xs font-extrabold",
                              active
                                ? "bg-brand-700 text-white"
                                : "bg-slate-100 text-slate-500"
                            )}
                          >
                            {qty}
                          </span>
                        </div>
                        <p className="money mt-0.5 text-[11px] font-bold text-brand-700">
                          <Money amount={price} />
                        </p>
                      </button>
                      <div className="flex w-8 flex-col border-l border-slate-100">
                        <button
                          type="button"
                          aria-label={`Thêm ${product.name}`}
                          disabled={submitting}
                          onClick={() => changeQty(product.id, 1)}
                          className="flex flex-1 items-center justify-center bg-brand-700 text-white active:bg-brand-800 disabled:opacity-50"
                        >
                          <Plus className="h-4 w-4" strokeWidth={2.75} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Giảm ${product.name}`}
                          disabled={!qty || submitting}
                          onClick={() => changeQty(product.id, -1)}
                          className="flex flex-1 items-center justify-center bg-slate-100 text-slate-700 active:bg-slate-200 disabled:opacity-25"
                        >
                          <Minus className="h-4 w-4" strokeWidth={2.75} />
                        </button>
                      </div>
                    </>
                  )}
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
        <div className="mt-1.5 truncate rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-900 ring-1 ring-brand-100">
          {cartItems.map((item) => (
            <span key={item.id} className="mr-2 inline-block">
              {item.name} ×{item.qty}
            </span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        className="mt-1 w-full py-1 text-center text-[11px] font-semibold text-slate-400"
      >
        {showHistory
          ? "Ẩn lịch sử"
          : canDeleteSales
            ? "Lịch sử bán hôm nay (mọi người)"
            : "Lịch sử vừa thu"}
      </button>

      {showHistory ? (
        <div className="mb-28 space-y-1.5">
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
                    second: "2-digit",
                  })
                : "—";
              const isCk = row.paymentMethod === "banking";
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {row.note || "Thu"}
                    </p>
                    <p className="text-[11px] text-slate-400">
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
                      {canDeleteSales ? (
                        <>
                          {" · "}
                          <span className="font-semibold text-slate-600">
                            {formatActorLabel(row)}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <p className="money text-sm font-extrabold text-emerald-700">
                      {formatCurrency(row.amount)}
                    </p>
                    {canDeleteSales ? (
                      <button
                        type="button"
                        aria-label="Xóa khoản thu"
                        disabled={deletingId === row.id}
                        onClick={() => handleDeleteSale(row)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-100 disabled:opacity-50"
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
          {canDeleteSales ? (
            <Link
              href="/manager/sales"
              className="block pt-2 text-center text-xs font-bold text-brand-800"
            >
              Sổ món đã bán · chọn ngày →
            </Link>
          ) : (
            <p className="pt-1 text-center text-[11px] text-slate-400">
              {formatActorLabel({
                createdByName: displayName,
                createdByUsername: profile?.username,
              })}
            </p>
          )}
        </div>
      ) : (
        <div className="h-28" aria-hidden />
      )}

      {/* Thanh thu gọn: tổng + 3 nút 1 hàng */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[45] border-t border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur-md">
        <div className="mx-auto max-w-lg space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <p className="money text-2xl font-extrabold leading-none text-slate-900">
              <Money amount={total} />
            </p>
            <p className="text-xs font-extrabold text-slate-500">
              {totalQty > 0 ? `${totalQty} phần` : "Chạm món"}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("cash")}
              className="touch-btn h-11 flex-col gap-0 bg-emerald-600 text-[11px] font-extrabold text-white disabled:opacity-35"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Banknote className="h-4 w-4" aria-hidden />
                  Tiền mặt
                </>
              )}
            </button>
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("banking")}
              className="touch-btn h-11 flex-col gap-0 bg-brand-700 text-[11px] font-extrabold text-white disabled:opacity-35"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Smartphone className="h-4 w-4" aria-hidden />
                  CK
                </>
              )}
            </button>
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => setShowQr(true)}
              className="touch-btn h-11 flex-col gap-0 border border-brand-200 bg-brand-50 text-[11px] font-extrabold text-brand-900 disabled:opacity-35"
            >
              <QrCode className="h-4 w-4" aria-hidden />
              Hiện QR
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
