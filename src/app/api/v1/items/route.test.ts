import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApiItemUseCase: vi.fn(),
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

vi.mock("@/features/items/application/item-api-command-use-cases", () => ({
  createApiItemUseCase: mocks.createApiItemUseCase,
}));

vi.mock("@/features/items/application/item-api-query-use-cases", () => ({
  loadApiItemsUseCase: mocks.loadApiItemsUseCase,
}));

vi.mock("@/features/items/infrastructure/prisma-item-api-command-repository", () => ({
  prismaItemApiCommandRepository: {},
}));

vi.mock("@/features/items/infrastructure/prisma-item-api-query-repository", () => ({
  prismaItemApiQueryRepository: {},
}));

vi.mock("@/lib/auth/api", () => ({
  getApiUser: mocks.getApiUser,
  unauthorized: mocks.unauthorized,
  badRequest: mocks.badRequest,
  dbErrorResponse: mocks.dbErrorResponse,
}));

import { GET, POST } from "@/app/api/v1/items/route";

const items = Object.freeze([
  Object.freeze({ id: 1, name: "Camera", category_ids: Object.freeze([3]) }),
]);
const createdItem = Object.freeze({
  id: 2,
  name: "New camera",
  category_ids: Object.freeze([3]),
});

function postRequest(body: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApiUser.mockResolvedValue({ sub: "user-1", email: "user@example.com" });
  mocks.loadApiItemsUseCase.mockResolvedValue(items);
  mocks.createApiItemUseCase.mockResolvedValue({
    status: "created",
    item: createdItem,
  });
});

describe("POST /api/v1/items", () => {
  it("returns 401 when authentication fails", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await POST(postRequest('{"name":"New camera"}'));

    expect(response.status).toBe(401);
    expect(mocks.createApiItemUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(postRequest("{"));

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith("invalid JSON body");
    expect(mocks.createApiItemUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 when body validation fails", async () => {
    const response = await POST(postRequest("{}"));

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith("name is required");
    expect(mocks.createApiItemUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid purchased_at", async () => {
    const response = await POST(
      postRequest('{"name":"New camera","purchased_at":"2026-02-30"}'),
    );

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith(
      "purchased_at must be YYYY-MM-DD or null",
    );
    expect(mocks.createApiItemUseCase).not.toHaveBeenCalled();
  });

  it("creates an item and returns the public response envelope", async () => {
    const response = await POST(
      postRequest(
        JSON.stringify({
          name: " New camera ",
          status: "owned",
          category_ids: [3],
        }),
      ),
    );

    expect(mocks.createApiItemUseCase).toHaveBeenCalledWith(
      expect.anything(),
      {
        actor: { userId: "user-1", email: "user@example.com" },
        input: {
          status: "owned",
          name: "New camera",
          janCode: null,
          quantity: 1,
          notes: null,
          actualPrice: null,
          purchasedAt: null,
          categoryIds: [3],
        },
      },
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ item: createdItem });
  });

  it("returns 400 without disclosing an unavailable category", async () => {
    mocks.createApiItemUseCase.mockResolvedValue({
      status: "invalid_categories",
    });

    const response = await POST(
      postRequest('{"name":"New camera","category_ids":[999]}'),
    );

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith("invalid category_ids");
    await expect(response.json()).resolves.toEqual({
      error: "invalid category_ids",
    });
  });

  it("converts command failures to the shared database response", async () => {
    const error = new Error("database failure");
    mocks.createApiItemUseCase.mockRejectedValue(error);

    const response = await POST(postRequest('{"name":"New camera"}'));

    expect(response.status).toBe(500);
    expect(mocks.dbErrorResponse).toHaveBeenCalledWith(error);
  });
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
