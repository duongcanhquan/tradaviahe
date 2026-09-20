import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchesFundSearch,
  isShopFundEditableRow,
  shopFundSourceLabel,
  matchesCapitalExpenseSearch,
} from "./fundSearch.js";
import {
  ACQUISITION,
  acquisitionLabel,
  matchesAssetSearch,
  normalizeAcquisition,
  summarizeAssets,
} from "./assetMeta.js";

describe("matchesFundSearch", () => {
  it("tìm theo ghi chú và hạng mục", () => {
    const row = {
      type: "expense",
      category: "thiết bị",
      note: "Mua quạt trần quán",
      amount: 1500000,
      source: "shop_fund",
      businessLine: "shop",
      paymentMethod: "cash",
    };
    assert.equal(matchesFundSearch(row, "quạt"), true);
    assert.equal(matchesFundSearch(row, "thiết bị"), true);
    assert.equal(matchesFundSearch(row, "1500000"), true);
    assert.equal(matchesFundSearch(row, "xyz"), false);
  });
});

describe("isShopFundEditableRow", () => {
  it("cho phép chi tay, chặn nhập hàng", () => {
    assert.equal(
      isShopFundEditableRow({
        id: "1",
        type: "expense",
        source: "shop_fund",
        businessLine: "shop",
      }),
      true
    );
    assert.equal(
      isShopFundEditableRow({
        id: "2",
        type: "expense",
        source: "inventory_receive",
        category: "nhập hàng",
        businessLine: "shop",
      }),
      false
    );
  });
});

describe("shopFundSourceLabel", () => {
  it("nhãn nguồn", () => {
    assert.match(
      shopFundSourceLabel({ type: "expense", source: "shop_fund" }),
      /Chi quỹ/
    );
    assert.match(
      shopFundSourceLabel({
        type: "expense",
        source: "inventory_receive",
        category: "nhập hàng",
      }),
      /Nhập hàng/
    );
  });
});

describe("matchesCapitalExpenseSearch", () => {
  it("tìm chi vốn", () => {
    const row = {
      kind: "expense",
      note: "Mua máy pha",
      amount: 5000000,
      source: null,
    };
    assert.equal(matchesCapitalExpenseSearch(row, "máy pha"), true);
    assert.equal(matchesCapitalExpenseSearch(row, "quỹ đầu tư"), true);
  });
});

describe("acquisition", () => {
  it("normalize + label", () => {
    assert.equal(normalizeAcquisition("free"), ACQUISITION.free);
    assert.equal(normalizeAcquisition(""), ACQUISITION.purchased);
    assert.equal(acquisitionLabel("free"), "Miễn phí / CĐT cho");
  });

  it("summarizeAssets đếm free/purchased", () => {
    const s = summarizeAssets([
      { type: "equipment", amount: 0, acquisition: "free" },
      { type: "equipment", amount: 1000, acquisition: "purchased" },
      { type: "goods", amount: 2000 },
    ]);
    assert.equal(s.freeCount, 1);
    assert.equal(s.purchasedCount, 2);
    assert.equal(s.total, 3000);
  });

  it("matchesAssetSearch", () => {
    const row = {
      type: "equipment",
      equipmentName: "Tủ lạnh Panasonic",
      investorName: "Anh Minh",
      acquisition: "free",
      amount: 0,
    };
    assert.equal(matchesAssetSearch(row, "tủ lạnh"), true);
    assert.equal(matchesAssetSearch(row, "miễn phí"), true);
    assert.equal(matchesAssetSearch(row, "xyz"), false);
  });
});
