# Nhập hàng chia giá + Công thức món / NL ảo — Design Spec

**Date:** 2026-09-13  
**Status:** Approved (user)  
**App:** TRADAVIAHE  
**Approach:** A — mở rộng trên nền 1 SKU + packaging 2 tầng + recipe hiện có

## Goal

1. **Nhập hàng:** cùng chủng loại, **giá nhập mỗi lần khác nhau**; khi nhập theo thùng/cây phải **chia ra đơn giá gốc** (vd 1 thùng 120k / 30 gói → 4.000đ/gói) và ghi nhận số lượng quy đổi trên phiếu.
2. **Món bán (ăn/uống):** giá vốn = **tổng cost nguyên liệu** trong công thức.
3. **NL kho:** trừ tồn khi bán (theo recipe serve / batch như hiện tại).
4. **NL ảo** (đá, nước sôi…): chỉ **cộng cost ước**, **không trừ kho**.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Giá vốn NL sau nhập | **Lần nhập mới nhất** (last purchase) cập nhật `product.cost` / `units[].sellCost` |
| Preview chia giá | Bắt buộc hiện trên form nhập: `SL × ĐV → +baseQty · đơn giá gốc · trừ quỹ` |
| NL ảo | Dòng recipe **không gắn productId kho**; có `name` + `unitCost` + `qty`; không trừ tồn |
| COGS lúc bán | Snapshot cost công thức tại lúc bán (gồm NL ảo) |
| FIFO / weighted average | **Không** làm trong đợt này |
| Packaging | Giữ **2 tầng** (gốc + đơn vị nhập/bán); không thùng→cây→bao sâu hơn |
| Cổ tức | Không đổi (vẫn Thu − chi) |
| Recipe + packaging | Giữ rule phase 1: món recipe **không** bật packaging |

## Non-goals

- FIFO / trung bình gia quyền theo lô
- Multi-level packaging > 2 tầng
- Đổi cơ sở cổ tức sang lãi COGS
- Tự tạo NL ảo thành SKU kho

---

## Example (locked)

### Nhập

```
NL: Mỳ tôm
Đơn vị gốc: gói
1 thùng = 30 gói

Nhập 1 thùng × 120.000đ/thùng
  → tồn +30 gói
  → quỹ −120.000đ
  → cost gốc (gói) = 120.000 / 30 = 4.000đ
  → cập nhật sellCost đơn vị gốc = 4.000
  → (tuỳ chọn) sellCost thùng = 120.000 nếu có đơn vị thùng
  → recomputeRecipeCosts() cho món dùng NL này
```

### Công thức món “Mỳ tôm trứng”

```
NL kho:  1 × Mỳ tôm (4.000) + 2 × Trứng (…cost trứng…)
NL ảo:   1 × Đá (ước 200đ) + 1 × Nước sôi (ước 100đ)

Cost / suất = Σ (qty × unitCost)
Bán 1 suất:
  → trừ kho: −1 mỳ, −2 trứng
  → không trừ đá/nước
  → COGS snapshot = cost công thức tại lúc bán
```

---

## Part 1 — Nhập hàng & chia giá

### UI (`/manager/inventory`)

Với mỗi dòng nhận hàng:

- Số lượng nhập (`receiveQty`)
- Đơn vị nhập (picker `canReceive`)
- **Giá nhập / ĐV đang chọn** (editable; prefill từ `sellCost` unit hoặc `product.cost × factor` nếu hợp lý)
- Preview (bắt buộc):

  ```
  {receiveQty} {unitLabel} × {unitReceivePrice}
  → +{baseQty} {baseUnit}
  → đơn giá gốc {baseUnitCost} đ/{baseUnit}
  → trừ quỹ {amount}
  ```

  Công thức:

  - `baseQty = receiveQty × factor`
  - `amount = receiveQty × unitReceivePrice`
  - `baseUnitCost = round(amount / baseQty)` khi `baseQty > 0`

### Persist (`receiveInventoryPaid` / expenses)

Khi `addQty > 0` và có giá:

