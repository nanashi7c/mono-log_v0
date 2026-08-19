import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDemoAccountConfig,
  isDemoEmail,
  isDemoUserId,
  isValidDemoSessionToken,
  matchesDemoCredentials,
} from "./demo-account";

const demoEnvironment = {
  DEMO_USER_ID: "c7f46a48-50f1-707a-22c0-bfc1746db566",
  DEMO_USER_EMAIL: "test@example.com",
  DEMO_USER_PASSWORD: "Passw0rd",
  DEMO_SESSION_TOKEN: "a".repeat(48),
};
const originalEnvironment = Object.fromEntries(
  Object.keys(demoEnvironment).map((key) => [key, process.env[key]]),
);

beforeEach(() => Object.assign(process.env, demoEnvironment));

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("demo account configuration", () => {
  it("matches only the configured credentials and fixed user", () => {
    expect(getDemoAccountConfig()).toMatchObject({
      userId: demoEnvironment.DEMO_USER_ID,
      email: demoEnvironment.DEMO_USER_EMAIL,
    });
    expect(isDemoEmail(" TEST@example.com ")).toBe(true);
    expect(matchesDemoCredentials("test@example.com", "Passw0rd")).toBe(true);
    expect(matchesDemoCredentials("test@example.com", "wrong")).toBe(false);
    expect(isDemoUserId(demoEnvironment.DEMO_USER_ID)).toBe(true);
    expect(isValidDemoSessionToken("a".repeat(48))).toBe(true);
    expect(isValidDemoSessionToken("different")).toBe(false);
  });

  it("disables demo authentication when the server secret is unsafe", () => {
    process.env.DEMO_SESSION_TOKEN = "short";

    expect(getDemoAccountConfig()).toBeNull();
    expect(isDemoEmail("test@example.com")).toBe(true);
    expect(isDemoUserId(demoEnvironment.DEMO_USER_ID)).toBe(true);
    expect(matchesDemoCredentials("test@example.com", "Passw0rd")).toBe(false);
  });
});
