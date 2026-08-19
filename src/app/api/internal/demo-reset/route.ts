import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resetDemoAccountUseCase } from "@/features/demo/application/demo-reset-use-case";
import { prismaDemoResetRepository } from "@/features/demo/infrastructure/prisma-demo-reset-repository";
import { s3ItemImageStore } from "@/features/items/infrastructure/s3-item-image-store";
import { getDemoAccountConfig } from "@/lib/auth/demo-account";

export const dynamic = "force-dynamic";

const resetDependencies = Object.freeze({
  repository: prismaDemoResetRepository,
  imageRemover: s3ItemImageStore,
  onCleanupError(error: unknown) {
    console.error("Failed to remove a stale demo image after reset.", error);
  },
});

function hasValidResetAuthorization(
  authorization: string | null,
  expectedSecret: string,
): boolean {
  const expected = Buffer.from(`Bearer ${expectedSecret}`);
  const presented = Buffer.from(authorization ?? "");
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

export async function POST(request: NextRequest) {
  const account = getDemoAccountConfig();
  const resetSecret = process.env.DEMO_RESET_SECRET;
  if (!account || !resetSecret || resetSecret.length < 32) {
    return NextResponse.json(
      { error: "demo reset is not configured" },
      { status: 503 },
    );
  }

  if (
    !hasValidResetAuthorization(
      request.headers.get("authorization"),
      resetSecret,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await resetDemoAccountUseCase(resetDependencies, {
      userId: account.userId,
      email: account.email,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Demo account reset failed.", error);
    return NextResponse.json({ error: "demo reset failed" }, { status: 500 });
  }
}
