/**
 * Mảng xây dựng — tách biệt hoàn toàn khỏi bán hàng trà đá (businessLine).
 * Thu TM → quỹ XD; thu CK → số dư vốn CĐT (cùng gốc CK bán hàng).
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";
import {
  canManageShareholderCapital,
  canManageShop,
} from "./roles";
import {
  inputValueToDateKey,
  timestampForBusinessDate,
  todayInputValue,
  todayKey,
} from "./utils";

export const BUSINESS_LINE = {
  SHOP: "shop",
  CONSTRUCTION: "construction",
};

export const CONSTRUCTION_JOBS = "construction_jobs";

export const CONSTRUCTION_EXPENSE_CATEGORIES = [
  { value: "nhân công", label: "Nhân công" },
  { value: "vật tư", label: "Vật tư" },
  { value: "thuê xe", label: "Thuê xe / máy" },
  { value: "thầu phụ", label: "Thầu phụ" },
  { value: "khác", label: "Khác" },
];

export const CONSTRUCTION_JOB_CATEGORIES = [
  { value: "cho_thue_nhan_cong", label: "Cho thuê nhân công" },
  { value: "xay_dung", label: "Xây dựng" },
  { value: "sua_chua", label: "Sửa chữa" },
  { value: "khac", label: "Khác" },
];

export const JOB_STATUS = {
  planned: "planned",
  active: "active",
  done: "done",
  settled: "settled",
};

export const JOB_STATUS_LABEL = {
  planned: "Dự kiến",
  active: "Đang làm",
  done: "Xong",
  settled: "Đã quyết toán",
};

/** Dữ liệu cũ không có field → shop */
export function resolveBusinessLine(row) {
  if (row?.businessLine === BUSINESS_LINE.CONSTRUCTION) {
    return BUSINESS_LINE.CONSTRUCTION;
  }
  return BUSINESS_LINE.SHOP;
}

export function isConstructionLine(row) {
  return resolveBusinessLine(row) === BUSINESS_LINE.CONSTRUCTION;
}

export function isShopLine(row) {
  return resolveBusinessLine(row) === BUSINESS_LINE.SHOP;
}

export function isConstructionFundIn(row) {
  return isConstructionLine(row) && row?.type === "fund_in";
}

export function isConstructionExpense(row) {
  return isConstructionLine(row) && row?.type === "expense";
}

export function isConstructionFundEntry(row) {
  return isConstructionFundIn(row) || isConstructionExpense(row);
}

/** Thu dịch vụ xây dựng (không phải bán trà) */
export function isConstructionServiceIncome(tx) {
  if (!tx || tx.type !== "income") return false;
  if (!isConstructionLine(tx)) return false;
  const cat = String(tx.category || "")
    .trim()
    .toLowerCase();
  if (cat === "dịch vụ xây dựng" || cat === "dich vu xay dung") return true;
  const source = String(tx.source || "").toLowerCase();
  return source === "construction_service";
}

export function sumConstructionIncomeByMethod(transactions = []) {
  let cash = 0;
  let banking = 0;
  for (const t of transactions) {
    if (!isConstructionServiceIncome(t)) continue;
    const amount = Number(t.amount) || 0;
    if (t.paymentMethod === "banking") banking += amount;
    else cash += amount;
  }
  return { cash, banking, total: cash + banking };
}

/**
 * Tổng CK vào số dư vốn = CK bán hàng + CK dịch vụ XD.
 * Mirror isGoodsIncome (tránh import vòng với receipts).
 */
export function sumCapitalBankingIncome(transactions = []) {
  let banking = 0;
  for (const t of transactions) {
    if (t?.type !== "income") continue;
    if (t.paymentMethod !== "banking") continue;
    const isGoods =
      !isConstructionLine(t) &&
      (() => {
        const cat = String(t.category || "")
          .trim()
          .toLowerCase();
        if (cat === "dịch vụ xây dựng" || cat === "dich vu xay dung") {
          return false;
        }
        if (cat === "bán hàng" || cat === "ban hang" || cat === "pos") {
          return true;
        }
        const source = String(t.source || "").toLowerCase();
        if (source === "construction_service") return false;
        return source === "pos" || source === "banking_by_date";
      })();
    if (isGoods || isConstructionServiceIncome(t)) {
      banking += Number(t.amount) || 0;
    }
  }
  return banking;
}

/**
 * Quỹ XD = nạp + thu TM dịch vụ − chi.
 * Thu CK không vào quỹ (vào vốn).
 */
