import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
  login: vi.fn(),
  verifyIdToken: vi.fn(),
  setSession: vi.fn(),
  setDemoSession: vi.fn(),
  clearSession: vi.fn(),
  userUpsert: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/cognito", () => ({
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  login: mocks.login,
  verifyIdToken: mocks.verifyIdToken,
}));
vi.mock("@/lib/auth/session", () => ({
  setSession: mocks.setSession,
  setDemoSession: mocks.setDemoSession,
  clearSession: mocks.clearSession,
}));
vi.mock("@/db/client", () => ({
  withUser: vi.fn(async (_userId: string, operation: (tx: unknown) => Promise<unknown>) =>
    operation({ user: { upsert: mocks.userUpsert } }),
  ),
}));

import { loginAction } from "./actions";

const environment = {
  DEMO_USER_ID: "c7f46a48-50f1-707a-22c0-bfc1746db566",
  DEMO_USER_EMAIL: "test@example.com",
  DEMO_USER_PASSWORD: "Passw0rd",
  DEMO_SESSION_TOKEN: "s".repeat(48),
};
const originalEnvironment = Object.fromEntries(
  Object.keys(environment).map((key) => [key, process.env[key]]),
);

function loginForm(password: string): FormData {
  const form = new FormData();
  form.set("email", "test@example.com");
  form.set("password", password);
  return form;
}

beforeEach(() => {
  Object.assign(process.env, environment);
  mocks.userUpsert.mockResolvedValue({});
  mocks.setDemoSession.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("loginAction demo account", () => {
  it("creates only the fixed demo DB user and issues a restricted session", async () => {
    await expect(loginAction(loginForm("Passw0rd"))).rejects.toThrow(
      "redirect:/items",
    );

    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: environment.DEMO_USER_ID },
      }),
    );
    expect(mocks.setDemoSession).toHaveBeenCalledOnce();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("does not fall through to Cognito when the demo password is wrong", async () => {
    await expect(loginAction(loginForm("wrong"))).rejects.toThrow(
      "redirect:/login?error=",
    );

    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.setDemoSession).not.toHaveBeenCalled();
  });
});
