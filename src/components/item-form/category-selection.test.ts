import { describe, expect, it } from "vitest";
import { toggleCategorySelection } from "@/components/item-form/category-selection";

describe("toggleCategorySelection", () => {
  it("未選択のカテゴリを追加し、元のSetを変更しない", () => {
    const selectedCategoryIds = new Set([1]);

    const result = toggleCategorySelection(selectedCategoryIds, 2);

    expect(result).toEqual(new Set([1, 2]));
    expect(selectedCategoryIds).toEqual(new Set([1]));
    expect(result).not.toBe(selectedCategoryIds);
  });

  it("選択済みのカテゴリを削除し、元のSetを変更しない", () => {
    const selectedCategoryIds = new Set([1, 2]);

    const result = toggleCategorySelection(selectedCategoryIds, 2);

    expect(result).toEqual(new Set([1]));
    expect(selectedCategoryIds).toEqual(new Set([1, 2]));
    expect(result).not.toBe(selectedCategoryIds);
  });
});
