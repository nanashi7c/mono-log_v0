import { describe, expect, it, vi } from "vitest";
import type { ItemApiData } from "@/features/items/application/item-api-data";
import type { ItemApiQueryRepository } from "@/features/items/application/item-api-query-ports";
import {
  loadApiItemUseCase,
  loadApiItemsUseCase,
} from "@/features/items/application/item-api-query-use-cases";

const item: ItemApiData = Object.freeze({
  id: 1,
  user_id: "user-1",
  status: "owned",
  name: "Camera",
  image_url: null,
  jan_code: null,
  quantity: 1,
  notes: null,
  actual_price: null,
  purchased_at: null,
  deleted_at: null,
  created_at: "2026-08-18T00:00:00.000Z",
  updated_at: "2026-08-18T00:00:00.000Z",
  category_ids: Object.freeze([3]),
});

function createRepository(): ItemApiQueryRepository {
  return {
    findMany: vi.fn().mockResolvedValue(Object.freeze([item])),
    findById: vi.fn().mockResolvedValue(item),
  };
}

describe("item API query use cases", () => {
  it("forwards list query values to the repository", async () => {
    const repository = createRepository();

    const result = await loadApiItemsUseCase({ repository }, {
      userId: "user-1",
      status: "sold",
    });

    expect(repository.findMany).toHaveBeenCalledWith("user-1", "sold");
    expect(result).toEqual([item]);
  });

  it("forwards detail query values to the repository", async () => {
    const repository = createRepository();

    const result = await loadApiItemUseCase({ repository }, {
      userId: "user-1",
      itemId: 1,
    });

    expect(repository.findById).toHaveBeenCalledWith("user-1", 1);
    expect(result).toBe(item);
  });
});
