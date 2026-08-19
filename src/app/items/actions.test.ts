import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemWriteRejectedError } from "@/features/items/application/item-write-error";
import type { ItemWriteInput } from "@/features/items/application/item-write-input";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error("not-found");
  }),
  parseItemForm: vi.fn(),
  createItemUseCase: vi.fn(),
  updateItemUseCase: vi.fn(),
  deleteItemUseCase: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

vi.mock("@/features/items/adapters/parse-item-form", () => ({
  parseItemForm: mocks.parseItemForm,
}));

vi.mock("@/features/items/application/item-write-use-cases", () => ({
  createItemUseCase: mocks.createItemUseCase,
  updateItemUseCase: mocks.updateItemUseCase,
}));

vi.mock("@/features/items/application/item-delete-use-case", () => ({
  deleteItemUseCase: mocks.deleteItemUseCase,
}));

vi.mock(
  "@/features/items/infrastructure/prisma-item-write-repository",
  () => ({
    prismaItemWriteRepository: {},
  }),
);

vi.mock(
  "@/features/items/infrastructure/prisma-item-delete-repository",
  () => ({
    prismaItemDeleteRepository: {},
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
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { createItem, deleteItem, updateItem } from "@/app/items/actions";

const consoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

const input = {
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
} satisfies ItemWriteInput;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "user-1" });
  mocks.parseItemForm.mockReturnValue({
    ok: true,
    value: {
      input,
      imageUploadId: null,
      deleteImage: false,
    },
  });
});

afterAll(() => {
  consoleError.mockRestore();
});

describe("createItem", () => {
  it("想定外のエラー詳細を公開せず、固定エラーコードで追加画面へ戻す", async () => {
    const internalError = new Error(
      'Invalid prisma.item.create() invocation: invalid DateTime',
    );
    mocks.createItemUseCase.mockRejectedValue(internalError);

    await expect(createItem(new FormData())).rejects.toThrow(
      "redirect:/items/new?error=save-failed",
    );

    expect(mocks.redirect).toHaveBeenCalledWith("/items/new?error=save-failed");
    expect(consoleError).toHaveBeenCalledWith(
      "アイテムの作成に失敗しました。",
      internalError,
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateItem", () => {
  it("更新対象が存在しない場合は404にし、キャッシュを更新しない", async () => {
    mocks.updateItemUseCase.mockResolvedValue({ type: "not_found" });

    await expect(updateItem(10, new FormData())).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("想定外のエラー詳細を公開せず、固定エラーコードで編集画面へ戻す", async () => {
    const internalError = new Error("database error");
    mocks.updateItemUseCase.mockRejectedValue(internalError);

    await expect(updateItem(10, new FormData())).rejects.toThrow(
      "redirect:/items/10/edit?error=save-failed",
    );

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/items/10/edit?error=save-failed",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "アイテムの更新に失敗しました。",
      internalError,
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("利用者が修正できるエラーだけを編集画面へ返す", async () => {
    mocks.updateItemUseCase.mockRejectedValue(
      new ItemWriteRejectedError("invalid_categories"),
    );

    const expectedPath = `/items/10/edit?error=${encodeURIComponent(
      "選択されたカテゴリが存在しないか、このユーザーには利用できません。",
    )}`;
    await expect(updateItem(10, new FormData())).rejects.toThrow(
      `redirect:${expectedPath}`,
    );

    expect(mocks.redirect).toHaveBeenCalledWith(expectedPath);
    expect(consoleError).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("更新成功後は関連画面を再検証して詳細画面へ遷移する", async () => {
    mocks.updateItemUseCase.mockResolvedValue({
      type: "updated",
      previousImageKey: null,
    });

    await expect(updateItem(10, new FormData())).rejects.toThrow(
      "redirect:/items/10",
    );

    expect(mocks.updateItemUseCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      itemId: 10,
      input,
      imageUploadId: null,
      deleteImage: false,
    });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/",
      "/items",
      "/items/planned",
      "/items/selling",
      "/dashboard",
      "/items/10",
      "/items/10/edit",
    ]);
    expect(mocks.redirect).toHaveBeenCalledWith("/items/10");
  });
});

describe("deleteItem", () => {
  it("削除対象が存在しない場合は404にし、キャッシュを更新しない", async () => {
    mocks.deleteItemUseCase.mockResolvedValue({ type: "not_found" });

    await expect(deleteItem(10)).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("削除成功後は一覧画面を再検証して一覧へ遷移する", async () => {
    mocks.deleteItemUseCase.mockResolvedValue({
      type: "deleted",
      previousImageKey: null,
    });

    await expect(deleteItem(10)).rejects.toThrow("redirect:/items");

    expect(mocks.deleteItemUseCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      itemId: 10,
    });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/",
      "/items",
      "/items/planned",
      "/items/selling",
      "/dashboard",
    ]);
    expect(mocks.redirect).toHaveBeenCalledWith("/items");
  });
});
