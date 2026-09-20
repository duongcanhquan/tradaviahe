import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";
import { canManageShareholderCapital } from "./roles";
import {
  matchFundInCandidates,
  matchConstructionFundCandidates,
  previewCapitalFundRepair,
} from "./capitalFundLink.js";

export {
  matchFundInCandidates,
  matchConstructionFundCandidates,
  previewCapitalFundRepair,
} from "./capitalFundLink.js";

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
 * Tìm giao dịch nạp quỹ cửa hàng gắn với dòng chi vốn.
 * Ưu tiên shopFundTxId → capitalEntryId → khớp amount/ngày/ghi chú (dữ liệu cũ).
 */
export async function findLinkedShopFundTxIds(entry) {
  const ids = new Set();
  if (!entry?.id) return [];

  const direct = String(entry.shopFundTxId || "").trim();
  if (direct) ids.add(direct);

  try {
    const byCapital = await getDocs(
      query(
        collection(db, "transactions"),
        where("capitalEntryId", "==", entry.id)
      )
    );
    byCapital.forEach((d) => ids.add(d.id));
  } catch (error) {
    console.warn("findLinkedShopFundTxIds capitalEntryId", error);
  }

  if (ids.size > 0 || !entry.toShopFund) {
    return [...ids];
  }

  const amount = Number(entry.amount) || 0;
  if (amount <= 0) return [];

  try {
    const snaps = await getDocs(
      query(
        collection(db, "transactions"),
        where("type", "==", "fund_in"),
        where("amount", "==", amount)
      )
    );
    const fundRows = snaps.docs.map((d) => ({ id: d.id, ...d.data() }));
    for (const id of matchFundInCandidates(entry, fundRows)) {
      ids.add(id);
    }
  } catch (error) {
    console.warn("findLinkedShopFundTxIds heuristic", error);
  }

  return [...ids];
}

/**
 * Giao dịch quỹ xây dựng gắn chi vốn (vốn → XD).
 */
export async function findLinkedConstructionFundTxIds(entry) {
  const ids = new Set();
  if (!entry?.id) return [];

  const direct = String(entry.constructionFundTxId || "").trim();
  if (direct) ids.add(direct);

  const group = String(entry.transferGroupId || "").trim();
  if (group) {
    try {
      const snaps = await getDocs(
        query(
          collection(db, "transactions"),
          where("transferGroupId", "==", group)
        )
      );
      snaps.forEach((d) => {
        const data = d.data() || {};
        const source = String(data.source || "");
        if (
          source === "transfer_capital_to_xd" ||
          data.businessLine === "construction"
        ) {
          ids.add(d.id);
        }
      });
    } catch (error) {
      console.warn("findLinkedConstructionFundTxIds", error);
    }
  }

  if (ids.size > 0 || !entry.toConstructionFund) {
    return [...ids];
  }

  try {
    const byCapital = await getDocs(
      query(
        collection(db, "transactions"),
        where("capitalEntryId", "==", entry.id)
      )
    );
    byCapital.forEach((d) => {
      const data = d.data() || {};
      if (data.businessLine === "construction" || data.type === "fund_in") {
        ids.add(d.id);
      }
    });
  } catch (error) {
    console.warn("findLinkedConstructionFundTxIds capitalEntryId", error);
  }

  if (ids.size > 0) return [...ids];

  const amount = Number(entry.amount) || 0;
  if (amount <= 0) return [];
  try {
    const snaps = await getDocs(
      query(
        collection(db, "transactions"),
        where("type", "==", "fund_in"),
        where("amount", "==", amount)
      )
    );
    const fundRows = snaps.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.businessLine === "construction");
    for (const id of matchConstructionFundCandidates(entry, fundRows)) {
      ids.add(id);
    }
  } catch (error) {
    console.warn("findLinkedConstructionFundTxIds heuristic", error);
  }

  return [...ids];
}

/**
 * Super Admin sửa nội dung chi tiêu vốn (số tiền / ghi chú / ngày).
 * Đồng bộ nạp quỹ cửa hàng và/hoặc quỹ xây dựng nếu đã gắn.
 */
