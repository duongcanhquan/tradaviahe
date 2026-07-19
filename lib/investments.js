import {
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

/** cash = tiền đầu tư (chỉ Chủ ĐT/SA); equipment / goods = Quản lý được thấy */
export const INVESTMENT_TYPES = {
  cash: "cash",
  equipment: "equipment",
  goods: "goods",
};

export function normalizeInvestmentType(type) {
  if (type === "equipment" || type === "goods") return type;
  return "cash";
}

export function investmentTypeLabel(type) {
  if (type === "equipment") return "Thiết bị";
  if (type === "goods") return "Hàng hóa";
  return "Tiền đầu tư";
}

/** Khoản tài sản quán (hàng hóa / thiết bị) — Quản lý được xem */
export function isAssetInvestment(row) {
  const t = normalizeInvestmentType(row?.type);
  return t === "equipment" || t === "goods";
}

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
 */
export async function createInvestment({
  investorName,
  type,
  amount,
  equipmentName = "",
  note = "",
  createdBy = null,
}) {
  const normalizedType = normalizeInvestmentType(type);
  const payload = {
    investorName: String(investorName || "").trim(),
    type: normalizedType,
    amount: Number(amount) || 0,
    equipmentName:
      normalizedType === "equipment" || normalizedType === "goods"
        ? String(equipmentName || "").trim()
        : "",
    date: serverTimestamp(),
    note: String(note || "").trim(),
    createdBy,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "investments"), payload);
  return ref.id;
}

export function subscribeInvestments(callback, onError) {
  return onSnapshot(
    collection(db, "investments"),
    (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.date?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
          const tb = b.date?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
      callback(list);
    },
    onError
  );
}

/**
 * Tổng vốn + tỷ lệ cổ phần theo từng người.
 * Mặc định chỉ tính tiền đầu tư (cash) để chia cổ phần.
 */
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

/** Tổng giá trị hàng hóa + thiết bị */
export function summarizeAssets(investments) {
  const assets = (investments || []).filter(isAssetInvestment);
  const total = assets.reduce(
    (sum, row) => sum + (Number(row.amount) || 0),
    0
  );
  const goods = assets
    .filter((r) => normalizeInvestmentType(r.type) === "goods")
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const equipment = assets
    .filter((r) => normalizeInvestmentType(r.type) === "equipment")
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return { total, goods, equipment, list: assets };
}
