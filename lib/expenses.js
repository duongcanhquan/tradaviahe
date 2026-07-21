import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { canManageShop } from "./roles";
import {
  inputValueToDateKey,
  dateKeyToInputValue,
  timestampForBusinessDate,
  todayInputValue,
  todayKey,
} from "./utils";

/** Loại giao dịch quỹ / chi tiêu cửa hàng */
export const FUND_TYPES = {
  fundIn: "fund_in",
  expense: "expense",
};

/**
 * Hạng mục chi — mới + cũ (legacy vẫn map được khi xem).
 */
export const EXPENSE_CATEGORIES = [
  { value: "nhập hàng", label: "Nhập hàng" },
  { value: "xây dựng", label: "Xây dựng" },
  { value: "thiết bị", label: "Thiết bị (ngoài CĐT)" },
  { value: "quan hệ", label: "Quan hệ" },
  { value: "trả lương", label: "Trả lương" },
  { value: "khác", label: "Khác" },
];

/** Chuẩn hóa category cũ → giá trị mới để lọc / báo cáo */
const CATEGORY_ALIASES = {
  "nhập nguyên liệu": "nhập hàng",
  "nhập hàng": "nhập hàng",
  "xây dựng": "xây dựng",
  "thiết bị": "thiết bị",
  "quan hệ": "quan hệ",
  "chi phí đối ngoại": "quan hệ",
  "trả lương": "trả lương",
  khác: "khác",
};

export function normalizeExpenseCategory(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  if (!key) return "khác";
  // Alias đã biết → hạng mục chuẩn; còn lại gộp vào "khác" (tránh lệch tổng vs thẻ hạng mục)
  return CATEGORY_ALIASES[key] || "khác";
}

export function expenseCategoryLabel(raw) {
  const normalized = normalizeExpenseCategory(raw);
  const found = EXPENSE_CATEGORIES.find((c) => c.value === normalized);
  if (found) return found.label;
  return String(raw || "Khác");
}

export function isFundIn(row) {
  return row?.type === FUND_TYPES.fundIn;
}

export function isShopExpense(row) {
  return row?.type === FUND_TYPES.expense;
}

/** Giao dịch thuộc sổ quỹ cửa hàng (nạp + chi) */
export function isShopFundEntry(row) {
  return isFundIn(row) || isShopExpense(row);
}

/**
 * Số dư quỹ = tổng nạp − tổng chi (expense).
 * Không gồm thu bán hàng (income).
 */
export function summarizeShopFund(transactions = []) {
  let fundIn = 0;
  let expense = 0;
  const byCategory = {};

  for (const t of transactions) {
    const amount = Number(t.amount) || 0;
    if (isFundIn(t)) {
      fundIn += amount;
      continue;
    }
    if (isShopExpense(t)) {
      expense += amount;
      const cat = normalizeExpenseCategory(t.category);
      byCategory[cat] = (byCategory[cat] || 0) + amount;
    }
  }

  return {
    fundIn,
    expense,
    balance: fundIn - expense,
    byCategory,
  };
}

function parseAmount(amount) {
  return Number(String(amount ?? "").replace(/\D/g, "")) || 0;
}

/**
 * Nạp tiền vào quỹ cửa hàng.
 */
export async function recordFundIn({
  amount,
  note = "",
  dateInput = null,
  paymentMethod = "cash",
  user,
  profile,
}) {
  if (!canManageShop(profile?.role)) {
    throw new Error("Không có quyền nạp quỹ cửa hàng");
  }

  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền nạp phải > 0");

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const noteText =
    String(note || "").trim() || `Nạp quỹ cửa hàng ${businessDate}`;

  const ref = await addDoc(collection(db, "transactions"), {
    amount: value,
    type: FUND_TYPES.fundIn,
    category: "quỹ cửa hàng",
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note: noteText,
    paymentMethod:
      paymentMethod === "banking" ? "banking" : "cash",
    source: "shop_fund",
    ...actorFields(user, profile),
  });

  return { id: ref.id, amount: value, businessDate };
}

/**
 * Ghi khoản chi từ quỹ cửa hàng.
 */
