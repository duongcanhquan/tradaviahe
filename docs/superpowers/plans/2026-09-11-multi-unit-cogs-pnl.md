# Multi-unit packaging + COGS P&L Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một SKU với nhiều đơn vị bán/nhập (cây↔bao), trừ tồn theo đơn vị gốc, snapshot COGS lúc bán, và Đối soát hiện song song Thu−chi + Lãi kinh doanh (cổ tức vẫn theo Thu−chi).

**Architecture:** Pure helpers in `lib/packaging.js` + `lib/cogs.js` (no Firebase). POS/nhập gọi helpers rồi ghi Firestore. Dashboard/monthly cộng từ `cogsTotal` và tách opex khỏi `nhập hàng`. Legacy món không `packaging.enabled` giữ hành vi cũ.

**Tech Stack:** Next.js 14, React 18, Firebase Firestore, Node built-in test runner (`node --test`) cho pure helpers.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-11-multi-unit-cogs-pnl-design.md`
- Tồn luôn theo **base unit**; `factor` chỉ quy đổi tồn, **không** tự nhân cost
- `sellPrice` / `sellCost` nhập tay **riêng** từng unit
- Recipe (`costMode === recipe`) **không** bật packaging phase 1
- Construction / `businessLine === construction` không vào P&L quán
- Cổ tức tháng **không đổi** (vẫn Lens Thu−chi)
- VND: `Math.round` từng dòng tiền
- Không phá POS món không packaging
- Sau mỗi task: `npm run build` khi đụng app routes; commit rõ ràng
- Push production qua **cả `master` và `main`** khi user yêu cầu deploy

## File map

| File | Responsibility |
|------|----------------|
| Create `lib/packaging.js` | Normalize units, base qty, resolve sell/receive unit |
| Create `lib/cogs.js` | Line COGS + sale totals; accrual opex filter |
| Create `lib/packaging.test.js` | `node --test` for packaging/cogs |
| Modify `lib/stock.js` | Sale deltas use `baseQty`; serialize unit+cost fields |
| Modify `lib/sales.js` | Persist `cogsTotal` / `cogsStatus` |
| Modify `lib/products.js` | Persist `packaging` + `units`; block recipe+packaging |
| Modify `lib/expenses.js` | Receive by unitId → base qty + metadata |
| Modify `lib/receipts.js` or keep filters; add `lib/pnl.js` | Dual-lens period summary |
| Modify `app/manager/products/page.js` | Units editor UI |
| Modify `components/EmployeeDesk.js` | Unit picker on POS |
| Modify `app/manager/inventory/page.js` | Unit picker on nhập |
| Modify `app/dashboard/page.js` | Dual lens cards |
| Modify `app/dashboard/monthly/page.js` | Reference Lens 2 block |

---

### Task 1: Packaging + COGS pure helpers

**Files:**
- Create: `lib/packaging.js`
- Create: `lib/cogs.js`
- Create: `lib/packaging.test.js`

**Interfaces:**
- Produces:
  - `normalizeProductUnits(product) → { enabled, baseUnit, units[] }`
  - `getSellableUnits(product) → units[]`
  - `getReceivableUnits(product) → units[]`
  - `defaultSellUnit(product) → unit | null`
  - `defaultReceiveUnit(product) → unit | null` (largest factor among canReceive)
  - `findUnit(product, unitId) → unit | null`
  - `toBaseQty(qty, unit) → number`
  - `assertCanSellStock(product, unitId, qty) → void` (throws if insufficient)
  - `buildSaleLineFromProduct(product, { qty, unitId }) → line`
  - `sumSaleCogs(lines) → { cogsTotal, revenue, cogsStatus }`
  - `isAccrualShopOpex(row) → boolean` (shop opex excluding nhập hàng)

- [ ] **Step 1: Write `lib/packaging.js`**

```js
/** Multi-unit packaging helpers — no Firebase */

