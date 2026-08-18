import { collection, getDoc, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

export function mapDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function fallbackRead(readFn, onError) {
  readFn().catch((readError) => {
    if (onError) onError(readError);
  });
}

/**
 * Lắng nghe collection. Nếu realtime (Listen) lỗi, đọc một lần bằng getDocs.
 */
export function subscribeCollection(name, callback, onError) {
  const ref = collection(db, name);
  return onSnapshot(
    ref,
    (snap) => callback(mapDocs(snap)),
    (error) => {
      console.error(`Firestore listen ${name}:`, error);
      fallbackRead(
        () => getDocs(ref).then((snap) => callback(mapDocs(snap))),
        onError
      );
    }
  );
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