export function summarizeConstructionFund(
  fundRows = [],
  cashServiceTotal = 0
) {
  let fundIn = 0;
  let expense = 0;
  const byCategory = {};
  const cashService = Number(cashServiceTotal) || 0;

  for (const t of fundRows) {
    if (!isConstructionFundEntry(t)) continue;
    const amount = Number(t.amount) || 0;
    if (isConstructionFundIn(t)) {
      fundIn += amount;
      continue;
    }
    if (isConstructionExpense(t)) {
      expense += amount;
      const cat = String(t.category || "khác").toLowerCase();
      byCategory[cat] = (byCategory[cat] || 0) + amount;
    }
  }

  return {
    fundIn,
    cashService,
    expense,
    balance: fundIn + cashService - expense,
    byCategory,
  };
}

function parseAmount(amount) {
  return Number(String(amount ?? "").replace(/\D/g, "")) || 0;
}

function assertManageConstruction(profile) {
  if (!canManageShop(profile?.role)) {
    throw new Error("Không có quyền quản lý mảng xây dựng");
  }
}

export async function recordConstructionFundIn({
  amount,
  note = "",
  dateInput = null,
  paymentMethod = "cash",
  source = "construction_fund",
  transferGroupId = null,
  user,
  profile,
}) {
  assertManageConstruction(profile);
  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền nạp phải > 0");

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const noteText =
    String(note || "").trim() || `Nạp quỹ xây dựng ${businessDate}`;

  const ref = await addDoc(collection(db, "transactions"), {
    amount: value,
    type: "fund_in",
    category: "quỹ xây dựng",
    businessLine: BUSINESS_LINE.CONSTRUCTION,
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note: noteText,
    paymentMethod: paymentMethod === "banking" ? "banking" : "cash",
    source,
    transferGroupId: transferGroupId || null,
    ...actorFields(user, profile),
  });

  return { id: ref.id, amount: value, businessDate };
}

export async function recordConstructionExpense({
  amount,
  category,
  note = "",
  dateInput = null,
  constructionJobId = null,
  user,
  profile,
}) {
  assertManageConstruction(profile);
  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền chi phải > 0");

  const cat = String(category || "khác").trim().toLowerCase() || "khác";
  const allowed = CONSTRUCTION_EXPENSE_CATEGORIES.some((c) => c.value === cat);
  if (!allowed) throw new Error("Hạng mục chi không hợp lệ");

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();

  const ref = await addDoc(collection(db, "transactions"), {
    amount: value,
    type: "expense",
    category: cat,
    businessLine: BUSINESS_LINE.CONSTRUCTION,
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note: String(note || "").trim(),
    paymentMethod: "cash",
    source: "construction_fund",
    constructionJobId: constructionJobId || null,
    ...actorFields(user, profile),
  });

  return { id: ref.id, amount: value, businessDate, category: cat };
}

/**
 * Thu dịch vụ XD.
 * cash → quỹ XD (type income, cộng vào summarize qua cashService).
 * banking → chỉ ghi income; số dư vốn cộng qua sumCapitalBankingIncome.
 */
export async function recordConstructionServiceIncome({
  amount,
  paymentMethod,
  note = "",
  dateInput = null,
  constructionJobId = null,
  user,
  profile,
}) {
  assertManageConstruction(profile);
  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền phải > 0");
  if (paymentMethod !== "cash" && paymentMethod !== "banking") {
    throw new Error("Chọn hình thức thanh toán");
  }

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const via = paymentMethod === "banking" ? "CK" : "TM";
  const noteText =
    String(note || "").trim() ||
    `Thu dịch vụ xây dựng (${via}) ${businessDate}`;

  const ref = await addDoc(collection(db, "transactions"), {
    amount: value,
    type: "income",
    category: "dịch vụ xây dựng",
    businessLine: BUSINESS_LINE.CONSTRUCTION,
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note: noteText,
    paymentMethod,
    source: "construction_service",
    constructionJobId: constructionJobId || null,
    ...actorFields(user, profile),
  });

  return {
    id: ref.id,
    amount: value,
    businessDate,
    paymentMethod,
    toFund: paymentMethod === "cash",
    toCapital: paymentMethod === "banking",
  };
}

export async function deleteConstructionTx(id, role) {
  if (!canManageShop(role)) throw new Error("Không có quyền xóa");
  if (!id) throw new Error("Thiếu mã giao dịch");
  await deleteDoc(doc(db, "transactions", id));
}

/**
 * Xóa cả cặp chuyển quỹ (transactions + dòng vốn nếu có cùng transferGroupId).
 * @param {Array<{id: string}>} siblingTxs
 * @param {string|null} transferGroupId
 */
