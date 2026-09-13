# Import cost split + Recipe virtual ingredients — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi nhập thùng/cây, tự chia ra đơn giá gốc và cập nhật cost NL (last purchase); công thức món hỗ trợ dòng NL ảo (đá/nước) chỉ cộng COGS, không trừ kho.

**Architecture:** Thêm helper thuần `deriveReceiveCostUpdate` trong `lib/packaging.js` (chia giá + patch `cost`/`units[].sellCost`). `receiveInventoryFromShopFund` / `FromCapitalFund` luôn áp dụng khi có giá nhập. Mở rộng `normalizeRecipe` / `computeRecipeCost` / `stockDeltasForSaleItems` để dòng `virtual: true` cộng cost nhưng bỏ qua trừ kho. UI inventory hiện preview chia giá; UI products thêm dòng “Ước tay”.

**Tech Stack:** Next.js 14, Firebase Firestore client SDK, `node:test` (chạy `node --test lib/*.test.js`)

**Spec:** `docs/superpowers/specs/2026-09-13-import-cost-recipe-virtual-design.md`

## Global Constraints

- Cost NL sau nhập = **lần nhập mới nhất** (`baseUnitCost = round(amount / baseQty)`).
- NL ảo: `virtual: true`, không `productId` kho, **không trừ tồn**.
- Không FIFO / WAC; không packaging > 2 tầng; không đổi cổ tức.
- Recipe + packaging enabled vẫn **cấm** đồng thời.
- Giữ tên field hiện có: `inStock`, `sellCost`, `costMode`, `toBaseQty`, `recomputeRecipeCosts`.

## File map

| File | Responsibility |
|------|----------------|
| `lib/packaging.js` | `deriveReceiveCostUpdate(product, { unit, receiveQty, unitReceivePrice })` |
| `lib/packaging.test.js` | Tests chia giá + patch units |
| `lib/expenses.js` | Receive luôn ghi cost gốc (mọi factor) |
| `app/manager/inventory/page.js` | Preview chia giá; `updateCost: true` khi có giá |
| `lib/products.js` | Recipe virtual lines + cost |
| `lib/products.test.js` | Tests recipe ảo (file mới) |
| `lib/stock.js` | Bỏ qua virtual khi trừ kho |
| `lib/packaging.test.js` (stock section) hoặc `lib/stock` tests in packaging.test | Virtual không trừ |
| `app/manager/products/page.js` | UI thêm dòng ảo |
| `lib/cogs.js` | Không đổi signature nếu `resolveUnitCost` đã gồm ảo qua products |

---

### Task 1: Helper chia giá nhập → cost gốc

**Files:**
- Modify: `lib/packaging.js`
- Modify: `lib/packaging.test.js`

**Interfaces:**
- Produces: `deriveReceiveCostUpdate(product, { unit, receiveQty, unitReceivePrice }) → { baseQty, amount, baseUnitCost, productPatch } | throws`
- `productPatch`: `{ cost, units? }` — `units` chỉ khi product đã có packaging/units

- [ ] **Step 1: Write the failing tests**

Append to `lib/packaging.test.js`:

```js
import { deriveReceiveCostUpdate } from "./packaging.js";

describe("deriveReceiveCostUpdate", () => {
  it("splits carton price into base unit cost", () => {
    const product = {
      id: "noodle",
      cost: 3500,
      unit: "gói",
      packaging: { enabled: true, baseUnit: "gói" },
      units: [
        {
          id: "goi",
          label: "gói",
          factor: 1,
          sellPrice: 5000,
          sellCost: 3500,
          canSell: true,
          canReceive: true,
        },
        {
          id: "thung",
          label: "thùng",
          factor: 30,
          sellPrice: 140000,
          sellCost: 105000,
          canSell: false,
          canReceive: true,
        },
      ],
    };
    const thung = product.units[1];
    const result = deriveReceiveCostUpdate(product, {
      unit: thung,
      receiveQty: 1,
      unitReceivePrice: 120000,
    });
    assert.equal(result.baseQty, 30);
    assert.equal(result.amount, 120000);
    assert.equal(result.baseUnitCost, 4000);
    assert.equal(result.productPatch.cost, 4000);
    const goi = result.productPatch.units.find((u) => u.factor === 1);
    const pack = result.productPatch.units.find((u) => u.id === "thung");
    assert.equal(goi.sellCost, 4000);
    assert.equal(pack.sellCost, 120000);
  });

  it("factor 1 uses unit price as cost", () => {
    const product = { id: "egg", cost: 2000, unit: "quả", units: [] };
    const unit = {
      id: "base",
      label: "quả",
      factor: 1,
      sellCost: 2000,
      canReceive: true,
    };
    const result = deriveReceiveCostUpdate(product, {
      unit,
      receiveQty: 10,
      unitReceivePrice: 2500,
    });
    assert.equal(result.baseQty, 10);
    assert.equal(result.baseUnitCost, 2500);
    assert.equal(result.productPatch.cost, 2500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/packaging.test.js`
