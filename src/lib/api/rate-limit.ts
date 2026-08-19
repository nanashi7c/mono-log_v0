export type RateLimitDecision = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}>;

type RateLimitEntry = {
  count: number;
  resetAtMs: number;
};

const MAX_TRACKED_CLIENTS = 10_000;

export type FixedWindowRateLimiter = Readonly<{
  consume(key: string): RateLimitDecision;
}>;

export function createFixedWindowRateLimiter(options: Readonly<{
  limit: number;
  windowMs: number;
  now?: () => number;
}>): FixedWindowRateLimiter {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("rate limit must be a positive integer");
  }
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
    throw new Error("rate limit window must be a positive integer");
  }

  const entries = new Map<string, RateLimitEntry>();
  const now = options.now ?? Date.now;

  return Object.freeze({
    consume(key: string): RateLimitDecision {
      const currentTime = now();
      const current = entries.get(key);
      if (
        (!current || current.resetAtMs <= currentTime) &&
        entries.size >= MAX_TRACKED_CLIENTS
      ) {
        const oldestKey = entries.keys().next().value as string | undefined;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }
      const entry =
        current && current.resetAtMs > currentTime
          ? current
          : { count: 0, resetAtMs: currentTime + options.windowMs };

      entry.count += 1;
      entries.set(key, entry);

      return Object.freeze({
        allowed: entry.count <= options.limit,
        limit: options.limit,
        remaining: Math.max(0, options.limit - entry.count),
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((entry.resetAtMs - currentTime) / 1_000),
        ),
      });
    },
  });
}

export function clientIpFromForwardedHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const addresses = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const cloudFrontAppendedAddress = addresses.at(-1);
    if (cloudFrontAppendedAddress) return cloudFrontAppendedAddress;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function configuredLimit(): number {
  const value = Number(process.env.API_RATE_LIMIT_MAX ?? "120");
  return Number.isInteger(value) && value > 0 ? value : 120;
}

export const EXTERNAL_API_RATE_LIMIT = configuredLimit();

export const externalApiRateLimiter = createFixedWindowRateLimiter({
  limit: EXTERNAL_API_RATE_LIMIT,
  windowMs: 60_000,
});
