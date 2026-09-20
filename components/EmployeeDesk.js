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
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { Money } from "@/components/StatusBadges";
import {
  BottomSheet,
  EmptyState,
  FilterChip,
  ChipRow,
} from "@/components/ui/MobileUI";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast";
import { formatActorLabel } from "@/lib/audit";
import { buildSaleLineFromProduct } from "@/lib/cogs";
import { buildVietQrUrl, prefetchVietQrImage } from "@/lib/bank";
import { firestoreErrorMessage } from "@/lib/firestoreErrors";
import { isGoodsIncome } from "@/lib/receipts";
import { getCachedBank, subscribeGlobalSettings } from "@/lib/settings";
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
import { productUsesRecipe } from "@/lib/recipe";
import { deleteSaleTransaction, recordPosSale } from "@/lib/sales";
import {
  assertCanSellStock,
  defaultSellUnit,
  getSellableUnits,
} from "@/lib/packaging";
import {
  checkStockDeltas,
  stockDeltasForSaleItems,
} from "@/lib/stock";
import { cn, dateInfoCode, formatCurrency, todayKey } from "@/lib/utils";

/**
 * Bàn thu siêu nhanh (POS):
 * - Danh mục nhóm nằm trong header (nút nhỏ) — ưu tiên diện tích món
 * - Mỗi món: chạm / + / − chỉnh SL
 * - Thanh dưới: Tiền mặt · Chuyển khoản · QR chuyển
 */
function getDefaultCartUnitId(product) {
  return defaultSellUnit(product)?.id || "base";
}

