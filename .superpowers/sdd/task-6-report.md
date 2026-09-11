Task 6 completed: inventory receive now supports multi-unit input and converts received quantity back to base stock.

Changed:
- `lib/expenses.js`: receive flows accept `unitId`, resolve unit via packaging helpers, convert to `baseQty`, update `inStock` by base quantity, and store unit metadata on transactions.
- `app/manager/inventory/page.js`: added receive-unit selector, defaulting to `defaultReceiveUnit`, plus a preview like `= N {baseUnit}`.

Verification:
- `npm run build` ✅
- Lint check on touched files ✅

Notes:
- Sell cost is not auto-updated during receive.
