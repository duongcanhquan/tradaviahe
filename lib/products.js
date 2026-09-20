import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";
import { normalizeUnitsForSave } from "./packaging.js";
import {
  RECIPE_PHASE,
  normalizeRecipePhase,
  normalizeRecipe,
  filterRecipeByPhase,
  computeRecipeCost,
} from "./recipe.js";

export const PRODUCT_KIND = {
  INGREDIENT: "ingredient",
  FINISHED: "finished",
};

export const COST_MODE = {
  MANUAL: "manual",
  RECIPE: "recipe",
};

/** RECIPE_PHASE.BATCH chỉ còn để đọc CT cũ */
export { RECIPE_PHASE };
export {
  normalizeRecipePhase,
  normalizeRecipe,
  filterRecipeByPhase,
  computeRecipeCost,
};

export { PRODUCT_UNITS } from "./units.js";

/** Seed: nguyên liệu + thành phẩm có công thức */
export const DEFAULT_CATALOG = [
  {
    name: "Trà khô",
    kind: PRODUCT_KIND.INGREDIENT,
    unit: "g",
    price: 0,
    cost: 2,
    costMode: COST_MODE.MANUAL,
    inStock: 5000,
    recipe: [],
    active: true,
  },
  {
    name: "Đường",
    kind: PRODUCT_KIND.INGREDIENT,
    unit: "g",
    price: 0,
    cost: 0.5,
    costMode: COST_MODE.MANUAL,
    inStock: 10000,
    recipe: [],
    active: true,
  },
  {
    name: "Ly nhựa",
    kind: PRODUCT_KIND.INGREDIENT,
    unit: "cái",
    price: 0,
    cost: 500,
    costMode: COST_MODE.MANUAL,
    inStock: 500,
    recipe: [],
    active: true,
  },
  {
    name: "Trứng",
    kind: PRODUCT_KIND.INGREDIENT,
    unit: "quả",
    price: 0,
    cost: 3000,
    costMode: COST_MODE.MANUAL,
    inStock: 0,
    recipe: [],
    active: true,
  },
  {
    name: "Chanh",
    kind: PRODUCT_KIND.INGREDIENT,
    unit: "quả",
    price: 0,
    cost: 2000,
    costMode: COST_MODE.MANUAL,
    inStock: 0,
    recipe: [],
    active: true,
  },
  {
    name: "Đá",
    kind: PRODUCT_KIND.INGREDIENT,
    unit: "g",
    price: 0,
    cost: 0.1,
    costMode: COST_MODE.MANUAL,
    inStock: 20000,
    recipe: [],
    active: true,
  },
  {
    name: "Nước ngọt (nhập)",
    kind: PRODUCT_KIND.INGREDIENT,
    unit: "chai",
    price: 0,
    cost: 8000,
    costMode: COST_MODE.MANUAL,
    inStock: 100,
    recipe: [],
    active: true,
  },
  {
    name: "Nước lọc",
    kind: PRODUCT_KIND.INGREDIENT,
    unit: "l",
    price: 0,
    cost: 500,
    costMode: COST_MODE.MANUAL,
    inStock: 100,
    recipe: [],
    active: true,
  },
];

/** Cost 1 suất = tổng dòng CT (kho + ước tay). CT cũ phase=batch đã chia / suất. */
export function resolveUnitCost(product, productsById = {}) {
  if (!product) return 0;
  if (
    product.kind === PRODUCT_KIND.FINISHED &&
    product.costMode === COST_MODE.RECIPE
  ) {
    return computeRecipeCost(product.recipe, productsById, null, {
      estimatedServings: product.estimatedServings,
    });
  }
  return Number(product.cost) || 0;
}

export function marginOf(product, productsById = {}) {
  const price = Number(product?.price) || 0;
  const cost = resolveUnitCost(product, productsById);
  return price - cost;
}

/** Chi tiết cost để UI tính toán công thức */
export function summarizeRecipeCosts(product, productsById = {}) {
  const lines = normalizeRecipe(product?.recipe, productsById, {
    estimatedServings: product?.estimatedServings,
  });
  const unitCost = computeRecipeCost(product?.recipe, productsById, null, {
    estimatedServings: product?.estimatedServings,
  });
  const price = Number(product?.price) || 0;
  return {
    lines,
    unitCost,
    margin: price - unitCost,
  };
}

export function isSellable(product) {
  if (!product) return false;
  if (product.active === false) return false;
  return product.kind !== PRODUCT_KIND.INGREDIENT;
}

export function productsByIdMap(products) {
  return Object.fromEntries((products || []).map((p) => [p.id, p]));
}

export function subscribeProducts(callback, onError) {
  return subscribeCollection(
    "products",
    (rows) => {
      callback(
        [...rows].sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), "vi")
        )
      );
    },
    onError
  );
}

