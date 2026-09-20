import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";
import {
  ACQUISITION,
  acquisitionLabel,
  investmentTypeLabel,
  isAssetInvestment,
  matchesAssetSearch,
  normalizeAcquisition,
  normalizeInvestmentType,
  summarizeAssets,
} from "./assetMeta.js";

export {
  ACQUISITION,
  acquisitionLabel,
  investmentTypeLabel,
  isAssetInvestment,
  matchesAssetSearch,
  normalizeAcquisition,
  normalizeInvestmentType,
  summarizeAssets,
};

/** cash = tiền đầu tư (chỉ Chủ ĐT/SA); equipment / goods = Quản lý được thấy */
export const INVESTMENT_TYPES = {
  cash: "cash",
  equipment: "equipment",
  goods: "goods",
};

/** Tiền đầu tư / vốn góp cash — Quản lý không xem */
export function isCapitalInvestment(row) {
  return normalizeInvestmentType(row?.type) === "cash";
}

export function filterInvestmentsForRole(investments, { canViewCapital }) {
  const list = Array.isArray(investments) ? investments : [];
  if (canViewCapital) return list;
  return list.filter(isAssetInvestment);
}

/**
 * Lưu một khoản vào collection investments.
 * type: cash | equipment | goods
 * acquisition: purchased | free (chỉ goods/equipment)
 */
export async function createInvestment({
  investorName,
  type,
  amount,
  equipmentName = "",
  note = "",
  isInitial = false,
  acquisition = ACQUISITION.purchased,
  capitalEntryId = null,
  createdBy = null,
  createdByName = "",
  createdByUsername = "",
  createdByRole = null,
}) {
  const normalizedType = normalizeInvestmentType(type);
  const isAsset =
    normalizedType === "equipment" || normalizedType === "goods";
  const acq = isAsset
    ? normalizeAcquisition(acquisition)
    : ACQUISITION.purchased;
  const value = Number(amount) || 0;
  if (isAsset && acq === ACQUISITION.purchased && value <= 0) {
    throw new Error("Thiết bị / hàng mua phải có giá trị > 0");
  }
  if (isAsset && acq === ACQUISITION.free && value < 0) {
    throw new Error("Giá trị không hợp lệ");
  }
  if (!isAsset && value <= 0) {
    throw new Error("Số tiền phải > 0");
  }

  const payload = {
    investorName: String(investorName || "").trim(),
    type: normalizedType,
    amount: acq === ACQUISITION.free ? 0 : value,
    equipmentName: isAsset ? String(equipmentName || "").trim() : "",
    isInitial: normalizedType === "cash" ? Boolean(isInitial) : false,
    acquisition: isAsset ? acq : null,
    date: serverTimestamp(),
    note: String(note || "").trim(),
    createdBy,
    createdByName,
    createdByUsername,
    createdByRole,
    createdAt: serverTimestamp(),
  };
  if (capitalEntryId) {
    payload.capitalEntryId = String(capitalEntryId);
  }

  const ref = await addDoc(collection(db, "investments"), payload);
  return ref.id;
}

export async function updateInvestment({
  id,
  investorName,
  type,
  amount,
  equipmentName = "",
  note = "",
  acquisition = ACQUISITION.purchased,
}) {
  if (!id) throw new Error("Thiếu mã tài sản");
  const normalizedType = normalizeInvestmentType(type);
  if (normalizedType === "cash") {
    throw new Error("Không sửa khoản tiền đầu tư tại đây");
  }
  const acq = normalizeAcquisition(acquisition);
  const value = Number(amount) || 0;
  if (acq === ACQUISITION.purchased && value <= 0) {
    throw new Error("Hàng mua phải có giá trị > 0");
  }

  await updateDoc(doc(db, "investments", id), {
    investorName: String(investorName || "").trim(),
    type: normalizedType,
    amount: acq === ACQUISITION.free ? 0 : value,
    equipmentName: String(equipmentName || "").trim(),
    acquisition: acq,
    note: String(note || "").trim(),
    updatedAt: serverTimestamp(),
  });
  return { id };
}

export function listCapitalInvestments(investments) {
  return (investments || []).filter(isCapitalInvestment);
}

export function summarizeInitialCapital(investments) {
  const initial = listCapitalInvestments(investments).filter(
    (row) => row.isInitial
  );
  const total = initial.reduce(
    (sum, row) => sum + (Number(row.amount) || 0),
    0
  );
  return { total, list: initial };
}

export function subscribeInvestments(callback, onError) {
  return subscribeCollection(
    "investments",
    (rows) => {
      const list = [...rows].sort((a, b) => {
        const ta = a.date?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const tb = b.date?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      });
      callback(list);
    },
    onError
  );
}

export function summarizeInvestments(investments, { capitalOnly = true } = {}) {
  const source = capitalOnly
    ? (investments || []).filter(isCapitalInvestment)
    : investments || [];

  const total = source.reduce(
    (sum, row) => sum + (Number(row.amount) || 0),
    0
  );

  const byInvestor = {};
  source.forEach((row) => {
    const name = row.investorName || "Không tên";
    byInvestor[name] = (byInvestor[name] || 0) + (Number(row.amount) || 0);
  });

  const shares = Object.entries(byInvestor)
    .map(([name, value]) => ({
      name,
      value,
      percent: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return { total, shares };
}
