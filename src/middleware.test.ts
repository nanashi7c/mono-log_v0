import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { CLOUDFRONT_ORIGIN_VERIFY_HEADER } from "@/lib/origin-verification";
import { EXTERNAL_API_RATE_LIMIT } from "@/lib/api/rate-limit";
import { middleware } from "@/middleware";

const originalOriginSecret = process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET;
const demoEnvironment = {
  DEMO_USER_ID: "c7f46a48-50f1-707a-22c0-bfc1746db566",
  DEMO_USER_EMAIL: "test@example.com",
  DEMO_USER_PASSWORD: "Passw0rd",
  DEMO_SESSION_TOKEN: "s".repeat(48),
};
const originalDemoEnvironment = Object.fromEntries(
  Object.keys(demoEnvironment).map((key) => [key, process.env[key]]),
);

afterEach(() => {
  if (originalOriginSecret === undefined) {
    delete process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET;
  } else {
    process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = originalOriginSecret;
  }
  for (const [key, value] of Object.entries(originalDemoEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(
  path: string,
  originSecret?: string,
  cookie?: string,
  forwardedFor?: string,
): NextRequest {
  const headers = new Headers();
  if (originSecret !== undefined) {
    headers.set(CLOUDFRONT_ORIGIN_VERIFY_HEADER, originSecret);
  }
  if (cookie) headers.set("cookie", cookie);
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  return new NextRequest(`http://localhost${path}`, { headers });
}

describe("middleware origin verification", () => {
  it("keeps local requests compatible when verification is not configured", async () => {
    delete process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET;

    const response = await middleware(request("/api/v1/items"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([undefined, "unexpected"])(
    "returns 403 for a protected origin with %s",
    async (originSecret) => {
      process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = "expected";

      const response = await middleware(
        request("/api/v1/items", originSecret),
      );

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("");
    },
  );

  it.each(["/api/health", "/api/v1/items", "/_next/static/chunk.js", "/item.png"])(
    "allows the CloudFront secret without applying page authentication to %s",
    async (path) => {
      process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = "expected";

      const response = await middleware(request(path, "expected"));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("preserves session authentication for protected pages", async () => {
    process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = "expected";

    const response = await middleware(request("/items", "expected"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe("/items");
  });

  it("accepts a valid restricted demo session on protected pages", async () => {
    process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = "expected";
    Object.assign(process.env, demoEnvironment);

    const response = await middleware(
      request("/items", "expected", `ml_demo=${demoEnvironment.DEMO_SESSION_TOKEN}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a demo session away from the regular login page", async () => {
    process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = "expected";
    Object.assign(process.env, demoEnvironment);

    const response = await middleware(
      request("/login", "expected", `ml_demo=${demoEnvironment.DEMO_SESSION_TOKEN}`),
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/items");
  });

  it("rejects a legacy Cognito cookie for the configured demo identity", async () => {
    process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = "expected";
    Object.assign(process.env, demoEnvironment);
    const payload = Buffer.from(
      JSON.stringify({
        sub: demoEnvironment.DEMO_USER_ID,
        exp: Math.floor(Date.now() / 1_000) + 3_600,
      }),
    ).toString("base64url");

    const response = await middleware(
      request(
        "/items",
        "expected",
        `ml_id=header.${payload}.signature; ml_refresh=legacy-refresh`,
      ),
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    expect(response.headers.getSetCookie().join(";")).toContain("ml_id=");
  });

  it("returns 429 and retry guidance after the external API limit", async () => {
    process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = "expected";
    let response = await middleware(
      request("/api/v1/items", "expected", undefined, "198.51.100.44"),
    );
    for (
      let count = 1;
      count <= EXTERNAL_API_RATE_LIMIT && response.status !== 429;
      count += 1
    ) {
      response = await middleware(
        request("/api/v1/items", "expected", undefined, "198.51.100.44"),
      );
    }

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      error: "too many requests",
    });
  });
});
