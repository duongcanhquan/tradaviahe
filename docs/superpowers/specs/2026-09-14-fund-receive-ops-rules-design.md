# Quỹ cửa hàng ↔ Nhập hàng — Quy tắc vận hành

**Date:** 2026-09-14  
**Status:** Approved (user)  
**App:** Trà Đá / tradaviahe  
**Approach:** Siết rule trên path hiện có (`receiveInventoryPaid`, chi quỹ, xóa chi)

## Goal

1. **Quản lý** quản lý quỹ cửa hàng: nhập hàng = ghi nhận nhập + tự trừ quỹ; chi ngoài nhập hàng = trừ quỹ với hạng mục rõ.
2. **Superadmin** tra soát và xóa đơn chi sai → tiền về quỹ ngay.
3. Phiếu chi gắn **nhập hàng** không xóa mù trên sổ chi (rule C) — tránh tồn “ma”.
4. Tạo món mới không cộng tồn “chui”; có hàng phải qua Nhập hàng.
5. **Quản lý** nhập → chỉ quỹ cửa hàng; **Superadmin / Cổ đông (investor)** có thể trừ quỹ đầu tư.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Tạo món mới + tồn đầu | **B** — `inStock` bắt buộc 0; nhập qua màn Nhập hàng |
| 2 | Xóa chi `inventory_receive` | **C** — cấm xóa; hoàn tiền+tồn chỉ qua đảo phiếu nhập (phase sau nếu chưa có UI) |
| 3 | Xóa chi ngoài (lương, điện…) | Chỉ **superadmin**; xóa dòng expense = tiền về quỹ (sổ quỹ = tổng giao dịch) |
| 4 | Form chi tay category “Nhập hàng” | **Bỏ / cấm** — nhập hàng chỉ qua `receiveInventoryPaid` |
| 5 | Quỹ khi nhập | Manager → shop; Superadmin/Investor → shop **hoặc** capital (đã có `canChooseInventoryFundSource`) |

## Non-goals (phase này)

- Viết lại module “Phiếu nhập” riêng / ledger phiếu đầy đủ
- FIFO / WAC
- Đổi công thức cổ tức / P&L
- UI đảo phiếu nhập đầy đủ (có thể stub lỗi rõ + ticket phase 2)
- Sửa dữ liệu lịch sử hàng loạt (giữ backfill hiện có nếu còn)

---

## Current gaps (baseline)

| Gap | Hành vi hiện tại | Hệ quả |
|-----|------------------|--------|
| Thêm hàng kho kèm SL > 0 | `createProduct({ inStock })` không trừ quỹ | Hàng ↑ tiền không ↓ |
| Chi tay category “nhập hàng” | `recordShopExpense` default/cho phép | Tiền ↓ hàng không ↑ |
| `deleteShopFundEntry` | `canManageShop` (manager+) xóa mọi dòng | QL xóa được; xóa `inventory_receive` không hoàn tồn |
| Capital receive | Đã có path riêng | Giữ; không ghi expense shop (đúng thiết kế vốn) |

---

## Part 1 — Nhập hàng + quỹ

### Flow chuẩn

```
Nhập hàng (SL > 0, có giá)
  → receiveInventoryPaid({ fundSource })
       fundSource = "shop"     → +inStock + expense shop (category nhập hàng, source inventory_receive)
       fundSource = "capital"  → +inStock + chi sổ vốn (chỉ SA/investor)
```

- **Manager:** UI + API chỉ cho `fundSource: "shop"` (bắt buộc).
- **Superadmin / Investor:** picker quỹ cửa hàng | quỹ đầu tư (giữ `canChooseInventoryFundSource`).

### Tạo món mới (“Thêm hàng kho”)

- Payload tạo product: **`inStock` luôn 0** (bỏ / ignore ô tồn đầu nếu còn trên UI).
- Copy UI: hướng dẫn “Sau khi tạo, vào Nhập hàng để cộng tồn và trừ quỹ”.
- Backend: `createProduct` / wrapper save — nếu caller không phải superadmin chỉnh kho đặc biệt, clamp `inStock` về 0 khi create (defense in depth). Superadmin sửa tồn tay (nếu còn) giữ ngoài scope nhập hàng thường.

### Kiểm kho

- Giữ: chỉnh sổ tồn, **không** trừ quỹ (đã ghi chú UI). Không đổi phase này.

---

## Part 2 — Chi tiêu ngoài nhập hàng

