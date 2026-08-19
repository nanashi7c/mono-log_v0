import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock("./cognito", () => ({ verifyIdToken: mocks.verifyIdToken }));

import { getApiUser } from "./api";

const environment = {
  DEMO_USER_ID: "c7f46a48-50f1-707a-22c0-bfc1746db566",
  DEMO_USER_EMAIL: "test@example.com",
  DEMO_USER_PASSWORD: "Passw0rd",
  DEMO_SESSION_TOKEN: "s".repeat(48),
};
const originalEnvironment = Object.fromEntries(
  Object.keys(environment).map((key) => [key, process.env[key]]),
);

function request(): NextRequest {
  return new NextRequest("http://localhost/api/v1/items", {
    headers: { authorization: "Bearer valid-token" },
  });
}

beforeEach(() => Object.assign(process.env, environment));
afterEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("getApiUser", () => {
  it("accepts a regular Cognito user", async () => {
    mocks.verifyIdToken.mockResolvedValue({
      sub: "regular-user",
      email: "regular@example.com",
    });

    await expect(getApiUser(request())).resolves.toEqual({
      sub: "regular-user",
      email: "regular@example.com",
    });
  });

  it("rejects the legacy Cognito token for the public demo identity", async () => {
    mocks.verifyIdToken.mockResolvedValue({
      sub: environment.DEMO_USER_ID,
      email: environment.DEMO_USER_EMAIL,
    });

    await expect(getApiUser(request())).resolves.toBeNull();
  });
});
