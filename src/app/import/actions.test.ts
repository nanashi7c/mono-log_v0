import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemImportInput } from "@/features/items/application/item-import-input";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
  parseItemBackupCsv: vi.fn(),
  importItemsUseCase: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/features/items/adapters/item-backup-csv", () => ({
  parseItemBackupCsv: mocks.parseItemBackupCsv,
}));

vi.mock("@/features/items/application/item-import-use-cases", () => ({
  importItemsUseCase: mocks.importItemsUseCase,
}));

vi.mock("@/features/items/infrastructure/prisma-item-import-repository", () => ({
  prismaItemImportRepository: {},
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { importBackup } from "@/app/import/actions";

const consoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

const input: ItemImportInput = {
  categories: [],
  items: [],
};

function backupFormData(): FormData {
  const formData = new FormData();
  formData.set(
    "file",
    new File(["record_type,name"], "backup.csv", {
      type: "text/csv",
    }),
  );
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "user-1" });
  mocks.parseItemBackupCsv.mockReturnValue({ ok: true, value: input });
  mocks.importItemsUseCase.mockResolvedValue({ insertedItems: 2 });
});

afterAll(() => {
  consoleError.mockRestore();
});

describe("importBackup", () => {
  it("未認証の場合はファイルを処理せずログイン画面へ遷移する", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(importBackup(new FormData())).rejects.toThrow(
      "redirect:/login",
    );

    expect(mocks.parseItemBackupCsv).not.toHaveBeenCalled();
    expect(mocks.importItemsUseCase).not.toHaveBeenCalled();
  });

  it("ファイルがない場合は入力エラーにする", async () => {
    await expect(importBackup(new FormData())).rejects.toThrow(
      "redirect:/import?error=no-file",
    );

    expect(mocks.parseItemBackupCsv).not.toHaveBeenCalled();
  });

  it("解析エラーをインポート画面へ渡す", async () => {
    mocks.parseItemBackupCsv.mockReturnValue({
      ok: false,
      error: "invalid format",
    });

    await expect(importBackup(backupFormData())).rejects.toThrow(
      "redirect:/import?error=invalid%20format",
    );

    expect(mocks.importItemsUseCase).not.toHaveBeenCalled();
  });

  it("永続化エラーの詳細を公開せず、固定エラーコードで戻す", async () => {
    const internalError = new Error("database error");
    mocks.importItemsUseCase.mockRejectedValue(internalError);

    await expect(importBackup(backupFormData())).rejects.toThrow(
      "redirect:/import?error=import-failed",
    );

    expect(consoleError).toHaveBeenCalledWith(
      "CSVインポートの保存に失敗しました。",
      internalError,
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("取り込み成功後は一覧を再検証して件数を表示する", async () => {
    await expect(importBackup(backupFormData())).rejects.toThrow(
      "redirect:/import?ok=2%20%E4%BB%B6%E3%81%AE%E3%82%A2%E3%82%A4%E3%83%86%E3%83%A0%E3%82%92%E5%8F%96%E3%82%8A%E8%BE%BC%E3%81%BF%E3%81%BE%E3%81%97%E3%81%9F%E3%80%82",
    );

    expect(mocks.importItemsUseCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      input,
    });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/",
      "/items",
    ]);
  });
});