export async function recordShopExpense({
  amount,
  category,
  note = "",
  dateInput = null,
  user,
  profile,
}) {
  if (!canManageShop(profile?.role)) {
    throw new Error("Không có quyền ghi chi tiêu");
  }

  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền chi phải > 0");

  const normalized = normalizeExpenseCategory(category);
  const allowed = EXPENSE_CATEGORIES.some((c) => c.value === normalized);
  if (!allowed) throw new Error("Hạng mục chi không hợp lệ");

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const noteText = String(note || "").trim();

  await addDoc(collection(db, "transactions"), {
    amount: value,
    type: FUND_TYPES.expense,
    category: normalized,
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note: noteText,
    paymentMethod: "cash",
    source: "shop_fund",
    ...actorFields(user, profile),
  });

  return { amount: value, businessDate, category: normalized };
}

/**
 * Xóa dòng quỹ / chi — Quản lý trở lên (canManageShop).
 */
export async function deleteShopFundEntry(id, role) {
  if (!canManageShop(role)) {
    throw new Error("Không có quyền xóa");
  }
  if (!id) throw new Error("Thiếu mã giao dịch");
  await deleteDoc(doc(db, "transactions", id));
}

/**
 * Chi tiêu vốn → đồng thời nạp vào quỹ cửa hàng (cùng số tiền / ngày / ghi chú).
 * Trừ sổ vốn + tăng số dư két quán — không tính doanh thu.
 */
export async function transferCapitalToShopFund({
  amount,
  note = "",
  dateInput = null,
  user,
  profile,
}) {
  const { canManageShareholderCapital } = await import("./roles");
  if (!canManageShareholderCapital(profile?.role)) {
    throw new Error("Chỉ tài khoản quản trị được chuyển từ vốn sang quỹ");
  }
  if (!canManageShop(profile?.role)) {
    throw new Error("Không có quyền nạp quỹ cửa hàng");
  }

  const {
    addCapitalExpense,
    markCapitalExpenseLinkedToFund,
  } = await import("./shareholderCapital");
  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const noteText =
    String(note || "").trim() ||
    `Chuyển từ vốn sang quỹ cửa hàng ${businessDate}`;

  const capitalId = await addCapitalExpense({
    amount,
    note: noteText,
    dateKey: businessDate,
    expenseDate: dateInput
      ? timestampForBusinessDate(dateInput)
      : undefined,
    toShopFund: true,
    user,
    profile,
  });

  const fund = await recordFundIn({
    amount,
    note: noteText,
    dateInput,
    paymentMethod: "cash",
    user,
    profile,
  });

  await markCapitalExpenseLinkedToFund(
    capitalId,
    fund.id,
    profile?.role
  );

  return { businessDate, note: noteText, capitalId, fundId: fund.id };
}

/**
 * Giao dịch chi tiêu vốn đã có → nạp quỹ cửa hàng (1 lần, không tạo chi vốn mới).
 */
export async function convertExistingCapitalExpenseToShopFund({
  entry,
  user,
  profile,
}) {
  const { canManageShareholderCapital } = await import("./roles");
  if (!canManageShareholderCapital(profile?.role)) {
    throw new Error("Chỉ tài khoản quản trị được chuyển quỹ");
  }
  if (!entry?.id || entry.kind !== "expense") {
    throw new Error("Không phải dòng chi tiêu vốn");
  }
  if (entry.toShopFund || entry.shopFundTxId) {
    throw new Error("Dòng này đã chuyển vào quỹ cửa hàng rồi");
  }

  const { markCapitalExpenseLinkedToFund } = await import(
    "./shareholderCapital"
  );

  const dateInput = entry.dateKey
    ? dateKeyToInputValue(entry.dateKey)
    : todayInputValue();
  const noteText =
    String(entry.note || "").trim() ||
    `Chuyển từ vốn sang quỹ (sửa sau)`;

  const fund = await recordFundIn({
    amount: entry.amount,
    note: noteText,
    dateInput,
    paymentMethod: "cash",
    user,
    profile,
  });

  await markCapitalExpenseLinkedToFund(entry.id, fund.id, profile?.role);

  return { fundId: fund.id };
}
