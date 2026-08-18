import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareItemImageUploadUseCase: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock(
  "@/features/items/application/item-image-upload-use-cases",
  () => ({
    prepareItemImageUploadUseCase: mocks.prepareItemImageUploadUseCase,
  }),
);

vi.mock(
  "@/features/items/infrastructure/prisma-pending-item-image-upload-repository",
  () => ({
    prismaPendingItemImageUploadRepository: {},
  }),
);

vi.mock("@/features/items/infrastructure/s3-item-image-store", () => ({
  s3ItemImageStore: {},
  s3ItemImageUploadSigner: {},
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { prepareItemImageUpload } from "@/app/items/image-upload-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "user-1" });
  mocks.prepareItemImageUploadUseCase.mockResolvedValue({
    ok: true,
    value: {
      uploadId: "upload-1",
      url: "https://bucket.example.test",
      fields: { policy: "signed-policy" },
    },
  });
});

describe("prepareItemImageUpload", () => {
  it("認証ユーザーと画像メタデータをuse caseへ渡す", async () => {
    const result = await prepareItemImageUpload({
      contentType: "image/png",
      size: 1024,
    });

    expect(result).toMatchObject({ ok: true });
    expect(mocks.prepareItemImageUploadUseCase).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
        contentType: "image/png",
        size: 1024,
      },
    );
  });

  it("未認証なら署名を作成しない", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(
      prepareItemImageUpload({ contentType: "image/png", size: 1024 }),
    ).resolves.toEqual({ ok: false, error: "ログインし直してください。" });
    expect(mocks.prepareItemImageUploadUseCase).not.toHaveBeenCalled();
  });

  it("内部エラーの詳細をクライアントへ返さない", async () => {
    mocks.prepareItemImageUploadUseCase.mockRejectedValue(
      new Error("storage credential detail"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      prepareItemImageUpload({ contentType: "image/png", size: 1024 }),
    ).resolves.toEqual({
      ok: false,
      error: "画像アップロードを準備できませんでした。",
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
