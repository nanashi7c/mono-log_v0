import { describe, expect, it } from "vitest";
import { isOriginRequestAllowed } from "@/lib/origin-verification";

describe("isOriginRequestAllowed", () => {
  it.each([null, "unexpected"])(
    "allows %s when origin verification is not configured",
    (presentedSecret) => {
      expect(isOriginRequestAllowed(presentedSecret, undefined)).toBe(true);
    },
  );

  it("allows the exact configured secret", () => {
    expect(isOriginRequestAllowed("expected", "expected")).toBe(true);
  });

  it.each([null, "", "unexpected"])(
    "rejects %s when origin verification is configured",
    (presentedSecret) => {
      expect(isOriginRequestAllowed(presentedSecret, "expected")).toBe(false);
    },
  );

  it("rejects every request when the configured secret is empty", () => {
    expect(isOriginRequestAllowed("", "")).toBe(false);
  });
});
