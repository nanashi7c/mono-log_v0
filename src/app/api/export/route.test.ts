import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportItemsUseCase: vi.fn(),
  getCurrentUser: vi.fn(),
  itemBackupCsvFilename: vi.fn(),
  serializeItemBackupCsv: vi.fn(),
}));

vi.mock("@/features/items/adapters/item-backup-csv", () => ({
  itemBackupCsvFilename: mocks.itemBackupCsvFilename,
  serializeItemBackupCsv: mocks.serializeItemBackupCsv,
}));

vi.mock("@/features/items/application/item-export-use-cases", () => ({
  exportItemsUseCase: mocks.exportItemsUseCase,
}));

vi.mock("@/features/items/infrastructure/prisma-item-export-repository", () => ({
  prismaItemExportRepository: {},
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { GET } from "@/app/api/export/route";

const backup = {
  version: 1,
  exported_at: "2026-08-15T12:00:00.000Z",
  categories: [],
  items: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "user-1" });
  mocks.exportItemsUseCase.mockResolvedValue(backup);
  mocks.itemBackupCsvFilename.mockReturnValue("mono-log-2026-08-15.csv");
  mocks.serializeItemBackupCsv.mockReturnValue("csv-data");
});

describe("GET /api/export", () => {
  it("未認証の場合は401を返す", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mocks.exportItemsUseCase).not.toHaveBeenCalled();
  });

  it("バックアップをCSVと日付付きファイル名で返す", async () => {
    const response = await GET();

    expect(mocks.exportItemsUseCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
    });
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="mono-log-2026-08-15.csv"',
    );
    expect(mocks.serializeItemBackupCsv).toHaveBeenCalledWith(backup);
    await expect(response.text()).resolves.toBe("csv-data");
  });
});
