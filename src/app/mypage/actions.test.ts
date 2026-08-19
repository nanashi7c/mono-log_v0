import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
  getCurrentUser: vi.fn(),
  getAccessToken: vi.fn(),
  cognitoChangePassword: vi.fn(),
  requestEmailUpdate: vi.fn(),
  verifyEmailUpdate: vi.fn(),
  login: vi.fn(),
  deleteOwnUser: vi.fn(),
  withUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
  getAccessToken: mocks.getAccessToken,
  getRefreshToken: vi.fn(),
  setIdAndAccess: vi.fn(),
  clearSession: vi.fn(),
}));
vi.mock("@/lib/auth/cognito", () => ({
  login: mocks.login,
  refresh: vi.fn(),
  changePassword: mocks.cognitoChangePassword,
  deleteOwnUser: mocks.deleteOwnUser,
  requestEmailUpdate: mocks.requestEmailUpdate,
  verifyEmailUpdate: mocks.verifyEmailUpdate,
}));
vi.mock("@/db/client", () => ({ withUser: mocks.withUser }));

import {
  changePassword,
  confirmEmailChange,
  deleteAccount,
  requestEmailChange,
} from "./actions";

const demoUserId = "c7f46a48-50f1-707a-22c0-bfc1746db566";
const environment = {
  DEMO_USER_ID: demoUserId,
  DEMO_USER_EMAIL: "test@example.com",
  DEMO_USER_PASSWORD: "Passw0rd",
  DEMO_SESSION_TOKEN: "s".repeat(48),
};
const originalEnvironment = Object.fromEntries(
  Object.keys(environment).map((key) => [key, process.env[key]]),
);

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  Object.assign(process.env, environment);
  mocks.getCurrentUser.mockResolvedValue({
    sub: demoUserId,
    email: "test@example.com",
    authTime: null,
  });
});
afterEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("mypage demo account protection", () => {
  it.each([
    [
      "password change",
      () =>
        changePassword(
          form({
            current_password: "Passw0rd",
            new_password: "NewPass1",
            confirm_password: "NewPass1",
          }),
        ),
    ],
    [
      "email change request",
      () => requestEmailChange(form({ new_email: "new@example.com" })),
    ],
    [
      "email change confirmation",
      () =>
        confirmEmailChange(
          form({ new_email: "new@example.com", code: "123456" }),
        ),
    ],
    [
      "account deletion",
      () => deleteAccount(form({ password: "Passw0rd", confirmation: "削除" })),
    ],
  ])("rejects %s before calling Cognito or DB", async (_label, action) => {
    await expect(action()).rejects.toThrow(
      "redirect:/mypage?error=demo-account-protected",
    );

    expect(mocks.getAccessToken).not.toHaveBeenCalled();
    expect(mocks.cognitoChangePassword).not.toHaveBeenCalled();
    expect(mocks.requestEmailUpdate).not.toHaveBeenCalled();
    expect(mocks.verifyEmailUpdate).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.deleteOwnUser).not.toHaveBeenCalled();
    expect(mocks.withUser).not.toHaveBeenCalled();
  });
});