export function normalizeProductUnits(product) {
  const packaging = product?.packaging;
  const enabled = Boolean(packaging?.enabled);
  const baseUnit = String(
    packaging?.baseUnit || product?.unit || "cái"
  ).trim() || "cái";

  if (!enabled) {
    const legacy = {
      id: "base",
      label: baseUnit,
      factor: 1,
      sellPrice: Number(product?.price) || 0,
      sellCost: Number(product?.cost) || 0,
      canSell: true,
      canReceive: true,
    };
    return { enabled: false, baseUnit, units: [legacy] };
  }

  const raw = Array.isArray(product?.units) ? product.units : [];
  const units = raw
    .map((u) => ({
      id: String(u.id || u.label || "").trim(),
      label: String(u.label || u.id || "").trim() || "đv",
      factor: Math.max(1, Math.round(Number(u.factor) || 1)),
      sellPrice: Math.round(Number(u.sellPrice) || 0),
      sellCost: Math.round(Number(u.sellCost) || 0),
      canSell: u.canSell !== false,
      canReceive: u.canReceive !== false,
    }))
    .filter((u) => u.id);

  if (!units.some((u) => u.factor === 1)) {
    units.unshift({
      id: baseUnit,
      label: baseUnit,
      factor: 1,
      sellPrice: Math.round(Number(product?.price) || 0),
      sellCost: Math.round(Number(product?.cost) || 0),
      canSell: true,
      canReceive: true,
    });
  }

  return { enabled: true, baseUnit, units };
}

export function findUnit(product, unitId) {
  const { units } = normalizeProductUnits(product);
  if (!unitId) return units.find((u) => u.factor === 1) || units[0] || null;
  return units.find((u) => u.id === unitId) || null;
}

export function getSellableUnits(product) {
  return normalizeProductUnits(product).units.filter((u) => u.canSell);
}

export function getReceivableUnits(product) {
  return normalizeProductUnits(product).units.filter((u) => u.canReceive);
}

export function defaultSellUnit(product) {
  const units = getSellableUnits(product);
  return units.find((u) => u.factor === 1) || units[0] || null;
}

export function defaultReceiveUnit(product) {
  const units = getReceivableUnits(product);
  if (!units.length) return null;
  return [...units].sort((a, b) => b.factor - a.factor)[0];
}

export function toBaseQty(qty, unit) {
  const q = Number(qty) || 0;
  const f = Math.max(1, Number(unit?.factor) || 1);
  return q * f;
}

export function assertCanSellStock(product, unitId, qty) {
  const unit = findUnit(product, unitId);
  if (!unit) throw new Error("Đơn vị bán không hợp lệ");
  const need = toBaseQty(qty, unit);
  const have = Number(product?.inStock) || 0;
  if (need > have) {
    throw new Error(
      `Không đủ tồn (cần ${need} ${normalizeProductUnits(product).baseUnit}, còn ${have})`
    );
  }
}
```

- [ ] **Step 2: Write `lib/cogs.js`**

```js
import { COST_MODE } from "./products";
import {
  findUnit,
  normalizeProductUnits,
  toBaseQty,
} from "./packaging";
import { isShopOperatingExpense, isInventoryFundExpense } from "./expenses";

export function buildSaleLineFromProduct(product, { qty, unitId } = {}) {
  const q = Number(qty) || 0;
  if (!product?.id && !product?.productId) {
    throw new Error("Thiếu món");
  }
  if (q <= 0) throw new Error("Số lượng phải > 0");

  const unit = findUnit(product, unitId);
  if (!unit) throw new Error("Đơn vị bán không hợp lệ");

  const unitPrice = Math.round(Number(unit.sellPrice) || 0);
  const unitCost = Math.round(Number(unit.sellCost) || 0);
  const baseQty = toBaseQty(q, unit);

  return {
    productId: String(product.productId || product.id),
    name: String(product.name || ""),
    qty: q,
    unitId: unit.id,
    unitLabel: unit.label,
    unitFactor: unit.factor,
    baseQty,
    unitPrice,
    unitCost,
    lineRevenue: Math.round(q * unitPrice),
    lineCogs: Math.round(q * unitCost),
    costMode:
      product.costMode === COST_MODE.RECIPE ? COST_MODE.RECIPE : COST_MODE.MANUAL,
    recipe: product.recipe || [],
    estimatedServings: Math.max(1, Number(product.estimatedServings) || 100),
  };
}

export function sumSaleCogs(lines = []) {
  let cogsTotal = 0;
  let revenue = 0;
  let any = false;
  for (const line of lines) {
    any = true;
    cogsTotal += Math.round(Number(line.lineCogs) || 0);
    revenue += Math.round(
      Number(line.lineRevenue) ||
        (Number(line.qty) || 0) * (Number(line.unitPrice) || 0)
    );
  }
  return {
    cogsTotal,
    revenue,
    cogsStatus: any ? "snapshotted" : "unknown",
  };
}

/** Opex for Lens 2 — exclude inventory purchases */
export function isAccrualShopOpex(row) {
  if (!isShopOperatingExpense(row)) return false;
  if (isInventoryFundExpense(row)) return false;
  return true;
}

