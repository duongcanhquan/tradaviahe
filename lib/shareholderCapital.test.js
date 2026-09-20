import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchFundInCandidates,
  matchConstructionFundCandidates,
  previewCapitalFundRepair,
} from "./capitalFundLink.js";

describe("matchFundInCandidates", () => {
  it("matches unique fund_in by amount + note", () => {
    const entry = {
      id: "c1",
      amount: 500000,
      dateKey: "2026-09-20",
      note: "Nạp nhầm vào quỹ",
      toShopFund: true,
    };
    const ids = matchFundInCandidates(entry, [
      {
        id: "t1",
        type: "fund_in",
        amount: 500000,
        businessDate: "2026-09-20",
        note: "Nạp nhầm vào quỹ",
        source: "shop_fund",
      },
      {
        id: "t2",
        type: "fund_in",
        amount: 500000,
        businessDate: "2026-09-19",
        note: "Khác",
        source: "shop_fund",
      },
    ]);
    assert.deepEqual(ids, ["t1"]);
  });

  it("returns empty when multiple same amount without unique note", () => {
    const entry = {
      id: "c1",
      amount: 100000,
      dateKey: "2026-09-20",
      note: "",
      toShopFund: true,
    };
    const ids = matchFundInCandidates(entry, [
      {
        id: "t1",
        type: "fund_in",
        amount: 100000,
        businessDate: "2026-09-20",
        source: "shop_fund",
      },
      {
        id: "t2",
        type: "fund_in",
        amount: 100000,
        businessDate: "2026-09-20",
        source: "shop_fund",
      },
    ]);
    assert.deepEqual(ids, []);
  });

  it("prefers capital_to_shop source", () => {
    const entry = {
      id: "c1",
      amount: 200000,
      dateKey: "2026-09-20",
      note: "abc",
    };
    const ids = matchFundInCandidates(entry, [
      {
        id: "t1",
        type: "fund_in",
        amount: 200000,
        businessDate: "2026-09-20",
        note: "khác",
        source: "capital_to_shop",
      },
    ]);
    assert.deepEqual(ids, ["t1"]);
  });
});

describe("previewCapitalFundRepair", () => {
  it("links capital missing shopFundTxId to unique fund_in", () => {
    const preview = previewCapitalFundRepair({
      capitalEntries: [
        {
          id: "c1",
          kind: "expense",
          amount: 300000,
          dateKey: "2026-09-20",
          note: "Chuyển vào quỹ",
          toShopFund: true,
        },
      ],
      transactions: [
        {
          id: "f1",
          type: "fund_in",
          amount: 300000,
          businessDate: "2026-09-20",
          note: "Chuyển vào quỹ",
          source: "shop_fund",
        },
      ],
    });
    assert.equal(preview.linkShop.length, 1);
    assert.equal(preview.linkShop[0].fundTxId, "f1");
    assert.equal(preview.orphanShopFund.length, 0);
  });

  it("flags orphan fund_in after capital deleted", () => {
    const preview = previewCapitalFundRepair({
      capitalEntries: [],
      transactions: [
        {
          id: "f1",
          type: "fund_in",
          amount: 100000,
          source: "capital_to_shop",
          capitalEntryId: "missing",
        },
      ],
    });
    assert.equal(preview.orphanShopFund.length, 1);
    assert.equal(preview.orphanShopFund[0].fundTxId, "f1");
  });

  it("matches construction fund candidates", () => {
    const ids = matchConstructionFundCandidates(
      {
        id: "c1",
        amount: 50000,
        dateKey: "2026-09-20",
        note: "Sang XD",
      },
      [
        {
          id: "x1",
          type: "fund_in",
          amount: 50000,
          businessDate: "2026-09-20",
          note: "Sang XD",
          businessLine: "construction",
          source: "transfer_capital_to_xd",
        },
      ]
    );
    assert.deepEqual(ids, ["x1"]);
  });
});
