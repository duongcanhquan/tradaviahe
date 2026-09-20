/** Metadata tài sản / thiết bị — pure (không Firebase). */

export const ACQUISITION = {
  purchased: "purchased",
  free: "free",
};

export function normalizeInvestmentType(type) {
  if (type === "equipment" || type === "goods") return type;
  return "cash";
}

export function normalizeAcquisition(raw) {
  return String(raw || "").trim() === ACQUISITION.free
    ? ACQUISITION.free
    : ACQUISITION.purchased;
}

export function acquisitionLabel(raw) {
  return normalizeAcquisition(raw) === ACQUISITION.free
    ? "Miễn phí / CĐT cho"
    : "Mua";
}

export function investmentTypeLabel(type) {
  if (type === "equipment") return "Thiết bị";
  if (type === "goods") return "Hàng hóa";
  return "Tiền đầu tư";
}

export function isAssetInvestment(row) {
  const t = normalizeInvestmentType(row?.type);
  return t === "equipment" || t === "goods";
}

export function matchesAssetSearch(row, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!q) return true;
  const hay = [
    row?.equipmentName,
    row?.investorName,
    row?.note,
    investmentTypeLabel(row?.type),
    acquisitionLabel(row?.acquisition),
    String(row?.amount ?? ""),
    row?.createdByName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

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
  const freeCount = assets.filter(
    (r) => normalizeAcquisition(r.acquisition) === ACQUISITION.free
  ).length;
  const purchasedCount = assets.length - freeCount;
  return {
    total,
    goods,
    equipment,
    freeCount,
    purchasedCount,
    list: assets,
  };
}