export function summarizeShopPnl(transactions = []) {
  let revenue = 0;
  let cogs = 0;
  let cashOpex = 0;
  let accrualOpex = 0;
  let inventoryPurchase = 0;

  for (const t of transactions) {
    if (t?.type === "income" && t.businessLine !== "construction") {
      const cat = String(t.category || "").toLowerCase();
      const source = String(t.source || "").toLowerCase();
      const isGoods =
        cat === "bán hàng" ||
        cat === "ban hang" ||
        cat === "pos" ||
        source === "pos" ||
        source === "banking_by_date";
      if (isGoods && t.businessLine !== "construction") {
        // prefer isGoodsIncome in callers; keep defensive here
      }
    }
  }

  // Prefer importing isGoodsIncome in real implementation:
  return { revenue, cogs, cashOpex, accrualOpex, inventoryPurchase };
}
```

Fix `summarizeShopPnl` properly in implementation — use `isGoodsIncome` from `receipts.js`:

```js
import { isGoodsIncome } from "./receipts";

export function summarizeShopPnl(transactions = []) {
  let revenue = 0;
  let cogs = 0;
  let cashOpex = 0;
  let accrualOpex = 0;
  let inventoryPurchase = 0;

  for (const t of transactions) {
    if (isGoodsIncome(t)) {
      revenue += Number(t.amount) || 0;
      cogs += Number(t.cogsTotal) || 0;
    }
    if (isShopOperatingExpense(t)) {
      const amt = Number(t.amount) || 0;
      cashOpex += amt;
      if (isInventoryFundExpense(t)) inventoryPurchase += amt;
      else accrualOpex += amt;
    }
  }

  const cashProfit = revenue - cashOpex;
  const grossMargin = revenue - cogs;
  const operatingProfit = grossMargin - accrualOpex;

  return {
    revenue,
    cogs,
    cashOpex,
    accrualOpex,
    inventoryPurchase,
    cashProfit,
    grossMargin,
    operatingProfit,
  };
}
```

Avoid circular imports: if `expenses` ↔ `cogs` cycles, put `isAccrualShopOpex` / `summarizeShopPnl` in new `lib/pnl.js` instead of `cogs.js`. **Preferred:** Create `lib/pnl.js` for report helpers; keep `cogs.js` only sale-line math.

Adjusted files for Task 1:
- `lib/packaging.js`
- `lib/cogs.js` — `buildSaleLineFromProduct`, `sumSaleCogs` only
- `lib/pnl.js` — `isAccrualShopOpex`, `summarizeShopPnl`

- [ ] **Step 3: Write tests `lib/packaging.test.js`**

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProductUnits,
  toBaseQty,
  defaultReceiveUnit,
  assertCanSellStock,
} from "./packaging.js";
import { buildSaleLineFromProduct, sumSaleCogs } from "./cogs.js";

const medicine = {
  id: "p1",
  name: "Thuốc X",
  unit: "bao",
  price: 25000,
  cost: 18000,
  inStock: 20,
  costMode: "manual",
  packaging: { enabled: true, baseUnit: "bao" },
  units: [
    {
      id: "bao",
      label: "bao",
      factor: 1,
      sellPrice: 25000,
      sellCost: 18000,
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
      canReceive: true,
    },
  ],
};

describe("packaging", () => {
  it("toBaseQty cây × 2 = 20 bao", () => {
    const u = normalizeProductUnits(medicine).units.find((x) => x.id === "cay");
    assert.equal(toBaseQty(2, u), 20);
  });

  it("defaultReceiveUnit prefers largest factor", () => {
    assert.equal(defaultReceiveUnit(medicine).id, "cay");
  });

  it("assertCanSellStock blocks oversell", () => {
    assert.throws(() => assertCanSellStock(medicine, "cay", 3));
  });
});

describe("cogs", () => {
  it("snapshots independent sellCost for cây", () => {
    const line = buildSaleLineFromProduct(medicine, { qty: 1, unitId: "cay" });
    assert.equal(line.baseQty, 10);
    assert.equal(line.unitPrice, 220000);
    assert.equal(line.unitCost, 180000);
    assert.equal(line.lineCogs, 180000);
  });

  it("sumSaleCogs", () => {
    const lines = [
      buildSaleLineFromProduct(medicine, { qty: 1, unitId: "bao" }),
      buildSaleLineFromProduct(medicine, { qty: 1, unitId: "cay" }),
    ];
    const s = sumSaleCogs(lines);
    assert.equal(s.cogsTotal, 18000 + 180000);
    assert.equal(s.revenue, 25000 + 220000);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
node --test lib/packaging.test.js
```

Expected: all PASS. If ESM fails, rename to `.mjs` or add `"type":"module"` only for test via:

```bash
node --experimental-default-type=module --test lib/packaging.test.js
```

