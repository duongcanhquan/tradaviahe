import {
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

/**
 * Lưu một khoản góp vốn vào collection investments.
 */
export async function createInvestment({
  investorName,
  type,
  amount,
  equipmentName = "",
  note = "",
  createdBy = null,
}) {
  const payload = {
    investorName: String(investorName || "").trim(),
    type: type === "equipment" ? "equipment" : "cash",
    amount: Number(amount) || 0,
    equipmentName:
      type === "equipment" ? String(equipmentName || "").trim() : "",
    date: serverTimestamp(),
    note: String(note || "").trim(),
    createdBy,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "investments"), payload);
  return ref.id;
}

export function subscribeInvestments(callback, onError) {
  return onSnapshot(
    collection(db, "investments"),
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.date?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
          const tb = b.date?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      callback(list);
    },
    onError
  );
}

/** Tổng vốn + tỷ lệ cổ phần theo từng người */
export function summarizeInvestments(investments) {
  const total = investments.reduce(
    (sum, row) => sum + (Number(row.amount) || 0),
    0
  );

  const byInvestor = {};
  investments.forEach((row) => {
    const name = row.investorName || "Không tên";
    byInvestor[name] = (byInvestor[name] || 0) + (Number(row.amount) || 0);
  });

  const shares = Object.entries(byInvestor)
    .map(([name, value]) => ({
      name,
      value,
      percent: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return { total, shares };
}
