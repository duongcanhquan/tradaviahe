import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";

export const CAPITAL_COLLECTION = "shareholder_capital_entries";

export const CAPITAL_KINDS = {
  initial: "initial",
  contribution: "contribution",
  expense: "expense",
};

/** Chi từ vốn: shop = cho quán (không tự tạo TB); shareholder = chi cổ đông */
export const EXPENSE_CATEGORIES = {
  shop: "shop",
  shareholder: "shareholder",
};

export const EXPENSE_CATEGORY_OPTIONS = [
  {
    value: "shop",
    label: "Chi cho quán",
    hint: "Mua sắm / thiết bị — chỉ trừ vốn cổ đông; TB quán nhập tay sau",
  },
  {
    value: "shareholder",
    label: "Chi cổ đông",
    hint: "VD: lương NV chính, quản lý — thuộc dòng tiền cổ đông",
  },
];

export function capitalKindLabel(kind) {
  if (kind === CAPITAL_KINDS.initial) return "Vốn ban đầu";
  if (kind === CAPITAL_KINDS.contribution) return "Góp thêm";
  if (kind === CAPITAL_KINDS.expense) return "Chi tiêu vốn";
  return kind || "—";
}

export function expenseCategoryLabel(category) {
  if (category === EXPENSE_CATEGORIES.shop) return "Cho quán";
  if (category === EXPENSE_CATEGORIES.shareholder) return "Cổ đông";
  return category || "—";
}

export function isContributionKind(kind) {
  return kind === CAPITAL_KINDS.initial || kind === CAPITAL_KINDS.contribution;
}

export function subscribeShareholderCapital(callback, onError) {
  return onSnapshot(
    collection(db, CAPITAL_COLLECTION),
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
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
 */
export function summarizeShareholderCapital(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const byInvestor = {};

  let totalContributed = 0;
  let totalInitial = 0;
  let totalExpenses = 0;
  let expensesShop = 0;
  let expensesShareholder = 0;

  for (const row of list) {
    const name = String(row.investorName || "").trim() || "Không tên";
    const amount = Number(row.amount) || 0;
    if (!byInvestor[name]) {
      byInvestor[name] = {
        name,
        initial: 0,
        contributed: 0,
        expenses: 0,
        expensesShop: 0,
        expensesShareholder: 0,
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
    } else if (row.kind === CAPITAL_KINDS.expense) {
      bucket.expenses += amount;
      totalExpenses += amount;
      if (row.expenseCategory === EXPENSE_CATEGORIES.shop) {
        bucket.expensesShop += amount;
        expensesShop += amount;
      } else {
        bucket.expensesShareholder += amount;
        expensesShareholder += amount;
      }
    }
  }

  const shares = Object.values(byInvestor)
    .map((s) => {
      const balance = s.contributed - s.expenses;
      return {
        ...s,
        balance,
        percent: totalContributed > 0 ? (s.contributed / totalContributed) * 100 : 0,
        value: s.contributed,
      };
    })
    .sort((a, b) => b.contributed - a.contributed);

  return {
    totalContributed,
    totalInitial,
    totalExpenses,
    expensesShop,
    expensesShareholder,
    totalBalance: totalContributed - totalExpenses,
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

export async function addCapitalExpense({
  investorName,
  amount,
  expenseCategory,
  note = "",
  user,
  profile,
}) {
  const name = String(investorName || "").trim();
  const value = Number(amount) || 0;
  if (!name) throw new Error("Chọn hoặc nhập tên cổ đông");
  if (value <= 0) throw new Error("Số tiền phải > 0");
  if (
    expenseCategory !== EXPENSE_CATEGORIES.shop &&
    expenseCategory !== EXPENSE_CATEGORIES.shareholder
  ) {
    throw new Error("Chọn nhóm chi tiêu vốn");
  }

  const ref = await addDoc(collection(db, CAPITAL_COLLECTION), {
    investorName: name,
    kind: CAPITAL_KINDS.expense,
    expenseCategory,
    amount: value,
    note: String(note || "").trim(),
    timestamp: serverTimestamp(),
    createdAt: serverTimestamp(),
    ...actorFields(user, profile),
  });
  return ref.id;
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
 * Loại khỏi sổ vốn cổ đông các dòng gắn tên Quản lý / Nhân viên.
 * Tên tự nhập (không trùng user QL/NV) vẫn giữ.
 */
export function filterShareholderCapitalEntries(entries = [], users = []) {
  const blocked = new Set([
    ...collectUserNameKeys(users, "manager"),
    ...collectUserNameKeys(users, "employee"),
  ]);
  return (entries || []).filter((row) => {
    const key = normalizePersonKey(row?.investorName);
    if (!key) return false;
    return !blocked.has(key);
  });
}

/** true nếu tên trùng user quản lý quán (không được ghi vào sổ cổ đông) */
export function isShopManagerName(name, users = []) {
  return collectUserNameKeys(users, "manager").has(normalizePersonKey(name));
}
