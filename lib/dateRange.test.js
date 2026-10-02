import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listenWindowMs,
  monthInputBounds,
  parseRangeBound,
} from "./dateRange.js";

describe("listenWindowMs", () => {
  it("uses explicit from/to when provided", () => {
    const { fromMs, toMs, capped } = listenWindowMs("2026-10-01", "2026-10-02", {
      fallbackDays: 90,
    });
    assert.equal(capped, false);
    assert.equal(fromMs, parseRangeBound("2026-10-01", false));
    assert.equal(toMs, parseRangeBound("2026-10-02", true));
  });

  it("falls back to N days when no dates", () => {
    const { fromMs, toMs, capped, fallbackDays } = listenWindowMs("", "", {
      fallbackDays: 90,
    });
    assert.equal(capped, true);
    assert.equal(fallbackDays, 90);
    assert.ok(fromMs < toMs);
    const spanDays = (toMs - fromMs) / (24 * 60 * 60 * 1000);
    assert.ok(spanDays >= 89 && spanDays <= 91);
  });
});

describe("monthInputBounds", () => {
  it("returns yyyy-MM-dd bounds", () => {
    const b = monthInputBounds(2026, 8); // September
    assert.equal(b.from, "2026-09-01");
    assert.match(b.to, /^\d{4}-\d{2}-\d{2}$/);
  });
});
