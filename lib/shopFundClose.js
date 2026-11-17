/**
 * Chốt quỹ cửa hàng theo tháng — tiết kiệm đọc Firestore.
 * “Từ đầu → nay” = chốt hết tháng trước (1 doc) + giao dịch tháng này.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { format } from "date-fns";
import { db } from "./firebase";
import { readDeviceCache, writeDeviceCache } from "./deviceCache";
import { readTransactionsInRange } from "./liveCollection";
import {
  addFundTotals,
  emptyFundTotals,
  monthBoundsForKey,
  nextMonthKey,
  previousMonthKey,
  summarizeRowsForFundClose,
} from "./shopFundCloseMath";

export {
  addFundTotals,
  canCloseMonthKey,
  combineLifetimeWithMonth,
  emptyFundTotals,
  isLifetimePreset,
  lifetimeFundLabel,
  monthBoundsForKey,
  monthKeyFromDate,
  nextMonthKey,
  previousMonthKey,
  summarizeRowsForFundClose,
  todayMonthKey,
} from "./shopFundCloseMath";

export const SHOP_FUND_CLOSE_COLLECTION = "shop_fund_closes";

function packClose(monthKey, totals, meta = {}) {
  return {
    monthKey,
    fundIn: Math.round(Number(totals.fundIn) || 0),
    cashSales: Math.round(Number(totals.cashSales) || 0),
    expense: Math.round(Number(totals.expense) || 0),
    balance: Math.round(Number(totals.balance) || 0),
    ...meta,
  };
}

function cacheKey(monthKey) {
  return `shop_fund_close.${monthKey}`;
}

export async function readShopFundClose(monthKey) {
  const key = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return null;

  const cached = readDeviceCache(cacheKey(key));
  if (cached?.rows?.[0]?.monthKey === key) {
    return cached.rows[0];
  }

  const snap = await getDoc(doc(db, SHOP_FUND_CLOSE_COLLECTION, key));
  if (!snap.exists()) return null;
  const data = packClose(key, snap.data() || {}, {
    source: snap.data()?.source || "stored",
  });
  writeDeviceCache(cacheKey(key), [data]);
  return data;
}

export async function writeShopFundClose(monthKey, totals, source = "auto") {
  const key = String(monthKey || "").slice(0, 7);
  const payload = {
    ...packClose(key, totals, { source }),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, SHOP_FUND_CLOSE_COLLECTION, key), payload, {
    merge: true,
  });
  const stored = packClose(key, totals, { source });
  writeDeviceCache(cacheKey(key), [stored]);
  return stored;
}

async function readLatestCloseAtOrBefore(monthKey) {
  const key = String(monthKey || "").slice(0, 7);
  const q = query(
    collection(db, SHOP_FUND_CLOSE_COLLECTION),
    where("monthKey", "<=", key),
    orderBy("monthKey", "desc"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const row = snap.docs[0].data() || {};
  return packClose(row.monthKey || snap.docs[0].id, row, {
    source: row.source || "stored",
  });
}

async function firstTransactionMonthKey() {
  const q = query(
    collection(db, "transactions"),
    orderBy("timestamp", "asc"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const ts = snap.docs[0].data()?.timestamp;
  const ms = ts?.toMillis?.() || 0;
  if (!ms) return null;
  return format(new Date(ms), "yyyy-MM");
}

/**
 * Đảm bảo có chốt lũy kế đến hết monthKey.
 * Chỉ đọc các tháng còn thiếu (sau bản chốt gần nhất).
 */
export async function ensureShopFundCloseThrough(monthKey, now = new Date()) {
  const target = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(target)) {
    throw new Error("Tháng chốt không hợp lệ");
  }

  const existing = await readShopFundClose(target);
  if (existing) return existing;

  const latest = await readLatestCloseAtOrBefore(target);
  let running = latest
    ? {
        fundIn: latest.fundIn,
        cashSales: latest.cashSales,
        expense: latest.expense,
        balance: latest.balance,
      }
    : emptyFundTotals();
  let cursor =
    latest && latest.monthKey < target
      ? nextMonthKey(latest.monthKey)
      : latest?.monthKey === target
        ? null
        : await firstTransactionMonthKey();

  if (!cursor) {
    return writeShopFundClose(target, emptyFundTotals(), "empty");
  }
  if (cursor > target) {
    return writeShopFundClose(target, running, "carry");
  }

  while (cursor <= target) {
    const bounds = monthBoundsForKey(cursor, now);
    const rows = await readTransactionsInRange(bounds.from, bounds.to);
    const period = summarizeRowsForFundClose(rows);
    running = addFundTotals(running, period);
    await writeShopFundClose(cursor, running, "auto");
    if (cursor === target) break;
    cursor = nextMonthKey(cursor);
  }

  return (
    (await readShopFundClose(target)) ||
    packClose(target, running, { source: "auto" })
  );
}

/** Chốt hết tháng lịch trước — dùng cho nút “Từ đầu → nay”. */
export async function ensurePreviousMonthShopFundClose(now = new Date()) {
  return ensureShopFundCloseThrough(previousMonthKey(now), now);
}
