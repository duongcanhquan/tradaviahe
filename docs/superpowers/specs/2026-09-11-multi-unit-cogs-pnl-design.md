# Đơn vị lồng nhau + Lãi/lỗ đúng (COGS) — Design Spec

**Date:** 2026-09-11  
**Status:** Approved (user)  
**App:** TRADAVIAHE  
**Approach:** Phương án 1 — một SKU, tồn theo đơn vị gốc, nhiều đơn vị bán/nhập

## Goal

1. Nhập/bán đúng với hàng có **đơn vị lồng nhau** (vd thuốc: cây ↔ bao), giá bán & giá vốn **riêng từng đơn vị bán**, tồn kho **không lệch**.
2. Hiện **hai góc nhìn**: **Thu − chi (tiền)** và **Lãi kinh doanh (COGS lúc bán)**.
3. Cổ tức tháng **tạm giữ theo Thu − chi** cho đến khi quen số lãi mới.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Mô hình SKU | **Một món** + nhiều đơn vị bán/nhập |
| Tồn kho | Luôn theo **đơn vị gốc** (vd `bao`) |
| Bán 1 cây (1 cây = 10 bao) | Trừ **10 bao** trên cùng kho gốc |
| Giá bán cây vs bao | **Khác nhau**, nhập tay từng đơn vị |
| Giá vốn (cost) cây vs bao | **Nhập tay riêng** (không bắt buộc = hệ số × cost gốc) |
| Nhập hàng | Chủ yếu **theo cây**; vẫn cho chọn **bao** khi nhập lẻ |
| Snapshot COGS | Mỗi lần bán POS ghi `unitCost` / `lineCogs` / `cogsTotal` |
| UI báo cáo | Hiện **cả hai** lens |
| Cơ sở cổ tức | **Thu − chi** (giữ như hiện tại) cho đến khi user đổi |

## Non-goals (phase 1)

- Không FIFO/weighted-average phức tạp trên từng lần nhập (cost bán = số đã cấu hình trên đơn vị bán tại lúc bán)
- Không đổi cổ tức sang lãi kinh doanh trong phase 1
- Không multi-level sâu hơn 2 tầng (gốc + các đơn vị bán/nhập quy về gốc) — đủ cây/bao; mở rộng sau nếu cần thùng→cây→bao
- Không áp đơn vị lồng cho món recipe trà đá nếu chưa bật `packaging` (món cũ giữ 1 đơn vị như hiện tại)
- Không gộp mảng xây dựng vào P&L quán

---

## Example (locked)

```
Món: Thuốc X
Đơn vị gốc: bao
1 cây = 10 bao

Nhập 2 cây × 200.000đ/cây
  → tồn +20 bao
  → quỹ −400.000đ (nhập hàng)

Bán 1 bao · giá bán 25.000 · cost bán 18.000
  → tồn −1 bao
  → thu +25.000 · COGS 18.000 · lãi gộp dòng 7.000

Bán 1 cây · giá bán 220.000 · cost bán 180.000
  → tồn −10 bao
  → thu +220.000 · COGS 180.000 · lãi gộp dòng 40.000
```

Giá vốn cây **không** tự = 10 × cost bao; user tự nhập. Hệ số 10 **chỉ** dùng trừ/cộng tồn.

---

## Product data model

### Legacy (không đổi hành vi)

Món chưa có `packaging` / `sellUnits`:

- `unit`, `price`, `cost`, `inStock` như hiện tại
- 1 đơn vị bán = 1 đơn vị tồn

### Packaging-enabled product

