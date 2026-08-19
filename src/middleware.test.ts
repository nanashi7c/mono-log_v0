import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { CLOUDFRONT_ORIGIN_VERIFY_HEADER } from "@/lib/origin-verification";
import { middleware } from "@/middleware";

const originalOriginSecret = process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET;

afterEach(() => {
  if (originalOriginSecret === undefined) {
    delete process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET;
  } else {
    process.env.CLOUDFRONT_ORIGIN_VERIFY_SECRET = originalOriginSecret;
  }
});

function request(path: string, originSecret?: string): NextRequest {
  const headers = new Headers();
  if (originSecret !== undefined) {
    headers.set(CLOUDFRONT_ORIGIN_VERIFY_HEADER, originSecret);
  }
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
});