export async function updateCapitalExpense({
  entryId,
  amount,
  note,
  dateKey = "",
  expenseDate = null,
  role,
}) {
  if (!canManageShareholderCapital(role)) {
    throw new Error("Chỉ tài khoản quản trị được sửa chi tiêu vốn");
  }
  if (!entryId) throw new Error("Thiếu dòng chi tiêu");
  const value = Number(amount) || 0;
  if (value <= 0) throw new Error("Số tiền phải > 0");

  const capitalRef = doc(db, CAPITAL_COLLECTION, entryId);
  const snap = await getDoc(capitalRef);
  if (!snap.exists()) throw new Error("Không tìm thấy dòng chi tiêu vốn");
  const row = { id: snap.id, ...snap.data() };
  if (row.kind !== CAPITAL_KINDS.expense) {
    throw new Error("Chỉ sửa được dòng chi tiêu vốn");
  }
  if (row.source === "inventory_receive") {
    throw new Error(
      "Dòng nhập hàng từ quỹ đầu tư — sửa tồn/giá ở màn Nhập hàng, không sửa sổ vốn tay"
    );
  }

  const payload = {
    amount: value,
    note: String(note || "").trim(),
    dateKey: String(dateKey || "").trim() || null,
    updatedAt: serverTimestamp(),
  };
  if (expenseDate) payload.timestamp = expenseDate;

  const shopFundIds = await findLinkedShopFundTxIds(row);
  const xdFundIds = await findLinkedConstructionFundTxIds(row);

  if ((row.toShopFund || row.shopFundTxId) && shopFundIds.length === 0) {
    throw new Error(
      "Đã gắn quỹ cửa hàng nhưng không tìm thấy giao dịch nạp — sửa trên Quỹ hoặc gắn lại rồi thử."
    );
  }
  if (
    (row.toConstructionFund || row.constructionFundTxId) &&
    xdFundIds.length === 0
  ) {
    throw new Error(
      "Đã gắn quỹ xây dựng nhưng không tìm thấy giao dịch — sửa trên màn Xây dựng rồi thử."
    );
  }

  const batch = writeBatch(db);
  batch.update(capitalRef, {
    ...payload,
    ...(shopFundIds[0] && !row.shopFundTxId
      ? { shopFundTxId: shopFundIds[0], toShopFund: true }
      : {}),
    ...(xdFundIds[0] && !row.constructionFundTxId
      ? { constructionFundTxId: xdFundIds[0], toConstructionFund: true }
      : {}),
  });

  const patchLinkedTx = async (fundId, extras = {}) => {
    const fundRef = doc(db, "transactions", fundId);
    const fundSnap = await getDoc(fundRef);
    if (!fundSnap.exists()) return;
    const fundPatch = {
      amount: value,
      note: String(note || "").trim() || fundSnap.data()?.note || "",
      capitalEntryId: entryId,
      updatedAt: serverTimestamp(),
      ...extras,
    };
    if (expenseDate) fundPatch.timestamp = expenseDate;
    if (payload.dateKey) fundPatch.businessDate = payload.dateKey;
    batch.update(fundRef, fundPatch);
  };

  for (const fundId of shopFundIds) {
    await patchLinkedTx(fundId, { source: "capital_to_shop" });
  }
  for (const fundId of xdFundIds) {
    await patchLinkedTx(fundId, { source: "transfer_capital_to_xd" });
  }

  await batch.commit();
  return {
    id: entryId,
    updatedFundTxIds: shopFundIds,
    updatedConstructionTxIds: xdFundIds,
  };
}

/**
 * Super Admin xóa chi tiêu vốn (ghi nhầm).
 * Xóa kèm nạp quỹ cửa hàng / quỹ xây dựng nếu đã gắn.
 * Không xóa dòng gắn phiếu nhập hàng (tránh lệch tồn).
 */
export async function deleteCapitalExpense({ entryId, role }) {
  if (!canManageShareholderCapital(role)) {
    throw new Error("Chỉ tài khoản quản trị được xóa chi tiêu vốn");
  }
  if (!entryId) throw new Error("Thiếu dòng chi tiêu");

  const capitalRef = doc(db, CAPITAL_COLLECTION, entryId);
  const snap = await getDoc(capitalRef);
  if (!snap.exists()) throw new Error("Không tìm thấy dòng chi tiêu vốn");
  const row = { id: snap.id, ...snap.data() };
  if (row.kind !== CAPITAL_KINDS.expense) {
    throw new Error("Chỉ xóa được dòng chi tiêu vốn");
  }
  if (row.source === "inventory_receive") {
    throw new Error(
      "Dòng nhập hàng từ quỹ đầu tư — không xóa trên sổ vốn (tồn đã cộng). Dùng kiểm kho / đảo nhập nếu cần."
    );
  }

  const shopFundIds = await findLinkedShopFundTxIds(row);
  const xdFundIds = await findLinkedConstructionFundTxIds(row);

  if ((row.toShopFund || row.shopFundTxId) && shopFundIds.length === 0) {
    throw new Error(
      "Dòng này đánh dấu đã nạp quỹ cửa hàng nhưng không tìm thấy giao dịch nạp. Vào Quỹ / Chi tiêu → xóa thủ công khoản nạp tương ứng, rồi thử lại."
    );
  }
  if (
    (row.toConstructionFund || row.constructionFundTxId) &&
    xdFundIds.length === 0
  ) {
    throw new Error(
      "Dòng này đánh dấu đã chuyển quỹ xây dựng nhưng không tìm thấy giao dịch. Xóa cặp chuyển trên màn Xây dựng, rồi thử lại."
    );
  }

  const batch = writeBatch(db);
  for (const fundId of [...new Set([...shopFundIds, ...xdFundIds])]) {
    batch.delete(doc(db, "transactions", fundId));
  }
  batch.delete(capitalRef);
  await batch.commit();

  return {
    id: entryId,
    removedFundTxIds: shopFundIds,
    removedConstructionTxIds: xdFundIds,
    removedFundTxId: shopFundIds[0] || null,
  };
}

