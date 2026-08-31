# Mảng xây dựng — Design Spec

**Date:** 2026-08-31  
**Status:** Approved (user)  
**App:** TRADAVIAHE (Trà đá + mở rộng mảng xây dựng)

## Goal

Tách **Mảng xây dựng** khỏi bán hàng trà đá: quỹ riêng, thu/chi riêng, tổng kết riêng, hồ sơ việc (hạng mục) có đủ trường quản lý. Tránh nhầm lẫn tên và số liệu với quán.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Approach | **A** — Quỹ Xây dựng song song (+ hồ sơ việc giai đoạn 2) |
| Product name in UI | **Mảng xây dựng** (không dùng từ “quán / POS / bán món”) |
| Thu **tiền mặt** dịch vụ XD | Vào **Quỹ xây dựng** |
| Thu **chuyển khoản** dịch vụ XD | Vào **số dư vốn CĐT** (cùng gốc với CK bán trà — một gốc quản lý) |
| Nạp / chuyển quỹ XD | Từ **sổ vốn CĐT** và/hoặc **quỹ cửa hàng** (và chiều ngược khi cần) |
| Doanh thu XD vs cổ tức trà | **Không** gộp vào `calculateMonthlyReport` / cổ tức quán (báo cáo XD riêng) |
| Chi “xây dựng” trên quỹ quán cũ | Giữ hạng mục quán nếu còn; mảng XD dùng sổ + category riêng, không trộn tổng kết |

## Non-goals (phase 1–2)

- Không làm POS kiểu “gọi món” cho xây dựng
- Không payroll nhân công chi tiết / chấm công
- Không gắn bắt buộc mọi dòng thu/chi vào việc ngay từ đầu (phase 3)
- Không đổi % cổ phần khi thu CK XD (chỉ cộng **số dư vốn**, giống CK bán hàng)

---

## Money model

### Three pots

```
┌─────────────────┐     transfer      ┌──────────────────┐
│ Số dư vốn CĐT   │◄──────────────────►│ Quỹ xây dựng     │
│ (góp − chi vốn  │                    │ (nạp + thu TM XD │
│  + CK bán + CK  │                    │  − chi XD)       │
│  dịch vụ XD)    │                    └────────▲─────────┘
└────────▲────────┘                             │
         │ transfer                             │ transfer
         └──────────────► Quỹ cửa hàng ◄────────┘
                          (TM bán trà + nạp − chi quán)
```

### Formulas

- **Quỹ xây dựng**  
  `balance = fundInXd + cashServiceIncomeXd − expenseXd`  
  - `fundInXd`: nạp/chuyển vào quỹ XD (từ vốn, từ quỹ quán, hoặc nạp tay có note)  
  - `cashServiceIncomeXd`: thu dịch vụ XD `paymentMethod === cash`  
  - `expenseXd`: chi thuộc sổ XD  

- **Số dư vốn CĐT** (giữ helper hiện tại, mở rộng nguồn CK)  
  `totalBalance = contributed − capitalExpenses + bankingGoodsIncome + bankingConstructionIncome`  
  - CK bán trà và CK dịch vụ XD cùng cộng số dư vốn  
  - `% cổ phần` vẫn chỉ theo vốn đã góp  

- **Quỹ cửa hàng** — không đổi công thức; chỉ thêm chiều chuyển sang/từ quỹ XD.

### Transfer rules

Mỗi lần chuyển tạo **cặp bút toán liên kết** (`transferGroupId`):

| Hướng | Bên trừ | Bên cộng |
|-------|---------|----------|
| Vốn → Quỹ XD | `shareholder_capital` expense (hoặc kind tương đương “chuyển quỹ XD”) | `fund_in` sổ XD |
| Quỹ quán → Quỹ XD | `expense` (hoặc type chuyển) sổ quán | `fund_in` sổ XD |
| Quỹ XD → Vốn / quán | đối xứng | đối xứng |

Ghi: số tiền, ngày nghiệp vụ, note, actor, `linkedIds`.

---

## Data model (Firestore)

### A. Ledger lines — reuse `transactions` with `businessLine`

Tránh collection mới cho quỹ nếu có thể; phân tách bằng field:

```js
businessLine: "shop" | "construction"  // shop = mặc định cho dữ liệu cũ
```

**Shop (hiện tại):**  
`type`: `income` | `expense` | `fund_in` — logic cũ; coi `businessLine` thiếu = `"shop"`.

**Construction fund / P&L lines:**

| type | Ý nghĩa | paymentMethod | Ảnh hưởng |
|------|---------|---------------|-----------|
| `fund_in` + line construction | Nạp/chuyển vào quỹ XD | cash/banking (metadata) | + quỹ XD |
| `expense` + line construction | Chi XD | — | − quỹ XD |
| `income` + line construction + category dịch vụ | Thu dịch vụ | `cash` → +quỹ XD; `banking` → +bankingConstructionIncome (vốn) | |

Filters:

- `isConstructionTx(t)` ↔ `t.businessLine === "construction"`
- `isGoodsIncome` **không** nhận income construction (tránh lẫn doanh thu trà)
- Helper mới: `isConstructionServiceIncome`, `sumConstructionIncomeByMethod`, `summarizeConstructionFund`