Expected: FAIL — `deriveReceiveCostUpdate` not exported / not defined

- [ ] **Step 3: Implement `deriveReceiveCostUpdate`**

In `lib/packaging.js`, add:

```js
/**
 * Từ phiếu nhập (SL × ĐV × giá ĐV) → số lượng gốc + đơn giá gốc + patch catalog.
 * last-purchase: cost gốc = round(amount / baseQty).
 */
export function deriveReceiveCostUpdate(
  product,
  { unit, receiveQty, unitReceivePrice }
) {
  const qty = Number(receiveQty) || 0;
  const price = Number(unitReceivePrice);
  if (qty <= 0) throw new Error("Số lượng nhập phải > 0");
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Giá nhập không hợp lệ");
  }
  const u = unit || defaultReceiveUnit(product);
  if (!u) throw new Error("Đơn vị nhập không hợp lệ");

  const baseQty = toBaseQty(qty, u);
  if (baseQty <= 0) throw new Error("Số lượng nhập phải > 0");

  const amount = Math.round(qty * price);
  if (amount <= 0) {
    throw new Error("Tiền nhập phải > 0 (số lượng × giá nhập)");
  }

  const baseUnitCost = Math.round(amount / baseQty);
  const productPatch = { cost: baseUnitCost };

  const normalized = normalizeProductUnits(product);
  if (normalized.enabled && Array.isArray(normalized.units) && normalized.units.length) {
    productPatch.units = normalized.units.map((row) => {
      if (Number(row.factor) === 1) {
        return { ...row, sellCost: baseUnitCost };
      }
      if (row.id === u.id) {
        return { ...row, sellCost: Math.round(price) };
      }
      return { ...row };
    });
  }

  return { baseQty, amount, baseUnitCost, productPatch };
}
```

Ensure `normalizeProductUnits` / `toBaseQty` / `defaultReceiveUnit` already exist in this file (they do).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/packaging.test.js`
Expected: PASS for `deriveReceiveCostUpdate`

- [ ] **Step 5: Commit**

```bash
git add lib/packaging.js lib/packaging.test.js
git commit -m "feat(packaging): derive base unit cost from pack receive price"
```

---

### Task 2: Receive inventory always updates last-purchase cost

**Files:**
- Modify: `lib/expenses.js` (`receiveInventoryFromShopFund`, `receiveInventoryFromCapitalFund`)
- Modify: `app/manager/inventory/page.js`

**Interfaces:**
- Consumes: `deriveReceiveCostUpdate` from Task 1
- Produces: receive writes `cost` (+ `units`) on every paid receive with price; UI passes `updateCost: true` when user entered price OR always on receive

- [ ] **Step 1: Update shop receive to apply cost patch for any factor**

In `receiveInventoryFromShopFund`, replace the block that only sets cost when `updateCost && factor === 1` with:

```js
import { defaultReceiveUnit, findUnit, toBaseQty, deriveReceiveCostUpdate } from "./packaging.js";

// after amount/baseQty computed (or replace local amount/baseQty with helper):
const derived = deriveReceiveCostUpdate(product, {
  unit,
  receiveQty,
  unitReceivePrice,
});
// use derived.baseQty, derived.amount for stock + expense

