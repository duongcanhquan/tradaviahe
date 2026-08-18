import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { subscribeCollection } from "./liveCollection";

/**
 * 4 nhóm mặc định trên POS — có thể thêm / sửa; xóa từ cấp Admin (Cổ đông / SA).
 */
export const DEFAULT_PRODUCT_GROUPS = [
  { id: "drinks", name: "Nước uống", sortOrder: 0, active: true },
  { id: "food", name: "Đồ ăn", sortOrder: 1, active: true },
  { id: "goods", name: "Đồ dùng", sortOrder: 2, active: true },
  { id: "service", name: "Dịch vụ", sortOrder: 3, active: true },
];

export const GROUPS_COLLECTION = "product_groups";

export function sortGroups(groups = []) {
  return [...groups].sort((a, b) => {
    const sa = Number(a.sortOrder) || 0;
    const sb = Number(b.sortOrder) || 0;
    if (sa !== sb) return sa - sb;
    return String(a.name || "").localeCompare(String(b.name || ""), "vi");
  });
}

export function subscribeProductGroups(callback, onError) {
  return subscribeCollection(
    GROUPS_COLLECTION,
    (rows) => callback(sortGroups(rows)),
    onError
  );
}

/** Tạo 4 nhóm mặc định nếu collection trống */
export async function ensureDefaultProductGroups() {
  const snap = await getDocs(collection(db, GROUPS_COLLECTION));
  if (!snap.empty) {
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  await Promise.all(
    DEFAULT_PRODUCT_GROUPS.map((g) =>
      setDoc(doc(db, GROUPS_COLLECTION, g.id), {
        name: g.name,
        sortOrder: g.sortOrder,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
  );
  return DEFAULT_PRODUCT_GROUPS.map((g) => ({ ...g }));
}

export async function createProductGroup({ name, sortOrder = 99 }) {
  const label = String(name || "").trim();
  if (!label) throw new Error("Nhập tên nhóm");
  const ref = await addDoc(collection(db, GROUPS_COLLECTION), {
    name: label,
    sortOrder: Number(sortOrder) || 99,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProductGroup(id, { name, sortOrder, active }) {
  if (!id) throw new Error("Thiếu nhóm");
  const payload = { updatedAt: serverTimestamp() };
  if (name !== undefined) {
    const label = String(name || "").trim();
    if (!label) throw new Error("Nhập tên nhóm");
    payload.name = label;
  }
  if (sortOrder !== undefined) payload.sortOrder = Number(sortOrder) || 0;
  if (active !== undefined) payload.active = Boolean(active);
  await updateDoc(doc(db, GROUPS_COLLECTION, id), payload);
}

/**
 * Xóa nhóm (Admin). Gỡ groupId khỏi sản phẩm đang gắn nhóm này.
 */
export async function deleteProductGroup(id, { products = [] } = {}) {
  if (!id) throw new Error("Thiếu nhóm");

  const batch = writeBatch(db);
  batch.delete(doc(db, GROUPS_COLLECTION, id));

  for (const p of products) {
    if (p.groupId === id) {
      batch.update(doc(db, "products", p.id), {
        groupId: null,
        updatedAt: serverTimestamp(),
      });
    }
  }

  await batch.commit();
}

export function groupsByIdMap(groups) {
  return Object.fromEntries((groups || []).map((g) => [g.id, g]));
}

export function filterProductsByGroup(products, groupId) {
  if (!groupId) {
    return products.filter((p) => !p.groupId);
  }
  return products.filter((p) => p.groupId === groupId);
}