function basePayload(data) {
  const kind =
    data.kind === PRODUCT_KIND.INGREDIENT
      ? PRODUCT_KIND.INGREDIENT
      : PRODUCT_KIND.FINISHED;
  const costMode =
    kind === PRODUCT_KIND.INGREDIENT
      ? COST_MODE.MANUAL
      : data.costMode === COST_MODE.RECIPE
        ? COST_MODE.RECIPE
        : COST_MODE.MANUAL;
  const recipe =
    costMode === COST_MODE.RECIPE
      ? normalizeRecipe(data.recipe, data._productsById || {}, {
          estimatedServings: data.estimatedServings,
          convertBatch: true,
        })
      : [];

  return {
    name: String(data.name || "").trim(),
    kind,
    unit: String(data.unit || "cái").trim() || "cái",
    price: kind === PRODUCT_KIND.INGREDIENT ? 0 : Number(data.price) || 0,
    cost:
      costMode === COST_MODE.RECIPE
        ? 0 // sẽ ghi đè bằng resolveUnitCost khi save nếu cần
        : Number(data.cost) || 0,
    costMode,
    recipe,
    groupId: data.groupId ? String(data.groupId) : null,
    sortOrder:
      data.sortOrder === undefined || data.sortOrder === null
        ? 9999
        : Number(data.sortOrder) || 0,
    active: data.active === false ? false : true,
    updatedAt: serverTimestamp(),
  };
}

/** Chỉ gắn inStock khi caller chủ động truyền (tránh ghi đè tồn lúc sửa giá/CT). */
export function withOptionalStock(payload, data) {
  if (Object.prototype.hasOwnProperty.call(data || {}, "inStock")) {
    return { ...payload, inStock: Number(data.inStock) || 0 };
  }
  return payload;
}

/** Thứ tự hiện trên POS — số nhỏ lên trước (món gọi nhiều đặt trên) */
export function comparePosOrder(a, b) {
  const sa = Number(a?.sortOrder);
  const sb = Number(b?.sortOrder);
  const aHas = Number.isFinite(sa);
  const bHas = Number.isFinite(sb);
  if (aHas && bHas && sa !== sb) return sa - sb;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  return String(a?.name || "").localeCompare(String(b?.name || ""), "vi");
}

