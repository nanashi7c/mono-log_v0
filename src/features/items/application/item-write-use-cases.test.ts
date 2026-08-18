import { describe, expect, it, vi } from "vitest";
import type {
  ItemImageObjectStore,
  PendingItemImageUploadRepository,
} from "@/features/items/application/item-image-upload-ports";
import type { ItemWriteInput } from "@/features/items/application/item-write-input";
import type { ItemWriteRepository } from "@/features/items/application/item-write-ports";
import {
  createItemUseCase,
  updateItemUseCase,
} from "@/features/items/application/item-write-use-cases";

const NOW_EPOCH_MS = Date.parse("2026-08-19T00:00:00.000Z");
const UPLOAD_ID = "123e4567-e89b-42d3-a456-426614174000";

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

function createDependencies() {
  const repository: ItemWriteRepository = {
    create: vi.fn(async () => 10),
    update: vi.fn(async () => ({
      type: "updated" as const,
      previousImageKey: "old.png",
    })),
  };
  const pendingImageUploads: PendingItemImageUploadRepository = {
    reserve: vi.fn(async () => undefined),
    findById: vi.fn(async () => ({
      id: UPLOAD_ID,
      objectKey: "user-1/items/new.png",
      contentType: "image/png",
      expiresAtEpochMs: Date.parse("2026-08-20T00:00:00.000Z"),
    })),
    findExpired: vi.fn(async () => []),
    remove: vi.fn(async () => undefined),
  };
  const imageStore: ItemImageObjectStore = {
    inspect: vi.fn(async () => ({ contentType: "image/png", size: 1024 })),
    remove: vi.fn(async () => undefined),
  };
  const onCleanupError = vi.fn();
  return {
    repository,
    pendingImageUploads,
    imageStore,
    now: () => NOW_EPOCH_MS,
    onCleanupError,
  };
}

describe("createItemUseCase", () => {
  it("S3上のpending画像を確認してから、そのIDと一緒にアイテムを作成する", async () => {
    const dependencies = createDependencies();

    const itemId = await createItemUseCase(dependencies, {
      userId: "user-1",
      input,
      imageUploadId: UPLOAD_ID,
    });

    expect(itemId).toBe(10);
    expect(dependencies.pendingImageUploads.findById).toHaveBeenCalledWith(
      "user-1",
      UPLOAD_ID,
    );
    expect(dependencies.imageStore.inspect).toHaveBeenCalledWith(
      "user-1/items/new.png",
    );
    expect(dependencies.repository.create).toHaveBeenCalledWith(
      "user-1",
      input,
      UPLOAD_ID,
    );
  });

  it("DB作成に失敗してもpending画像を残す", async () => {
    const dependencies = createDependencies();
    const databaseError = new Error("database error");
    dependencies.repository.create = vi.fn(async () => {
      throw databaseError;
    });

    await expect(
      createItemUseCase(dependencies, {
        userId: "user-1",
        input,
        imageUploadId: UPLOAD_ID,
      }),
    ).rejects.toBe(databaseError);
    expect(dependencies.imageStore.remove).not.toHaveBeenCalled();
    expect(dependencies.pendingImageUploads.remove).not.toHaveBeenCalled();
  });

  it("S3に画像がなければDB作成を開始しない", async () => {
    const dependencies = createDependencies();
    dependencies.imageStore.inspect = vi.fn(async () => null);

    await expect(
      createItemUseCase(dependencies, {
        userId: "user-1",
        input,
        imageUploadId: UPLOAD_ID,
      }),
    ).rejects.toThrow("画像のアップロードが完了していません");
    expect(dependencies.repository.create).not.toHaveBeenCalled();
  });
});

describe("updateItemUseCase", () => {
  it("pending画像IDでDBを更新してから、古い画像を削除する", async () => {
    const dependencies = createDependencies();

    const result = await updateItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
      input,
      imageUploadId: UPLOAD_ID,
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
      { type: "replace", uploadId: UPLOAD_ID },
    );
    expect(dependencies.imageStore.remove).toHaveBeenCalledWith("old.png");
  });

  it("DB更新に失敗したらpending画像と古い画像を残す", async () => {
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
        imageUploadId: UPLOAD_ID,
        deleteImage: false,
      }),
    ).rejects.toBe(databaseError);
    expect(dependencies.imageStore.remove).not.toHaveBeenCalled();
    expect(dependencies.pendingImageUploads.remove).not.toHaveBeenCalled();
  });

  it("更新対象が存在しない場合はpending画像を残す", async () => {
    const dependencies = createDependencies();
    dependencies.repository.update = vi.fn(async () => ({
      type: "not_found" as const,
    }));

    const result = await updateItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
      input,
      imageUploadId: UPLOAD_ID,
      deleteImage: false,
    });

    expect(result).toEqual({ type: "not_found" });
    expect(dependencies.imageStore.remove).not.toHaveBeenCalled();
  });

  it("画像指定がなければ現在の画像を維持する", async () => {
    const dependencies = createDependencies();

    await updateItemUseCase(dependencies, {
      userId: "user-1",
      itemId: 10,
      input,
      imageUploadId: null,
      deleteImage: false,
    });

    expect(dependencies.repository.update).toHaveBeenCalledWith(
      "user-1",
      10,
      input,
      { type: "keep" },
    );
    expect(dependencies.pendingImageUploads.findById).not.toHaveBeenCalled();
    expect(dependencies.imageStore.remove).not.toHaveBeenCalled();
  });
});
