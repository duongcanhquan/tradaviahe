# Bản đồ vận hành: NL kho ↔ món bán ↔ nhập/xuất/cost

**Date:** 2026-09-13  
**Status:** Approved + implemented (bỏ pha mẻ, thêm ĐV dùng trên CT)  
**App:** TRADAVIAHE

---

## 1. Tổ chức dữ liệu (2 tầng, không trộn)

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│ NGUYÊN LIỆU (kho)           │         │ MÓN BÁN (POS)               │
│ kind = ingredient           │  công   │ kind = finished             │
│ Không hiện POS              │  thức   │ Hiện POS, có giá bán        │
│ Có tồn + giá nhập           │ ──────► │ Cost = Σ NL trong CT        │
│ Đường, sữa, mì gói, trứng   │         │ Mì tôm, mì 1 trứng, trà sữa │
└─────────────────────────────┘         └─────────────────────────────┘
```

| | Nguyên liệu | Món bán |
|--|--|--|
| Mục đích | Kiểm soát nhập + trừ kho + cost | Bán cho khách |
| Tồn | Có (đơn vị gốc nhỏ) | Recipe: **không** trừ chính món; trừ NL trong CT |
| Giá bán | Không | Có |
| Giá vốn | Từ lần nhập (chia về gốc) | Tự cộng từ công thức |
| Sửa / xóa | Có (cảnh báo nếu món đang dùng) | Có — đổi CT → cost đổi |

**Quy tắc cứng**

- POS **chỉ** `kind = finished` + `active`.
- Công thức **chỉ** gắn NL `ingredient` (hoặc dòng ảo đá/nước).
- Không bán “1 kg đường” trên POS trừ khi cố ý tạo thành phẩm riêng.

---

## 2. Đơn vị — đây là chỗ đang thiếu

Mọi số tồn / trừ kho / cost NL **luôn quy về đơn vị gốc nhỏ**.

| NL | Gốc (tồn) | Nhập (quy về gốc) | Dùng trong CT (quy về gốc) |
|----|-----------|-------------------|----------------------------|
| Đường, sữa bột | **g** | 1 kg = 1000g · 1 túi = N g · 1 lạng = 100g | 2 lạng → trừ 200g |
| Sữa tươi, nước | **ml** | 1 l = 1000ml · 1 hộp = N ml | 50ml → trừ 50ml |
| Mì tôm | **gói** | 1 thùng = 30 gói | 1 gói → trừ 1 gói |
| Trứng | **quả** | 1 vỉ = 10 quả | 1–2 quả |

`cost` trên NL = **đồng / 1 đơn vị gốc** (vd 25đ/g sau khi nhập túi 25.000đ / 1000g).

Công thức lưu:

```
qtyUse × factor(unitUse → gốc) = baseQty
cost dòng = baseQty × cost/gốc
trừ kho = baseQty
```

**Hiện tại:** CT chỉ có `qty`, hiểu là **đúng đơn vị gốc**. Ghi `2` khi Đường = kg → trừ 2kg. **Chưa có** đơn vị dùng (lạng/g) trên dòng CT.

---

## 3. Nhập (xuất quỹ, vào kho)

**Màn:** Nhập hàng. **Đối tượng chính:** nguyên liệu.

```
Chọn tên hàng → ĐV nhập (thùng / gói / chai)
  → nếu thùng: nhập số lẻ (1 thùng = N gói/chai)
  → giá / thùng → tự chia: cost gốc = tiền ÷ (SL × N)
  → tồn += SL × N (đơn vị nhỏ nhất)
  → gói/chai = ĐV gốc: bán lẻ POS hoặc gắn CT món khác
  → trừ quỹ = SL × giá thùng
```

Ví dụ: 1 túi đường 1kg × 25.000 → +1000g, quỹ −25.000, cost = 25đ/g.

**Giữ:** trừ quỹ quán (QL) / chọn quỹ vốn (Admin); preview chia giá; không FIFO.

**Thành phẩm nhập (AVIA, chai nước):** `kind=finished` + `costMode=manual` + kiện (1 thùng = 24 chai). Nhập/sửa tại kho. POS bán lẻ chai, trừ tồn chai.

**Món nấu/pha:** `kind=finished` + `costMode=recipe`. Không nhập món — nhập NL, CT trừ lúc bán.

---

## 4. Xuất (bán / pha)

### 4a. Bán POS — món có công thức

```
Bán 1 “Mì tôm 1 trứng”
  → thu = giá bán món
  → trừ kho: từng dòng CT (baseQty), bỏ dòng ảo
  → COGS snapshot = Σ cost dòng tại lúc bán