Optional fields on tx:

- `constructionJobId` — gắn việc (nullable, phase 3 ưu tiên dùng)
- `transferGroupId`, `transferDirection`
- `source`: `construction_pos` | `construction_fund` | `transfer_capital_to_xd` | …

### B. Jobs / hạng mục — collection `construction_jobs`

```js
{
  title: string,              // tên việc
  category: string,           // cho_thue_nhan_cong | xay_dung | sua_chua | khac
  clientName: string,         // chủ đầu tư / bên A (khách)
  contractAmount: number,     // số tiền HĐ
  expectedProfit: number,     // lãi ước
  actualProfit: number | null,// lãi thực (khi quyết toán)
  durationDays: number,       // số ngày (ước hoặc thực)
  startDate: string,          // yyyy-MM-dd hoặc dd/MM/yyyy — thống nhất input date
  endDate: string | null,
  status: "planned" | "active" | "done" | "settled",
  note: string,
  createdAt, updatedAt, ...actorFields
}
```

UI labels tiếng Việt rõ: **Hạng mục**, **Chủ đầu tư (khách)**, **Số tiền**, **Lãi**, **Số ngày**, **Thời gian thực hiện**, **Trạng thái**, **Ghi chú**.

---

## UI / IA

### Naming

- Hub: **Mảng xây dựng**
- Fund: **Quỹ xây dựng**
- Jobs: **Hạng mục / việc**
- Never reuse “Thu tiền / POS / Món đã bán” copy for this module

### Routes (proposed)

| Route | Role |
|-------|------|
| `/manager/construction` | Hub: số dư quỹ XD, việc đang làm, CTA |
| `/manager/construction/fund` | Quỹ: nạp/chuyển, thu, chi, sổ + date range + tổng kết kỳ |
| `/manager/construction/jobs` | Danh sách + form hạng mục |

Entry points:

- Cài đặt: nút **Mảng xây dựng**
- Đối soát (quick actions): **Mảng xây dựng**
- Bottom nav: không nhồi tab mới ngay — vào từ Cài đặt / Đối soát (tránh loạn với Pha mẻ). Owner có thể thêm sau nếu dùng nhiều.

### Fund screen summary (date range)

Khi lọc từ–đến:

- Thu TM kỳ  
- Thu CK kỳ (tham chiếu — tiền vào vốn, vẫn hiện để đối soát mảng)  
- Nạp/chuyển vào kỳ  
- Chi kỳ  
- Biến động quỹ XD kỳ (`TM + nạp − chi`)  
- (Tuỳ chọn) Lãi ước từ việc `settled`/`done` trong kỳ  

### Jobs screen

- List + filter status / date  
- Totals: tổng HĐ, tổng lãi ước, số việc active  
- Form đủ field đã chốt  

---

## Phasing

### Phase 1 — Quỹ & thu/chi & chuyển

1. `businessLine` + helpers summarize / filters  
2. UI Quỹ xây dựng (nạp từ vốn, từ quỹ quán, thu TM/CK, chi)  
3. CK income updates capital summary (`bankingIncome` mở rộng = goods CK + construction CK)  
4. Date range + period summary  
5. Isolation: không vào monthly tea dividend revenue  

### Phase 2 — Hạng mục / việc

1. CRUD `construction_jobs`  
2. Hub hiển thị việc đang làm + link quỹ  
3. Tổng kết việc (tiền, lãi, ngày)  

### Phase 3 — (Optional) Gắn sổ cái vào việc

- `constructionJobId` trên thu/chi  
- Lãi thực = thu gắn việc − chi gắn việc  

---

## Permissions

Cùng mức quản lý quỹ quán / vốn:

- **manager, investor, superadmin**: xem + ghi quỹ XD + việc  
- **employee**: không vào mảng (trừ khi sau này giao thu riêng)  

Reuse `canManageShop` / `canViewInvestmentCapital` tương ứng: chuyển từ vốn cần quyền vốn; chuyển từ quỹ quán cần quyền quỹ.

---

## Migration / backward compatibility

- Mọi `transactions` cũ không có `businessLine` → coi như `"shop"`  
- Hạng mục chi quán `"xây dựng"` cũ **không** tự migrate sang sổ XD (tránh nhảy số); user ghi mới trên mảng XD  
- Capital `summarizeShareholderCapital(entries, bankingTotal)` — caller truyền tổng CK = goods + construction  

---

## Success criteria

1. Số quỹ quán / vốn / XD đọc hiểu tách bạch trên UI  
2. Thu TM XD tăng quỹ XD; thu CK XD tăng số dư vốn, **không** tăng quỹ XD  
3. Chuyển vốn↔XD và quán↔XD không double-count  
4. Hồ sơ việc lưu đủ: CĐT, tiền, lãi, số ngày, thời gian, hạng mục, note, status  
5. Tổng kết mảng XD theo khoảng ngày độc lập với đối soát trà đá  

---

## Open items (none blocking)

- Bottom nav tab riêng: trì hoãn đến khi usage cao  
- Phase 3 gắn việc: làm sau khi phase 1–2 ổn  
