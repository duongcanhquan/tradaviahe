/**
 * Chốt quỹ cửa hàng theo tháng — tiết kiệm đọc Firestore.
 *
 * Lần đầu “Từ đầu”:
 *   đọc HẾT phiếu từng tháng (phân trang) từ phiếu đầu tiên → hết tháng trước,
 *   ghi bản chốt sealed + scanVersion lên Firestore.
 * Lần sau:
 *   chỉ getDoc bản chốt tháng trước (đáng tin) + đọc HẾT phiếu tháng này.
 *
 * Bản chốt thiếu scanVersion (lần quét cũ bị cắt limit) → tính lại cho đúng.
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
import { readAllTransactionsInRange } from "./liveCollection";
import {
  addFundTotals,
  emptyFundTotals,
  isTrustedShopFundClose,
  monthBoundsForKey,
  nextMonthKey,
  normalizeFundTotals,
  previousMonthKey,
  SHOP_FUND_SCAN_VERSION,
  summarizeRowsForFundClose,
} from "./shopFundCloseMath";

export {
  addFundTotals,
  canCloseMonthKey,
  combineLifetimeWithMonth,
  emptyFundTotals,
  isLifetimePreset,
  isTrustedShopFundClose,
  lifetimeFundLabel,
  monthBoundsForKey,
  monthKeyFromDate,
  nextMonthKey,
  normalizeFundTotals,
  previousMonthKey,
  SHOP_FUND_SCAN_VERSION,
  summarizeRowsForFundClose,
  todayMonthKey,
} from "./shopFundCloseMath";

export const SHOP_FUND_CLOSE_COLLECTION = "shop_fund_closes";
export const SHOP_FUND_CLOSE_META_ID = "_meta";

function packClose(monthKey, totals, meta = {}) {
  const norm = normalizeFundTotals(totals);
  return {
    monthKey,
    ...norm,
    sealed: meta.sealed === true,
    scanVersion: Number(meta.scanVersion) || 0,
    txCount: Math.max(0, Math.round(Number(meta.txCount) || 0)),
    periodFundIn: Math.round(Number(meta.periodFundIn) || 0),
    periodCashSales: Math.round(Number(meta.periodCashSales) || 0),
    periodExpense: Math.round(Number(meta.periodExpense) || 0),
    periodBalance: Math.round(Number(meta.periodBalance) || 0),
    source: meta.source || "stored",
  };
}

function cacheKey(monthKey) {
  return `shop_fund_close.${monthKey}`;
}

/** Đọc thẳng Firestore — không tin cache máy khi quyết định đã chốt chưa. */
export async function readShopFundCloseFromServer(monthKey) {
  const key = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  const snap = await getDoc(doc(db, SHOP_FUND_CLOSE_COLLECTION, key));
  if (!snap.exists()) return null;
  const raw = snap.data() || {};
  const data = packClose(key, raw, {
    source: raw.source || "stored",
    sealed: raw.sealed === true,
    scanVersion: Number(raw.scanVersion) || 0,
    txCount: Number(raw.txCount) || 0,
    periodFundIn: Math.round(Number(raw.periodFundIn) || 0),
    periodCashSales: Math.round(Number(raw.periodCashSales) || 0),
    periodExpense: Math.round(Number(raw.periodExpense) || 0),
    periodBalance: Math.round(Number(raw.periodBalance) || 0),
  });
  if (isTrustedShopFundClose(data)) {
    writeDeviceCache(cacheKey(key), [data]);
  }
  return data;
}

export async function readShopFundClose(monthKey) {
  const key = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return null;

  const cached = readDeviceCache(cacheKey(key));
  const hit = cached?.rows?.[0];
  if (hit?.monthKey === key && isTrustedShopFundClose(hit)) {
    return hit;
  }

  return readShopFundCloseFromServer(key);
}

export async function writeShopFundClose(
  monthKey,
  totals,
  {
    source = "auto",
    sealed = true,
    txCount = 0,
    period = null,
  } = {}
) {
  const key = String(monthKey || "").slice(0, 7);
  const cumulative = normalizeFundTotals(totals);
  const periodTotals = normalizeFundTotals(period || emptyFundTotals());
  const payload = {
    monthKey: key,
    ...cumulative,
    periodFundIn: periodTotals.fundIn,
    periodCashSales: periodTotals.cashSales,
    periodExpense: periodTotals.expense,
    periodBalance: periodTotals.balance,
    txCount: Math.max(0, Math.round(Number(txCount) || 0)),
    sealed: sealed !== false,
    scanVersion: SHOP_FUND_SCAN_VERSION,
    source,
    updatedAt: serverTimestamp(),
    sealedAt: sealed !== false ? serverTimestamp() : null,
  };
  await setDoc(doc(db, SHOP_FUND_CLOSE_COLLECTION, key), payload, {
    merge: true,
  });
  const stored = packClose(key, payload, {
    source,
    sealed: payload.sealed,
    scanVersion: payload.scanVersion,
    txCount: payload.txCount,
    periodFundIn: payload.periodFundIn,
    periodCashSales: payload.periodCashSales,
    periodExpense: payload.periodExpense,
    periodBalance: payload.periodBalance,
  });
  if (isTrustedShopFundClose(stored)) {
    writeDeviceCache(cacheKey(key), [stored]);
  }
  return stored;
}

