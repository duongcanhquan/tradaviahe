/**
 * Khớp & preview sửa sổ vốn ↔ quỹ (dữ liệu cũ lệch sau xóa/sửa).
 * Pure — không Firebase.
 */

/**
 * Khớp ứng viên nạp quỹ với dòng chi vốn (dữ liệu cũ thiếu id liên kết).
 */
export function matchFundInCandidates(entry, fundRows = []) {
  const amount = Number(entry?.amount) || 0;
  if (amount <= 0) return [];
  const dateKey = String(entry?.dateKey || "").trim();
  const note = String(entry?.note || "").trim();
  const matches = [];

  for (const row of fundRows || []) {
    if (!row?.id) continue;
    if (row.type && row.type !== "fund_in") continue;
    if (Number(row.amount) !== amount) continue;
    if (row.businessLine === "construction") continue;
    if (dateKey && row.businessDate && row.businessDate !== dateKey) continue;

    const source = String(row.source || "");
    const sameNote = note && String(row.note || "").trim() === note;
    if (sameNote || source === "capital_to_shop") {
      matches.push(row.id);
      continue;
    }
    if (
      (source === "shop_fund" || source === "transfer_capital_to_shop") &&
      dateKey &&
      row.businessDate === dateKey
    ) {
      matches.push(row.id);
    }
  }

  if (matches.length === 1) return matches;
  if (matches.length > 1 && note) {
    const exact = matches.filter((id) => {
      const row = fundRows.find((r) => r.id === id);
      return String(row?.note || "").trim() === note;
    });
    if (exact.length === 1) return exact;
  }
  return [];
}

/**
 * Khớp nạp quỹ xây dựng với chi vốn (vốn → XD).
 */
export function matchConstructionFundCandidates(entry, fundRows = []) {
  const amount = Number(entry?.amount) || 0;
  if (amount <= 0) return [];
  const dateKey = String(entry?.dateKey || "").trim();
  const note = String(entry?.note || "").trim();
  const matches = [];

  for (const row of fundRows || []) {
    if (!row?.id) continue;
    if (row.type && row.type !== "fund_in") continue;
    if (Number(row.amount) !== amount) continue;
    if (row.businessLine !== "construction") continue;
    if (dateKey && row.businessDate && row.businessDate !== dateKey) continue;

    const source = String(row.source || "");
    const sameNote = note && String(row.note || "").trim() === note;
    if (sameNote || source === "transfer_capital_to_xd") {
      matches.push(row.id);
      continue;
    }
    if (dateKey && row.businessDate === dateKey) {
      matches.push(row.id);
    }
  }

  if (matches.length === 1) return matches;
  if (matches.length > 1 && note) {
    const exact = matches.filter((id) => {
      const row = fundRows.find((r) => r.id === id);
      return String(row?.note || "").trim() === note;
    });
    if (exact.length === 1) return exact;
  }
  return [];
}

/**
 * Preview sửa lệch sổ:
 * - linkShop: chi vốn thiếu shopFundTxId nhưng khớp đúng 1 fund_in
 * - linkXd: chi vốn thiếu constructionFundTxId nhưng khớp 1 fund_in XD
 * - orphanShopFund: fund_in gắn vốn nhưng capital đã mất / id chết
 * - orphanXdFund: tương tự bên XD
 * - brokenShopFlag: toShopFund nhưng không khớp được fund
 * - brokenXdFlag: toConstructionFund nhưng không khớp
 */
