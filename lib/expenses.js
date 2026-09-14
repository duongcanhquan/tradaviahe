import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import {
  canChooseInventoryFundSource,
  canDeleteShopFundEntry,
  canManageShop,
} from "./roles";
import { productUsesRecipe } from "./recipe.js";
import {
  inputValueToDateKey,
  dateKeyToInputValue,
  timestampForBusinessDate,
  todayInputValue,
  todayKey,
} from "./utils";
import {
  defaultReceiveUnit,
  findUnit,
  deriveReceiveCostUpdate,
} from "./packaging.js";

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

/** Hạng mục form chi tay — không gồm nhập hàng (nhập chỉ qua màn Nhập hàng). */
export const MANUAL_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES.filter(
  (c) => c.value !== "nhập hàng"
);

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

/** Giao dịch thuộc sổ quỹ cửa hàng (nạp + chi) — loại trừ mảng xây dựng */
export function isShopFundEntry(row) {
  if (!row) return false;
  if (row.businessLine === "construction") return false;
  return isFundIn(row) || isShopExpense(row);
}

/** Chi vận hành quán (P&L / cổ tức) — bỏ chuyển quỹ nội bộ */
export function isShopOperatingExpense(row) {
  if (!row || row.type !== FUND_TYPES.expense) return false;
  if (row.businessLine === "construction") return false;
  const source = String(row.source || "").toLowerCase();
  if (source.startsWith("transfer_")) return false;
  return true;
}

/**
 * Số dư quỹ = nạp quỹ + thu bán hàng tiền mặt − chi quỹ.
 * Thu CK bán hàng không vào quỹ (tính vào số dư vốn).
 *
 * @param {Array} fundRows — dòng fund_in / expense
 * @param {number} cashSalesTotal — tổng thu bán hàng tiền mặt (POS…)
 */
export function summarizeShopFund(fundRows = [], cashSalesTotal = 0) {
  let fundIn = 0;
  let expense = 0;
  const byCategory = {};
  const cashSales = Number(cashSalesTotal) || 0;

  for (const t of fundRows) {
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
    cashSales,
    expense,
    balance: fundIn + cashSales - expense,
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
    businessLine: "shop",
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
  paymentMethod = "cash",
  user,
  profile,
  productId = null,
  productName = null,
  qty = null,
  unitCost = null,
}) {
  if (!canManageShop(profile?.role)) {
    throw new Error("Không có quyền ghi chi tiêu");
  }

  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền chi phải > 0");

  const normalized = normalizeExpenseCategory(category);
  if (normalized === "nhập hàng") {
    throw new Error(
      "Nhập hàng chỉ ghi qua màn Nhập hàng (cộng tồn + trừ quỹ cùng lúc)"
    );
  }
  const allowed = MANUAL_EXPENSE_CATEGORIES.some((c) => c.value === normalized);
  if (!allowed) throw new Error("Hạng mục chi không hợp lệ");

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const noteText = String(note || "").trim();
  const pay = paymentMethod === "banking" ? "banking" : "cash";

  const payload = {
    amount: value,
    type: FUND_TYPES.expense,
    category: normalized,
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note: noteText,
    paymentMethod: pay,
    source: "shop_fund",
    businessLine: "shop",
    ...actorFields(user, profile),
  };
  if (productId) payload.productId = productId;
  if (productName) payload.productName = productName;
  if (qty != null) payload.qty = Number(qty) || 0;
  if (unitCost != null) payload.unitCost = Number(unitCost) || 0;

  const ref = await addDoc(collection(db, "transactions"), payload);

  return {
    id: ref.id,
    amount: value,
    businessDate,
    category: normalized,
    paymentMethod: pay,
  };
}

/**
 * Nhập hàng + trừ quỹ cửa hàng (TM hoặc CK) trong một lần lưu.
 * amount = số lượng × giá nhập đơn vị.
 */