async function writeCloseMeta({ lastSealedMonth, rebuiltAtMs, note }) {
  await setDoc(
    doc(db, SHOP_FUND_CLOSE_COLLECTION, SHOP_FUND_CLOSE_META_ID),
    {
      lastSealedMonth: lastSealedMonth || null,
      rebuiltAtMs: Number(rebuiltAtMs) || Date.now(),
      note: String(note || "").trim() || null,
      scanVersion: SHOP_FUND_SCAN_VERSION,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function readLatestTrustedCloseAtOrBefore(monthKey) {
  const key = String(monthKey || "").slice(0, 7);
  const q = query(
    collection(db, SHOP_FUND_CLOSE_COLLECTION),
    where("sealed", "==", true),
    where("scanVersion", "==", SHOP_FUND_SCAN_VERSION),
    where("monthKey", "<=", key),
    orderBy("monthKey", "desc"),
    limit(1)
  );
  try {
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const row = snap.docs[0].data() || {};
    const packed = packClose(row.monthKey || snap.docs[0].id, row, {
      source: row.source || "stored",
      sealed: true,
      scanVersion: Number(row.scanVersion) || 0,
      txCount: Number(row.txCount) || 0,
    });
    return isTrustedShopFundClose(packed) ? packed : null;
  } catch (error) {
    // Index chưa có — fallback quét doc từng tháng lùi (tối đa 48 tháng).
    console.warn("shop fund close index fallback", error);
    let cursor = key;
    for (let i = 0; i < 48; i += 1) {
      const row = await readShopFundCloseFromServer(cursor);
      if (isTrustedShopFundClose(row)) return row;
      if (cursor <= "2000-01") break;
      const [y, m] = cursor.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      cursor = format(d, "yyyy-MM");
    }
    return null;
  }
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
 * Đảm bảo có chốt đáng tin đến hết monthKey.
 * - Đã trusted → trả về ngay (không tính lại).
 * - Thiếu / bản cũ → đọc HẾT phiếu từng tháng còn thiếu rồi ghi sealed v2.
 */
export async function ensureShopFundCloseThrough(
  monthKey,
  now = new Date(),
  { onProgress } = {}
) {
  const target = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(target)) {
    throw new Error("Tháng chốt không hợp lệ");
  }

  const existing = await readShopFundCloseFromServer(target);
  if (isTrustedShopFundClose(existing)) {
    writeDeviceCache(cacheKey(target), [existing]);
    return { close: existing, rebuilt: false, monthsBuilt: 0 };
  }

  const latest = await readLatestTrustedCloseAtOrBefore(target);
  let running = latest
    ? normalizeFundTotals(latest)
    : emptyFundTotals();

  let cursor =
    latest && latest.monthKey < target
      ? nextMonthKey(latest.monthKey)
      : latest?.monthKey === target
        ? null
        : await firstTransactionMonthKey();

  if (!cursor) {
    const close = await writeShopFundClose(target, emptyFundTotals(), {
      source: "empty",
      sealed: true,
      txCount: 0,
      period: emptyFundTotals(),
    });
    await writeCloseMeta({
      lastSealedMonth: target,
      note: "empty-ledger",
    });
    return { close, rebuilt: true, monthsBuilt: 1 };
  }

  if (cursor > target) {
    const close = await writeShopFundClose(target, running, {
      source: "carry",
      sealed: true,
      txCount: 0,
      period: emptyFundTotals(),
    });
    await writeCloseMeta({
      lastSealedMonth: target,
      note: "carry-forward",
    });
    return { close, rebuilt: true, monthsBuilt: 1 };
  }

  let monthsBuilt = 0;
  while (cursor <= target) {
    onProgress?.({ monthKey: cursor, phase: "scanning" });
    const bounds = monthBoundsForKey(cursor, now);
    const rows = await readAllTransactionsInRange(bounds.from, bounds.to);
    const period = summarizeRowsForFundClose(rows);
    running = normalizeFundTotals(addFundTotals(running, period));
    await writeShopFundClose(cursor, running, {
      source: latest ? "extend" : "full_rebuild",
      sealed: true,
      txCount: rows.length,
      period,
    });
    monthsBuilt += 1;
    onProgress?.({
      monthKey: cursor,
      phase: "sealed",
      txCount: rows.length,
      balance: running.balance,
    });
    if (cursor === target) break;
    cursor = nextMonthKey(cursor);
  }

  await writeCloseMeta({
    lastSealedMonth: target,
    note: latest ? "extended" : "full_rebuild_from_start",
  });

  const close =
    (await readShopFundCloseFromServer(target)) ||
    packClose(target, running, {
      sealed: true,
      scanVersion: SHOP_FUND_SCAN_VERSION,
      source: "auto",
    });

  return { close, rebuilt: true, monthsBuilt };
}

/**
 * Chốt hết tháng lịch trước — dùng cho nút “Từ đầu → nay”.
 * @returns {{ close: object, rebuilt: boolean, monthsBuilt: number }}
 */
export async function ensurePreviousMonthShopFundClose(
  now = new Date(),
  options = {}
) {
  return ensureShopFundCloseThrough(previousMonthKey(now), now, options);
}