export default function EmployeeDesk() {
  const { user, profile, role, canDeleteSales, canManageProducts } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState([]);
  const [groups, setGroups] = useState(DEFAULT_PRODUCT_GROUPS);
  const [activeGroupId, setActiveGroupId] = useState("drinks");
  const [cart, setCart] = useState({});
  const [unitPrefs, setUnitPrefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [bank, setBank] = useState(getCachedBank);
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
      () => setBank(getCachedBank())
    );
    return () => unsub();
  }, []);

  // Chỉ tải lịch sử khi mở — POS lần đầu nhẹ hơn trên điện thoại.
  useEffect(() => {
    if (!showHistory || !user?.uid) return;
    const today = todayKey();
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
  }, [showHistory, user?.uid, canDeleteSales]);

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

  const resolveCartUnitId = (product, line) => {
    if (!product) return "base";
    const preferred =
      line?.unitId || unitPrefs[product.id] || getDefaultCartUnitId(product);
    const sellable = getSellableUnits(product);
    if (sellable.some((u) => u.id === preferred)) return preferred;
    return getDefaultCartUnitId(product);
  };

  const pickSellUnit = (productId, unitId) => {
    setUnitPrefs((prev) => ({ ...prev, [productId]: unitId }));
    setCart((prev) => {
      if (!prev[productId]) return prev;
      return {
        ...prev,
        [productId]: { ...prev[productId], unitId },
      };
    });
  };

  const productsById = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products]
  );

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([productId, line]) => {
        const product = productsById[productId];
        const qty = Number(line?.qty) || 0;
        if (!product || qty <= 0) return null;

        const unitId = resolveCartUnitId(product, line);
        let saleLine;
        try {
          saleLine = buildSaleLineFromProduct(product, {
            qty,
            unitId,
            productsById,
          });
        } catch {
          try {
            saleLine = buildSaleLineFromProduct(product, {
              qty,
              productsById,
            });
          } catch (fallbackError) {
            console.error(fallbackError);
            return null;
          }
        }

        return {
          product,
          ...saleLine,
        };
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unitPrefs via resolveCartUnitId
  }, [cart, productsById, unitPrefs]);

  const total = cartItems.reduce((sum, item) => sum + item.lineRevenue, 0);
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
      const product = productsById[id];
      const current = next[id];
      const value = (Number(current?.qty) || 0) + delta;
      if (value <= 0) {
        delete next[id];
      } else {
        next[id] = {
          qty: value,
          unitId: resolveCartUnitId(product, current),
        };
      }
      return next;
    });
    if (delta > 0) bumpFlash(id);
  };

  const setCartUnit = (productId, unitId) => {
    pickSellUnit(productId, unitId);
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

    let saleItems;
    let amount;
    try {
      saleItems = cartItems.map((item) => {
        if (!productUsesRecipe(item.product)) {
          assertCanSellStock(item.product, item.unitId, item.qty);
        }
        return buildSaleLineFromProduct(item.product, {
          qty: item.qty,
          unitId: item.unitId,
          productsById,
        });
      });
      amount = saleItems.reduce(
        (sum, line) => sum + (Number(line.lineRevenue) || 0),
        0
      );
      if (amount <= 0) {
        throw new Error("Số tiền phải > 0");
      }
      const recipeDeltas = stockDeltasForSaleItems(
        saleItems,
        -1,
        productsById
      );
      checkStockDeltas(productsById, recipeDeltas);
    } catch (error) {
      console.error(error);
      showToast(error?.message || "Ghi thu thất bại — thử lại", "error");
      return;
    }

    const cartSnapshot = cart;
    const snapshot = { items: saleItems, amount };
    setSubmitting(true);
    setCart({});
    setShowQr(false);
    try {
      await writeSale({ ...snapshot, paymentMethod });
      const via = paymentMethod === "banking" ? "Chuyển khoản" : "Tiền mặt";
      showToast(
        `Đã thu ${via} · ${formatCurrency(snapshot.amount)}`,
        "success"
      );
    } catch (error) {
      console.error(error);
      setCart(cartSnapshot);
      showToast(
        error?.message || "Ghi thu thất bại — thử lại",
        "error"
      );
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

  const qrUrl = useMemo(
    () =>
      buildVietQrUrl({
        ...bank,
        amount: total > 0 ? total : undefined,
        addInfo: `Trada_${dateInfoCode()}`,
      }),
    [bank, total]
  );

  // Prefetch QR theo tổng tiền hiện tại — bấm "QR chuyển" hiện ngay từ cache.
  useEffect(() => {
    prefetchVietQrImage(qrUrl);
  }, [qrUrl]);

  const displayName = profile?.name || profile?.username || "Nhân viên";

  const groupHeader = (
    <div className="space-y-2">
      <ChipRow>
        {groups.map((g) => {
          const active = activeGroupId === g.id;
          return (
            <FilterChip
              key={g.id}
              active={active}
              onClick={() => setActiveGroupId(g.id)}
              className="gap-1.5"
            >
              <span className="truncate">{g.name}</span>
              <span
                className={cn(
                  "tabular-nums text-xs",
                  active ? "text-white/80" : "text-slate-500"
                )}
              >
                {countInGroup(g.id)}
              </span>
            </FilterChip>
          );
        })}
      </ChipRow>
      {canManageProducts ? (
        <button
          type="button"
          onClick={() => setSortMode((v) => !v)}
          className={cn(
            "touch-btn h-11 w-full text-sm font-bold",
            sortMode
              ? "bg-brand-700 text-white"
              : "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
          )}
        >
          {sortMode ? "Xong sắp xếp" : "Sắp xếp món"}
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
        <p className="mb-2 text-sm font-bold text-brand-800">
          ↑↓ đưa món gọi nhiều lên trên
        </p>
      ) : null}

      {/* Lưới món — tối đa diện tích màn hình */}
      <div className="grid grid-cols-2 gap-2 pb-1">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-2xl bg-white/80"
              />
            ))
          : visibleProducts.map((product, index) => {
              const qty = Number(cart[product.id]?.qty) || 0;
              const sellableUnits = getSellableUnits(product);
              const multiUnit =
                Boolean(product?.packaging?.enabled) &&
                sellableUnits.length > 1;
              const unitId = resolveCartUnitId(
                product,
                cart[product.id]
              );
              const selectedUnit =
                sellableUnits.find((u) => u.id === unitId) ||
                defaultSellUnit(product);
              const price = Math.round(
                Number(selectedUnit?.sellPrice) || Number(product.price) || 0
              );
              const active = qty > 0;
              const flashing = flashId === product.id;

              return (
                <div
                  key={product.id}
                  className={cn(
                    "relative flex overflow-hidden rounded-2xl bg-white ring-1 transition duration-150",
                    multiUnit ? "min-h-[6rem]" : "min-h-[5.5rem]",
                    active
                      ? "ring-2 ring-brand-700 shadow-soft"
                      : "ring-slate-200",
                    flashing && "scale-[0.98] bg-brand-50"
                  )}
                >
                  {sortMode ? (
                    <>
                      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
                        <p className="truncate text-base font-bold leading-tight text-slate-900">
                          {product.name}
                        </p>
                        <p className="money mt-1 text-sm font-bold text-brand-700">
                          <Money amount={price} />
                          <span className="ml-1 font-semibold text-slate-400">
                            #{index + 1}
                          </span>
                        </p>
                      </div>
                      <div className="flex w-11 flex-col border-l border-slate-100">
                        <button
                          type="button"
                          aria-label="Đưa lên"
                          disabled={submitting || index === 0}
                          onClick={() => handleMoveProduct(product.id, "up")}
                          className="flex flex-1 items-center justify-center bg-brand-700 text-white disabled:opacity-25"
                        >
                          <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
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
                          <ArrowDown className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
                        <button
                          type="button"
                          onClick={() => changeQty(product.id, 1)}
                          className="w-full text-left active:opacity-80"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <p className="line-clamp-2 min-w-0 flex-1 text-base font-bold leading-snug text-slate-900">
                              {product.name}
                            </p>
                            <span
                              className={cn(
                                "money flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-lg px-1.5 text-sm font-extrabold",
                                active
                                  ? "bg-brand-700 text-white"
                                  : "bg-slate-100 text-slate-500"
                              )}
                            >
                              {qty}
                            </span>
                          </div>
                          <p className="money mt-1 text-sm font-bold text-brand-700">
                            <Money amount={price} />
                            {selectedUnit?.label ? (
                              <span className="ml-1 font-semibold text-slate-400">
                                / {selectedUnit.label}
                              </span>
                            ) : null}
                          </p>
                        </button>
                        {multiUnit ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {sellableUnits.map((unit) => (
                              <button
                                key={unit.id}
                                type="button"
                                onClick={() =>
                                  pickSellUnit(product.id, unit.id)
                                }
                                className={cn(
                                  "h-11 rounded-xl px-2.5 text-sm font-bold ring-1",
                                  unit.id === unitId
                                    ? "bg-brand-700 text-white ring-brand-700"
                                    : "bg-white text-slate-600 ring-slate-200"
                                )}
                              >
                                {unit.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex w-11 flex-col border-l border-slate-100">
                        <button
                          type="button"
                          aria-label={`Thêm ${product.name}`}
                          disabled={submitting}
                          onClick={() => changeQty(product.id, 1)}
                          className="flex flex-1 items-center justify-center bg-brand-700 text-white active:bg-brand-800 disabled:opacity-50"
                        >
                          <Plus className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Giảm ${product.name}`}
                          disabled={!qty || submitting}
                          onClick={() => changeQty(product.id, -1)}
                          className="flex flex-1 items-center justify-center bg-slate-100 text-slate-700 active:bg-slate-200 disabled:opacity-25"
                        >
                          <Minus className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
      </div>

      {!loading && products.length === 0 ? (
        <EmptyState
          title="Chưa có món bán"
          description="Nhờ quản lý thêm món ở mục Món."
        />
      ) : null}

      {!loading && products.length > 0 && visibleProducts.length === 0 ? (
        <EmptyState
          title="Nhóm trống"
          description="Chọn nhóm khác ở phía trên."
        />
      ) : null}

      {totalQty > 0 ? (
        <div className="mt-3 space-y-2 rounded-2xl bg-brand-50 px-3 py-3 ring-1 ring-brand-100">
          {cartItems.map((item) => {
            const sellableUnits = getSellableUnits(item.product);
            const showUnitPicker =
              Boolean(item.product?.packaging?.enabled) &&
              sellableUnits.length > 1;

            return (
              <div
                key={item.productId}
                className="flex items-center gap-2 rounded-xl bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-brand-950">
                    {item.name} ×{item.qty}
                  </p>
                  <p className="money text-sm font-extrabold text-brand-700">
                    <Money amount={item.lineRevenue} />
                  </p>
                </div>

                {showUnitPicker ? (
                  <select
                    value={item.unitId}
                    onChange={(e) => setCartUnit(item.productId, e.target.value)}
                    className="h-11 shrink-0 rounded-xl border border-brand-200 bg-white px-2 text-sm font-bold text-slate-700 outline-none"
                    aria-label={`Chọn đơn vị bán ${item.name}`}
                  >
                    {sellableUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="shrink-0 rounded-lg bg-brand-100 px-2.5 py-1.5 text-xs font-bold text-brand-800">
                    {item.unitLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        className="touch-btn mt-3 h-11 w-full bg-white text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
      >
        {showHistory
          ? "Ẩn lịch sử"
          : canDeleteSales
            ? "Lịch sử bán hôm nay"
            : "Lịch sử vừa thu"}
      </button>

      {showHistory ? (
        <div className="mb-36 mt-3 space-y-2">
          {myRecent.length === 0 ? (
            <EmptyState title="Chưa có khoản thu" description="Thu món sẽ hiện ở đây." />
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
                  className="flex items-center justify-between gap-2 rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-100"
                >
                  <div className="min-w-0">
                    <p className="money text-lg font-extrabold text-emerald-700">
                      {formatCurrency(row.amount)}
                    </p>
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {row.note || "Thu"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
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
                    {canDeleteSales ? (
                      <button
                        type="button"
                        aria-label="Xóa khoản thu"
                        disabled={deletingId === row.id}
                        onClick={() => handleDeleteSale(row)}
                        className="touch-btn h-11 w-11 bg-rose-50 p-0 text-rose-700 ring-1 ring-rose-100 disabled:opacity-50"
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
              className="touch-btn mt-1 h-11 w-full bg-brand-50 text-sm font-bold text-brand-800"
            >
              Sổ món đã bán →
            </Link>
          ) : (
            <p className="pt-1 text-center text-xs text-slate-400">
              {formatActorLabel({
                createdByName: displayName,
                createdByUsername: profile?.username,
              })}
            </p>
          )}
        </div>
      ) : (
        <div className="h-32" aria-hidden />
      )}

      {/* Thanh thu — thumb zone */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[45] border-t border-slate-200/90 bg-white/95 px-3 py-2 shadow-[0_-8px_24px_rgb(15_23_42_/_0.08)] backdrop-blur-xl">
        <div className="mx-auto max-w-lg space-y-2">
          <div className="flex items-end justify-between px-0.5">
            <p className="money text-3xl font-extrabold leading-none tracking-tight text-slate-900">
              <Money amount={total} />
            </p>
            <p className="pb-0.5 text-sm font-bold text-slate-500">
              {totalQty > 0 ? `${totalQty} phần` : "Chạm món"}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("cash")}
              className="touch-btn h-14 flex-col gap-0.5 bg-emerald-600 text-xs font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.18)] disabled:opacity-35"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Banknote className="h-5 w-5" aria-hidden />
                  Tiền mặt
                </>
              )}
            </button>
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => recordSale("banking")}
              className="touch-btn h-14 flex-col gap-0.5 bg-brand-700 text-xs font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.18)] disabled:opacity-35"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Smartphone className="h-5 w-5" aria-hidden />
                  CK
                </>
              )}
            </button>
            <button
              type="button"
              disabled={submitting || totalQty === 0}
              onClick={() => setShowQr(true)}
              className="touch-btn h-14 flex-col gap-0.5 bg-brand-50 text-xs font-bold text-brand-900 ring-1 ring-brand-700/15 disabled:opacity-35"
            >
              <QrCode className="h-5 w-5" aria-hidden />
              QR
            </button>
          </div>
        </div>
      </div>

      <BottomSheet
        open={showQr}
        onClose={() => setShowQr(false)}
        title="Đưa QR cho khách"
        subtitle={formatCurrency(total)}
        lookMoney
        labelledBy="employee-qr-title"
        footer={
          <div className="space-y-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => recordSale("banking")}
              className="touch-btn h-14 w-full bg-emerald-600 text-base font-bold text-white"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Đã nhận — ghi thu"
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowQr(false)}
              className="touch-btn h-12 w-full bg-slate-100 text-slate-700"
            >
              Quay lại
            </button>
          </div>
        }
      >
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt="VietQR chuyển khoản"
            width={360}
            height={360}
            decoding="async"
            fetchPriority="high"
            className="mx-auto h-auto w-full max-w-[340px]"
          />
        </div>
      </BottomSheet>
    </AppShell>
  );
}