export async function receiveInventoryFromShopFund({
  product,
  addQty,
  unitId,
  unitCost,
  paymentMethod = "cash",
  dateInput = null,
  user,
  profile,
  updateCost = false,
}) {
  if (!canManageShop(profile?.role)) {
    throw new Error("Không có quyền nhập hàng từ quỹ");
  }
  if (!product?.id) throw new Error("Thiếu món");
  if (productUsesRecipe(product)) {
    throw new Error(
      "Món công thức POS không nhập kho — nhập nguyên liệu / thành phẩm mua về"
    );
  }

  const receiveQty = Number(addQty) || 0;
  if (receiveQty <= 0) throw new Error("Số lượng nhập phải > 0");

  const unit = findUnit(product, unitId) || defaultReceiveUnit(product);
  if (!unit) throw new Error("Đơn vị nhập không hợp lệ");

  const unitReceivePrice =
    unitCost != null && String(unitCost).trim() !== ""
      ? Number(unitCost)
      : Number(unit.sellCost) || Number(product.cost) || 0;
  if (!Number.isFinite(unitReceivePrice) || unitReceivePrice < 0) {
    throw new Error("Giá nhập không hợp lệ");
  }

  // last-purchase: luôn chia giá ĐV nhập → cost gốc (mọi factor)
  const derived = deriveReceiveCostUpdate(product, {
    unit,
    receiveQty,
    unitReceivePrice,
  });
  const { baseQty, amount } = derived;
  // updateCost retained for callers; receive always applies derived cost patch.
  void updateCost;

  const pay = paymentMethod === "banking" ? "banking" : "cash";
  const before = Number(product.inStock) || 0;
  const after = before + baseQty;
  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const payLabel = pay === "banking" ? "CK" : "TM";
  const baseUnit =
    String(product?.packaging?.baseUnit || product?.unit || "đv").trim() ||
    "đv";
  const note = `Nhập ${product.name || "món"} +${receiveQty} ${
    unit.label || "đv"
  } = ${baseQty} ${baseUnit} · ${payLabel} · đơn giá ${unitReceivePrice}`;

  const batch = writeBatch(db);
  const productPayload = {
    inStock: after,
    updatedAt: serverTimestamp(),
    ...derived.productPatch,
  };
  if (product.kind === "ingredient") {
    productPayload.costMode = "manual";
  } else if (product.costMode !== "recipe") {
    productPayload.costMode = "manual";
  }
  batch.update(doc(db, "products", product.id), productPayload);

  const txRef = doc(collection(db, "transactions"));
  batch.set(txRef, {
    amount,
    type: FUND_TYPES.expense,
    category: "nhập hàng",
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note,
    paymentMethod: pay,
    source: "inventory_receive",
    businessLine: "shop",
    productId: product.id,
    productName: product.name || "",
    unit: unit.label || product.unit || "",
    unitId: unit.id,
    unitFactor: unit.factor,
    receiveQty,
    baseQty,
    unitReceivePrice,
    qtyBefore: before,
    qtyAfter: after,
    ...actorFields(user, profile),
  });

  await batch.commit();
  return {
    id: txRef.id,
    amount,
    businessDate,
    paymentMethod: pay,
    qty: receiveQty,
    receiveQty,
    baseQty,
    unitId: unit.id,
    unitFactor: unit.factor,
    before,
    after,
    unitCost: unitReceivePrice,
    unitReceivePrice,
    fundSource: "shop",
  };
}

/**
 * Nhập hàng + trừ quỹ đầu tư (chi tiêu vốn cổ đông).
 * Chỉ Admin (Chủ ĐT) / Super Admin.
 */
export async function receiveInventoryFromCapitalFund({
  product,
  addQty,
  unitId,
  unitCost,
  paymentMethod = "cash",
  dateInput = null,
  user,
  profile,
  updateCost = false,
}) {
  if (!canChooseInventoryFundSource(profile?.role)) {
    throw new Error("Chỉ Admin / Super Admin được trừ quỹ đầu tư khi nhập hàng");
  }
  if (!product?.id) throw new Error("Thiếu món");
  if (productUsesRecipe(product)) {
    throw new Error(
      "Món công thức POS không nhập kho — nhập nguyên liệu / thành phẩm mua về"
    );
  }

  const receiveQty = Number(addQty) || 0;
  if (receiveQty <= 0) throw new Error("Số lượng nhập phải > 0");

  const unit = findUnit(product, unitId) || defaultReceiveUnit(product);
  if (!unit) throw new Error("Đơn vị nhập không hợp lệ");

  const unitReceivePrice =
    unitCost != null && String(unitCost).trim() !== ""
      ? Number(unitCost)
      : Number(unit.sellCost) || Number(product.cost) || 0;
  if (!Number.isFinite(unitReceivePrice) || unitReceivePrice < 0) {
    throw new Error("Giá nhập không hợp lệ");
  }

  const derived = deriveReceiveCostUpdate(product, {
    unit,
    receiveQty,
    unitReceivePrice,
  });
  const { baseQty, amount } = derived;
  void updateCost;

  const pay = paymentMethod === "banking" ? "banking" : "cash";
  const before = Number(product.inStock) || 0;
  const after = before + baseQty;
  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const payLabel = pay === "banking" ? "CK" : "TM";
  const baseUnit =
    String(product?.packaging?.baseUnit || product?.unit || "đv").trim() ||
    "đv";
  const note = `Nhập hàng từ quỹ đầu tư · ${product.name || "món"} +${receiveQty} ${
    unit.label || "đv"
  } = ${baseQty} ${baseUnit} · ${payLabel} · đơn giá ${unitReceivePrice}`;

  // Trừ quỹ đầu tư trước — tránh cộng tồn khi chi vốn thất bại.
  const { addCapitalExpense } = await import("./shareholderCapital");
  const capitalId = await addCapitalExpense({
    amount,
    note,
    dateKey: businessDate,
    expenseDate: dateInput
      ? timestampForBusinessDate(dateInput)
      : undefined,
    user,
    profile,
  });

  const productPayload = {
    inStock: after,
    updatedAt: serverTimestamp(),
    ...derived.productPatch,
  };
  if (product.kind === "ingredient") {
    productPayload.costMode = "manual";
  } else if (product.costMode !== "recipe") {
    productPayload.costMode = "manual";
  }
  await updateDoc(doc(db, "products", product.id), productPayload);

  return {
    id: capitalId,
    amount,
    businessDate,
    paymentMethod: pay,
    qty: receiveQty,
    receiveQty,
    baseQty,
    unitId: unit.id,
    unitFactor: unit.factor,
    before,
    after,
    unitCost: unitReceivePrice,
    unitReceivePrice,
    fundSource: "capital",
  };
}

