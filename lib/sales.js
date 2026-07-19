import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { canDeleteSales } from "./roles";
import {
  inputValueToDateKey,
  timestampForBusinessDate,
  todayKey,
} from "./utils";

/**
 * Ghi thu bán hàng (POS nhanh — thời điểm hiện tại).
 */
export async function recordPosSale({
  amount,
  paymentMethod,
  note,
  user,
  profile,
}) {
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error("Số tiền phải > 0");
  if (paymentMethod !== "cash" && paymentMethod !== "banking") {
    throw new Error("Chọn hình thức thanh toán");
  }

  await addDoc(collection(db, "transactions"), {
    amount: value,
    type: "income",
    category: "bán hàng",
    timestamp: serverTimestamp(),
    businessDate: todayKey(),
    note: String(note || "").trim() || "Thu bán hàng",
    paymentMethod,
    ...actorFields(user, profile),
  });
}

/**
 * Gõ số tiền CK theo ngày nghiệp vụ (Đối soát).
 */
export async function recordBankingByDate({
  amount,
  dateInput,
  note = "",
  user,
  profile,
}) {
  const value = Number(String(amount).replace(/\D/g, "")) || 0;
  if (value <= 0) throw new Error("Số tiền CK phải > 0");
  if (!dateInput) throw new Error("Chọn ngày nhận CK");

  const businessDate = inputValueToDateKey(dateInput);
  const noteText =
    String(note || "").trim() || `Thu CK ngày ${businessDate}`;

  await addDoc(collection(db, "transactions"), {
    amount: value,
    type: "income",
    category: "bán hàng",
    timestamp: timestampForBusinessDate(dateInput),
    businessDate,
    note: noteText,
    paymentMethod: "banking",
    source: "banking_by_date",
    ...actorFields(user, profile),
  });

  return { amount: value, businessDate };
}

/**
 * Xóa khoản thu đã ghi — chỉ Quản lý / Admin / SA.
 */
export async function deleteSaleTransaction(id, role) {
  if (!canDeleteSales(role)) {
    throw new Error("Không có quyền xóa khoản thu");
  }
  if (!id) throw new Error("Thiếu mã giao dịch");
  await deleteDoc(doc(db, "transactions", id));
}
