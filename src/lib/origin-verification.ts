export const CLOUDFRONT_ORIGIN_VERIFY_HEADER =
  "x-mono-log-origin-verify" as const;

export function isOriginRequestAllowed(
  presentedSecret: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (expectedSecret === undefined) return true;
  return expectedSecret.length > 0 && presentedSecret === expectedSecret;
}
