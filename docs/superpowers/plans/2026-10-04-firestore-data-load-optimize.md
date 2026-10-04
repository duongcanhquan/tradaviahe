# Firestore data-load optimize

**Goal:** Chỉ tải dữ liệu Firestore cần thiết theo màn / khoảng ngày — tránh listen cả lịch sử.

## Đã làm

| Màn / API | Trước | Sau |
|-----------|--------|-----|
| Quỹ cửa hàng | 3 listener chồng (all expense/fund_in/cash) | 1 `subscribeTransactionsBetween` (mặc định tháng; fallback 90 ngày) |
| Nhập hàng | Listen all `type=expense` | Bỏ; bù trừ one-shot `fetchInventoryFundExpensesOnce`; lịch sử món `productId` + limit 300 |
| Xây dựng | All `businessLine=construction` | `subscribeFieldBetween` theo ngày (mặc định tháng) |
| Vốn — thu CK | All `paymentMethod=banking` | 365 ngày gần nhất |
| Vốn — fund_in repair | All `type=fund_in` | 365 ngày gần nhất |
| Phiếu cổ đông | Cả collection `shareholder_receipts` | `where monthKey` + limit 500 |

## Giữ nguyên (collection nhỏ / cần đủ)

- `products`, `product_groups`, `users`, `investments`, `shareholder_capital_entries`, `construction_jobs`, settings doc

## Index mới

`firestore.indexes.json`: businessLine/type/paymentMethod/productId + timestamp; receipts monthKey + timestamp.

Deploy: `npm run firebase:indexes`
