import { describe, expect, it } from "vitest";
import { parseOwnedItemsFilter } from "@/features/items/adapters/parse-owned-items-filter";

describe("parseOwnedItemsFilter", () => {
  it("検索語をトリムしてカテゴリIDを数値化する", () => {
    expect(parseOwnedItemsFilter("  camera  ", "12")).toEqual({
      query: "camera",
      category: { type: "category", categoryId: 12 },
    });
  });

  it("未分類の特別値を判別可能型へ変換する", () => {
    expect(parseOwnedItemsFilter(undefined, "__none__")).toEqual({
      query: null,
      category: { type: "uncategorized" },
    });
  });

  it.each([undefined, "", "invalid", "0", "-1", "1.5"])(
    "不正または未指定のカテゴリを全件扱いにする",
    (category) => {
      const result = parseOwnedItemsFilter(" ", category);

      expect(result).toEqual({ query: null, category: { type: "all" } });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.category)).toBe(true);
    },
  );
});
