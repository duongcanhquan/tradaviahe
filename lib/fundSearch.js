/**
 * Tra cứu / phân loại sổ quỹ — pure helpers (không Firebase).
 */

export function normalizeExpenseCategoryLabel(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  const map = {
    "nhập nguyên liệu": "Nhập hàng",
    "nhập hàng": "Nhập hàng",
    "xây dựng": "Xây dựng",
    "thiết bị": "Thiết bị (ngoài CĐT)",
    "quan hệ": "Quan hệ",
    "chi phí đối ngoại": "Quan hệ",
    "trả lương": "Trả lương",
    khác: "Khác",
  };
  return map[key] || String(raw || "Khác");
}

export function isInventoryLikeExpense(row) {
  const source = String(row?.source || "");
  if (source === "inventory_receive" || source === "inventory_backfill") {
    return true;
  }
  return (
    String(row?.category || "")
      .trim()
      .toLowerCase() === "nhập hàng"
  );
}

export function isShopFundEditableRow(row) {
  if (!row?.id) return false;
  if (row.businessLine === "construction") return false;
  if (row.type !== "expense" && row.type !== "fund_in") return false;
  if (isInventoryLikeExpense(row)) return false;
  if (String(row.transferGroupId || "").trim()) return false;
  if (String(row.capitalEntryId || "").trim()) return false;
  const source = String(row.source || "");
  if (
    source === "capital_to_shop" ||
    source === "transfer_capital_to_shop" ||
    source.startsWith("transfer_")
  ) {
    return false;
  }
  return true;
}

export function shopFundSourceLabel(row) {
  if (!row) return "—";
  if (isInventoryLikeExpense(row)) return "Nhập hàng · quỹ cửa hàng";
  if (
    row.capitalEntryId ||
    row.source === "capital_to_shop" ||
    row.source === "transfer_capital_to_shop"
  ) {
    return "Từ sổ vốn CĐT";
  }
  if (String(row.transferGroupId || "").trim()) return "Chuyển quỹ";
  if (row.type === "fund_in") return "Nạp quỹ cửa hàng";
  return "Chi quỹ cửa hàng";
}

export function matchesFundSearch(row, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!q) return true;
  const hay = [
    row?.note,
    row?.productName,
    normalizeExpenseCategoryLabel(row?.category),
    row?.category,
    row?.createdByName,
    row?.createdByUsername,
    shopFundSourceLabel(row),
    row?.paymentMethod === "banking" ? "chuyển khoản ck" : "tiền mặt tm",
    row?.type === "fund_in" ? "nạp quỹ" : "chi tiêu",
    String(row?.amount ?? ""),
    String(row?.businessDate || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function matchesCapitalExpenseSearch(row, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!q) return true;
  const hay = [
    row?.note,
    row?.productName,
    row?.investorName,
    row?.createdByName,
    row?.kind === "expense" ? "chi vốn quỹ đầu tư" : row?.kind,
    row?.source === "inventory_receive" ? "nhập hàng" : "",
    String(row?.amount ?? ""),
    String(row?.dateKey || ""),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
