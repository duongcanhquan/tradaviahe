import {
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { canDeleteSales, canEditSales } from "./roles";
import {
  serializeSaleItems,
  stockDeltasForSaleItems,
} from "./stock";
import {
  inputValueToDateKey,
  timestampForBusinessDate,
  todayKey,
} from "./utils";

/**
 * Áp delta tồn kho (âm = trừ, dương = cộng). Bỏ qua id không tồn tại.
 */
async function applyStockDeltas(deltas, batch) {
  const entries = Object.entries(deltas || {}).filter(
    ([, delta]) => Number(delta) !== 0
  );
  if (!entries.length) return {};

  const applied = {};
  const checks = await Promise.all(
    entries.map(async ([productId, delta]) => {
      const ref = doc(db, "products", productId);
      const snap = await getDoc(ref);
      return snap.exists() ? { productId, delta: Number(delta), ref } : null;
    })
  );

  for (const row of checks) {
    if (!row) continue;
    batch.update(row.ref, {
      inStock: increment(row.delta),
      updatedAt: serverTimestamp(),
    });
    applied[row.productId] = row.delta;
  }
  return applied;
}

/**
 * Ghi thu bán hàng POS + trừ kho (recipe → nguyên liệu, không recipe → món).
 */
export async function recordPosSale({
  amount,
  paymentMethod,
  note,
  items = [],
  user,
  profile,
}) {
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error("Số tiền phải > 0");
  if (paymentMethod !== "cash" && paymentMethod !== "banking") {
    throw new Error("Chọn hình thức thanh toán");
  }

  const saleItems = serializeSaleItems(items);
  const noteText =
    String(note || "").trim() ||
    saleItems.map((item) => `${item.name} x${item.qty}`).join(", ") ||
    "Thu bán hàng";

  const stockDeltas = stockDeltasForSaleItems(saleItems, -1);
  const batch = writeBatch(db);
  const txRef = doc(collection(db, "transactions"));

  const applied = await applyStockDeltas(stockDeltas, batch);

  batch.set(txRef, {
    amount: value,
    type: "income",
    category: "bán hàng",
    timestamp: serverTimestamp(),
    businessDate: todayKey(),
    note: noteText,
    paymentMethod,
    source: "pos",
    items: saleItems,
    stockAdjustments: applied,
    ...actorFields(user, profile),
  });

  await batch.commit();
  return { id: txRef.id, stockAdjustments: applied };
}

/**
 * Gõ số tiền CK theo ngày nghiệp vụ (Đối soát) — không trừ kho.
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
 * Sửa khoản thu bán hàng — chỉ tiền/ghi chú/ngày (không đổi kho).
 */
export async function updateSaleTransaction({
  id,
  amount,
  note,
  paymentMethod,
  dateInput,
  role,
}) {
  if (!canEditSales(role)) {
    throw new Error("Không có quyền sửa khoản thu");
  }
  if (!id) throw new Error("Thiếu mã giao dịch");

  const value = Number(String(amount ?? "").replace(/\D/g, "")) || 0;
  if (value <= 0) throw new Error("Số tiền phải > 0");
  if (paymentMethod !== "cash" && paymentMethod !== "banking") {
    throw new Error("Chọn hình thức thanh toán");
  }
  if (!dateInput) throw new Error("Chọn ngày");

  const businessDate = inputValueToDateKey(dateInput);
  await updateDoc(doc(db, "transactions", id), {
    amount: value,
    note: String(note || "").trim() || "Thu bán hàng",
    paymentMethod,
    businessDate,
    timestamp: timestampForBusinessDate(dateInput),
    category: "bán hàng",
    type: "income",
    updatedAt: serverTimestamp(),
  });
}

/**
 * Xóa khoản thu — hoàn kho nếu giao dịch có stockAdjustments / items.
 */
export async function deleteSaleTransaction(id, role) {
  if (!canDeleteSales(role)) {
    throw new Error("Không có quyền xóa khoản thu");
  }
  if (!id) throw new Error("Thiếu mã giao dịch");

  const txRef = doc(db, "transactions", id);
  const snap = await getDoc(txRef);
  if (!snap.exists()) {
    throw new Error("Không tìm thấy giao dịch");
  }

  const data = snap.data() || {};
  let restoreDeltas = {};

  if (
    data.stockAdjustments &&
    typeof data.stockAdjustments === "object" &&
    Object.keys(data.stockAdjustments).length
  ) {
    // stockAdjustments lúc bán là số âm → đảo dấu để hoàn
    for (const [productId, delta] of Object.entries(data.stockAdjustments)) {
      restoreDeltas[productId] = -Number(delta) || 0;
    }
  } else if (Array.isArray(data.items) && data.items.length) {
    restoreDeltas = stockDeltasForSaleItems(data.items, 1);
  }

  const batch = writeBatch(db);
  await applyStockDeltas(restoreDeltas, batch);
  batch.delete(txRef);
  await batch.commit();
}
