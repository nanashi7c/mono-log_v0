import { describe, expect, it, vi } from "vitest";
import type { ItemApiCommandInput } from "@/features/items/application/item-api-command-input";
import type { ItemApiCommandRepository } from "@/features/items/application/item-api-command-ports";
import {
  createApiItemUseCase,
  updateApiItemUseCase,
} from "@/features/items/application/item-api-command-use-cases";
import type { ItemApiData } from "@/features/items/application/item-api-data";

const input: ItemApiCommandInput = Object.freeze({
  status: "owned",
  name: "Camera",
  janCode: null,
  quantity: 1,
  notes: null,
  actualPrice: null,
  purchasedAt: null,
  categoryIds: Object.freeze([3]),
});
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

function createRepository(): ItemApiCommandRepository {
  return {
    create: vi.fn().mockResolvedValue({ status: "created", item }),
    update: vi.fn().mockResolvedValue({ status: "updated", item }),
  };
}

describe("item API command use cases", () => {
  it("forwards create command values to the repository", async () => {
    const repository = createRepository();
    const actor = Object.freeze({
      userId: "user-1",
      email: "user@example.com",
    });

    const result = await createApiItemUseCase(
      { repository },
      { actor, input },
    );

    expect(repository.create).toHaveBeenCalledWith(actor, input);
    expect(result).toEqual({ status: "created", item });
  });

  it("forwards update command values to the repository", async () => {
    const repository = createRepository();

    const result = await updateApiItemUseCase(
      { repository },
      { userId: "user-1", itemId: 1, input },
    );

    expect(repository.update).toHaveBeenCalledWith("user-1", 1, input);
    expect(result).toEqual({ status: "updated", item });
  });

  it("preserves a not-found update result", async () => {
    const repository = createRepository();
    repository.update = vi.fn().mockResolvedValue({ status: "not_found" });

    const result = await updateApiItemUseCase(
      { repository },
      { userId: "user-1", itemId: 999, input },
    );

    expect(result).toEqual({ status: "not_found" });
  });

  it("preserves an invalid-category create result", async () => {
    const repository = createRepository();
    repository.create = vi.fn().mockResolvedValue({
      status: "invalid_categories",
    });

    const result = await createApiItemUseCase(
      { repository },
      {
        actor: { userId: "user-1", email: "user@example.com" },
        input,
      },
    );

    expect(result).toEqual({ status: "invalid_categories" });
  });
});
