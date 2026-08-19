import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetDemoAccountUseCase: vi.fn(),
}));

vi.mock("@/features/demo/application/demo-reset-use-case", () => ({
  resetDemoAccountUseCase: mocks.resetDemoAccountUseCase,
}));
vi.mock("@/features/demo/infrastructure/prisma-demo-reset-repository", () => ({
  prismaDemoResetRepository: {},
}));
vi.mock("@/features/items/infrastructure/s3-item-image-store", () => ({
  s3ItemImageStore: {},
}));

import { POST } from "./route";

const demoEnvironment = {
  DEMO_USER_ID: "c7f46a48-50f1-707a-22c0-bfc1746db566",
  DEMO_USER_EMAIL: "test@example.com",
  DEMO_USER_PASSWORD: "Passw0rd",
  DEMO_SESSION_TOKEN: "s".repeat(48),
  DEMO_RESET_SECRET: "r".repeat(48),
};
const originalEnvironment = Object.fromEntries(
  Object.keys(demoEnvironment).map((key) => [key, process.env[key]]),
);

function request(secret = demoEnvironment.DEMO_RESET_SECRET): NextRequest {
  return new NextRequest("http://localhost/api/internal/demo-reset", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  Object.assign(process.env, demoEnvironment);
  mocks.resetDemoAccountUseCase.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/internal/demo-reset", () => {
  it("rejects an invalid server secret", async () => {
    const response = await POST(request("wrong"));

    expect(response.status).toBe(401);
    expect(mocks.resetDemoAccountUseCase).not.toHaveBeenCalled();
  });

  it("resets only the configured demo account", async () => {
    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(mocks.resetDemoAccountUseCase).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: demoEnvironment.DEMO_USER_ID,
        email: demoEnvironment.DEMO_USER_EMAIL,
      },
    );
  });

  it("does not expose internal reset errors", async () => {
    mocks.resetDemoAccountUseCase.mockRejectedValue(new Error("database details"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "demo reset failed" });
    consoleError.mockRestore();
  });
});
