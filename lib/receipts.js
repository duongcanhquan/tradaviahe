import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";

export const RECEIPT_METHODS = [
  { value: "cash", label: "Tiền mặt" },
  { value: "banking", label: "Chuyển khoản / tài khoản" },
];

export function monthKeyFromParts(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function subscribeReceiptsByMonth(monthKey, callback, onError) {
  // Chỉ where — sort phía client (tránh cần composite index Firestore)
  const q = query(
    collection(db, "shareholder_receipts"),
    where("monthKey", "==", monthKey)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => {
        const ta = a.timestamp?.toMillis?.() || 0;
        const tb = b.timestamp?.toMillis?.() || 0;
        return tb - ta;
      });
      callback(rows);
    },
    onError
  );
}

/**
 * Cổ đông cập nhật tiền đã nhận (tiền mặt hoặc vào tài khoản CK).
 */
export async function addShareholderReceipt({
  monthKey,
  investorName,
  investorUid = null,
  amount,
  method,
  note = "",
  user,
  profile,
}) {
  const value = Number(amount) || 0;
  if (!monthKey) throw new Error("Thiếu tháng");
  if (!String(investorName || "").trim()) throw new Error("Chọn cổ đông");
  if (value <= 0) throw new Error("Số tiền phải > 0");
  if (method !== "cash" && method !== "banking") {
    throw new Error("Chọn hình thức nhận tiền");
  }

  await addDoc(collection(db, "shareholder_receipts"), {
    monthKey,
    investorName: String(investorName).trim(),
    investorUid: investorUid || null,
    amount: value,
    method,
    note: String(note || "").trim(),
    timestamp: serverTimestamp(),
    ...actorFields(user, profile),
  });
}

export async function deleteShareholderReceipt(id) {
  await deleteDoc(doc(db, "shareholder_receipts", id));
}

export function summarizeReceipts(rows = []) {
  let cash = 0;
  let banking = 0;
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    if (row.method === "banking") banking += amount;
    else cash += amount;
  }
  return { cash, banking, total: cash + banking };
}

/** Doanh thu hàng hóa (POS / bán hàng) — Quản lý chỉ xem phần này */
export function isGoodsIncome(tx) {
  if (!tx || tx.type !== "income") return false;
  const cat = String(tx.category || "").toLowerCase();
  if (!cat || cat === "bán hàng" || cat === "ban hang" || cat === "pos") {
    return true;
  }
  return false;
}

export function sumGoodsIncome(transactions = []) {
  return transactions
    .filter(isGoodsIncome)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

export function sumGoodsIncomeByMethod(transactions = []) {
  let cash = 0;
  let banking = 0;
  for (const t of transactions) {
    if (!isGoodsIncome(t)) continue;
    const amount = Number(t.amount) || 0;
    if (t.paymentMethod === "banking") banking += amount;
    else cash += amount;
  }
  return { cash, banking, total: cash + banking };
}
