Task 8 completed: monthly page now includes a Lens 2 reference PnL card without changing dividend logic.

Changed:
- `app/dashboard/monthly/page.js`: added `shopPnl = summarizeShopPnl(monthTx)` for the reference lens.
- Added the card `Tham khảo · Lãi kinh doanh (chưa chia cổ tức)` with `COGS`, `Lãi gộp`, and `Lãi kinh doanh`.
- Kept `calculateMonthlyReport` and the dividend block unchanged for Lens 1.

Verification:
- `npm run build` ✅
