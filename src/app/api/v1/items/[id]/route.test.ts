import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateApiItemUseCase: vi.fn(),
  loadApiItemUseCase: vi.fn(),
  getApiUser: vi.fn(),
  unauthorized: vi.fn(() =>
    Response.json({ error: "unauthorized" }, { status: 401 }),
  ),
  badRequest: vi.fn((message: string) =>
    Response.json({ error: message }, { status: 400 }),
  ),
  jsonError: vi.fn((status: number, message: string) =>
    Response.json({ error: message }, { status }),
  ),
  dbErrorResponse: vi.fn(() =>
    Response.json({ error: "database error" }, { status: 500 }),
  ),
}));

vi.mock("@/features/items/application/item-api-command-use-cases", () => ({
  updateApiItemUseCase: mocks.updateApiItemUseCase,
}));

vi.mock("@/features/items/application/item-api-query-use-cases", () => ({
  loadApiItemUseCase: mocks.loadApiItemUseCase,
}));

vi.mock("@/features/items/infrastructure/prisma-item-api-command-repository", () => ({
  prismaItemApiCommandRepository: {},
}));

vi.mock("@/features/items/infrastructure/prisma-item-api-query-repository", () => ({
  prismaItemApiQueryRepository: {},
}));

vi.mock("@/db/client", () => ({ withUser: vi.fn() }));
vi.mock("@/lib/image", () => ({ deleteImage: vi.fn() }));

vi.mock("@/lib/auth/api", () => ({
  getApiUser: mocks.getApiUser,
  unauthorized: mocks.unauthorized,
  badRequest: mocks.badRequest,
  jsonError: mocks.jsonError,
  dbErrorResponse: mocks.dbErrorResponse,
}));

import { GET, PUT } from "@/app/api/v1/items/[id]/route";

const request = new NextRequest("http://localhost/api/v1/items/1");
const item = Object.freeze({
  id: 1,
  name: "Camera",
  category_ids: Object.freeze([3]),
});

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function putRequest(body: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/items/1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApiUser.mockResolvedValue({ sub: "user-1", email: "user@example.com" });
  mocks.loadApiItemUseCase.mockResolvedValue(item);
  mocks.updateApiItemUseCase.mockResolvedValue(item);
});

describe("GET /api/v1/items/:id", () => {
  it("returns 401 when authentication fails", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await GET(request, context("1"));

    expect(response.status).toBe(401);
    expect(mocks.unauthorized).toHaveBeenCalledOnce();
    expect(mocks.loadApiItemUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid id", async () => {
    const response = await GET(request, context("0"));

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith("invalid id");
    expect(mocks.loadApiItemUseCase).not.toHaveBeenCalled();
  });

  it("returns the item from the query use case", async () => {
    const response = await GET(request, context("1"));

    expect(mocks.loadApiItemUseCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      itemId: 1,
    });
    await expect(response.json()).resolves.toEqual({ item });
  });

  it("returns 404 when the item is not visible", async () => {
    mocks.loadApiItemUseCase.mockResolvedValue(null);

    const response = await GET(request, context("1"));

    expect(response.status).toBe(404);
    expect(mocks.jsonError).toHaveBeenCalledWith(404, "not found");
  });

  it("converts query failures to the shared database response", async () => {
    const error = new Error("database failure");
    mocks.loadApiItemUseCase.mockRejectedValue(error);

    const response = await GET(request, context("1"));

    expect(response.status).toBe(500);
    expect(mocks.dbErrorResponse).toHaveBeenCalledWith(error);
  });
});

describe("PUT /api/v1/items/:id", () => {
  it("returns 401 when authentication fails", async () => {
    mocks.getApiUser.mockResolvedValue(null);

    const response = await PUT(
      putRequest('{"name":"Updated camera"}'),
      context("1"),
    );

    expect(response.status).toBe(401);
    expect(mocks.updateApiItemUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid id", async () => {
    const response = await PUT(
      putRequest('{"name":"Updated camera"}'),
      context("0"),
    );

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith("invalid id");
    expect(mocks.updateApiItemUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await PUT(putRequest("{"), context("1"));

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith("invalid JSON body");
    expect(mocks.updateApiItemUseCase).not.toHaveBeenCalled();
  });

  it("returns 400 when body validation fails", async () => {
    const response = await PUT(putRequest("{}"), context("1"));

    expect(response.status).toBe(400);
    expect(mocks.badRequest).toHaveBeenCalledWith("name is required");
    expect(mocks.updateApiItemUseCase).not.toHaveBeenCalled();
  });

  it("updates an item and returns the public response envelope", async () => {
    const response = await PUT(
      putRequest(
        JSON.stringify({
          name: " Updated camera ",
          status: "listed",
          quantity: 2,
          category_ids: [3],
        }),
      ),
      context("1"),
    );

    expect(mocks.updateApiItemUseCase).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
        itemId: 1,
        input: {
          status: "listed",
          name: "Updated camera",
          janCode: null,
          quantity: 2,
          notes: null,
          actualPrice: null,
          purchasedAt: null,
          categoryIds: [3],
        },
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ item });
  });

  it("returns 404 when the item is not visible", async () => {
    mocks.updateApiItemUseCase.mockResolvedValue(null);

    const response = await PUT(
      putRequest('{"name":"Updated camera"}'),
      context("1"),
    );

    expect(response.status).toBe(404);
    expect(mocks.jsonError).toHaveBeenCalledWith(404, "not found");
  });

  it("converts command failures to the shared database response", async () => {
    const error = new Error("database failure");
    mocks.updateApiItemUseCase.mockRejectedValue(error);

    const response = await PUT(
      putRequest('{"name":"Updated camera"}'),
      context("1"),
    );

    expect(response.status).toBe(500);
    expect(mocks.dbErrorResponse).toHaveBeenCalledWith(error);
  });
});
