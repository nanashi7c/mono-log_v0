import { describe, expect, it, vi } from "vitest";
import type { ItemFormOptions } from "@/features/items/application/item-form-data";
import type { ItemFormQueryRepository } from "@/features/items/application/item-form-query-ports";
import {
  loadItemEditFormUseCase,
  loadItemFormOptionsUseCase,
} from "@/features/items/application/item-form-query-use-cases";

const options: ItemFormOptions = {
  categories: [],
  platforms: [],
  services: [],
  sizes: [],
};

function createRepository(): ItemFormQueryRepository {
  return {
    findOptions: vi.fn(async () => options),
    findEditData: vi.fn(async () => null),
  };
}

describe("アイテムフォーム読み取りユースケース", () => {
  it("新規フォームの選択肢を取得する", async () => {
    const repository = createRepository();

    const result = await loadItemFormOptionsUseCase(
      { repository },
      { userId: "user-1" },
    );

    expect(result).toBe(options);
    expect(repository.findOptions).toHaveBeenCalledWith("user-1");
  });

  it("編集対象と選択肢を取得する", async () => {
    const repository = createRepository();

    const result = await loadItemEditFormUseCase(
      { repository },
      { userId: "user-1", itemId: 10 },
    );

    expect(result).toBeNull();
    expect(repository.findEditData).toHaveBeenCalledWith("user-1", 10);
  });
});
