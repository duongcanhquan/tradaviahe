import { doc, writeBatch } from "firebase/firestore";
import { db } from "./firebase";

/**
 * Cập nhật tồn kho sản phẩm (không còn chốt ca tiền mặt).
 */
export async function updateProductStocks({ products, endStocks }) {
  const batch = writeBatch(db);
  let updated = 0;

  products.forEach((product) => {
    if (endStocks[product.id] === undefined) return;
    const endStock = Math.max(0, Number(endStocks[product.id]) || 0);
    batch.update(doc(db, "products", product.id), { inStock: endStock });
    updated += 1;
  });

  if (updated > 0) {
    await batch.commit();
  }
  return updated;
}
