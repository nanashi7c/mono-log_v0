import { describe, expect, it, vi } from "vitest";
import {
  itemBackupFilename,
  type ItemExportData,
} from "@/features/items/application/item-export-data";
import type { ItemExportRepository } from "@/features/items/application/item-export-ports";
import { exportItemsUseCase } from "@/features/items/application/item-export-use-cases";

const data: ItemExportData = {
  categories: [],
  items: [],
};

describe("exportItemsUseCase", () => {
  it("ユーザーのデータへバージョンと固定時刻を付ける", async () => {
    const repository: ItemExportRepository = {
      read: vi.fn(async () => data),
    };
    const now = new Date("2026-08-15T23:59:59.000Z");

    const backup = await exportItemsUseCase(
      { repository, now: () => now },
      { userId: "user-1" },
    );

    expect(backup).toEqual({
      version: 1,
      exported_at: "2026-08-15T23:59:59.000Z",
      categories: [],
      items: [],
    });
    expect(repository.read).toHaveBeenCalledWith("user-1");
    expect(Object.isFrozen(backup)).toBe(true);
  });

  it("エクスポート時刻と同じ日付のファイル名を作る", async () => {
    const repository: ItemExportRepository = {
      read: vi.fn(async () => data),
    };
    const backup = await exportItemsUseCase(
      {
        repository,
        now: () => new Date("2026-08-15T23:59:59.999Z"),
      },
      { userId: "user-1" },
    );

    expect(itemBackupFilename(backup)).toBe("mono-log-2026-08-15.json");
  });
});
