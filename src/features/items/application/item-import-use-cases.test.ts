import { describe, expect, it, vi } from "vitest";
import type { ItemImportInput } from "@/features/items/application/item-import-input";
import type { ItemImportRepository } from "@/features/items/application/item-import-ports";
import { importItemsUseCase } from "@/features/items/application/item-import-use-cases";

const input: ItemImportInput = {
  categories: [],
  items: [],
};

describe("importItemsUseCase", () => {
  it("ユーザーと解析済み入力をRepositoryへ渡す", async () => {
    const repository: ItemImportRepository = {
      import: vi.fn(async () => ({ insertedItems: 2 })),
    };

    const result = await importItemsUseCase(
      { repository },
      { userId: "user-1", input },
    );

    expect(result).toEqual({ insertedItems: 2 });
    expect(repository.import).toHaveBeenCalledWith("user-1", input);
  });

  it("Repositoryの失敗を呼び出し側へ伝える", async () => {
    const error = new Error("database error");
    const repository: ItemImportRepository = {
      import: vi.fn(async () => {
        throw error;
      }),
    };

    await expect(
      importItemsUseCase({ repository }, { userId: "user-1", input }),
    ).rejects.toBe(error);
  });
});
