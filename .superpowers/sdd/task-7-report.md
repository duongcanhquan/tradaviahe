Task 7 completed: dashboard now shows both cash-flow and PnL lenses side by side.

Changed:
- `app/dashboard/page.js`: added `periodPnl = summarizeShopPnl(periodTx)` and switched the summary cards to use the new PnL helper.
- Kept the existing `Thu − chi` card, and added `COGS`, `Lãi gộp`, and `Lãi kinh doanh` cards.
- Added the note: `Lãi kinh doanh không trừ tiền nhập hàng (đã nằm trong tồn).`

Verification:
- `npm run build` ✅
