import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportItemsUseCase: vi.fn(),
  getApiUser: vi.fn(),
  unauthorized: vi.fn(() =>
    Response.json({ error: "unauthorized" }, { status: 401 }),
  ),
  dbErrorResponse: vi.fn(() =>
    Response.json({ error: "database error" }, { status: 500 }),
  ),
}));

vi.mock("@/features/items/application/item-export-use-cases", () => ({
  exportItemsUseCase: mocks.exportItemsUseCase,
}));

vi.mock("@/features/items/infrastructure/prisma-item-export-repository", () => ({
  prismaItemExportRepository: {},
}));

vi.mock("@/lib/auth/api", () => ({
  getApiUser: mocks.getApiUser,
  unauthorized: mocks.unauthorized,
  dbErrorResponse: mocks.dbErrorResponse,
}));

import { GET } from "@/app/api/v1/export/route";

const request = new NextRequest("http://localhost/api/v1/export");
const backup = {
  version: 1,
  exported_at: "2026-08-15T12:00:00.000Z",
  categories: [],
  items: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApiUser.mockResolvedValue({ sub: "user-1" });
  mocks.exportItemsUseCase.mockResolvedValue(backup);
});

describe("GET /api/v1/export", () => {
  it("Bearer認証に失敗した場合は401を返す", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mocks.unauthorized).toHaveBeenCalledOnce();
    expect(mocks.exportItemsUseCase).not.toHaveBeenCalled();
  });

  it("認証ユーザーのバックアップをJSONで返す", async () => {
    const response = await GET(request);

    expect(mocks.exportItemsUseCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
    });
    await expect(response.json()).resolves.toEqual(backup);
  });

  it("永続化失敗を共通DBエラーレスポンスへ変換する", async () => {
    const error = new Error("database failure");
    mocks.exportItemsUseCase.mockRejectedValue(error);

    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(mocks.dbErrorResponse).toHaveBeenCalledWith(error);
  });
});