const productPayload = {
  inStock: after, // after = before + derived.baseQty
  updatedAt: serverTimestamp(),
  ...derived.productPatch,
};
if (product.kind === "ingredient") {
  productPayload.costMode = "manual";
} else if (product.costMode !== "recipe") {
  productPayload.costMode = "manual";
}
// Keep updateCost param for backward compat but ignore factor===1 gate:
// Always apply derived.productPatch on successful receive.
```

Do the **same** change inside `receiveInventoryFromCapitalFund`.

Remove or stop using the old `if (updateCost && Number(unit.factor) === 1)` gate.

- [ ] **Step 2: Inventory UI — always update cost when receiving with price; show preview**

In `app/manager/inventory/page.js`:

1. Import `deriveReceiveCostUpdate` (and keep `findUnit` / `toBaseQty` as needed).
2. In `handleReceive`, when `addQty > 0`:

```js
updateCost: true, // last-purchase always
```

3. After successful receive with `hasCost` **or always after receive**, keep:

```js
await recomputeRecipeCosts();
```

(Call `recomputeRecipeCosts()` after every successful qty receive, not only `hasCost`.)

4. In the receive row UI (near “Giá nhập mới”), add a preview when `addQty > 0` and unit selected:

```jsx
{(() => {
  const qty = Number(d.addQty) || 0;
  if (qty <= 0 || !selectedUnit) return null;
  let preview = null;
  try {
    preview = deriveReceiveCostUpdate(product, {
      unit: selectedUnit,
      receiveQty: qty,
      unitReceivePrice: nextCost,
    });
  } catch {
    return null;
  }
  return (
    <p className="mt-1 text-[11px] font-semibold leading-snug text-slate-600">
      {qty} {selectedUnit.label} × {formatCurrency(nextCost)}
      {" → +"}
      {preview.baseQty} {product.packaging?.baseUnit || product.unit || "đv"}
      {" · ĐG gốc "}
      {formatCurrency(preview.baseUnitCost)}
      {" · Trừ quỹ "}
      {formatCurrency(preview.amount)}
    </p>
  );
})()}
```

- [ ] **Step 3: Manual smoke / lint**

Run: `npm run lint`
Expected: no errors

Run: `node --test lib/packaging.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/expenses.js app/manager/inventory/page.js
git commit -m "feat(inventory): last-purchase cost on pack receive + preview"
```

---

### Task 3: Recipe virtual lines (cost only)

**Files:**
- Modify: `lib/products.js` (`normalizeRecipe`, `computeRecipeCost`)
- Create: `lib/products.test.js`

**Interfaces:**
- Produces: recipe line shape  
  - Stock: `{ productId, qty, phase, virtual?: false }`  
  - Virtual: `{ virtual: true, name, qty, unitCost, phase, productId?: "" }`
- `computeRecipeCost` sums stock lines via `productsById[id].cost` and virtual via `line.unitCost`

- [ ] **Step 1: Write failing tests**

Create `lib/products.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecipe,
  computeRecipeCost,
  resolveUnitCost,
  COST_MODE,
  PRODUCT_KIND,
  RECIPE_PHASE,
} from "./products.js";