1. Ghi giao dịch nhập như hiện tại (`unitReceivePrice`, `receiveQty`, `baseQty`, `unitFactor`, …).
2. Cộng tồn `+baseQty`.
3. Trừ quỹ `amount`.
4. **Luôn** cập nhật catalog cost theo lần nhập (không chỉ khi `factor === 1`):
   - `products.cost = baseUnitCost`
   - `units` factor=1: `sellCost = baseUnitCost`
   - unit vừa nhập (factor > 1): `sellCost = unitReceivePrice` (giá vốn theo ĐV đó)
5. Gọi `recomputeRecipeCosts()` sau khi cập nhật cost NL.

Khi chỉ sửa giá (không nhập SL): giữ hành vi cập nhật cost tay + recompute.

### Edge cases

- `baseQty = 0` → không chia cost, báo lỗi.
- `unitReceivePrice <= 0` khi có SL → báo lỗi (đã có).
- Món không packaging: `factor = 1`, `baseUnitCost = unitReceivePrice`.

---

## Part 2 — Công thức + NL ảo

### Recipe line model

Mở rộng dòng công thức:

```js
// NL kho (như hiện tại)
{ productId: "abc", qty: 1, phase: "serve" }

// NL ảo (mới)
{
  productId: "",           // hoặc null / omit
  virtual: true,
  name: "Đá",
  qty: 1,
  unitCost: 200,           // ước tay, đ
  phase: "serve" | "batch"
}
```

`normalizeRecipe`:

- Giữ dòng kho nếu `productId` + `qty > 0`
- Giữ dòng ảo nếu `virtual === true` && `name` trim && `qty > 0` && `unitCost >= 0`
- Phase mặc định `serve` như hiện tại

### `computeRecipeCost`

- Dòng kho: `qty × (productsById[id].cost || 0)`
- Dòng ảo: `qty × unitCost`
- `resolveUnitCost` / `summarizeRecipeCosts` / lưu `product.cost` khi save món: dùng hàm mới (không đổi công thức tổng)

### Stock (`stockDeltasForSaleItems` / batch)

- **Bỏ qua** mọi dòng `virtual === true` hoặc không có `productId`
- Chỉ trừ NL kho như hiện tại

### Sale COGS

- `buildSaleLineFromProduct` / `recordPosSale`: `unitCost` lấy `resolveUnitCost(product, productsById)` (đã gồm NL ảo) khi `costMode === recipe`
- Snapshot `lineCogs` / `cogsTotal` như hiện tại

### UI Món (`/manager/products`)

Với món `costMode === recipe`:

- Nút thêm dòng: **Từ kho** | **Ước tay (không trừ kho)**
- Dòng kho: chọn NL + qty + phase
- Dòng ảo: tên + qty + cost ước + phase; badge “Không trừ kho”
- Preview: từng dòng thành tiền + tổng cost / suất + biên lãi

---

## Files likely touched

| File | Change |
|------|--------|
| `lib/expenses.js` (hoặc receive helper) | Luôn cập nhật cost gốc + sellCost theo chia giá |
| `app/manager/inventory/page.js` | Preview chia giá; `updateCost` khi nhập mọi factor |
| `lib/products.js` | `normalizeRecipe`, `computeRecipeCost`, virtual lines |
| `lib/stock.js` | Bỏ qua virtual khi trừ kho |
| `lib/cogs.js` / `lib/sales.js` | Đảm bảo unitCost recipe dùng resolveUnitCost đầy đủ |
| `app/manager/products/page.js` | UI dòng ảo |
| Tests `packaging` / products / stock | Case chia giá + virtual không trừ kho |

## Acceptance

1. Nhập 1 thùng 120k, factor 30 → tồn +30, quỹ −120k, cost gói = 4000, preview đúng.
2. Nhập lại thùng giá khác → cost gói = giá mới / 30; món recipe dùng NL này đổi cost sau recompute.
3. Công thức có NL kho + NL ảo → tổng cost đúng; bán chỉ trừ NL kho.
4. Packaging / P&L / cổ tức không đổi hành vi ngoài cost catalog & recipe.

## Out of scope follow-ups

- FIFO / WAC
- Thùng → cây → bao
- NL ảo có “tồn ảo” tham khảo