```

Mọi NL trong CT trừ lúc bán. **Không còn pha mẻ / ghi sổ pha.**

### 4b. Bán không công thức (chai nước mua sẵn)

Trừ chính SKU bán; cost = `product.cost` / sellCost đơn vị.

---

## 5. Tính toán (3 lens, không trộn)

| Tên | Công thức | Dùng để |
|-----|-----------|---------|
| **Quỹ / két** | Thu TM + nạp − chi (gồm nhập hàng) | Còn bao nhiêu tiền mặt. **Có thể âm** nếu chi/CK lệch |
| **Lãi gộp** | Doanh thu − COGS món bán | Lãi sau giá vốn NL đã dùng |
| **Cổ tức** | Thu − chi (như cũ) | Chưa đổi |

COGS 1 suất recipe:

```
Σ (baseQty_NL × cost_gốc_NL) + Σ (qty_ảo × cost_ước)
```

Nhập hàng **không** trừ lần nữa trong lãi gộp (đã nằm trong tồn → ra lúc bán).

---

## 6. Hệ thống đang chạy — giữ / bỏ / thêm

### Giữ (đúng, không đụng phá)

- `kind` ingredient vs finished + POS lọc `isSellable`
- Công thức 1 nhóm (trừ lúc bán) + dòng ảo đá/nước
- **Đã bỏ:** màn Pha mẻ, `lib/production`, NL mẻ ÷ suất
- Packaging 2 tầng trên **NL** (và thành phẩm mua sẵn, không recipe)
- Snapshot COGS lúc bán + ước bill cũ
- Dual lens Đối soát; cổ tức Lens 1
- Mảng xây dựng tách `businessLine`
- Chặn tồn âm khi bán

### Bỏ / không làm thêm (tránh rối)

- FIFO / trung bình gia quyền theo lô
- Packaging > 2 tầng (thùng→cây→bao→gói)
- Đổi cổ tức sang lãi COGS
- Bán nguyên liệu trên POS
- Tồn “ảo” cho đá/nước
- Bắt buộc mọi món ăn phải có pha mẻ (đã xóa hẳn tính năng này)

### Làm rõ / siết UX (không đổi model)

- Nhập hàng: mặc định lọc **Nguyên liệu**
- Món: 2 nút rõ “Thêm nguyên liệu kho” / “Thêm món bán”
- CT: hiện đơn vị gốc cạnh ô SL (`2 … [g]`)
- Toast khi **Từ kho** mà chưa có NL

### **Thêm (đợt này — chỗ bạn kẹt)**

1. **Đơn vị dùng trên dòng công thức**  
   `qty` + `unitId` (g / lạng / kg / gói…) → `baseQty`  
   Preview: `2 lạng = 200g · 5.000đ`

2. **Bảng quy đổi chuẩn** (ngoài packaging tùy biến)  
   - 1 kg = 1000g · 1 lạng = 100g  
   - 1 l = 1000ml  
   NL vẫn tự khai túi/thùng (1 túi = ? g)

3. **NL mới: gợi ý gốc g/ml** + bật nhiều ĐV nhập (kg, túi)

4. **List đơn vị** thêm `lạng`, `túi`, `thùng`, `vỉ`, `quả`, `bát`

5. (Tuỳ chọn) Recipe dòng chọn ĐV từ packaging của NL đó

### Không xóa collection / không migration phá

- Không xóa `products` / `transactions`
- CT cũ: `qty` không có `unitId` = **đơn vị gốc** (như hiện tại)
- Món/NL tạo sai loại: **sửa kind**, không xóa sổ quỹ

---

## 7. Ví dụ end-to-end (sau khi thêm)

**Kho**

1. Tạo NL **Đường** — gốc `g`; ĐV nhập: kg (×1000), túi (×1000 nếu túi 1kg).  
2. Tạo NL **Trứng** — gốc `quả`; vỉ ×10.  
3. Tạo NL **Mì tôm** — gốc `gói`; thùng ×30.  
4. Nhập 1 túi đường 25k → tồn 1000g, 25đ/g.  
5. Nhập 1 thùng mì 120k → tồn 30 gói, 4.000đ/gói.  
6. Nhập 30 trứng × giá → cost/quả.

**Món**

- Mì tôm: CT serve **1 gói mì**  
- Mì tôm 1 trứng: **1 gói mì + 1 trứng**  
- Trà sữa: **2 lạng đường** + sữa + (ảo) đá  

**Bán 1 trà sữa** (2 lạng đường, cost 25đ/g)

- Trừ 200g đường  
- COGS đường = 5.000 + sữa + đá  
- Quỹ + giá bán TM; tồn đường 800g  

---

## 8. Việc user làm tay trước/khi lên production

1. Tạo đủ NL (Đường, Sữa, Mì, Trứng…) — **không** để chúng là thành phẩm.  
2. Đổi NL đang để `kg` sang gốc `g` + packaging kg/túi (hoặc nhập lại).  
3. Gắn CT món bán bằng **Từ kho**.  
4. Không dùng **Ước tay** cho đường/sữa thật (sẽ không trừ kho).

---

## 9. Phạm vi code (khi được duyệt)

- `lib/units.js` — quy đổi chuẩn + `toIngredientBaseQty`  
- `lib/recipe.js` — lưu `unitId` / `baseQty` trên dòng kho  
- `lib/stock.js` — trừ `baseQty` NL  
- `lib/products.js` + UI Món — picker ĐV trên dòng CT + preview tiền  
- `lib/cogs.js` — `resolveUnitCost` dùng baseQty  
- Nhập hàng: default filter nguyên liệu  
- Tests: 2 lạng → 200g; cost; trừ kho  

Không đụng cổ tức, xây dựng, FIFO.
