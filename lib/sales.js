import {
  addDoc,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { canDeleteSales, canEditSales } from "./roles";
import { sumSaleCogs } from "./cogs";
import {
  serializeSaleItems,
  stockDeltasForSaleItems,
  checkStockDeltas,
} from "./stock";
import {
  inputValueToDateKey,
  timestampForBusinessDate,
  todayKey,
} from "./utils";

function stockEntries(deltas) {
  return Object.entries(deltas || {}).filter(
    ([, delta]) => Number(delta) !== 0
  );
}

/**
 * Đọc tồn rồi ghi trong cùng một transaction — hai máy bán cùng lúc không trừ chồng.
 * Mọi lần đọc phải xong trước khi ghi.
 */
async function readStockForUpdate(transaction, deltas) {
  const checks = [];
  for (const [productId, delta] of stockEntries(deltas)) {
    const ref = doc(db, "products", productId);
    const snap = await transaction.get(ref);
    if (!snap.exists()) continue;
    checks.push({
      productId,
      delta: Number(delta),
      ref,
      data: snap.data() || {},
    });
  }

  const productsById = {};
  for (const row of checks) {
    productsById[row.productId] = {
      inStock: row.data.inStock,
      name: row.data.name || "",
    };
  }
  checkStockDeltas(productsById, deltas);

  const applied = {};
  for (const row of checks) {
    const next = (Number(row.data.inStock) || 0) + row.delta;
    transaction.update(row.ref, {
      inStock: next,
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
  const { cogsTotal, cogsStatus } = sumSaleCogs(saleItems);
  const noteText =
    String(note || "").trim() ||
    saleItems.map((item) => `${item.name} x${item.qty}`).join(", ") ||
    "Thu bán hàng";

  const stockDeltas = stockDeltasForSaleItems(saleItems, -1);
  const txRef = doc(collection(db, "transactions"));
  const salePayload = {
    amount: value,
    type: "income",
    category: "bán hàng",
    businessLine: "shop",
    timestamp: serverTimestamp(),
    businessDate: todayKey(),
    note: noteText,
    paymentMethod,
    source: "pos",
    items: saleItems,
    cogsTotal,
    cogsStatus,
    ...actorFields(user, profile),
  };

  const applied = await runTransaction(db, async (transaction) => {
    const stockAdjustments = await readStockForUpdate(transaction, stockDeltas);
    transaction.set(txRef, { ...salePayload, stockAdjustments });
    return stockAdjustments;
  });

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
    businessLine: "shop",
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

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(txRef);
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

    await readStockForUpdate(transaction, restoreDeltas);
    transaction.delete(txRef);
  });
}
