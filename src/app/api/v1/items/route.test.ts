import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadApiItemsUseCase: vi.fn(),
  getApiUser: vi.fn(),
  unauthorized: vi.fn(() =>
    Response.json({ error: "unauthorized" }, { status: 401 }),
  ),
  badRequest: vi.fn((message: string) =>
    Response.json({ error: message }, { status: 400 }),
  ),
  dbErrorResponse: vi.fn(() =>
    Response.json({ error: "database error" }, { status: 500 }),
  ),
}));

vi.mock("@/features/items/application/item-api-query-use-cases", () => ({
  loadApiItemsUseCase: mocks.loadApiItemsUseCase,
}));

vi.mock("@/features/items/infrastructure/prisma-item-api-query-repository", () => ({
  prismaItemApiQueryRepository: {},
}));

vi.mock("@/db/client", () => ({ withUser: vi.fn() }));
vi.mock("@/db/serialize", () => ({ toItem: vi.fn() }));

vi.mock("@/lib/auth/api", () => ({
  getApiUser: mocks.getApiUser,
  unauthorized: mocks.unauthorized,
  badRequest: mocks.badRequest,
  dbErrorResponse: mocks.dbErrorResponse,
}));

import { GET } from "@/app/api/v1/items/route";

const items = Object.freeze([
  Object.freeze({ id: 1, name: "Camera", category_ids: Object.freeze([3]) }),
]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApiUser.mockResolvedValue({ sub: "user-1", email: "user@example.com" });
  mocks.loadApiItemsUseCase.mockResolvedValue(items);
});

describe("GET /api/v1/items", () => {
  it("returns 401 when authentication fails", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/v1/items"));

    expect(response.status).toBe(401);
    expect(mocks.unauthorized).toHaveBeenCalledOnce();
    expect(mocks.loadApiItemsUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid status", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/items?status=unknown"),
    );

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith("invalid status: unknown");
    expect(mocks.loadApiItemsUseCase).not.toHaveBeenCalled();
  });

  it.each([
    ["http://localhost/api/v1/items", null],
    ["http://localhost/api/v1/items?status=sold", "sold"],
  ])("loads items with the parsed status from %s", async (url, status) => {
    const response = await GET(new NextRequest(url));

    expect(mocks.loadApiItemsUseCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      status,
    });
    await expect(response.json()).resolves.toEqual({ items });
  });

  it("converts query failures to the shared database response", async () => {
    const error = new Error("database failure");
    mocks.loadApiItemsUseCase.mockRejectedValue(error);

    const response = await GET(new NextRequest("http://localhost/api/v1/items"));

    expect(response.status).toBe(500);
    expect(mocks.dbErrorResponse).toHaveBeenCalledWith(error);
  });
});
