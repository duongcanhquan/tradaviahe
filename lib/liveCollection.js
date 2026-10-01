import {
  collection,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

export function mapDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function fallbackRead(readFn, onError) {
  readFn().catch((readError) => {
    if (onError) onError(readError);
  });
}

/** Một listener dùng chung — tránh tải lại cả collection khi đổi màn. */
const listeners = new Map();

function subscribeShared(key, refOrQuery, callback, onError) {
  let slot = listeners.get(key);
  if (!slot) {
    slot = { subs: new Set(), rows: undefined, unsub: null };
    const fanout = (rows) => {
      slot.rows = rows;
      for (const sub of slot.subs) sub.callback(rows.slice());
    };
    const fail = (error) => {
      for (const sub of slot.subs) sub.onError?.(error);
    };
    slot.unsub = onSnapshot(
      refOrQuery,
      (snap) => fanout(mapDocs(snap)),
      (error) => {
        console.error(`Firestore listen ${key}:`, error);
        getDocs(refOrQuery)
          .then((snap) => fanout(mapDocs(snap)))
          .catch(fail);
      }
    );
    listeners.set(key, slot);
  }
  const sub = { callback, onError };
  slot.subs.add(sub);
  if (slot.rows) callback(slot.rows.slice());
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.subs.delete(sub);
    if (current.subs.size === 0) {
      current.unsub?.();
      listeners.delete(key);
    }
  };
}

/**
 * Lắng nghe collection. Nếu realtime (Listen) lỗi, đọc một lần bằng getDocs.
 */
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

/** Lắng nghe một giá trị (vd businessLine, productId) — nhỏ hơn cả collection. */
export function subscribeWhere(name, field, value, callback, onError) {
  const key = `${name}:${field}=${String(value)}`;
  const q = query(collection(db, name), where(field, "==", value));
  return subscribeShared(key, q, callback, onError);
}

/** Lắng nghe 1 document — fallback getDoc nếu Listen lỗi. */
export function subscribeDocument(ref, callback, onError) {
  return onSnapshot(
    ref,
    callback,
    (error) => {
      console.error("Firestore listen doc:", error);
      fallbackRead(() => getDoc(ref).then(callback), onError);
    }
  );
}
