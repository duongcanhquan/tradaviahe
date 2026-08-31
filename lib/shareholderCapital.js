import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";

export const CAPITAL_COLLECTION = "shareholder_capital_entries";

export const CAPITAL_KINDS = {
  initial: "initial",
  contribution: "contribution",
  expense: "expense",
};

/** @deprecated giữ để đọc dữ liệu cũ; form mới không dùng nhóm chi */
export const EXPENSE_CATEGORIES = {
  shop: "shop",
  shareholder: "shareholder",
};

export function capitalKindLabel(kind) {
  if (kind === CAPITAL_KINDS.initial) return "Vốn ban đầu";
  if (kind === CAPITAL_KINDS.contribution) return "Góp thêm";
  if (kind === CAPITAL_KINDS.expense) return "Chi tiêu vốn";
  return kind || "—";
}

export function isContributionKind(kind) {
  return kind === CAPITAL_KINDS.initial || kind === CAPITAL_KINDS.contribution;
}

export function subscribeShareholderCapital(callback, onError) {
  return subscribeCollection(
    CAPITAL_COLLECTION,
    (rows) => {
      const list = [...rows].sort((a, b) => {
        const ta = a.timestamp?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const tb = b.timestamp?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
      callback(list);
    },
    onError
  );
}

/**
 * Tổng hợp sổ vốn cổ đông (tách khỏi transactions bán hàng / nhập hàng).
 * % cổ phần theo tổng đã góp (initial + contribution), không trừ chi tiêu.
 * Chi tiêu vốn trừ số dư tổng; thu CK bán hàng cộng số dư (không đổi vốn góp).
 *
 * @param {Array} entries
 * @param {number} bankingIncomeTotal — tổng thu CK (bán hàng + dịch vụ XD)
 */
export function summarizeShareholderCapital(
  entries = [],
  bankingIncomeTotal = 0
) {
  const list = Array.isArray(entries) ? entries : [];
  const byInvestor = {};
  const bankingIncome = Number(bankingIncomeTotal) || 0;

  let totalContributed = 0;
  let totalInitial = 0;
  let totalExpenses = 0;

  for (const row of list) {
    const amount = Number(row.amount) || 0;

    if (row.kind === CAPITAL_KINDS.expense) {
      totalExpenses += amount;
      continue;
    }

    const name = String(row.investorName || "").trim() || "Không tên";
    if (!byInvestor[name]) {
      byInvestor[name] = {
        name,
        initial: 0,
        contributed: 0,
        expenses: 0,
        balance: 0,
        initialEntryId: null,
      };
    }
    const bucket = byInvestor[name];

    if (row.kind === CAPITAL_KINDS.initial) {
      bucket.initial += amount;
      bucket.contributed += amount;
      totalInitial += amount;
      totalContributed += amount;
      if (!bucket.initialEntryId) bucket.initialEntryId = row.id;
    } else if (row.kind === CAPITAL_KINDS.contribution) {
      bucket.contributed += amount;
      totalContributed += amount;
    }
  }

  const shares = Object.values(byInvestor)
    .map((s) => ({
      ...s,
      balance: s.contributed,
      percent: totalContributed > 0 ? (s.contributed / totalContributed) * 100 : 0,
      value: s.contributed,
    }))
    .sort((a, b) => b.contributed - a.contributed);

  return {
    totalContributed,
    totalInitial,
    totalExpenses,
    bankingIncome,
    totalBalance: totalContributed - totalExpenses + bankingIncome,
    shares,
    byInvestor,
  };
}

/** Shape tương thích calculateMonthlyReport / cổ tức (dựa trên vốn đã góp) */
export function capitalSharesForDividends(entries = []) {
  const { totalContributed, shares } = summarizeShareholderCapital(entries);
  return {
    total: totalContributed,
    shares: shares.map((s) => ({
      name: s.name,
      value: s.contributed,
      percent: s.percent,
    })),
  };
}

export async function addCapitalContribution({
  investorName,
  amount,
  kind = CAPITAL_KINDS.contribution,
  note = "",
  user,
  profile,
}) {
  const name = String(investorName || "").trim();
  const value = Number(amount) || 0;
  if (!name) throw new Error("Chọn hoặc nhập tên cổ đông");
  if (value <= 0) throw new Error("Số tiền phải > 0");
  if (kind !== CAPITAL_KINDS.initial && kind !== CAPITAL_KINDS.contribution) {
    throw new Error("Loại góp vốn không hợp lệ");
  }

  const ref = await addDoc(collection(db, CAPITAL_COLLECTION), {
    investorName: name,
    kind,
    expenseCategory: null,
    amount: value,
    note: String(note || "").trim(),
    timestamp: serverTimestamp(),
    createdAt: serverTimestamp(),
    ...actorFields(user, profile),
  });
  return ref.id;
}

/**
 * Chi tiêu từ vốn quỹ chung — không gắn cổ đông.
 * Lưu vết người bấm gửi + ngày nghiệp vụ (dateKey / timestamp).
 */
export async function addCapitalExpense({
  amount,
  note = "",
  dateKey = "",
  expenseDate = null,
  toShopFund = false,
  shopFundTxId = null,
  user,
  profile,
}) {
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error("Số tiền phải > 0");

  const actor = actorFields(user, profile);
  const ref = await addDoc(collection(db, CAPITAL_COLLECTION), {
    investorName: null,
    kind: CAPITAL_KINDS.expense,
    expenseCategory: null,
    amount: value,
    note: String(note || "").trim(),
    dateKey: String(dateKey || "").trim() || null,
    timestamp: expenseDate || serverTimestamp(),
    createdAt: serverTimestamp(),
    toShopFund: Boolean(toShopFund),
    shopFundTxId: shopFundTxId || null,
    ...actor,
  });
  return ref.id;
}

/**
 * Super Admin sửa nội dung chi tiêu vốn (số tiền / ghi chú / ngày).
 */
export async function updateCapitalExpense({
  entryId,
  amount,
  note,
  dateKey = "",
  expenseDate = null,
  role,
}) {
  if (role !== "superadmin") {
    throw new Error("Chỉ tài khoản quản trị được sửa chi tiêu vốn");
  }
  if (!entryId) throw new Error("Thiếu dòng chi tiêu");
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error("Số tiền phải > 0");

  const payload = {
    amount: value,
    note: String(note || "").trim(),
    dateKey: String(dateKey || "").trim() || null,
    updatedAt: serverTimestamp(),
  };
  if (expenseDate) payload.timestamp = expenseDate;

  await updateDoc(doc(db, CAPITAL_COLLECTION, entryId), payload);
}

/**
 * Đánh dấu dòng chi vốn đã gắn giao dịch nạp quỹ cửa hàng.
 */
export async function markCapitalExpenseLinkedToFund(
  entryId,
  shopFundTxId,
  role
) {
  if (role !== "superadmin") {
    throw new Error("Chỉ tài khoản quản trị được chuyển quỹ");
  }
  if (!entryId) throw new Error("Thiếu dòng chi tiêu");
  await updateDoc(doc(db, CAPITAL_COLLECTION, entryId), {
    toShopFund: true,
    shopFundTxId: shopFundTxId || null,
    convertedToFundAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Super Admin sửa số vốn đầu tư ban đầu trên đúng dòng initial */
export async function updateInitialCapitalAmount(entryId, amount) {
  if (!entryId) throw new Error("Thiếu dòng vốn ban đầu");
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error("Số tiền phải > 0");

  await updateDoc(doc(db, CAPITAL_COLLECTION, entryId), {
    amount: value,
    updatedAt: serverTimestamp(),
  });
}

export function findInitialEntry(entries, investorName) {
  const name = String(investorName || "").trim();
  if (!name) return null;
  return (
    (entries || []).find(
      (row) =>
        row.kind === CAPITAL_KINDS.initial &&
        String(row.investorName || "").trim() === name
    ) || null
  );
}

function normalizePersonKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/** Thu thập mọi tên/username/email của user đúng role (so khớp không phân biệt hoa thường). */
export function collectUserNameKeys(users = [], role) {
  const want = String(role || "")
    .trim()
    .toLowerCase();
  const keys = new Set();
  for (const u of users || []) {
    if (String(u?.role || "").trim().toLowerCase() !== want) continue;
    for (const field of [u.name, u.username, u.email]) {
      const key = normalizePersonKey(field);
      if (key) keys.add(key);
    }
  }
  return keys;
}

export function displayNamesForRole(users = [], role) {
  const want = String(role || "")
    .trim()
    .toLowerCase();
  const names = [];
  for (const u of users || []) {
    if (String(u?.role || "").trim().toLowerCase() !== want) continue;
    const label = String(u.name || u.username || u.email || "").trim();
    if (label) names.push(label);
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "vi"));
}

/**
 * Loại khỏi sổ vốn các dòng góp gắn tên Quản lý / Nhân viên.
 * Chi tiêu vốn (không gắn cổ đông) luôn giữ.
 */
export function filterShareholderCapitalEntries(entries = [], users = []) {
  const blocked = new Set([
    ...collectUserNameKeys(users, "manager"),
    ...collectUserNameKeys(users, "employee"),
  ]);
  return (entries || []).filter((row) => {
    if (row?.kind === CAPITAL_KINDS.expense) return true;
    const key = normalizePersonKey(row?.investorName);
    if (!key) return false;
    return !blocked.has(key);
  });
}

/** true nếu tên trùng user quản lý quán (không được ghi vào sổ cổ đông) */
export function isShopManagerName(name, users = []) {
  return collectUserNameKeys(users, "manager").has(normalizePersonKey(name));
}