export async function deleteConstructionTransferGroup({
  siblingTxs = [],
  transferGroupId = null,
  role,
}) {
  if (!canManageShop(role)) throw new Error("Không có quyền xóa");
  const ids = [
    ...new Set(
      siblingTxs.map((t) => t?.id).filter(Boolean)
    ),
  ];
  if (ids.length === 0) throw new Error("Thiếu mã giao dịch");

  for (const id of ids) {
    await deleteDoc(doc(db, "transactions", id));
  }

  const group = String(transferGroupId || "").trim();
  if (!group) return { deletedTx: ids.length, deletedCapital: 0 };

  const snap = await getDocs(
    query(
      collection(db, "shareholder_capital_entries"),
      where("transferGroupId", "==", group)
    )
  );
  let deletedCapital = 0;
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
    deletedCapital += 1;
  }
  return { deletedTx: ids.length, deletedCapital };
}

/** Vốn CĐT → Quỹ xây dựng */
export async function transferCapitalToConstructionFund({
  amount,
  note = "",
  dateInput = null,
  user,
  profile,
}) {
  if (!canManageShareholderCapital(profile?.role)) {
    throw new Error("Không có quyền chuyển từ sổ vốn");
  }
  assertManageConstruction(profile);

  // parseAmount (strip non-digit) — khớp recordConstructionFundIn; tránh Number("500.000")=500
  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền phải > 0");

  const { addCapitalExpense } = await import("./shareholderCapital");
  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const transferGroupId = `xd_cap_${Date.now()}`;
  const noteText =
    String(note || "").trim() ||
    `Chuyển từ vốn sang quỹ xây dựng ${businessDate}`;

  const capitalId = await addCapitalExpense({
    amount: value,
    note: noteText,
    dateKey: businessDate,
    expenseDate: dateInput
      ? timestampForBusinessDate(dateInput)
      : undefined,
    toShopFund: false,
    user,
    profile,
  });

  await updateDoc(doc(db, "shareholder_capital_entries", capitalId), {
    toConstructionFund: true,
    transferGroupId,
    updatedAt: serverTimestamp(),
  });

  const fund = await recordConstructionFundIn({
    amount: value,
    note: noteText,
    dateInput,
    paymentMethod: "cash",
    source: "transfer_capital_to_xd",
    transferGroupId,
    user,
    profile,
  });

  await updateDoc(doc(db, "shareholder_capital_entries", capitalId), {
    constructionFundTxId: fund.id,
    updatedAt: serverTimestamp(),
  });

  return {
    businessDate,
    note: noteText,
    capitalId,
    fundId: fund.id,
    transferGroupId,
  };
}

/** Quỹ cửa hàng → Quỹ xây dựng */
export async function transferShopFundToConstruction({
  amount,
  note = "",
  dateInput = null,
  user,
  profile,
}) {
  assertManageConstruction(profile);
  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền phải > 0");

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const transferGroupId = `xd_shop_${Date.now()}`;
  const noteText =
    String(note || "").trim() ||
    `Chuyển từ quỹ cửa hàng sang quỹ xây dựng ${businessDate}`;

  // Trừ quỹ quán (expense shop) — không đụng doanh thu
  const shopRef = await addDoc(collection(db, "transactions"), {
    amount: value,
    type: "expense",
    category: "khác",
    businessLine: BUSINESS_LINE.SHOP,
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note: noteText,
    paymentMethod: "cash",
    source: "transfer_shop_to_xd",
    transferGroupId,
    ...actorFields(user, profile),
  });

  const fund = await recordConstructionFundIn({
    amount: value,
    note: noteText,
    dateInput,
    paymentMethod: "cash",
    source: "transfer_shop_to_xd",
    transferGroupId,
    user,
    profile,
  });

  return {
    businessDate,
    note: noteText,
    shopExpenseId: shopRef.id,
    fundId: fund.id,
    transferGroupId,
  };
}