### Form Quỹ / Chi tiêu (`app/manager/expenses`)

- Danh sách hạng mục chi tay **không gồm** `"nhập hàng"`.
- Default category: `"khác"` hoặc hạng mục vận hành đầu tiên không phải nhập hàng.
- `recordShopExpense`: **reject** nếu `category === "nhập hàng"` (trừ khi gọi nội bộ với flag/`source` đặc biệt — khuyến nghị: không cho path public nào ghi category này ngoài `receiveInventoryFromShopFund`).

### Phân biệt trên sổ

| source / category | Ý nghĩa |
|-------------------|---------|
| `source: inventory_receive` + category nhập hàng | Phiếu nhập (đủ cặp) |
| `source: shop_fund` + category ≠ nhập hàng | Chi ngoài |
| `source: inventory_backfill` | Bù lịch sử (giữ nếu còn) |

---

## Part 3 — Tra soát & xóa (Superadmin)

### Quyền xóa

- Đổi `deleteShopFundEntry(id, role)`:
  - Chỉ `role === "superadmin"`.
  - Nếu doc `source === "inventory_receive"` (hoặc tương đương nhận diện phiếu nhập): **throw** với message rõ: không xóa phiếu nhập trên sổ chi — dùng đảo nhập hàng.
  - Chi khác: `deleteDoc` → quỹ tăng lại vì số dư = fundIn − Σ expense.

### UI

- Nút xóa trên trang chi/quỹ: chỉ hiện với superadmin.
- Manager / investor: xem + lọc; không xóa.
- Toast/error khi cố xóa phiếu nhập.

### Đảo phiếu nhập (phase 2 — ghi trong spec, có thể chưa ship)

- Hàm `reverseInventoryReceive(txId)`: kiểm tra đủ tồn → −baseQty, xóa/đánh dấu void expense hoặc tạo bút toán hoàn; atomic batch.
- Phase 1: chỉ **cấm xóa** + copy hướng dẫn.

---

## Part 4 — Roles matrix

| Việc | Manager | Investor | Superadmin |
|------|---------|----------|------------|
| Nhập + trừ quỹ CH | Có | Có | Có |
| Nhập + trừ quỹ đầu tư | Không | Có | Có |
| Tạo món tồn đầu > 0 | Không | Không | Không (phase 1) |
| Chi tay (không phải nhập hàng) | Có | Có | Có |
| Xóa chi ngoài | Không | Không | Có |
| Xóa chi inventory_receive | Không | Không | Không (cấm; phase 2 đảo) |

---

## Error / edge cases

- Nhập SL > 0, giá ≤ 0 → reject (đã có).
- Manager gửi `fundSource: "capital"` → reject (`canChooseInventoryFundSource`).
- `recordShopExpense({ category: "nhập hàng" })` → reject.
- Xóa `inventory_receive` → reject.
- Non-superadmin gọi `deleteShopFundEntry` → reject.

---

## Files (expected touch)

| File | Change |
|------|--------|
| `lib/expenses.js` | Siết `recordShopExpense`, `deleteShopFundEntry`; giữ receive paths |
| `lib/roles.js` | Có thể thêm `canDeleteShopFundEntry` (= superadmin only) |
| `app/manager/expenses/page.js` | Bỏ category nhập hàng; nút xóa chỉ SA |
| `app/manager/inventory/page.js` | Tạo món inStock=0; copy hướng dẫn |
| `lib/products.js` (nếu cần) | Clamp inStock=0 on create |
| Tests | `lib/expenses` / packaging-adjacent unit nếu tách pure helpers |

---

## Success criteria

1. Manager không thể tạo lệch: tồn tăng mà không có phiếu nhập trừ quỹ (trừ kiểm kho).
2. Không còn chi tay gắn nhãn “Nhập hàng” làm nhiễu đối soát.
3. Chỉ Superadmin xóa chi ngoài; quỹ phản ánh đúng sau xóa.
4. Không ai xóa được dòng `inventory_receive` qua sổ chi.
5. SA/Investor vẫn chọn được quỹ đầu tư khi nhập.

## Spec self-review

- [x] Không còn placeholder TBD cho quyết định đã chốt
- [x] Không mâu thuẫn A/B quỹ vs rule xóa C
- [x] Scope phase 1 rõ; đảo phiếu = phase 2
- [x] Ánh xạ file cụ thể trong repo hiện tại