```js
{
  // …fields hiện có
  unit: "bao",              // đơn vị gốc tồn (base)
  inStock: 20,              // luôn theo base
  // cost/price top-level: giữ tương thích = đơn vị gốc (bao)
  price: 25000,
  cost: 18000,

  packaging: {
    enabled: true,
    baseUnit: "bao",
    // optional display helpers
  },

  /**
   * Đơn vị bán / nhập quy về gốc.
   * factor = số đơn vị gốc cho 1 đơn vị này.
   */
  units: [
    {
      id: "bao",
      label: "bao",
      factor: 1,
      sellPrice: 25000,
      sellCost: 18000,      // COGS khi bán theo đơn vị này
      canSell: true,
      canReceive: true,
    },
    {
      id: "cay",
      label: "cây",
      factor: 10,
      sellPrice: 220000,
      sellCost: 180000,
      canSell: true,
      canReceive: true,     // nhập chủ yếu theo cây
    },
  ],
}
```

**Rules**

- Phải có đúng một unit `factor === 1` trùng `baseUnit` / `unit`.
- `factor` nguyên dương ≥ 1.
- POS chỉ hiện unit `canSell`.
- Nhập hàng hiện unit `canReceive` (mặc định cây + bao).
- Món `costMode === recipe`: phase 1 **không** bật packaging (tránh đụng batch/serve). Packaging cho hàng bán theo kiện (đồ ăn đóng gói, thuốc, nước thùng…).

---

## Stock math

```
baseQtyDelta = sellOrReceiveQty × factor × direction
```

- Bán `qty` đơn vị U: `inStock -= qty * U.factor`
- Nhập `qty` đơn vị U: `inStock += qty * U.factor`
- Chặn bán nếu `inStock < qty * factor` (trừ khi policy cho phép âm — mặc định **không**)

`stockAdjustments` trên transaction vẫn theo **productId → delta base qty**.

---

## Sale / COGS snapshot

Trong `recordPosSale` / serialize items, mỗi dòng lưu:

```js
{
  productId, name, qty,
  unitId,          // "bao" | "cay"
  unitLabel,       // "bao" | "cây"
  unitFactor,      // 1 | 10
  baseQty,         // qty * factor
  unitPrice,       // sellPrice của unit lúc bán
  unitCost,        // sellCost snapshot
  lineRevenue: qty * unitPrice,
  lineCogs: qty * unitCost,
}
```

Transaction:

```js
{
  amount: sum(lineRevenue),
  cogsTotal: sum(lineCogs),
  cogsStatus: "snapshotted", // | "unknown" | "estimated"
  items: [...],
  stockAdjustments: { [productId]: -baseQtySum },
  businessLine: "shop",
  source: "pos",
  …
}
```

**banking_by_date** (không có dòng món): `cogsTotal = 0`, `cogsStatus = "unknown"` — UI cảnh báo không đủ để tính lãi gộp đầy đủ.

**Xóa bill:** xóa tx → mất revenue + COGS khỏi tổng; hoàn tồn theo `stockAdjustments` (đã có).

---

## Receive (nhập hàng)

Form nhập:

1. Chọn món  
2. Chọn đơn vị nhập (mặc định ưu tiên unit `factor > 1` nếu có, vd cây)  
3. Số lượng + **đơn giá nhập lần này** (tiền trả NCC)  
4. TM/CK / quỹ như flow hiện tại  

```
fundAmount = qty * unitReceivePrice
baseQty  = qty * factor
inStock += baseQty
```

**Không** tự ghi đè `sellCost` / `sellPrice` trừ khi user bật “cập nhật giá vốn bán theo đơn vị này” (optional toggle, mặc định **tắt** trong phase 1 để tôn trọng cost bán nhập tay riêng).

Chi quỹ: giữ `category: "nhập hàng"`, `source: "inventory_receive"`, thêm metadata `unitId`, `unitFactor`, `baseQty`, `unitReceivePrice`.

---

## Two reporting lenses

### Lens 1 — Thu − chi (tiền) — giữ nguyên cổ tức

```
goodsIncome − shopOperatingExpenses (kể cả nhập hàng)
```

Nhãn UI: **Thu − chi**  
Dùng cho: quỹ, đối soát tiền, **cổ tức tháng (phase 1)**.

### Lens 2 — Lãi kinh doanh (COGS)

