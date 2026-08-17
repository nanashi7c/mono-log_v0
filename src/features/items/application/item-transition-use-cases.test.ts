import { describe, expect, it, vi } from "vitest";
import type { ItemTransitionRepository } from "@/features/items/application/item-transition-ports";
import { transitionItemUseCase } from "@/features/items/application/item-transition-use-cases";

function createRepository(): ItemTransitionRepository {
  return {
    transition: vi.fn(async () => ({ type: "transitioned" as const })),
  };
}

describe("transitionItemUseCase", () => {
  it("状態遷移規則をRepositoryへ渡す", async () => {
    const repository = createRepository();

    const result = await transitionItemUseCase(
      { repository },
      { userId: "user-1", itemId: 10, action: "start_listing" },
    );

    expect(result).toEqual({ type: "transitioned" });
    expect(repository.transition).toHaveBeenCalledWith(
      "user-1",
      10,
      {
        from: "owned",
        to: "listed",
        listingChange: "ensure",
        markDeleted: false,
      },
      null,
    );
  });

  it("売却時刻を外部から注入する", async () => {
    const repository = createRepository();
    const now = new Date("2026-08-15T12:00:00.000Z");

    await transitionItemUseCase(
      { repository, now: () => now },
      { userId: "user-1", itemId: 10, action: "mark_sold" },
    );

    expect(repository.transition).toHaveBeenCalledWith(
      "user-1",
      10,
      {
        from: "listed",
        to: "sold",
        listingChange: "keep",
        markDeleted: true,
      },
      now,
    );
  });

  it("遷移できなかった結果を呼び出し側へ返す", async () => {
    const repository: ItemTransitionRepository = {
      transition: vi.fn(async () => ({
        type: "not_found_or_invalid_status" as const,
      })),
    };

    const result = await transitionItemUseCase(
      { repository },
      { userId: "user-1", itemId: 10, action: "mark_purchased" },
    );

    expect(result).toEqual({ type: "not_found_or_invalid_status" });
  });
});
