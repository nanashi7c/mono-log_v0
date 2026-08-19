const HEALTH_RESPONSE = Object.freeze({ status: "ok" as const });

export function GET(): Response {
  return Response.json(HEALTH_RESPONSE, {
    headers: { "Cache-Control": "no-store" },
  });
}