```
Revenue     = Σ isGoodsIncome (shop)
COGS        = Σ cogsTotal (tx có cogsStatus snapshotted|estimated)
GrossMargin = Revenue − COGS
Opex        = shop operating expenses EXCLUDING nhập hàng / transfer_* / construction
OperatingProfit = GrossMargin − Opex
```

Nhãn UI: **Lãi kinh doanh** (hoặc **Lãi sau giá vốn**)  
Không đổi `% cổ phần`; chưa đẩy vào `calculateMonthlyReport` dividend base.

### Dashboard

Trong kỳ (Ngày / Tuần / Tháng / khoảng ngày):

| Thẻ | Lens |
|-----|------|
| Doanh thu · TM · CK | chung |
| Thu − chi | Lens 1 |
| COGS · Lãi gộp · Lãi kinh doanh | Lens 2 |
| Chi nhập hàng (trong kỳ) | thông tin phụ (đã nằm trong Lens 1) |

### Monthly

- Giữ block cổ tức theo Lens 1.  
- Thêm block phụ: Lãi gộp / Lãi kinh doanh (Lens 2) — “tham khảo, chưa chia cổ tức”.

---

## UI changes (phase 1)

1. **Món** — nếu bật “Nhiều đơn vị”: form units (label, factor, sellPrice, sellCost, canSell, canReceive).  
2. **POS** — sau chọn món packaging: chọn đơn vị bán (mặc định unit factor=1 hoặc unit hay dùng). Giá theo unit.  
3. **Nhập hàng** — chọn đơn vị nhập; preview “= N đơn vị gốc”.  
4. **Đối soát / Tháng** — dual lens như trên.  
5. **Kho** — hiện tồn gốc + gợi ý quy đổi (vd `20 bao ≈ 2 cây`).

---

## Edge cases

| Case | Behavior |
|------|----------|
| Cost cây ≠ 10× cost bao | Cho phép; lãi/gộp theo snapshot sellCost |
| Đổi factor sau khi đã bán | Factor mới chỉ áp dụng giao dịch mới; lịch sử giữ `unitFactor` đã snapshot |
| Đổi sellCost sau bán | Không sửa bill cũ (đã snapshot) |
| Thiếu sellCost (0) | Vẫn bán; `lineCogs=0`; có thể badge “thiếu giá vốn” |
| Tồn không đủ baseQty | Chặn bán / cảnh báo |
| Món recipe + packaging | Không cho bật đồng thời phase 1 |
| Construction | Ngoài scope P&L quán |
| Backfill bill cũ | Ước lượng từ `items` + cost hiện tại → `cogsStatus: "estimated"` (optional phase 1.1) |

---

## Implementation phases

### Phase 1 (core)

1. Data model `units` + helpers convert base qty  
2. POS chọn unit + snapshot COGS  
3. Nhập hàng chọn unit  
4. Dashboard + monthly dual lens  
5. Cổ tức vẫn Lens 1  

### Phase 1.1 (optional)

- Backfill `cogsTotal` estimated  
- Toggle “cập nhật sellCost khi nhập”  
- Báo cáo lệch tồn quy đổi  

### Phase 2 (sau khi user quen)

- Cho phép chuyển cơ sở cổ tức sang Lens 2 (cấu hình)

---

## Success criteria

1. Nhập 2 cây → tồn +20 bao; quỹ trừ đúng tiền nhập.  
2. Bán 1 bao / 1 cây → trừ đúng base; thu đúng giá bán unit; COGS đúng sellCost unit đã snapshot.  
3. Đối soát ngày hiện được Thu − chi **và** Lãi kinh doanh, số không “trừ nhập hàng hai lần” ở Lens 2.  
4. Cổ tức tháng không đổi hành vi so với trước khi ship.  
5. Món không packaging / recipe trà đá hoạt động như cũ.

---

## Open points (mặc định nếu user không phản đối)

- Làm tròn tiền VND: `Math.round` từng dòng.  
- Mặc định đơn vị bán trên POS: unit `factor === 1`.  
- Mặc định đơn vị nhập: unit `canReceive` có `factor` lớn nhất (vd cây).  
