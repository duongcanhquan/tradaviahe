import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isStocktakeTarget,
  parseActualQty,
  buildStocktakeLine,
  summarizeStocktake,
  stocktakeLinesToApply,
} from "./stocktake.js";
import { canStocktake } from "./roles.js";

const noodle = {
  id: "mi",
  name: "Mì tôm",
  kind: "ingredient",
  unit: "gói",
  inStock: 10,
  cost: 5000,
};

describe("stocktake", () => {
  it("quản lý được kiểm kho, nhân viên không", () => {
    assert.equal(canStocktake("manager"), true);
    assert.equal(canStocktake("investor"), true);
    assert.equal(canStocktake("superadmin"), true);
    assert.equal(canStocktake("employee"), false);
    assert.equal(canStocktake(""), false);
  });

  it("parseActualQty: trống bỏ qua, 1,5 hợp lệ, âm invalid", () => {
    assert.equal(parseActualQty("").skipped, true);
    assert.equal(parseActualQty("1,5").actual, 1.5);
    assert.equal(parseActualQty("-3").invalid, true);
    assert.equal(parseActualQty("abc").invalid, true);
  });

  it("inactive product is not a target", () => {
    assert.equal(isStocktakeTarget({ ...noodle, active: false }), false);
  });

  it("skips recipe finished", () => {
    assert.equal(isStocktakeTarget(noodle), true);
    assert.equal(
      isStocktakeTarget({
        kind: "finished",
        costMode: "recipe",
        active: true,
      }),
      false
    );
    assert.equal(
      isStocktakeTarget({
        kind: "finished",
        costMode: "manual",
        active: true,
      }),
      true
    );
  });

  it("empty actual is skip; 0 is counted", () => {
    assert.equal(buildStocktakeLine(noodle, "").skipped, true);
    const zero = buildStocktakeLine(noodle, "0");
    assert.equal(zero.skipped, false);
    assert.equal(zero.actual, 0);
    assert.equal(zero.delta, -10);
    assert.equal(zero.value, -50000);
  });

  it("surplus 2 gói × 5000 = +10000", () => {
    const line = buildStocktakeLine(noodle, "12");
    assert.equal(line.delta, 2);
    assert.equal(line.value, 10000);
  });

  it("summary net value", () => {
    const lines = [
      buildStocktakeLine(noodle, "12"),
      buildStocktakeLine(
        { ...noodle, id: "egg", name: "Trứng", inStock: 30, cost: 2000 },
        "25"
      ),
      buildStocktakeLine({ ...noodle, id: "skip" }, ""),
    ];
    const sum = summarizeStocktake(lines);
    assert.equal(sum.counted, 2);
    assert.equal(sum.mismatch, 2);
    assert.equal(sum.surplusQty, 2);
    assert.equal(sum.shortageQty, 5);
    assert.equal(sum.surplusValue, 10000);
    assert.equal(sum.shortageValue, 10000);
    assert.equal(sum.netValue, 0);
    assert.equal(stocktakeLinesToApply(lines).length, 2);
  });

  it("khớp sổ không ghi", () => {
    const same = buildStocktakeLine(noodle, "10");
    assert.equal(same.delta, 0);
    assert.equal(stocktakeLinesToApply([same]).length, 0);
  });
});