/**
 * Nhập hàng có trừ tiền: quỹ cửa hàng (mặc định) hoặc quỹ đầu tư (Admin/SA).
 */
export async function receiveInventoryPaid({
  fundSource = "shop",
  ...rest
}) {
  if (fundSource === "capital") {
    return receiveInventoryFromCapitalFund(rest);
  }
  return receiveInventoryFromShopFund(rest);
}

/** Đã ghi chi nhập hàng gắn quỹ (mới hoặc bù trừ). */
export function isInventoryFundExpense(row) {
  if (!row || row.type !== FUND_TYPES.expense) return false;
  if (row.businessLine === "construction") return false;
  const source = String(row.source || "");
  if (
    source === "inventory_receive" ||
    source === "inventory_backfill"
  ) {
    return true;
  }
  return normalizeExpenseCategory(row.category) === "nhập hàng";
}

/**
 * Ước lượng bù trừ quỹ cho tồn cũ (không có sổ đơn nhập).
 * = giá trị tồn hiện tại − tổng chi "nhập hàng" đã ghi (không âm).
 */
export function previewInventoryFundBackfill(products = [], transactions = []) {
  const lines = [];
  let stockValue = 0;

  for (const p of products || []) {
    if (p?.active === false) continue;
    const qty = Number(p.inStock) || 0;
    const unitCost = Number(p.cost) || 0;
    if (qty <= 0 || unitCost <= 0) continue;
    const amount = Math.round(qty * unitCost);
    if (amount <= 0) continue;
    stockValue += amount;
    lines.push({
      productId: p.id,
      productName: p.name || "",
      unit: p.unit || "",
      qty,
      unitCost,
      amount,
    });
  }

  let alreadyCharged = 0;
  let backfillDone = false;
  for (const t of transactions || []) {
    if (!isInventoryFundExpense(t)) continue;
    alreadyCharged += Number(t.amount) || 0;
    if (t.source === "inventory_backfill") backfillDone = true;
  }

  const suggested = Math.max(0, stockValue - alreadyCharged);

  return {
    lines,
    stockValue,
    alreadyCharged,
    suggested,
    backfillDone,
    lineCount: lines.length,
  };
}

/**
 * Ghi một lần chi quỹ bù trừ tồn cũ (idempotent nếu đã có inventory_backfill).
 */
export async function backfillInventoryFundFromStock({
  products = [],
  transactions = [],
  paymentMethod = "cash",
  user,
  profile,
}) {
  if (!canManageShop(profile?.role)) {
    throw new Error("Không có quyền bù trừ quỹ nhập hàng");
  }

  const preview = previewInventoryFundBackfill(products, transactions);
  if (preview.backfillDone) {
    throw new Error("Đã bù trừ tồn cũ trước đó — không chạy lại");
  }
  if (preview.suggested <= 0) {
    throw new Error(
      "Không cần bù trừ: giá trị tồn ≤ chi nhập hàng đã ghi trên quỹ"
    );
  }

  const pay = paymentMethod === "banking" ? "banking" : "cash";
  const via = pay === "banking" ? "CK" : "TM";
  const businessDate = todayKey();
  const note =
    `Bù trừ quỹ — tồn kho cũ (trước khi nhập hàng tự trừ quỹ) · ${via} · ` +
    `${preview.lineCount} món · giá trị tồn ${preview.stockValue} − đã chi ${preview.alreadyCharged}`;

  const ref = await addDoc(collection(db, "transactions"), {
    amount: preview.suggested,
    type: FUND_TYPES.expense,
    category: "nhập hàng",
    timestamp: serverTimestamp(),
    businessDate,
    note,
    paymentMethod: pay,
    source: "inventory_backfill",
    businessLine: "shop",
    stockValue: preview.stockValue,
    alreadyCharged: preview.alreadyCharged,
    backfillLines: preview.lines.slice(0, 80),
    ...actorFields(user, profile),
  });

  return {
    id: ref.id,
    amount: preview.suggested,
    paymentMethod: pay,
    businessDate,
    preview,
  };
}

