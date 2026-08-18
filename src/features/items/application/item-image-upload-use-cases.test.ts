import { describe, expect, it, vi } from "vitest";
import type {
  ItemImageObjectStore,
  ItemImageUploadSigner,
  PendingItemImageUploadRepository,
} from "@/features/items/application/item-image-upload-ports";
import {
  ITEM_IMAGE_MAX_BYTES,
  prepareItemImageUploadUseCase,
  verifyPendingItemImageUpload,
} from "@/features/items/application/item-image-upload-use-cases";

const NOW_EPOCH_MS = Date.parse("2026-08-19T00:00:00.000Z");
const UPLOAD_ID = "123e4567-e89b-42d3-a456-426614174000";

function createDependencies() {
  const repository: PendingItemImageUploadRepository = {
    reserve: vi.fn(async () => undefined),
    findById: vi.fn(async () => null),
    findExpired: vi.fn(async () => []),
    remove: vi.fn(async () => undefined),
  };
  const signer: ItemImageUploadSigner = {
    sign: vi.fn(async () => ({
      url: "https://bucket.example.test",
      fields: { policy: "signed-policy" },
    })),
  };
  const objectStore: ItemImageObjectStore = {
    inspect: vi.fn(async () => ({ contentType: "image/png", size: 1024 })),
    remove: vi.fn(async () => undefined),
  };
  const onCleanupError = vi.fn();
  return {
    repository,
    signer,
    objectStore,
    createId: () => UPLOAD_ID,
    now: () => NOW_EPOCH_MS,
    onCleanupError,
  };
}

describe("prepareItemImageUploadUseCase", () => {
  it("S3の制約を署名し、24時間有効なpendingレコードを作成する", async () => {
    const dependencies = createDependencies();

    const result = await prepareItemImageUploadUseCase(dependencies, {
      userId: "user-1",
      contentType: "image/png",
      size: 1024,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        uploadId: UPLOAD_ID,
        url: "https://bucket.example.test",
        fields: { policy: "signed-policy" },
      },
    });
    expect(dependencies.signer.sign).toHaveBeenCalledWith({
      key: `user-1/items/${UPLOAD_ID}.png`,
      contentType: "image/png",
      maxBytes: ITEM_IMAGE_MAX_BYTES,
      expiresInSeconds: 300,
    });
    expect(dependencies.repository.reserve).toHaveBeenCalledWith("user-1", {
      id: UPLOAD_ID,
      objectKey: `user-1/items/${UPLOAD_ID}.png`,
      contentType: "image/png",
      expiresAtEpochMs: Date.parse("2026-08-20T00:00:00.000Z"),
    });
  });

  it.each([
    ["image/svg+xml", 100, "JPEG、PNG、GIF、WebP形式"],
    ["image/png", 0, "10MB以下"],
    ["image/png", ITEM_IMAGE_MAX_BYTES + 1, "10MB以下"],
    ["image/png", 1.5, "10MB以下"],
  ])("不正な画像を拒否する: %s / %s", async (contentType, size, message) => {
    const dependencies = createDependencies();

    const result = await prepareItemImageUploadUseCase(dependencies, {
      userId: "user-1",
      contentType,
      size,
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining(message) });
    expect(dependencies.signer.sign).not.toHaveBeenCalled();
    expect(dependencies.repository.reserve).not.toHaveBeenCalled();
  });

  it("同じユーザーの期限切れ画像をS3から削除してからpendingレコードを消す", async () => {
    const dependencies = createDependencies();
    dependencies.repository.findExpired = vi.fn(async () => [
      {
        id: "old-upload",
        objectKey: "user-1/items/old.png",
        contentType: "image/png",
        expiresAtEpochMs: Date.parse("2026-08-18T00:00:00.000Z"),
      },
    ]);

    await prepareItemImageUploadUseCase(dependencies, {
      userId: "user-1",
      contentType: "image/png",
      size: 1024,
    });

    expect(dependencies.objectStore.remove).toHaveBeenCalledWith(
      "user-1/items/old.png",
    );
    expect(dependencies.repository.remove).toHaveBeenCalledWith(
      "user-1",
      "old-upload",
    );
    expect(
      vi.mocked(dependencies.objectStore.remove).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.repository.remove).mock.invocationCallOrder[0],
    );
  });
});

describe("verifyPendingItemImageUpload", () => {
  it("期限内の自ユーザー画像がS3に存在すれば成功する", async () => {
    const dependencies = createDependencies();
    dependencies.repository.findById = vi.fn(async () => ({
      id: UPLOAD_ID,
      objectKey: "user-1/items/image.png",
      contentType: "image/png",
      expiresAtEpochMs: Date.parse("2026-08-20T00:00:00.000Z"),
    }));

    await expect(
      verifyPendingItemImageUpload(dependencies, "user-1", UPLOAD_ID),
    ).resolves.toBeUndefined();
    expect(dependencies.objectStore.inspect).toHaveBeenCalledWith(
      "user-1/items/image.png",
    );
  });

  it("期限切れならS3を確認せず拒否する", async () => {
    const dependencies = createDependencies();
    dependencies.repository.findById = vi.fn(async () => ({
      id: UPLOAD_ID,
      objectKey: "user-1/items/image.png",
      contentType: "image/png",
      expiresAtEpochMs: NOW_EPOCH_MS,
    }));

    await expect(
      verifyPendingItemImageUpload(dependencies, "user-1", UPLOAD_ID),
    ).rejects.toThrow("有効期限");
    expect(dependencies.objectStore.inspect).not.toHaveBeenCalled();
  });

  it("S3上の形式または容量が予約内容と異なれば拒否する", async () => {
    const dependencies = createDependencies();
    dependencies.repository.findById = vi.fn(async () => ({
      id: UPLOAD_ID,
      objectKey: "user-1/items/image.png",
      contentType: "image/png",
      expiresAtEpochMs: Date.parse("2026-08-20T00:00:00.000Z"),
    }));
    dependencies.objectStore.inspect = vi.fn(async () => ({
      contentType: "image/jpeg",
      size: 1024,
    }));

    await expect(
      verifyPendingItemImageUpload(dependencies, "user-1", UPLOAD_ID),
    ).rejects.toThrow("形式または容量が不正");
  });
});
