import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import { getItemTransitionPlan } from "@/features/items/domain/item-transition";
import { createPrismaItemTransitionRepository } from "@/features/items/infrastructure/prisma-item-transition-repository";

const LOCAL_ADMIN_DATABASE_URL =
  "postgresql://monolog_admin:localdev@localhost:5433/monolog";
const LOCAL_APP_DATABASE_URL =
  "postgresql://monolog_app:localapppw@localhost:5433/monolog";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function localDatabaseUrl(environmentName: string, fallback: string): string {
  const value = process.env[environmentName] ?? fallback;
  const host = new URL(value).hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `${environmentName} must point to a loopback database, but received ${host}.`,
    );
  }
  return value;
}

const admin = new PrismaClient({
  datasourceUrl: localDatabaseUrl("TEST_DATABASE_URL", LOCAL_ADMIN_DATABASE_URL),
});
const app = new PrismaClient({
  datasourceUrl: localDatabaseUrl("TEST_APP_DATABASE_URL", LOCAL_APP_DATABASE_URL),
});
const repository = createPrismaItemTransitionRepository(
  async <T>(userId: string, operation: (tx: Tx) => Promise<T>) =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
      return operation(tx);
    }),
);
const testUserIds = new Set<string>();
const LISTING_DRAFT_SELECT = {
  shippingId: true,
  platformId: true,
  quantity: true,
  sellingPrice: true,
  packagingCost: true,
  workTimeHours: true,
  laborRate: true,
  sellingFee: true,
  workTimeCost: true,
  operatingBenefit: true,
  ordinaryProfit: true,
  isListing: true,
} as const;

async function createTestUser(label: string): Promise<string> {
  const userId = randomUUID();
  testUserIds.add(userId);
  await admin.user.create({
    data: {
      id: userId,
      email: `${label}-${userId}@mono-log.integration.test`,
      username: label,
    },
  });
  return userId;
}

async function createItem(
  userId: string,
  status: "planned" | "owned" | "listed",
): Promise<number> {
  const item = await admin.item.create({
    data: { userId, status, name: `${status} item`, quantity: 1 },
  });
  return Number(item.id);
}

async function removeTestUsers(): Promise<void> {
  const userIds = [...testUserIds];
  if (userIds.length > 0) {
    await admin.user.deleteMany({ where: { id: { in: userIds } } });
  }
  testUserIds.clear();
}

beforeAll(async () => {
  await admin.$queryRaw`select 1`;
  await app.$queryRaw`select 1`;
});

afterEach(removeTestUsers);

afterAll(async () => {
  await removeTestUsers();
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("prismaItemTransitionRepository", () => {
  it("状態と出品行を遷移規則に従って同期する", async () => {
    const userId = await createTestUser("transition-flow");
    const itemId = await createItem(userId, "planned");
    const soldAt = new Date("2026-08-15T12:00:00.000Z");

    await repository.transition(
      userId,
      itemId,
      getItemTransitionPlan("mark_purchased"),
      null,
    );
    await repository.transition(
      userId,
      itemId,
      getItemTransitionPlan("start_listing"),
      null,
    );
    const listed = await admin.item.findUnique({
      where: { id: BigInt(itemId) },
      include: { listing: true },
    });
    expect(listed).toMatchObject({ status: "listed" });
    expect(listed?.listing).not.toBeNull();

    await admin.listing.update({
      where: { itemId: BigInt(itemId) },
      data: {
        quantity: 2,
        sellingPrice: 15_000,
        packagingCost: 300,
        workTimeHours: 1.25,
        laborRate: 1_200,
        sellingFee: 1_500,
        workTimeCost: 1_500,
        operatingBenefit: 11_700,
        ordinaryProfit: 11_700,
        isListing: true,
      },
    });
    const listingDraft = await admin.listing.findUnique({
      where: { itemId: BigInt(itemId) },
      select: LISTING_DRAFT_SELECT,
    });

    const invalidResult = await repository.transition(
      userId,
      itemId,
      getItemTransitionPlan("mark_purchased"),
      null,
    );
    expect(invalidResult).toEqual({ type: "not_found_or_invalid_status" });

    await repository.transition(
      userId,
      itemId,
      getItemTransitionPlan("cancel_listing"),
      null,
    );
    const unlisted = await admin.item.findUnique({
      where: { id: BigInt(itemId) },
      select: {
        status: true,
        listing: {
          select: LISTING_DRAFT_SELECT,
        },
      },
    });
    expect(unlisted?.status).toBe("owned");
    expect(unlisted?.listing).toEqual(listingDraft);

    await repository.transition(
      userId,
      itemId,
      getItemTransitionPlan("restore_planned"),
      null,
    );
    await repository.transition(
      userId,
      itemId,
      getItemTransitionPlan("mark_purchased"),
      null,
    );
    await repository.transition(
      userId,
      itemId,
      getItemTransitionPlan("start_listing"),
      null,
    );
    const relistedDraft = await admin.listing.findUnique({
      where: { itemId: BigInt(itemId) },
      select: LISTING_DRAFT_SELECT,
    });
    expect(relistedDraft).toEqual(listingDraft);
    await repository.transition(
      userId,
      itemId,
      getItemTransitionPlan("mark_sold"),
      soldAt,
    );

    const sold = await admin.item.findUnique({ where: { id: BigInt(itemId) } });
    expect(sold).toMatchObject({ status: "sold", deletedAt: soldAt });
  });

  it("他ユーザーのアイテムを遷移できない", async () => {
    const ownerId = await createTestUser("transition-owner");
    const intruderId = await createTestUser("transition-intruder");
    const itemId = await createItem(ownerId, "owned");

    const result = await repository.transition(
      intruderId,
      itemId,
      getItemTransitionPlan("start_listing"),
      null,
    );
    const persisted = await admin.item.findUnique({
      where: { id: BigInt(itemId) },
      include: { listing: true },
    });

    expect(result).toEqual({ type: "not_found_or_invalid_status" });
    expect(persisted).toMatchObject({ status: "owned", listing: null });
  });
});
