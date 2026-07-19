import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

export const PRODUCT_KIND = {
  INGREDIENT: "ingredient",
  FINISHED: "finished",
};

export const COST_MODE = {
  MANUAL: "manual",
  RECIPE: "recipe",
};

export const PRODUCT_UNITS = ["ly", "chai", "lon", "gói", "kg", "g", "ml", "l", "cái"];

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
  // Thành phẩm — recipe gắn sau khi có id nguyên liệu (seedCatalog xử lý)
];

export function normalizeRecipe(recipe) {
  if (!Array.isArray(recipe)) return [];
  return recipe
    .map((line) => ({
      productId: String(line.productId || ""),
      qty: Number(line.qty) || 0,
    }))
    .filter((line) => line.productId && line.qty > 0);
}

export function computeRecipeCost(recipe, productsById) {
  return normalizeRecipe(recipe).reduce((sum, line) => {
    const ing = productsById[line.productId];
    const unitCost = Number(ing?.cost) || 0;
    return sum + unitCost * line.qty;
  }, 0);
}

export function resolveUnitCost(product, productsById = {}) {
  if (!product) return 0;
  if (
    product.kind === PRODUCT_KIND.FINISHED &&
    product.costMode === COST_MODE.RECIPE
  ) {
    return computeRecipeCost(product.recipe, productsById);
  }
  return Number(product.cost) || 0;
}

export function marginOf(product, productsById = {}) {
  const price = Number(product?.price) || 0;
  const cost = resolveUnitCost(product, productsById);
  return price - cost;
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
  const q = query(collection(db, "products"), orderBy("name"));
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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

  return {
    name: String(data.name || "").trim(),
    kind,
    unit: String(data.unit || "cái").trim() || "cái",
    price: kind === PRODUCT_KIND.INGREDIENT ? 0 : Number(data.price) || 0,
    cost: Number(data.cost) || 0,
    costMode,
    recipe,
    inStock: Number(data.inStock) || 0,
    active: data.active === false ? false : true,
    updatedAt: serverTimestamp(),
  };
}

export async function createProduct(data) {
  const payload = basePayload(data);
  if (!payload.name) throw new Error("Nhập tên");
  if (payload.kind === PRODUCT_KIND.FINISHED && payload.price < 0) {
    throw new Error("Giá bán không hợp lệ");
  }
  const ref = await addDoc(collection(db, "products"), {
    ...payload,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProduct(id, data) {
  const payload = basePayload(data);
  if (!payload.name) throw new Error("Nhập tên");
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
    (await getDocs(query(collection(db, "products"), orderBy("name")))).docs.map(
      (d) => ({ id: d.id, ...d.data() })
    );
  const byId = productsByIdMap(list);
  const batch = writeBatch(db);
  let n = 0;

  for (const p of list) {
    if (p.kind !== PRODUCT_KIND.FINISHED) continue;
    if (p.costMode !== COST_MODE.RECIPE) continue;
    const nextCost = computeRecipeCost(p.recipe, byId);
    if (Math.round(nextCost) === Math.round(Number(p.cost) || 0)) continue;
    batch.update(doc(db, "products", p.id), {
      cost: nextCost,
      updatedAt: serverTimestamp(),
    });
    n += 1;
  }

  if (n > 0) await batch.commit();
  return n;
}

/** Seed catalog lần đầu: nguyên liệu + trà đá (công thức) + nước ngọt (giá nhập tay) */
export async function seedDefaultCatalog() {
  const existing = await getDocs(collection(db, "products"));
  if (!existing.empty) {
    throw new Error("Đã có sản phẩm — không seed lại");
  }

  const ingredientIds = {};
  for (const row of DEFAULT_CATALOG) {
    const id = await createProduct(row);
    ingredientIds[row.name] = id;
  }

  // Trà đá: công thức từ nhiều nguyên liệu
  const traDaRecipe = [
    { productId: ingredientIds["Trà khô"], qty: 3 },
    { productId: ingredientIds["Đường"], qty: 15 },
    { productId: ingredientIds["Ly nhựa"], qty: 1 },
    { productId: ingredientIds["Đá"], qty: 100 },
  ];
  const byIdPreview = Object.fromEntries(
    Object.entries(ingredientIds).map(([name, id]) => [
      id,
      DEFAULT_CATALOG.find((r) => r.name === name),
    ])
  );
  const traDaCost = computeRecipeCost(traDaRecipe, byIdPreview);

  await createProduct({
    name: "Trà đá",
    kind: PRODUCT_KIND.FINISHED,
    unit: "ly",
    price: 5000,
    cost: traDaCost,
    costMode: COST_MODE.RECIPE,
    recipe: traDaRecipe,
    inStock: 100,
    active: true,
  });

  // Nước ngọt bán lại: giá nhập = cost manual, giá bán riêng
  await createProduct({
    name: "Nước ngọt",
    kind: PRODUCT_KIND.FINISHED,
    unit: "chai",
    price: 12000,
    cost: 8000,
    costMode: COST_MODE.MANUAL,
    recipe: [],
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
    inStock: 50,
    active: true,
  });
}
