import { describe, expect, it, vi } from "vitest";
import type { ItemWriteInput } from "@/features/items/application/item-write-input";
import type {
  ItemImageFile,
  ItemImageStore,
  ItemWriteRepository,
} from "@/features/items/application/item-write-ports";
import {
  createItemUseCase,
  deleteItemUseCase,
  updateItemUseCase,
} from "@/features/items/application/item-write-use-cases";

const input: ItemWriteInput = {
  name: "test item",
  status: "owned",
  categoryIds: [],
  newCategoryNames: [],
  janCode: null,
  quantity: 1,
  notes: null,
  actualPrice: null,
  purchasedAt: null,
  plan: {
    plannedPurchaseYear: null,
    plannedPurchaseMonth: null,
    listPrice: null,
    purchasePrice: null,
    productUrl: null,
    dealPeriod: null,
  },
  listing: {
    platformId: null,
    serviceId: null,
    sizeId: null,
    quantity: null,
    sellingPrice: null,
    packagingCost: null,
    workTimeHours: null,
    laborRate: null,
  },
};

const image: ItemImageFile = {
  name: "item.png",
  type: "image/png",
  async arrayBuffer() {
    return new ArrayBuffer(0);
  },
};

function createDependencies() {
  const repository: ItemWriteRepository = {
    create: vi.fn(async () => 10),
    update: vi.fn(async () => ({
      type: "updated" as const,
      previousImageKey: "old.png",
    })),
    delete: vi.fn(async () => ({
      type: "deleted" as const,
      previousImageKey: "old.png",
    })),
  };
  const imageStore: ItemImageStore = {
    upload: vi.fn(async () => "new.png"),
    remove: vi.fn(async () => undefined),
  };
  const onCleanupError = vi.fn();
  return { repository, imageStore, onCleanupError };
}

describe("createItemUseCase", () => {
  it("画像を保存してから、そのキーと一緒にアイテムを作成する", async () => {
    const dependencies = createDependencies();

    const itemId = await createItemUseCase(dependencies, {
      userId: "user-1",
      input,
      image,
    });

    expect(itemId).toBe(10);
    expect(dependencies.imageStore.upload).toHaveBeenCalledWith("user-1", image);
    expect(dependencies.repository.create).toHaveBeenCalledWith(
      "user-1",
      input,
      "new.png",
    );
  });

  it("DB作成に失敗したら、先に保存した画像を削除する", async () => {
    const dependencies = createDependencies();
    const databaseError = new Error("database error");
    dependencies.repository.create = vi.fn(async () => {
      throw databaseError;
    });

    await expect(
      createItemUseCase(dependencies, { userId: "user-1", input, image }),
    ).rejects.toBe(databaseError);
    expect(dependencies.imageStore.remove).toHaveBeenCalledWith("new.png");
  });
});

describe("updateItemUseCase", () => {
  it("DB上の画像キーを切り替えてから、古い画像を削除する", async () => {
    const dependencies = createDependencies();

    const result = await updateItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
      input,
      image,
      deleteImage: false,
    });

    expect(result).toEqual({
      type: "updated",
      previousImageKey: "old.png",
    });
    expect(dependencies.repository.update).toHaveBeenCalledWith(
      "user-1",
      10,
      input,
      { type: "replace", key: "new.png" },
    );
    expect(dependencies.imageStore.remove).toHaveBeenCalledWith("old.png");
  });

  it("DB更新に失敗したら新しい画像だけを削除し、古い画像を残す", async () => {
    const dependencies = createDependencies();
    const databaseError = new Error("database error");
    dependencies.repository.update = vi.fn(async () => {
      throw databaseError;
    });

    await expect(
      updateItemUseCase(dependencies, {
        userId: "user-1",
        itemId: 10,
        input,
        image,
        deleteImage: false,
      }),
    ).rejects.toBe(databaseError);
    expect(dependencies.imageStore.remove).toHaveBeenCalledTimes(1);
    expect(dependencies.imageStore.remove).toHaveBeenCalledWith("new.png");
  });

  it("更新対象が存在しない場合はアップロードした新画像を削除する", async () => {
    const dependencies = createDependencies();
    dependencies.repository.update = vi.fn(async () => ({
      type: "not_found" as const,
    }));

    const result = await updateItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
      input,
      image,
      deleteImage: false,
    });

    expect(result).toEqual({ type: "not_found" });
    expect(dependencies.imageStore.remove).toHaveBeenCalledTimes(1);
    expect(dependencies.imageStore.remove).toHaveBeenCalledWith("new.png");
  });

  it("画像指定がなければ現在の画像を維持する", async () => {
    const dependencies = createDependencies();

    await updateItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
      input,
      image: null,
      deleteImage: false,
    });

    expect(dependencies.repository.update).toHaveBeenCalledWith(
      "user-1",
      10,
      input,
      { type: "keep" },
    );
    expect(dependencies.imageStore.remove).not.toHaveBeenCalled();
  });
});

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
    expect(dependencies.imageStore.remove).toHaveBeenCalledWith("old.png");
    expect(vi.mocked(dependencies.repository.delete).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dependencies.imageStore.remove).mock.invocationCallOrder[0],
    );
  });

  it("DB成功後の画像削除失敗を通知し、削除処理自体は成功にする", async () => {
    const dependencies = createDependencies();
    const cleanupError = new Error("storage error");
    dependencies.imageStore.remove = vi.fn(async () => {
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
    expect(dependencies.imageStore.remove).not.toHaveBeenCalled();
  });
});
