# Firestore quota savings — Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** Cắt reads Firestore realtime nặng trên Quỹ và Nhập hàng mà không đổi nghiệp vụ chính.

**Architecture:** Quỹ dùng **một** `subscribeTransactionsBetween` theo khoảng ngày (mặc định tháng hiện tại). Nhập hàng **không** listen toàn bộ `expense`; banner bù trừ chỉ `getDocs` khi user bấm kiểm tra, chỉ lấy phiếu `inventory_receive` / `inventory_backfill`. Lịch sử nhập theo món: capital filter theo `productId`.

**Tech Stack:** Next.js client, Firebase Firestore (`onSnapshot` / `getDocs`).

## Global Constraints

- Không đổi công thức WAC / trừ quỹ khi nhập.
- Không tải cả lịch sử `transactions` khi vào màn.
- Giữ shared listener trong `liveCollection.js`.

---

## Task 1: Helpers fetch + date listen window

- [ ] `lib/dateRange.js` — `listenWindowMs(from, to, { fallbackDays })`
- [ ] `lib/expenses.js` — `fetchInventoryFundExpensesOnce({ limitCount })`
- [ ] Test nhỏ cho listen window / filter source

## Task 2: Quỹ (`expenses/page.js`)

- [ ] Default khoảng = tháng hiện tại
- [ ] 1 listener `subscribeTransactionsBetween` thay 3 `subscribeWhere`
- [ ] Khi xóa filter ngày → fallback 90 ngày + hint UI

## Task 3: Nhập hàng (`inventory/page.js`)

- [ ] Bỏ listen all `type=expense`
- [ ] Banner bù trừ: idle → nút kiểm tra → one-shot fetch
- [ ] Capital history: `subscribeWhere(..., productId)` thay cả collection

## Task 4: Verify + ship

- [ ] `node --test lib/*.test.js`
- [ ] Commit / push / PR