export async function saveProductSortOrders(orderedIds = []) {
  if (!orderedIds.length) return;
  const batch = writeBatch(db);
  orderedIds.forEach((id, index) => {
    batch.update(doc(db, "products", id), {
      sortOrder: index,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

/** Đổi chỗ món trong danh sách đã sắp (↑ / ↓) rồi ghi sortOrder */
export async function moveProductInOrder(sortedList, productId, direction) {
  const list = [...sortedList];
  const idx = list.findIndex((p) => p.id === productId);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= list.length) return false;
  const tmp = list[idx];
  list[idx] = list[swap];
  list[swap] = tmp;
  await saveProductSortOrders(list.map((p) => p.id));
  return true;
}

function assertRecipePayload(payload) {
  if (payload.costMode !== COST_MODE.RECIPE) return;
  if (!payload.recipe?.length) {
    throw new Error("Công thức trống — thêm nguyên liệu kho hoặc dòng ước tay");
  }
}

function applyPackagingToPayload(payload, data, { isUpdate = false } = {}) {
  const patch = normalizeUnitsForSave({
    ...data,
    costMode: payload.costMode,
    unit: payload.unit,
    price: payload.price,
    cost: payload.cost,
  });

  if (patch.skip) {
    return payload;
  }

  if (patch.stripPackaging) {
    if (isUpdate) {
      return { ...payload, packaging: deleteField(), units: deleteField() };
    }
    return payload;
  }

  return {
    ...payload,
    packaging: patch.packaging,
    units: patch.units,
    unit: patch.unit,
    cost: patch.cost,
    price:
      payload.kind === PRODUCT_KIND.INGREDIENT ? payload.price : patch.price,
  };
}

export async function createProduct(data) {
  const isRecipe =
    data.kind !== PRODUCT_KIND.INGREDIENT &&
    data.costMode === COST_MODE.RECIPE;
  let payload = withOptionalStock(basePayload(data), {
    ...data,
    // Tạo mới: tồn 0 — cộng qua Nhập hàng. Món CT không bao giờ giữ tồn.
    inStock: isRecipe ? 0 : data.inStock ?? 0,
  });
  payload = applyPackagingToPayload(payload, data);
  if (!payload.name) throw new Error("Nhập tên");
  if (payload.kind === PRODUCT_KIND.FINISHED && payload.price < 0) {
    throw new Error("Giá bán không hợp lệ");
  }
  assertRecipePayload(payload);
  if (payload.costMode === COST_MODE.RECIPE) {
    payload.inStock = 0;
    // cost lưu ước / suất — caller nên truyền products map qua data._productsById
    const byId = data._productsById || {};
    payload.cost = resolveUnitCost(
      { ...payload, kind: PRODUCT_KIND.FINISHED },
      byId
    );
  }
  const ref = await addDoc(collection(db, "products"), {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProduct(id, data) {
  let payload = withOptionalStock(basePayload(data), data);
  payload = applyPackagingToPayload(payload, data, { isUpdate: true });
  if (!payload.name) throw new Error("Nhập tên");
  if (data.sortOrder === undefined || data.sortOrder === null) {
    delete payload.sortOrder;
  }
  assertRecipePayload(payload);
  if (payload.costMode === COST_MODE.RECIPE) {
    // Món CT không tồn — luôn ghi 0 để tránh “có hàng” ảo
    payload.inStock = 0;
    const byId = data._productsById || {};
    const hasStockLines = (payload.recipe || []).some(
      (line) => line.productId && !line.virtual
    );
    if (hasStockLines && !Object.keys(byId).length) {
      delete payload.cost;
    } else {
      payload.cost = resolveUnitCost(
        { ...payload, kind: PRODUCT_KIND.FINISHED },
        byId
      );
    }
  }
  await updateDoc(doc(db, "products", id), payload);
}

export async function deleteProduct(id) {
  await deleteDoc(doc(db, "products", id));
}

/**
 * Zero stock on all recipe POS dishes (ghost stock cleanup).
 * Returns number of products updated.
 */
export async function zeroRecipeProductStocks(products = []) {
  const { productUsesRecipe } = await import("./recipe.js");
  const batch = writeBatch(db);
  let n = 0;
  for (const p of products || []) {
    if (!p?.id || !productUsesRecipe(p)) continue;
    if ((Number(p.inStock) || 0) === 0) continue;
    batch.update(doc(db, "products", p.id), {
      inStock: 0,
      updatedAt: serverTimestamp(),
    });
    n += 1;
  }
  if (n > 0) await batch.commit();
  return n;
}

/**
 * Sau khi đổi giá nhập nguyên liệu / công thức:
 * tính lại cost mọi thành phẩm dùng mode recipe.
 */
export async function recomputeRecipeCosts(products) {
  const list =
    products ||
    (await getDocs(collection(db, "products"))).docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
  const byId = productsByIdMap(list);
  const batch = writeBatch(db);
  let n = 0;

  for (const p of list) {
    if (p.kind !== PRODUCT_KIND.FINISHED) continue;
    if (p.costMode !== COST_MODE.RECIPE) continue;
    const nextCost = resolveUnitCost(p, byId);
    if (Math.round(nextCost * 100) === Math.round((Number(p.cost) || 0) * 100)) {
      continue;
    }
    batch.update(doc(db, "products", p.id), {
      cost: nextCost,
      updatedAt: serverTimestamp(),
    });
    n += 1;
  }

  if (n > 0) await batch.commit();
  return n;
}

/** Seed catalog lần đầu: nhóm SP + nguyên liệu + thành phẩm */
export async function seedDefaultCatalog() {
  const existing = await getDocs(collection(db, "products"));
  if (!existing.empty) {
    throw new Error("Đã có sản phẩm — không seed lại");
  }

  const { ensureDefaultProductGroups } = await import("./productGroups");
  await ensureDefaultProductGroups();

  const ingredientIds = {};
  for (const row of DEFAULT_CATALOG) {
    const id = await createProduct(row);
    ingredientIds[row.name] = id;
  }

  const traDaRecipe = [
    { productId: ingredientIds["Trà khô"], qty: 3, unitId: "g" },
    { productId: ingredientIds["Nước lọc"], qty: 0.12, unitId: "l" },
    { productId: ingredientIds["Đường"], qty: 15, unitId: "g" },
    { productId: ingredientIds["Ly nhựa"], qty: 1, unitId: "cái" },
    { productId: ingredientIds["Đá"], qty: 100, unitId: "g" },
  ];
  const byIdPreview = Object.fromEntries(
    Object.entries(ingredientIds).map(([name, id]) => [
      id,
      DEFAULT_CATALOG.find((r) => r.name === name),
    ])
  );
  const traDaCost = resolveUnitCost(
    {
      kind: PRODUCT_KIND.FINISHED,
      costMode: COST_MODE.RECIPE,
      recipe: traDaRecipe,
    },
    byIdPreview
  );

  await createProduct({
    name: "Trà đá",
    kind: PRODUCT_KIND.FINISHED,
    unit: "ly",
    price: 5000,
    cost: traDaCost,
    costMode: COST_MODE.RECIPE,
    recipe: traDaRecipe,
    groupId: "drinks",
    inStock: 0,
    active: true,
    _productsById: byIdPreview,
  });

  await createProduct({
    name: "Nước ngọt",
    kind: PRODUCT_KIND.FINISHED,
    unit: "chai",
    price: 12000,
    cost: 8000,
    costMode: COST_MODE.MANUAL,
    recipe: [],
    groupId: "drinks",
    inStock: 40,
    active: true,
  });

  await createProduct({
    name: "Trà chanh",
    kind: PRODUCT_KIND.FINISHED,
    unit: "ly",
    price: 10000,
    cost: 3000,
    costMode: COST_MODE.MANUAL,
    recipe: [],
    groupId: "drinks",
    inStock: 50,
    active: true,
  });
}
