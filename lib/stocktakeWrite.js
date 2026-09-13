import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { canStocktake } from "./roles.js";
import { todayKey } from "./utils.js";
import {
  buildStocktakeLine,
  isStocktakeTarget,
  stocktakeLinesToApply,
  summarizeStocktake,
} from "./stocktake.js";

/**
 * Ghi tồn thực tế + phiếu kiểm. Không trừ/cộng quỹ.
 */
export async function commitStocktake({
  products = [],
  counts = {},
  note = "",
  user,
  profile,
} = {}) {
  const lines = (products || [])
    .filter(
      (p) =>
        p?.id &&
        isStocktakeTarget(p) &&
        Object.prototype.hasOwnProperty.call(counts, p.id)
    )
    .map((p) => {
      const line = buildStocktakeLine(p, counts[p.id]);
      if (line.skipped && counts[p.id] != null && String(counts[p.id]).trim() !== "") {
        throw new Error(`Số thực tế không hợp lệ: ${p.name || p.id}`);
      }
      return line;
    });
  const apply = stocktakeLinesToApply(lines);
  if (!canStocktake(profile?.role)) {
    throw new Error("Quản lý mới được kiểm kho");
  }
  if (!apply.length) {
    throw new Error("Chưa có lệch — nhập số thực tế khác sổ rồi lưu");
  }

  const summary = summarizeStocktake(lines);
  const batch = writeBatch(db);
  for (const line of apply) {
    batch.update(doc(db, "products", line.productId), {
      inStock: line.actual,
      updatedAt: serverTimestamp(),
    });
  }

  const rec = {
    createdAt: serverTimestamp(),
    businessDate: todayKey(),
    note: String(note || "").trim(),
    userId: user?.uid || "",
    userName:
      profile?.displayName ||
      profile?.name ||
      profile?.username ||
      "",
    lineCount: apply.length,
    counted: summary.counted,
    mismatch: summary.mismatch,
    surplusQty: summary.surplusQty,
    shortageQty: summary.shortageQty,
    surplusValue: summary.surplusValue,
    shortageValue: summary.shortageValue,
    netValue: summary.netValue,
    lines: apply,
    source: "stocktake",
  };

  const ref = doc(collection(db, "stocktakes"));
  batch.set(ref, rec);
  await batch.commit();
  return { id: ref.id, summary, lines: apply };
}
