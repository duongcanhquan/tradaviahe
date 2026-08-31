import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";

export const RECEIPT_METHODS = [
  { value: "cash", label: "Tiền mặt" },
  { value: "banking", label: "Chuyển khoản / tài khoản" },
];

export function monthKeyFromParts(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function subscribeReceiptsByMonth(monthKey, callback, onError) {
  return subscribeCollection(
    "shareholder_receipts",
    (rows) => {
      const list = rows
        .filter((row) => row.monthKey === monthKey)
        .sort((a, b) => {
          const ta = a.timestamp?.toMillis?.() || 0;
          const tb = b.timestamp?.toMillis?.() || 0;
          return tb - ta;
        });
      callback(list);
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

/**
 * Doanh thu hàng hóa (POS / bán hàng) — Quản lý chỉ xem phần này.
 * Không dùng paymentMethod đơn lẻ: nạp quỹ cũng có cash|banking nhưng type=fund_in.
 * Chỉ tính type=income + category bán hàng hoặc source POS/CK-theo-ngày.
 */
export function isGoodsIncome(tx) {
  if (!tx || tx.type !== "income") return false;
  // Mảng xây dựng — không tính doanh thu trà đá
  if (tx.businessLine === "construction") return false;
  const cat = String(tx.category || "")
    .trim()
    .toLowerCase();
  if (cat === "bán hàng" || cat === "ban hang" || cat === "pos") return true;
  if (cat === "dịch vụ xây dựng" || cat === "dich vu xay dung") return false;
  const source = String(tx.source || "").toLowerCase();
  if (source === "construction_service") return false;
  if (source === "pos" || source === "banking_by_date") return true;
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

/**
 * Tổng thu hàng hóa theo người nhập (NV / QL …) trong danh sách giao dịch.
 */
export function summarizeGoodsIncomeByActor(transactions = []) {
  const map = new Map();

  for (const t of transactions) {
    if (!isGoodsIncome(t)) continue;
    const amount = Number(t.amount) || 0;
    const key =
      t.createdBy ||
      t.createdByUsername ||
      t.createdByName ||
      "unknown";
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        uid: t.createdBy || null,
        name: t.createdByName || "",
        username: t.createdByUsername || "",
        role: t.createdByRole || null,
        cash: 0,
        banking: 0,
        total: 0,
        count: 0,
      };
      map.set(key, row);
    }
    // Ưu tiên tên mới nhất nếu trước đó trống
    if (!row.name && t.createdByName) row.name = t.createdByName;
    if (!row.username && t.createdByUsername) {
      row.username = t.createdByUsername;
    }
    if (!row.role && t.createdByRole) row.role = t.createdByRole;

    if (t.paymentMethod === "banking") row.banking += amount;
    else row.cash += amount;
    row.total += amount;
    row.count += 1;
  }

  return [...map.values()].sort((a, b) => b.total - a.total);
}
