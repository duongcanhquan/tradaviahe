import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { todayKey } from "./utils";

/**
 * Tính doanh thu hệ thống theo tồn kho:
 * systemRevenue = Σ ((tồn đầu - tồn cuối) * đơn giá)
 */
export function calculateReconciliation({
  products,
  endStocks,
  startCash,
  endCashActual,
  bankingActual,
}) {
  let systemRevenue = 0;

  products.forEach((product) => {
    const startStock = Number(product.inStock) || 0;
    const endStock = Number(endStocks[product.id] ?? startStock) || 0;
    const sold = Math.max(0, startStock - endStock);
    systemRevenue += sold * (Number(product.price) || 0);
  });

  const cashDelta = (Number(endCashActual) || 0) - (Number(startCash) || 0);
  const discrepancy =
    cashDelta + (Number(bankingActual) || 0) - systemRevenue;

  return {
    systemRevenue,
    discrepancy,
  };
}

/**
 * Lưu báo cáo chốt ca + cập nhật tồn kho.
 * Hook sẵn sàng gọi webhook n8n sau này.
 */
export async function submitDailyReport({
  products,
  endStocks,
  startCash,
  endCashActual,
  bankingActual,
  systemRevenue,
  discrepancy,
  checkedBy,
  checkedByName = "",
  checkedByUsername = "",
  checkedByRole = null,
}) {
  const date = todayKey();

  const reportPayload = {
    date,
    startCash: Number(startCash) || 0,
    endCashActual: Number(endCashActual) || 0,
    bankingActual: Number(bankingActual) || 0,
    systemRevenue: Number(systemRevenue) || 0,
    discrepancy: Number(discrepancy) || 0,
    status: "đã chốt",
    checkedBy,
    checkedByName,
    checkedByUsername,
    checkedByRole,
    createdAt: serverTimestamp(),
  };

  const reportRef = await addDoc(collection(db, "daily_reports"), reportPayload);

  const batch = writeBatch(db);
  products.forEach((product) => {
    const endStock = Number(endStocks[product.id] ?? product.inStock) || 0;
    batch.update(doc(db, "products", product.id), { inStock: endStock });
  });
  await batch.commit();

  // Placeholder webhook n8n — gắn URL thật khi sẵn sàng
  await pushToN8nWebhook({
    ...reportPayload,
    id: reportRef.id,
    createdAt: new Date().toISOString(),
  });

  return reportRef.id;
}

async function pushToN8nWebhook(payload) {
  const webhookUrl = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn("n8n webhook failed:", error);
  }
}
