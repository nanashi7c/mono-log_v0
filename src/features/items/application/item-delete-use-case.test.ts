import { describe, expect, it, vi } from "vitest";
import type {
  ItemDeleteRepository,
  ItemImageRemover,
} from "@/features/items/application/item-delete-ports";
import {
  deleteItemUseCase,
  type ItemDeleteDependencies,
} from "@/features/items/application/item-delete-use-case";

function createDependencies(): ItemDeleteDependencies {
  const repository: ItemDeleteRepository = {
    delete: vi.fn(async () => ({
      type: "deleted" as const,
      previousImageKey: "old.png",
    })),
  };
  const imageRemover: ItemImageRemover = {
    remove: vi.fn(async () => undefined),
  };
  return {
    repository,
    imageRemover,
    onCleanupError: vi.fn(),
  };
}

describe("deleteItemUseCase", () => {
  it("DBからアイテムを削除してから画像を削除する", async () => {
    const dependencies = createDependencies();

    const result = await deleteItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
    });

    expect(result).toEqual({
      type: "deleted",
      previousImageKey: "old.png",
    });
    expect(dependencies.repository.delete).toHaveBeenCalledWith("user-1", 10);
    expect(dependencies.imageRemover.remove).toHaveBeenCalledWith("old.png");
    expect(
      vi.mocked(dependencies.repository.delete).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.imageRemover.remove).mock.invocationCallOrder[0],
    );
  });

  it("DB成功後の画像削除失敗を通知し、削除処理自体は成功にする", async () => {
    const dependencies = createDependencies();
    const cleanupError = new Error("storage error");
    dependencies.imageRemover.remove = vi.fn(async () => {
      throw cleanupError;
    });

    await expect(
      deleteItemUseCase(dependencies, { userId: "user-1", itemId: 10 }),
    ).resolves.toEqual({
      type: "deleted",
      previousImageKey: "old.png",
    });
    expect(dependencies.onCleanupError).toHaveBeenCalledWith(cleanupError);
  });

  it("後処理エラーの通知処理が失敗しても削除結果を維持する", async () => {
    const baseDependencies = createDependencies();
    baseDependencies.imageRemover.remove = vi.fn(async () => {
      throw new Error("storage error");
    });
    const dependencies: ItemDeleteDependencies = {
      ...baseDependencies,
      onCleanupError() {
        throw new Error("logging error");
      },
    };

    await expect(
      deleteItemUseCase(dependencies, { userId: "user-1", itemId: 10 }),
    ).resolves.toEqual({
      type: "deleted",
      previousImageKey: "old.png",
    });
  });

  it("削除対象が存在しない場合は画像を削除しない", async () => {
    const dependencies = createDependencies();
    dependencies.repository.delete = vi.fn(async () => ({
      type: "not_found" as const,
    }));

    const result = await deleteItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
    });

    expect(result).toEqual({ type: "not_found" });
    expect(dependencies.imageRemover.remove).not.toHaveBeenCalled();
  });

  it("以前の画像がない場合は画像ストレージを呼び出さない", async () => {
    const dependencies = createDependencies();
    dependencies.repository.delete = vi.fn(async () => ({
      type: "deleted" as const,
      previousImageKey: null,
    }));

    const result = await deleteItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
    });

    expect(result).toEqual({ type: "deleted", previousImageKey: null });
    expect(dependencies.imageRemover.remove).not.toHaveBeenCalled();
  });
});