On Windows PowerShell use same. If `products.js` import pulls Firebase in `cogs.js`, keep `cogs.js` free of `COST_MODE` import — hardcode `"recipe"` string compare instead.

- [ ] **Step 5: Commit**

```bash
git add lib/packaging.js lib/cogs.js lib/pnl.js lib/packaging.test.js
git commit -m "feat(packaging): helpers đơn vị lồng + COGS/P&L pure"
```

---

### Task 2: Stock + sale serialization

**Files:**
- Modify: `lib/stock.js`
- Modify: `lib/sales.js`
- Test: extend `lib/packaging.test.js` for `stockDeltasForSaleItems` with `baseQty`

**Interfaces:**
- Consumes: `baseQty` on sale lines
- Produces: deltas in **base units**; tx fields `cogsTotal`, `cogsStatus`

- [ ] **Step 1: Update `stockDeltasForSaleItems`**

For non-recipe branch, use `baseQty` when present:

```js
} else {
  const base =
    item.baseQty != null
      ? Number(item.baseQty) || 0
      : qty * Math.max(1, Number(item.unitFactor) || 1);
  deltas[productId] = (deltas[productId] || 0) + sign * base;
}
```

Recipe branch unchanged (ignore packaging).

- [ ] **Step 2: Update `serializeSaleItems`**

Preserve packaging fields if already on item (from `buildSaleLineFromProduct`):

```js
export function serializeSaleItems(items = []) {
  return items.map((item) => {
    const qty = Number(item.qty) || 0;
    const unitFactor = Math.max(1, Number(item.unitFactor) || 1);
    const baseQty =
      item.baseQty != null ? Number(item.baseQty) || 0 : qty * unitFactor;
    const unitPrice = Number(item.unitPrice ?? item.price) || 0;
    const unitCost = Number(item.unitCost ?? item.sellCost ?? item.cost) || 0;
    return {
      productId: String(item.productId || item.id || ""),
      name: String(item.name || ""),
      qty,
      unitId: item.unitId || "base",
      unitLabel: item.unitLabel || "",
      unitFactor,
      baseQty,
      unitPrice,
      unitCost,
      lineRevenue: Math.round(
        Number(item.lineRevenue) || qty * unitPrice
      ),
      lineCogs: Math.round(Number(item.lineCogs) || qty * unitCost),
      costMode:
        item.costMode === COST_MODE.RECIPE ? COST_MODE.RECIPE : COST_MODE.MANUAL,
      recipe: normalizeRecipe(item.recipe),
      estimatedServings: Math.max(1, Number(item.estimatedServings) || 100),
    };
  });
}
```

- [ ] **Step 3: Update `recordPosSale`**

```js
import { sumSaleCogs } from "./cogs";

// after serializeSaleItems:
const { cogsTotal, cogsStatus } = sumSaleCogs(saleItems);

batch.set(txRef, {
  // ...existing
  items: saleItems,
  cogsTotal,
  cogsStatus,
  stockAdjustments: applied,
  ...
});
```

- [ ] **Step 4: Add stock delta test + run `node --test`**

- [ ] **Step 5: Commit**

```bash
git add lib/stock.js lib/sales.js lib/packaging.test.js
git commit -m "feat(sales): snapshot COGS và trừ tồn theo baseQty"
```

---

### Task 3: Persist packaging on products

**Files:**
- Modify: `lib/products.js` (`buildProductPayload` / `createProduct` / `updateProduct`)

- [ ] **Step 1: Add `normalizeUnitsForSave(data)`**

- Reject if `costMode === recipe` && `packaging.enabled`
- Require one unit with `factor === 1`
- Sync top-level `price`/`cost`/`unit` from factor-1 unit
- Strip packaging when disabled

- [ ] **Step 2: Wire into create/update payloads**

- [ ] **Step 3: Manual sanity via node snippet importing normalize (or unit test)**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(products): lưu packaging.units khi tạo/sửa món"
```

---

### Task 4: Products UI — units editor

**Files:**
- Modify: `app/manager/products/page.js`

- [ ] **Step 1: Add toggle “Nhiều đơn vị (cây/bao…)”** (hidden when recipe)

- [ ] **Step 2: Units table fields:** label, factor, sellPrice, sellCost, canSell, canReceive + add/remove row

- [ ] **Step 3: On save, send `packaging` + `units`; list row shows `tồn X {base}` and unit count

- [ ] **Step 4: `npm run build` — expect success

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(products): UI cấu hình đơn vị bán/nhập"
```

---

### Task 5: POS unit picker

**Files:**
- Modify: `components/EmployeeDesk.js`

