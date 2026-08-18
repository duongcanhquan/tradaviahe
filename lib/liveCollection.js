import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

export function mapDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
      getDocs(ref)
        .then((snap) => callback(mapDocs(snap)))
        .catch((readError) => {
          if (onError) onError(readError);
        });
    }
  );
}
