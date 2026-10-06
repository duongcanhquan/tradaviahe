import {
  collection,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { isGoodsIncome } from "./receipts";

const KEY = "tradaviahe.capitalBanking.v1";

function txMs(row) {
  return row?.timestamp?.toMillis?.() || 0;
}

export function readGoodsBankingCache() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "");
    if (!parsed || !Number.isFinite(Number(parsed.total))) return null;
    return {
      total: Math.round(Number(parsed.total) || 0),
      cursorMs: Math.max(0, Number(parsed.cursorMs) || 0),
    };
  } catch {
    return null;
  }
}

function writeGoodsBankingCache(entry) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    /* bộ nhớ máy đầy — lần sau tính lại */
  }
}

function foldBankingGoods(rows, startTotal, startCursor) {
  let total = Math.round(Number(startTotal) || 0);
  let cursor = Math.max(0, Number(startCursor) || 0);
  for (const row of rows || []) {
    const ms = txMs(row);
    if (ms > cursor) cursor = ms;
    if (row?.paymentMethod !== "banking" || !isGoodsIncome(row)) continue;
    total += Math.round(Number(row.amount) || 0);
  }
  if (cursor <= 0) cursor = Date.now();
  return { total, cursorMs: cursor };
}

let inflight = null;

/**
 * Thu CK bán hàng cho số dư vốn.
 * Lần đầu đọc mọi phiếu chuyển khoản. Các lần sau chỉ đọc phiếu mới hơn mốc đã nhớ.
 */
export function syncGoodsBankingTotal({ force = false } = {}) {
  if (!force && inflight) return inflight;
  const job = runSync(force).finally(() => {
    if (inflight === job) inflight = null;
  });
  inflight = job;
  return job;
}

async function runSync(force) {
  const cached = force ? null : readGoodsBankingCache();
  if (!cached || cached.cursorMs <= 0) {
    const snap = await getDocs(
      query(
        collection(db, "transactions"),
        where("paymentMethod", "==", "banking")
      )
    );
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const next = foldBankingGoods(rows, 0, 0);
    writeGoodsBankingCache(next);
    return next.total;
  }

  const snap = await getDocs(
    query(
      collection(db, "transactions"),
      where("timestamp", ">", Timestamp.fromMillis(cached.cursorMs)),
      orderBy("timestamp", "asc")
    )
  );
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const next = foldBankingGoods(rows, cached.total, cached.cursorMs);
  writeGoodsBankingCache(next);
  return next.total;
}