/**
 * Xóa dòng quỹ / chi ngoài — chỉ Super Admin.
 * Phiếu nhập hàng (inventory_receive / backfill) không xóa tại đây.
 * Xóa expense → số dư quỹ tăng lại (sổ = tổng giao dịch).
 */
export async function deleteShopFundEntry(id, role) {
  if (!canDeleteShopFundEntry(role)) {
    throw new Error("Chỉ Super Admin được xóa khoản quỹ / chi");
  }
  if (!id) throw new Error("Thiếu mã giao dịch");
  const ref = doc(db, "transactions", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Không tìm thấy giao dịch");
  const row = { id: snap.id, ...snap.data() };
  if (isInventoryFundExpense(row)) {
    throw new Error(
      "Không xóa phiếu nhập hàng trên sổ chi — đảo / sửa ở màn Nhập hàng"
    );
  }
  await deleteDoc(ref);
}

/**
 * Chi tiêu vốn → đồng thời nạp vào quỹ cửa hàng (cùng số tiền / ngày / ghi chú).
 * Trừ sổ vốn + tăng số dư két quán — không tính doanh thu.
 */
export async function transferCapitalToShopFund({
  amount,
  note = "",
  dateInput = null,
  paymentMethod = "cash",
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

  const pay =
    paymentMethod === "banking" ? "banking" : "cash";

  const {
    addCapitalExpense,
    markCapitalExpenseLinkedToFund,
  } = await import("./shareholderCapital");
  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const via = pay === "banking" ? "CK" : "TM";
  const noteText =
    String(note || "").trim() ||
    `Chuyển từ vốn sang quỹ cửa hàng (${via}) ${businessDate}`;

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
    paymentMethod: pay,
    user,
    profile,
  });

  await markCapitalExpenseLinkedToFund(
    capitalId,
    fund.id,
    profile?.role
  );

  return { businessDate, note: noteText, capitalId, fundId: fund.id, paymentMethod: pay };
}

/**
 * Giao dịch chi tiêu vốn đã có → nạp quỹ cửa hàng (1 lần, không tạo chi vốn mới).
 */
export async function convertExistingCapitalExpenseToShopFund({
  entry,
  paymentMethod = "cash",
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

  const pay =
    paymentMethod === "banking" ? "banking" : "cash";
  const dateInput = entry.dateKey
    ? dateKeyToInputValue(entry.dateKey)
    : todayInputValue();
  const via = pay === "banking" ? "CK" : "TM";
  const noteText =
    String(entry.note || "").trim() ||
    `Chuyển từ vốn sang quỹ (${via})`;

  const fund = await recordFundIn({
    amount: entry.amount,
    note: noteText,
    dateInput,
    paymentMethod: pay,
    user,
    profile,
  });

  await markCapitalExpenseLinkedToFund(entry.id, fund.id, profile?.role);

  return { fundId: fund.id, paymentMethod: pay };
}

/**
 * Nạp quỹ đồng thời trừ sổ vốn cổ đông (tiền mặt hoặc chuyển khoản).
 * Dùng khi nạp két từ vốn — tránh quỹ tăng mà sổ vốn không trừ.
 */
export async function recordFundInFromCapital({
  amount,
  note = "",
  dateInput = null,
  paymentMethod = "cash",
  user,
  profile,
}) {
  const { canManageShareholderCapital } = await import("./roles");
  if (!canManageShareholderCapital(profile?.role)) {
    throw new Error("Chỉ tài khoản quản trị được nạp quỹ từ vốn");
  }

  const pay =
    paymentMethod === "banking" ? "banking" : "cash";
  const {
    addCapitalExpense,
    markCapitalExpenseLinkedToFund,
  } = await import("./shareholderCapital");

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const via = pay === "banking" ? "CK" : "TM";
  const noteText =
    String(note || "").trim() ||
    `Nạp quỹ từ vốn (${via}) ${businessDate}`;

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
    paymentMethod: pay,
    user,
    profile,
  });

  await markCapitalExpenseLinkedToFund(
    capitalId,
    fund.id,
    profile?.role
  );

  return { businessDate, note: noteText, capitalId, fundId: fund.id, paymentMethod: pay };
}
