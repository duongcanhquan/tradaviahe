import {
  collection,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { actorFields } from "./audit";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";
import {
  COST_MODE,
  RECIPE_PHASE,
  filterRecipeByPhase,
  isSellable,
} from "./products";
import { stockDeltasForBatch } from "./stock";
import {
  inputValueToDateKey,
  todayInputValue,
  todayKey,
} from "./utils";

export const PRODUCTION_COLLECTION = "production_batches";

/**
 * Ghi mẻ pha: trừ NL phase=batch × số mẻ.
 * estimatedServings = tổng suất ước của lần ghi (vd 100 cốc / bình).
 */
export async function recordProductionBatch({
  product,
  batchCount = 1,
  estimatedServings = null,
  note = "",
  dateInput = null,
  user,
  profile,
}) {
  if (!product?.id) throw new Error("Chọn món bán");
  if (!isSellable(product)) throw new Error("Chỉ ghi mẻ cho món bán");
  if (product.costMode !== COST_MODE.RECIPE) {
    throw new Error("Món chưa có công thức — vào Món · giá để quy ước");
  }

  const batches = Math.max(1, Number(batchCount) || 1);
  const perBatch = Math.max(1, Number(product.estimatedServings) || 100);
  const servings = Math.max(
    1,
    Number(estimatedServings) || perBatch * batches
  );

  const batchLines = filterRecipeByPhase(product.recipe, RECIPE_PHASE.BATCH);
  if (!batchLines.length) {
    throw new Error(
      "Công thức chưa có NL mẻ (trà, nước pha…). Thêm ở Món · giá → nhóm “Pha mẻ”."
    );
  }

  const deltas = stockDeltasForBatch(product, batches);
  if (!Object.keys(deltas).length) {
    throw new Error("Không có NL pha để trừ — kiểm tra công thức mẻ");
  }

  const businessDate = dateInput
    ? inputValueToDateKey(dateInput)
    : todayKey();

  const write = writeBatch(db);
  const deductions = [];
  const shortages = [];

  for (const [productId, delta] of Object.entries(deltas)) {
    if (!delta) continue;
    const ref = doc(db, "products", productId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      throw new Error(
        "Nguyên liệu trong công thức mẻ đã bị xóa — sửa lại công thức"
      );
    }
    const data = snap.data();
    const need = Math.abs(delta);
    const stock = Number(data.inStock) || 0;
    if (stock + delta < -1e-9) {
      shortages.push(
        `${data.name || "NL"} (cần ${need} ${data.unit || ""}, tồn ${stock})`
      );
      continue;
    }
    write.update(ref, {
      inStock: increment(delta),
      updatedAt: serverTimestamp(),
    });
    deductions.push({
      productId,
      name: data.name || "",
      unit: data.unit || "",
      qty: need,
    });
  }

  if (shortages.length) {
    throw new Error(`Không đủ tồn NL pha: ${shortages.join("; ")}`);
  }
  if (!deductions.length) {
    throw new Error("Không trừ được kho — thử lại");
  }

  const logRef = doc(collection(db, PRODUCTION_COLLECTION));
  write.set(logRef, {
    productId: product.id,
    productName: product.name || "",
    batchCount: batches,
    estimatedServings: servings,
    servingsPerBatch: perBatch,
    businessDate,
    note: String(note || "").trim(),
    deductions,
    createdAt: serverTimestamp(),
    ...actorFields(user, profile),
  });

  await write.commit();
  return {
    id: logRef.id,
    batchCount: batches,
    estimatedServings: servings,
    deductions,
    businessDate,
  };
}

export function subscribeProductionBatches(callback, onError) {
  return subscribeCollection(
    PRODUCTION_COLLECTION,
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

export function defaultBatchDateInput() {
  return todayInputValue();
}
