import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";

export const PRODUCT_KIND = {
  INGREDIENT: "ingredient",
  FINISHED: "finished",
};

export const COST_MODE = {
  MANUAL: "manual",
  RECIPE: "recipe",
};

/** batch = trừ khi ghi mẻ pha; serve = trừ khi bán mỗi suất */
export const RECIPE_PHASE = {
  BATCH: "batch",
  SERVE: "serve",
};

export const PRODUCT_UNITS = [
  "ly",
  "chai",
  "lon",
  "gói",
  "túi",
  "kg",
  "g",
  "ml",
  "l",
  "cái",
  "quả",
];

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

export function normalizeRecipePhase(phase) {
  return phase === RECIPE_PHASE.BATCH
    ? RECIPE_PHASE.BATCH
    : RECIPE_PHASE.SERVE;
}

/**
 * Chuẩn hoá công thức. Dòng cũ không có phase → serve (trừ lúc bán).
 */
export function normalizeRecipe(recipe) {
  if (!Array.isArray(recipe)) return [];
  return recipe
    .map((line) => ({
      productId: String(line.productId || ""),
      qty: Number(line.qty) || 0,
      phase: normalizeRecipePhase(line.phase),
    }))
    .filter((line) => line.productId && line.qty > 0);
}

export function filterRecipeByPhase(recipe, phase) {
  const want = normalizeRecipePhase(phase);
  return normalizeRecipe(recipe).filter((line) => line.phase === want);
}

export function computeRecipeCost(recipe, productsById, phase = null) {
  const lines =
    phase == null
      ? normalizeRecipe(recipe)
      : filterRecipeByPhase(recipe, phase);
  return lines.reduce((sum, line) => {
    const ing = productsById[line.productId];
    const unitCost = Number(ing?.cost) || 0;
    return sum + unitCost * line.qty;
  }, 0);
}

/**
 * Cost / suất ước:
 * (cost NL mẻ ÷ số suất / mẻ) + cost NL kèm mỗi suất.
 */
export function resolveUnitCost(product, productsById = {}) {
  if (!product) return 0;
  if (
    product.kind === PRODUCT_KIND.FINISHED &&
    product.costMode === COST_MODE.RECIPE
  ) {
    const servings = Math.max(1, Number(product.estimatedServings) || 100);
    const batchCost = computeRecipeCost(
      product.recipe,
      productsById,
      RECIPE_PHASE.BATCH
    );
    const serveCost = computeRecipeCost(
      product.recipe,
      productsById,
      RECIPE_PHASE.SERVE
    );
    return batchCost / servings + serveCost;
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
  const servings = Math.max(1, Number(product?.estimatedServings) || 100);
  const batchLines = filterRecipeByPhase(product?.recipe, RECIPE_PHASE.BATCH);
  const serveLines = filterRecipeByPhase(product?.recipe, RECIPE_PHASE.SERVE);
  const batchCost = computeRecipeCost(
    product?.recipe,
    productsById,
    RECIPE_PHASE.BATCH
  );
  const serveCost = computeRecipeCost(
    product?.recipe,
    productsById,
    RECIPE_PHASE.SERVE
  );
  const batchPerServing = batchCost / servings;
  const unitCost = batchPerServing + serveCost;
  const price = Number(product?.price) || 0;
  return {
    servings,
    batchLines,
    serveLines,
    batchCost,
    serveCost,
    batchPerServing,
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
    costMode === COST_MODE.RECIPE ? normalizeRecipe(data.recipe) : [];
  const estimatedServings = Math.max(
    1,
    Number(data.estimatedServings) || 100
  );

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
    estimatedServings:
      kind === PRODUCT_KIND.FINISHED ? estimatedServings : null,
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
    throw new Error("Công thức trống — thêm NL pha mẻ và/hoặc NL kèm suất");
  }
}

export async function createProduct(data) {
  const payload = withOptionalStock(basePayload(data), {
    ...data,
    // Tạo mới: luôn có tồn (mặc định 0)
    inStock: data.inStock ?? 0,
  });
  if (!payload.name) throw new Error("Nhập tên");
  if (payload.kind === PRODUCT_KIND.FINISHED && payload.price < 0) {
    throw new Error("Giá bán không hợp lệ");
  }
  assertRecipePayload(payload);
  if (payload.costMode === COST_MODE.RECIPE) {
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
  const payload = withOptionalStock(basePayload(data), data);
  if (!payload.name) throw new Error("Nhập tên");
  if (data.sortOrder === undefined || data.sortOrder === null) {
    delete payload.sortOrder;
  }
  assertRecipePayload(payload);
  if (payload.costMode === COST_MODE.RECIPE) {
    const byId = data._productsById || {};
    payload.cost = resolveUnitCost(
      { ...payload, kind: PRODUCT_KIND.FINISHED },
      byId
    );
  }
  await updateDoc(doc(db, "products", id), payload);
}

export async function deleteProduct(id) {
  await deleteDoc(doc(db, "products", id));
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

  // Trà đá: mẻ (trà) + kèm khi bán (đường, ly, đá)
  const traDaRecipe = [
    {
      productId: ingredientIds["Trà khô"],
      qty: 300,
      phase: RECIPE_PHASE.BATCH,
    },
    {
      productId: ingredientIds["Nước lọc"],
      qty: 12,
      phase: RECIPE_PHASE.BATCH,
    },
    {
      productId: ingredientIds["Đường"],
      qty: 15,
      phase: RECIPE_PHASE.SERVE,
    },
    {
      productId: ingredientIds["Ly nhựa"],
      qty: 1,
      phase: RECIPE_PHASE.SERVE,
    },
    {
      productId: ingredientIds["Đá"],
      qty: 100,
      phase: RECIPE_PHASE.SERVE,
    },
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
      estimatedServings: 100,
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
    estimatedServings: 100,
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