describe("recipe virtual lines", () => {
  it("normalizeRecipe keeps virtual lines without productId", () => {
    const lines = normalizeRecipe([
      { productId: "noodle", qty: 1, phase: RECIPE_PHASE.SERVE },
      {
        virtual: true,
        name: "Đá",
        qty: 1,
        unitCost: 200,
        phase: RECIPE_PHASE.SERVE,
      },
      { productId: "", qty: 1, virtual: false },
    ]);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].virtual, true);
    assert.equal(lines[1].name, "Đá");
    assert.equal(lines[1].unitCost, 200);
  });

  it("computeRecipeCost adds virtual unitCost", () => {
    const byId = {
      noodle: { id: "noodle", cost: 4000 },
      egg: { id: "egg", cost: 3000 },
    };
    const cost = computeRecipeCost(
      [
        { productId: "noodle", qty: 1, phase: RECIPE_PHASE.SERVE },
        { productId: "egg", qty: 2, phase: RECIPE_PHASE.SERVE },
        {
          virtual: true,
          name: "Nước sôi",
          qty: 1,
          unitCost: 100,
          phase: RECIPE_PHASE.SERVE,
        },
      ],
      byId,
      RECIPE_PHASE.SERVE
    );
    assert.equal(cost, 4000 + 6000 + 100);
  });

  it("resolveUnitCost includes virtual serve lines", () => {
    const product = {
      kind: PRODUCT_KIND.FINISHED,
      costMode: COST_MODE.RECIPE,
      estimatedServings: 100,
      recipe: [
        {
          virtual: true,
          name: "Đá",
          qty: 1,
          unitCost: 200,
          phase: RECIPE_PHASE.SERVE,
        },
      ],
    };
    assert.equal(resolveUnitCost(product, {}), 200);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test lib/products.test.js`
Expected: FAIL (virtual lines dropped / cost missing)

- [ ] **Step 3: Update `normalizeRecipe` and `computeRecipeCost`**

In `lib/products.js`:

```js
export function normalizeRecipe(recipe) {
  if (!Array.isArray(recipe)) return [];
  return recipe
    .map((line) => {
      const phase = normalizeRecipePhase(line.phase);
      const qty = Number(line.qty) || 0;
      if (line.virtual === true) {
        const name = String(line.name || "").trim();
        const unitCost = Math.max(0, Math.round(Number(line.unitCost) || 0));
        if (!name || qty <= 0) return null;
        return {
          virtual: true,
          name,
          qty,
          unitCost,
          phase,
          productId: "",
        };
      }
      const productId = String(line.productId || "");
      if (!productId || qty <= 0) return null;
      return { productId, qty, phase, virtual: false };
    })
    .filter(Boolean);
}

export function computeRecipeCost(recipe, productsById, phase = null) {
  const lines =
    phase == null
      ? normalizeRecipe(recipe)
      : filterRecipeByPhase(recipe, phase);
  return lines.reduce((sum, line) => {
    if (line.virtual) {
      return sum + (Number(line.unitCost) || 0) * (Number(line.qty) || 0);
    }
    const ing = productsById[line.productId];
    const unitCost = Number(ing?.cost) || 0;
    return sum + unitCost * (Number(line.qty) || 0);
  }, 0);
}
```

Also update `summarizeRecipeCosts` line rendering if it assumes every line has `productId` (use `line.virtual ? line.name : byId[id]?.name`).

Check any save path that maps recipe and drops unknown fields — ensure `virtual`, `name`, `unitCost` persist on `createProduct` / `updateProduct`.

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test lib/products.test.js lib/packaging.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/products.js lib/products.test.js
git commit -m "feat(products): virtual recipe lines for estimated cost-only ingredients"
```

---

### Task 4: Stock deltas skip virtual lines

**Files:**
- Modify: `lib/stock.js` (`normalizeRecipe` local copy **or** import from products — prefer import to DRY)
- Modify: `lib/packaging.test.js` (stock describe) — add virtual case

**Interfaces:**
- Consumes: shared `normalizeRecipe` from `products.js` if feasible; else mirror virtual skip in local `normalizeRecipe`

- [ ] **Step 1: Prefer importing `normalizeRecipe` / `filterRecipeByPhase` from `products.js` in `stock.js`**

Replace local recipe helpers in `lib/stock.js` with:

```js
import {
  COST_MODE,
  RECIPE_PHASE,
  normalizeRecipe,
  filterRecipeByPhase,
} from "./products.js";
```

Remove duplicate local `normalizeRecipe` / `filterRecipeByPhase` / `normalizeRecipePhase` from `stock.js` if they exist.

In `stockDeltasForSaleItems` recipe branch, when iterating serve lines, skip virtual:

```js
for (const line of serveLines) {
  if (line.virtual) continue;
  const ingId = String(line.productId || "");
  ...
}
```

Same skip in `stockDeltasForBatch`.

- [ ] **Step 2: Add test**

In `lib/packaging.test.js` stock section:

```js
it("stockDeltasForSaleItems ignores virtual recipe lines", () => {
  const deltas = stockDeltasForSaleItems(
    [
      {
        productId: "dish",
        qty: 1,
        costMode: "recipe",
        recipe: [
          { productId: "noodle", qty: 1, phase: "serve" },
          {
            virtual: true,
            name: "Đá",
            qty: 1,
            unitCost: 200,
            phase: "serve",
          },
        ],
      },
    ],
    -1
  );
  assert.equal(deltas.noodle, -1);
  assert.equal(deltas.Đá, undefined);
  assert.equal(Object.keys(deltas).includes(""), false);
});
```

- [ ] **Step 3: Run tests**

Run: `node --test lib/packaging.test.js lib/products.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/stock.js lib/packaging.test.js
git commit -m "fix(stock): do not deduct inventory for virtual recipe lines"
```

---

### Task 5: Products UI — add virtual recipe lines

**Files:**
- Modify: `app/manager/products/page.js`

**Interfaces:**
- Consumes: `normalizeRecipe` / `summarizeRecipeCosts` already used for preview
- Produces: form can add `{ virtual: true, name, qty, unitCost, phase }`

- [ ] **Step 1: Extend `addRecipeLine` and form mapping**

```js
const addRecipeLine = (phase = RECIPE_PHASE.SERVE, { virtual = false } = {}) => {
  if (virtual) {
    setForm((f) => ({
      ...f,
      recipe: [
        ...f.recipe,
        {
          virtual: true,
          name: "",
          qty: "1",
          unitCost: "0",
          phase,
          productId: "",
        },
      ],
    }));
    return;
  }
  // existing stock line logic...
};
```

When loading `openEdit`, map virtual fields:

```js
recipe: (row.recipe || []).map((l) =>
  l.virtual
    ? {
        virtual: true,
        name: l.name || "",
        qty: String(l.qty ?? "1"),
        unitCost: String(l.unitCost ?? "0"),
        phase: l.phase || RECIPE_PHASE.SERVE,
        productId: "",
      }
    : {
        productId: l.productId || "",
        qty: String(l.qty ?? "1"),
        phase: l.phase || RECIPE_PHASE.SERVE,
        virtual: false,
      }
)
```

On save, pass recipe through `normalizeRecipe` (already should).

- [ ] **Step 2: UI — two add buttons + virtual row editors**

For each recipe section, replace single add button with:

```jsx
<div className="grid grid-cols-2 gap-2">
  <button type="button" onClick={() => addRecipeLine(section.phase)} className="...">
    + Từ kho
  </button>
  <button
    type="button"
    onClick={() => addRecipeLine(section.phase, { virtual: true })}
    className="..."
  >
    + Ước tay (không trừ kho)
  </button>
</div>
```

For each line in the section, if `line.virtual`:

```jsx
<input placeholder="Tên (Đá, Nước sôi…)" value={line.name} onChange=... />
<input type="number" placeholder="SL" value={line.qty} ... />
<input type="number" placeholder="Cost ước (đ)" value={line.unitCost} ... />
<span className="text-[10px] font-bold text-amber-800">Không trừ kho</span>
```

Else keep existing ingredient `<select>`.

Ensure `recipePreview` / `summarizeRecipeCosts` still works (virtual costs included from Task 3).

- [ ] **Step 3: Validation on save**

When `costMode === RECIPE`, require at least one line after `normalizeRecipe` (stock or virtual). If a virtual line has empty name, `normalizeRecipe` drops it — show toast if all lines invalid.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add app/manager/products/page.js
git commit -m "feat(products): UI for virtual cost-only recipe ingredients"
```

---

### Task 6: End-to-end verification checklist

**Files:** none (manual / tests only)

- [ ] **Step 1: Run full unit suite**

Run: `node --test lib/packaging.test.js lib/products.test.js`
Expected: all PASS

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: success (or note existing unrelated build warnings)

- [ ] **Step 3: Manual QA script (document in commit message if needed)**

1. Tạo NL Mỳ + packaging 1 thùng = 30 gói  
2. Nhập 1 thùng giá 120000 → preview 4000đ/gói; tồn +30; cost = 4000  
3. Tạo món “Mỳ trứng”: 1 mỳ + 2 trứng + ảo Đá 200  
4. Preview cost món = 4000 + 2×trứng + 200  
5. Bán 1 suất → trừ mỳ/trứng, không trừ đá; COGS có đủ  

- [ ] **Step 4: Commit push branch / merge main+master**

```bash
git push -u origin HEAD
# then merge to main and master per project convention
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Preview chia giá trên form nhập | Task 2 |
| `baseUnitCost = amount/baseQty`, cập nhật cost mọi factor | Task 1–2 |
| Đồng bộ `units[].sellCost` gốc + ĐV nhập | Task 1 |
| `recomputeRecipeCosts` sau nhập | Task 2 |
| Recipe dòng ảo name+unitCost+qty | Task 3, 5 |
| Bán không trừ NL ảo | Task 4 |
| COGS gồm NL ảo | Task 3 (`resolveUnitCost`) |
| Không FIFO / không đổi cổ tức | Global constraints |

## Placeholder scan

No TBD / “implement later” left in tasks.
