import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { parseRangeBound } from "./dateRange";
import { db } from "./firebase";
import { todayInputValue } from "./utils";

export function mapDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Một listener dùng chung — tránh tải lại cả collection khi đổi màn. */
const listeners = new Map();
/** Giữ listener thêm một lúc sau khi rời màn, để quay lại không đọc lại cả sổ. */
const LINGER_MS = 12 * 60 * 60 * 1000;

function subscribeShared(key, refOrQuery, callback, onError) {
  let slot = listeners.get(key);
  if (!slot) {
    slot = { subs: new Set(), rows: undefined, unsub: null };
    const fanout = (rows) => {
      slot.rows = rows;
      for (const sub of slot.subs) sub.callback(rows.slice());
    };
    slot.unsub = onSnapshot(
      refOrQuery,
      (snap) => fanout(mapDocs(snap)),
      (error) => {
        console.error(`Firestore listen ${key}:`, error);
        for (const sub of slot.subs) sub.onError?.(error);
      }
    );
    listeners.set(key, slot);
  }
  const sub = { callback, onError };
  slot.subs.add(sub);
  if (slot.lingerTimer) {
    clearTimeout(slot.lingerTimer);
    slot.lingerTimer = null;
  }
  if (slot.rows) callback(slot.rows.slice());
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.subs.delete(sub);
    if (current.subs.size === 0) {
      clearTimeout(current.lingerTimer);
      current.lingerTimer = setTimeout(() => {
        const latest = listeners.get(key);
        if (!latest || latest.subs.size > 0) return;
        latest.unsub?.();
        listeners.delete(key);
      }, LINGER_MS);
    }
  };
}

/** Lắng nghe collection. Lỗi listen không đọc lại — getDocs tính thêm read. */
export function subscribeCollection(name, callback, onError) {
  return subscribeShared(name, collection(db, name), callback, onError);
}

/**
 * Chỉ các giao dịch trong khoảng thời gian (timestamp), mới nhất trước.
 * Dùng cho đối soát / sổ bán / POS — không tải cả lịch sử.
 */
export function subscribeTransactionsBetween(
  startMs,
  endMs,
  callback,
  onError,
  limitCount = 600
) {
  const start = Math.max(0, Number(startMs) || 0);
  const end = Math.max(start, Number(endMs) || start);
  const cap = Math.min(2000, Math.max(20, Number(limitCount) || 600));
  const key = `tx:${start}:${end}:${cap}`;
  const q = query(
    collection(db, "transactions"),
    where("timestamp", ">=", Timestamp.fromMillis(start)),
    where("timestamp", "<=", Timestamp.fromMillis(end)),
    orderBy("timestamp", "desc"),
    limit(cap)
  );
  return subscribeShared(key, q, callback, onError);
}

/** Trần số phiếu theo độ dài kỳ — cùng kỳ thì cùng limit để dùng chung một listener. */
export function txLimitForRange(startMs, endMs) {
  const days = Math.max(
    1,
    Math.ceil((Number(endMs) - Number(startMs)) / (24 * 60 * 60 * 1000))
  );
  if (days <= 1) return 800;
  if (days <= 8) return 1600;
  return 2000;
}

/**
 * Chỉ phiếu trong khoảng ngày đã chọn. Thiếu ngày thì lấy hôm nay, không đọc cả sổ.
 */
export function subscribeTransactionsInRange(
  fromInput,
  toInput,
  callback,
  onError
) {
  const today = todayInputValue();
  const from = fromInput || toInput || today;
  const to = toInput || from || today;
  const startMs = parseRangeBound(from, false);
  const endMs = parseRangeBound(to, true);
  if (startMs == null || endMs == null) {
    callback([]);
    return () => {};
  }
  return subscribeTransactionsBetween(
    startMs,
    endMs,
    callback,
    onError,
    txLimitForRange(startMs, endMs)
  );
}

function transactionsRangeQuery(fromInput, toInput) {
  const today = todayInputValue();
  const from = fromInput || toInput || today;
  const to = toInput || from || today;
  const startMs = parseRangeBound(from, false);
  const endMs = parseRangeBound(to, true);
  if (startMs == null || endMs == null) return null;
  const cap = txLimitForRange(startMs, endMs);
  const q = query(
    collection(db, "transactions"),
    where("timestamp", ">=", Timestamp.fromMillis(startMs)),
    where("timestamp", "<=", Timestamp.fromMillis(endMs)),
    orderBy("timestamp", "desc"),
    limit(cap)
  );
  return { q, cap };
}

/** Một lần đọc theo kỳ — không giữ listener, không đọc lại khi đổi màn. */
export async function readTransactionsInRange(fromInput, toInput) {
  const built = transactionsRangeQuery(fromInput, toInput);
  if (!built) return [];
  const snap = await getDocs(built.q);
  return mapDocs(snap);
}

/** Phiếu mới hơn mốc đã nhớ, trong một ngày. Không đọc lại phần đã có. */
export async function readTransactionsSince(afterMs, endMs, limitCount = 400) {
  const start = Math.max(0, Number(afterMs) || 0);
  const end = Math.max(start + 1, Number(endMs) || start);
  const cap = Math.min(800, Math.max(20, Number(limitCount) || 400));
  const q = query(
    collection(db, "transactions"),
    where("timestamp", ">", Timestamp.fromMillis(start)),
    where("timestamp", "<=", Timestamp.fromMillis(end)),
    orderBy("timestamp", "asc"),
    limit(cap)
  );
  const snap = await getDocs(q);
  return mapDocs(snap);
}

export async function readCollectionOnce(name) {
  const snap = await getDocs(collection(db, name));
  return mapDocs(snap);
}

/** Lắng nghe một giá trị (vd businessLine, productId) — nhỏ hơn cả collection. */
export function subscribeWhere(name, field, value, callback, onError) {
  const key = `${name}:${field}=${String(value)}`;
  const q = query(collection(db, name), where(field, "==", value));
  return subscribeShared(key, q, callback, onError);
}

/** Lắng nghe 1 document. */
export function subscribeDocument(ref, callback, onError) {
  return onSnapshot(ref, callback, (error) => {
    console.error("Firestore listen doc:", error);
    if (onError) onError(error);
  });
}
