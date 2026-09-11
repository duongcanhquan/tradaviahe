# Task 4 Report: Products UI - units editor

**Date:** 2026-09-11  
**Branch:** `feature/multi-unit-cogs-pnl`  
**Status:** DONE

## Summary

`app/manager/products/page.js` now supports the multi-unit packaging editor: toggle, editable unit rows, payload wiring, and stock display with base-unit quantity hints.

## What changed

- Added the `Nhiều đơn vị (cây/bao…)` toggle and hid it while `costMode === recipe`.
- Added editable unit rows for `label`, `factor`, `sellPrice`, `sellCost`, `canSell`, `canReceive`, plus add/remove.
- Sent `packaging` and `units` on save; disabling the toggle sends `packaging: { enabled: false }` so the existing strip logic clears saved packaging fields.
- Updated list rows to show stock in base units and an approximate converted unit count when packaging is enabled.

## Verification

```
npm run build
```

- Build: PASS
- Lint: PASS

## Concerns

- No additional automated tests were added for the page UI; build validation was used for regression checking.

## Commit

`feat(products): UI cấu hình đơn vị bán/nhập`
