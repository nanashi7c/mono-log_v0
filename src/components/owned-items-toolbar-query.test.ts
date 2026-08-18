import { describe, expect, it } from "vitest";
import { buildOwnedItemsFilterHref } from "@/components/owned-items-toolbar-query";

describe("所有物フィルターURL", () => {
  it("変更対象以外の検索条件を保ったまま値を更新する", () => {
    expect(
      buildOwnedItemsFilterHref("/items", "category=3&page=2", {
        q: "camera",
      }),
    ).toBe("/items?category=3&page=2&q=camera");
  });

  it("空の検索条件を削除し、条件がなければpathnameだけを返す", () => {
    expect(
      buildOwnedItemsFilterHref("/items", "q=camera", { q: "" }),
    ).toBe("/items");
  });
});
