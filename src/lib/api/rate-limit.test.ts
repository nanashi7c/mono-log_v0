import { describe, expect, it } from "vitest";
import {
  clientIpFromForwardedHeaders,
  createFixedWindowRateLimiter,
} from "./rate-limit";

describe("createFixedWindowRateLimiter", () => {
  it("rejects requests over the limit and accepts them in the next window", () => {
    let currentTime = 1_000;
    const limiter = createFixedWindowRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: () => currentTime,
    });

    expect(limiter.consume("viewer")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("viewer")).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("viewer")).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });

    currentTime += 60_000;
    expect(limiter.consume("viewer")).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("keeps counters separate by client identifier", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 });

    expect(limiter.consume("viewer-a").allowed).toBe(true);
    expect(limiter.consume("viewer-b").allowed).toBe(true);
    expect(limiter.consume("viewer-a").allowed).toBe(false);
  });
});

describe("clientIpFromForwardedHeaders", () => {
  it("uses the address appended by CloudFront at the end of x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "spoofed, 198.51.100.10",
    });

    expect(clientIpFromForwardedHeaders(headers)).toBe("198.51.100.10");
  });

  it("falls back without trusting an empty forwarded header", () => {
    expect(
      clientIpFromForwardedHeaders(new Headers({ "x-real-ip": "127.0.0.1" })),
    ).toBe("127.0.0.1");
  });
});