export function previewCapitalFundRepair({
  capitalEntries = [],
  transactions = [],
} = {}) {
  const expenses = (capitalEntries || []).filter(
    (e) => e && e.kind === "expense" && e.id
  );
  const capitalById = new Map(expenses.map((e) => [e.id, e]));

  const shopFundIns = (transactions || []).filter(
    (t) =>
      t?.id &&
      t.type === "fund_in" &&
      t.businessLine !== "construction"
  );
  const xdFundIns = (transactions || []).filter(
    (t) =>
      t?.id &&
      t.type === "fund_in" &&
      t.businessLine === "construction"
  );

  const claimedShop = new Set();
  const claimedXd = new Set();
  for (const e of expenses) {
    if (e.shopFundTxId) claimedShop.add(String(e.shopFundTxId));
    if (e.constructionFundTxId) claimedXd.add(String(e.constructionFundTxId));
  }

  const linkShop = [];
  const linkXd = [];
  const brokenShopFlag = [];
  const brokenXdFlag = [];

  for (const entry of expenses) {
    const needsShop =
      (entry.toShopFund || entry.shopFundTxId) &&
      (!entry.shopFundTxId ||
        !shopFundIns.some((t) => t.id === entry.shopFundTxId));
    if (needsShop || (entry.toShopFund && !entry.shopFundTxId)) {
      const existingOk =
        entry.shopFundTxId &&
        shopFundIns.some((t) => t.id === entry.shopFundTxId);
      if (!existingOk) {
        const candidates = matchFundInCandidates(entry, shopFundIns).filter(
          (id) => !claimedShop.has(id)
        );
        if (candidates.length === 1) {
          linkShop.push({
            capitalId: entry.id,
            fundTxId: candidates[0],
            amount: Number(entry.amount) || 0,
            note: entry.note || "",
          });
          claimedShop.add(candidates[0]);
        } else if (entry.toShopFund || entry.shopFundTxId) {
          brokenShopFlag.push({
            capitalId: entry.id,
            amount: Number(entry.amount) || 0,
            note: entry.note || "",
            shopFundTxId: entry.shopFundTxId || null,
          });
        }
      }
    }

    const needsXd =
      (entry.toConstructionFund || entry.constructionFundTxId) &&
      (!entry.constructionFundTxId ||
        !xdFundIns.some((t) => t.id === entry.constructionFundTxId));
    if (needsXd || (entry.toConstructionFund && !entry.constructionFundTxId)) {
      const existingOk =
        entry.constructionFundTxId &&
        xdFundIns.some((t) => t.id === entry.constructionFundTxId);
      if (!existingOk) {
        const candidates = matchConstructionFundCandidates(
          entry,
          xdFundIns
        ).filter((id) => !claimedXd.has(id));
        if (candidates.length === 1) {
          linkXd.push({
            capitalId: entry.id,
            fundTxId: candidates[0],
            amount: Number(entry.amount) || 0,
            note: entry.note || "",
          });
          claimedXd.add(candidates[0]);
        } else if (entry.toConstructionFund || entry.constructionFundTxId) {
          brokenXdFlag.push({
            capitalId: entry.id,
            amount: Number(entry.amount) || 0,
            note: entry.note || "",
            constructionFundTxId: entry.constructionFundTxId || null,
          });
        }
      }
    }
  }

  const orphanShopFund = [];
  for (const t of shopFundIns) {
    const capitalId = String(t.capitalEntryId || "").trim();
    const fromCapital =
      t.source === "capital_to_shop" ||
      t.source === "transfer_capital_to_shop" ||
      Boolean(capitalId);
    if (!fromCapital) continue;
    if (capitalId && capitalById.has(capitalId)) continue;
    // fund claimed by capital.shopFundTxId?
    const claimedBy = expenses.find((e) => e.shopFundTxId === t.id);
    if (claimedBy) continue;
    orphanShopFund.push({
      fundTxId: t.id,
      amount: Number(t.amount) || 0,
      note: t.note || "",
      capitalEntryId: capitalId || null,
      businessDate: t.businessDate || null,
    });
  }

  const orphanXdFund = [];
  for (const t of xdFundIns) {
    if (t.source !== "transfer_capital_to_xd" && !t.capitalEntryId) continue;
    const capitalId = String(t.capitalEntryId || "").trim();
    if (capitalId && capitalById.has(capitalId)) continue;
    const claimedBy = expenses.find((e) => e.constructionFundTxId === t.id);
    if (claimedBy) continue;
    orphanXdFund.push({
      fundTxId: t.id,
      amount: Number(t.amount) || 0,
      note: t.note || "",
      capitalEntryId: capitalId || null,
      businessDate: t.businessDate || null,
    });
  }

  const autoFixable =
    linkShop.length + linkXd.length + orphanShopFund.length + orphanXdFund.length;
  const needsManual = brokenShopFlag.length + brokenXdFlag.length;

  return {
    linkShop,
    linkXd,
    orphanShopFund,
    orphanXdFund,
    brokenShopFlag,
    brokenXdFlag,
    autoFixable,
    needsManual,
    totalIssues: autoFixable + needsManual,
  };
}