/**
 * Đánh dấu dòng chi vốn đã gắn giao dịch nạp quỹ cửa hàng.
 */
export async function markCapitalExpenseLinkedToFund(
  entryId,
  shopFundTxId,
  role
) {
  if (!canManageShareholderCapital(role)) {
    throw new Error("Chỉ tài khoản quản trị được chuyển quỹ");
  }
  if (!entryId) throw new Error("Thiếu dòng chi tiêu");
  await updateDoc(doc(db, CAPITAL_COLLECTION, entryId), {
    toShopFund: true,
    shopFundTxId: shopFundTxId || null,
    convertedToFundAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Gắn ngược capitalEntryId trên giao dịch quỹ (để xóa/sửa tìm được chắc)
  if (shopFundTxId) {
    const fundRef = doc(db, "transactions", shopFundTxId);
    const fundSnap = await getDoc(fundRef);
    if (fundSnap.exists()) {
      await updateDoc(fundRef, {
        capitalEntryId: entryId,
        source: "capital_to_shop",
        updatedAt: serverTimestamp(),
      });
    }
  }
}

/**
 * Áp dụng sửa sổ vốn ↔ quỹ theo preview (gắn lại ID + xóa nạp quỹ mồ côi).
 * Chỉ Super Admin. Xóa orphan = trừ quỹ về đúng thực tế sau khi đã xóa vốn trước đó.
 */
export async function applyCapitalFundRepair({ preview, role }) {
  if (!canManageShareholderCapital(role)) {
    throw new Error("Chỉ tài khoản quản trị được sửa sổ lệch");
  }
  if (!preview || preview.totalIssues <= 0) {
    return { linkedShop: 0, linkedXd: 0, deletedOrphans: 0 };
  }

  const batch = writeBatch(db);
  let ops = 0;
  let linkedShop = 0;
  let linkedXd = 0;
  let deletedOrphans = 0;

  for (const row of preview.linkShop || []) {
    batch.update(doc(db, CAPITAL_COLLECTION, row.capitalId), {
      shopFundTxId: row.fundTxId,
      toShopFund: true,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "transactions", row.fundTxId), {
      capitalEntryId: row.capitalId,
      source: "capital_to_shop",
      updatedAt: serverTimestamp(),
    });
    linkedShop += 1;
    ops += 2;
  }

  for (const row of preview.linkXd || []) {
    batch.update(doc(db, CAPITAL_COLLECTION, row.capitalId), {
      constructionFundTxId: row.fundTxId,
      toConstructionFund: true,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "transactions", row.fundTxId), {
      capitalEntryId: row.capitalId,
      source: "transfer_capital_to_xd",
      updatedAt: serverTimestamp(),
    });
    linkedXd += 1;
    ops += 2;
  }

  for (const row of preview.orphanShopFund || []) {
    batch.delete(doc(db, "transactions", row.fundTxId));
    deletedOrphans += 1;
    ops += 1;
  }
  for (const row of preview.orphanXdFund || []) {
    batch.delete(doc(db, "transactions", row.fundTxId));
    deletedOrphans += 1;
    ops += 1;
  }

  // Cờ gãy: bỏ đánh dấu đã nạp (vốn còn, quỹ không còn / không khớp)
  for (const row of preview.brokenShopFlag || []) {
    batch.update(doc(db, CAPITAL_COLLECTION, row.capitalId), {
      toShopFund: false,
      shopFundTxId: null,
      updatedAt: serverTimestamp(),
    });
    ops += 1;
  }
  for (const row of preview.brokenXdFlag || []) {
    batch.update(doc(db, CAPITAL_COLLECTION, row.capitalId), {
      toConstructionFund: false,
      constructionFundTxId: null,
      updatedAt: serverTimestamp(),
    });
    ops += 1;
  }

  if (ops > 0) await batch.commit();
  return {
    linkedShop,
    linkedXd,
    deletedOrphans,
    clearedBrokenFlags:
      (preview.brokenShopFlag?.length || 0) +
      (preview.brokenXdFlag?.length || 0),
  };
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
