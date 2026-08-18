import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

export function mapDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Lắng nghe cả collection — không where/orderBy.
 * Tránh lỗi thiếu index / timestamp lẫn kiểu (string vs Timestamp).
 */
export function subscribeCollection(name, callback, onError) {
  return onSnapshot(
    collection(db, name),
    (snap) => callback(mapDocs(snap)),
    onError
  );
}
