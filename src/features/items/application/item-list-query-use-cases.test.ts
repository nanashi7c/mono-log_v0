import { describe, expect, it, vi } from "vitest";
import type { OwnedItemsFilter } from "@/features/items/application/item-list-data";
import type { ItemListQueryRepository } from "@/features/items/application/item-list-query-ports";
import {
  loadOwnedItemsUseCase,
  loadPlannedItemsUseCase,
  loadSellingItemsUseCase,
} from "@/features/items/application/item-list-query-use-cases";

function createRepository(): ItemListQueryRepository {
  return {
    findOwned: vi.fn(async () => ({ items: [], categoryOptions: [] })),
    findPlanned: vi.fn(async () => []),
    findSelling: vi.fn(async () => []),
  };
}

describe("アイテム一覧読み取りユースケース", () => {
  it("所有物の検索条件をRepositoryへ渡す", async () => {
    const repository = createRepository();
    const filter: OwnedItemsFilter = {
      query: "camera",
      category: { type: "category", categoryId: 12 },
    };

    await loadOwnedItemsUseCase(
      { repository },
      { userId: "user-1", filter },
    );

    expect(repository.findOwned).toHaveBeenCalledWith("user-1", filter);
  });

  it("購入予定一覧を取得する", async () => {
    const repository = createRepository();

    await loadPlannedItemsUseCase({ repository }, { userId: "user-1" });

    expect(repository.findPlanned).toHaveBeenCalledWith("user-1");
  });

  it("出品中一覧を取得する", async () => {
    const repository = createRepository();

    await loadSellingItemsUseCase({ repository }, { userId: "user-1" });

    expect(repository.findSelling).toHaveBeenCalledWith("user-1");
  });
});