- [ ] **Step 1: When adding packaging product, store `unitId` on cart line (default `defaultSellUnit`)**

- [ ] **Step 2: Cart UI: select unit → refresh `unitPrice` from unit; recompute line total**

- [ ] **Step 3: Before `recordPosSale`, map cart → `buildSaleLineFromProduct` per line; `assertCanSellStock`; amount = sum `lineRevenue`**

- [ ] **Step 4: Legacy products: no UI change (single unit)

- [ ] **Step 5: Build + commit**

```bash
git commit -m "feat(pos): chọn đơn vị bán và snapshot giá/COGS"
```

---

### Task 6: Inventory receive by unit

**Files:**
- Modify: `lib/expenses.js` (`receiveInventoryFromShopFund`, `receiveInventoryFromCapitalFund`)
- Modify: `app/manager/inventory/page.js`

- [ ] **Step 1: Extend receive APIs**

```js
{
  product,
  addQty,          // qty in selected unit
  unitId,          // optional
  unitCost,        // price per selected unit (NCC)
  ...
}
```

```js
const unit = findUnit(product, unitId) || defaultReceiveUnit(product);
const baseQty = toBaseQty(addQty, unit);
const amount = Math.round(Number(addQty) * Number(cost));
// inStock: before + baseQty
// tx metadata: unitId, unitFactor, baseQty, receiveQty: addQty, unitReceivePrice: cost
```

Do **not** auto-update `sellCost` (spec phase 1).

- [ ] **Step 2: Inventory form — unit select (default `defaultReceiveUnit`), preview “= N {baseUnit}”**

- [ ] **Step 3: Build + commit**

```bash
git commit -m "feat(inventory): nhập theo cây/bao quy về tồn gốc"
```

---

### Task 7: Dashboard dual lens

**Files:**
- Modify: `app/dashboard/page.js`
- Create/use: `lib/pnl.js`

- [ ] **Step 1: `periodPnl = summarizeShopPnl(periodTx)`**

- [ ] **Step 2: Keep existing Thu−chi card (= `cashProfit`)**

- [ ] **Step 3: Add cards: COGS · Lãi gộp · Lãi kinh doanh (`operatingProfit`)**

- [ ] **Step 4: Short note: “Lãi kinh doanh không trừ tiền nhập hàng (đã nằm trong tồn).”**

- [ ] **Step 5: Build + commit**

```bash
git commit -m "feat(dashboard): hiện Thu−chi và Lãi kinh doanh song song"
```

---

### Task 8: Monthly reference Lens 2

**Files:**
- Modify: `app/dashboard/monthly/page.js`

- [ ] **Step 1: Compute `summarizeShopPnl(monthTx)`**

- [ ] **Step 2: Keep dividend block on Lens 1 (`calculateMonthlyReport` unchanged)**

- [ ] **Step 3: Add card “Tham khảo · Lãi kinh doanh (chưa chia cổ tức)” with COGS / gross / operating**

- [ ] **Step 4: Build + commit**

```bash
git commit -m "feat(monthly): block tham khảo lãi kinh doanh, cổ tức giữ nguyên"
```

---

### Task 9: Spec status + deploy sync

**Files:**
- Spec already Approved
- Verify example path end-to-end mentally / manual checklist

- [ ] **Step 1: Run full `npm run build`**

- [ ] **Step 2: Run `node --test lib/packaging.test.js`**

- [ ] **Step 3: If user asks push:**

```bash
git push origin master
git push origin master:main
```

- [ ] **Step 4: Manual checklist**

1. Tạo món Thuốc X packaging bao/cây  
2. Nhập 2 cây × 200k → tồn 20, quỹ −400k  
3. Bán 1 bao → tồn 19, cogs 18k  
4. Bán 1 cây → tồn 9, cogs 180k  
5. Đối soát ngày: Thu−chi ≠ Lãi kinh doanh khi có nhập hàng  

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| One SKU + units factor | 1, 3, 4 |
| Stock always base | 2, 5, 6 |
| Independent sellPrice/sellCost | 1, 4, 5 |
| Receive prefers cây | 1 (`defaultReceiveUnit`), 6 |
| Snapshot COGS on POS | 2, 5 |
| Dual lens UI | 7, 8 |
| Dividends stay cash | 8 (no change to `calculateMonthlyReport`) |
| No recipe+packaging | 3, 4 |
| Construction isolated | `summarizeShopPnl` uses `isGoodsIncome` / shop opex filters |

## Placeholder scan

None intentional — implementers must use concrete helpers above; if import cycles appear, move P&L to `lib/pnl.js` as noted in Task 1.
