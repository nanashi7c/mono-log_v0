import { describe, expect, it, vi } from "vitest";
import type { ItemDetailQueryRepository } from "@/features/items/application/item-detail-query-ports";
import { loadItemDetailUseCase } from "@/features/items/application/item-detail-query-use-cases";

describe("loadItemDetailUseCase", () => {
  it("ユーザーとアイテムIDをRepositoryへ渡す", async () => {
    const repository: ItemDetailQueryRepository = {
      findDetail: vi.fn(async () => null),
    };

    const result = await loadItemDetailUseCase(
      { repository },
      { userId: "user-1", itemId: 10 },
    );

    expect(result).toBeNull();
    expect(repository.findDetail).toHaveBeenCalledWith("user-1", 10);
  });
});