/** Quỹ xây dựng → Quỹ cửa hàng */
export async function transferConstructionToShopFund({
  amount,
  note = "",
  dateInput = null,
  user,
  profile,
}) {
  assertManageConstruction(profile);
  const value = parseAmount(amount);
  if (value <= 0) throw new Error("Số tiền phải > 0");

  const { recordFundIn } = await import("./expenses");
  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();
  const transferGroupId = `xd_to_shop_${Date.now()}`;
  const noteText =
    String(note || "").trim() ||
    `Chuyển từ quỹ xây dựng sang quỹ cửa hàng ${businessDate}`;

  await addDoc(collection(db, "transactions"), {
    amount: value,
    type: "expense",
    category: "khác",
    businessLine: BUSINESS_LINE.CONSTRUCTION,
    timestamp: dateInput
      ? timestampForBusinessDate(dateInput)
      : serverTimestamp(),
    businessDate,
    note: noteText,
    paymentMethod: "cash",
    source: "transfer_xd_to_shop",
    transferGroupId,
    ...actorFields(user, profile),
  });

  const fund = await recordFundIn({
    amount: value,
    note: noteText,
    dateInput,
    paymentMethod: "cash",
    user,
    profile,
  });

  await updateDoc(doc(db, "transactions", fund.id), {
    transferGroupId,
    source: "transfer_xd_to_shop",
    updatedAt: serverTimestamp(),
  });

  return { businessDate, note: noteText, fundId: fund.id, transferGroupId };
}

// ——— Jobs ———

export function subscribeConstructionJobs(callback, onError) {
  return subscribeCollection(
    CONSTRUCTION_JOBS,
    (rows) => {
      const list = [...rows].sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });
      callback(list);
    },
    onError
  );
}

export function summarizeConstructionJobs(jobs = []) {
  let contractTotal = 0;
  let expectedProfitTotal = 0;
  let activeCount = 0;
  for (const j of jobs) {
    if (j?.active === false) continue;
    contractTotal += Number(j.contractAmount) || 0;
    expectedProfitTotal += Number(j.expectedProfit) || 0;
    if (j.status === JOB_STATUS.active || j.status === JOB_STATUS.planned) {
      activeCount += 1;
    }
  }
  return { contractTotal, expectedProfitTotal, activeCount, count: jobs.length };
}

export async function createConstructionJob(data, user, profile) {
  assertManageConstruction(profile);
  const title = String(data.title || "").trim();
  if (!title) throw new Error("Nhập tên hạng mục / việc");

  const status = JOB_STATUS[data.status] || JOB_STATUS.planned;
  const ref = await addDoc(collection(db, CONSTRUCTION_JOBS), {
    title,
    category: String(data.category || "khac"),
    clientName: String(data.clientName || "").trim(),
    contractAmount: Number(data.contractAmount) || 0,
    expectedProfit: Number(data.expectedProfit) || 0,
    actualProfit:
      data.actualProfit === "" || data.actualProfit == null
        ? null
        : Number(data.actualProfit) || 0,
    durationDays: Math.max(0, Number(data.durationDays) || 0),
    startDate: String(data.startDate || "").trim() || null,
    endDate: String(data.endDate || "").trim() || null,
    status,
    note: String(data.note || "").trim(),
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...actorFields(user, profile),
  });
  return ref.id;
}

export async function updateConstructionJob(id, data, profile) {
  assertManageConstruction(profile);
  if (!id) throw new Error("Thiếu mã việc");
  const title = String(data.title || "").trim();
  if (!title) throw new Error("Nhập tên hạng mục / việc");

  const status = JOB_STATUS[data.status] || JOB_STATUS.planned;
  await updateDoc(doc(db, CONSTRUCTION_JOBS, id), {
    title,
    category: String(data.category || "khac"),
    clientName: String(data.clientName || "").trim(),
    contractAmount: Number(data.contractAmount) || 0,
    expectedProfit: Number(data.expectedProfit) || 0,
    actualProfit:
      data.actualProfit === "" || data.actualProfit == null
        ? null
        : Number(data.actualProfit) || 0,
    durationDays: Math.max(0, Number(data.durationDays) || 0),
    startDate: String(data.startDate || "").trim() || null,
    endDate: String(data.endDate || "").trim() || null,
    status,
    note: String(data.note || "").trim(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteConstructionJob(id, profile) {
  assertManageConstruction(profile);
  if (!id) throw new Error("Thiếu mã việc");
  await deleteDoc(doc(db, CONSTRUCTION_JOBS, id));
}

export function defaultJobDateInput() {
  return todayInputValue();
}

export function constructionExpenseLabel(raw) {
  const key = String(raw || "").toLowerCase();
  const found = CONSTRUCTION_EXPENSE_CATEGORIES.find((c) => c.value === key);
  return found ? found.label : String(raw || "Khác");
}

export function constructionJobCategoryLabel(raw) {
  const found = CONSTRUCTION_JOB_CATEGORIES.find((c) => c.value === raw);
  return found ? found.label : String(raw || "Khác");
}
