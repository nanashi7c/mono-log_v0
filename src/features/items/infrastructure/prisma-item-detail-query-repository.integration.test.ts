import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import { createPrismaItemDetailQueryRepository } from "@/features/items/infrastructure/prisma-item-detail-query-repository";

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
const repository = createPrismaItemDetailQueryRepository(
  async <T>(userId: string, operation: (tx: Tx) => Promise<T>) =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
      return operation(tx);
    }),
);
const testUserIds = new Set<string>();
const testShippingIds = new Set<bigint>();
const testShippingFeeIds = new Set<bigint>();
const testServiceIds = new Set<number>();
const testSizeIds = new Set<number>();
const testPlatformIds = new Set<number>();

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

async function removeTestData(): Promise<void> {
  const userIds = [...testUserIds];
  if (userIds.length > 0) {
    await admin.user.deleteMany({ where: { id: { in: userIds } } });
  }
  const shippingIds = [...testShippingIds];
  if (shippingIds.length > 0) {
    await admin.shipping.deleteMany({ where: { id: { in: shippingIds } } });
  }
  const shippingFeeIds = [...testShippingFeeIds];
  if (shippingFeeIds.length > 0) {
    await admin.shippingFee.deleteMany({ where: { id: { in: shippingFeeIds } } });
  }
  const platformIds = [...testPlatformIds];
  if (platformIds.length > 0) {
    await admin.platform.deleteMany({ where: { id: { in: platformIds } } });
  }
  const serviceIds = [...testServiceIds];
  if (serviceIds.length > 0) {
    await admin.service.deleteMany({ where: { id: { in: serviceIds } } });
  }
  const sizeIds = [...testSizeIds];
  if (sizeIds.length > 0) {
    await admin.size.deleteMany({ where: { id: { in: sizeIds } } });
  }
  testUserIds.clear();
  testShippingIds.clear();
  testShippingFeeIds.clear();
  testServiceIds.clear();
  testSizeIds.clear();
  testPlatformIds.clear();
}

beforeAll(async () => {
  await admin.$queryRaw`select 1`;
  await app.$queryRaw`select 1`;
});

afterEach(removeTestData);

afterAll(async () => {
  await removeTestData();
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("prismaItemDetailQueryRepository", () => {
  it("所有者の詳細情報と関連データを公開形式で取得する", async () => {
    const userId = await createTestUser("detail-owner");
    const otherUserId = await createTestUser("detail-other");
    const suffix = randomUUID();
    const service = await admin.service.create({
      data: { shippingService: `detail-service-${suffix}` },
    });
    const size = await admin.size.create({
      data: { shippingSize: `detail-size-${suffix}` },
    });
    const platform = await admin.platform.create({
      data: { name: `detail-platform-${suffix}`, feeRate: 0.1 },
    });
    const shipping = await admin.shipping.create({
      data: { shippingServiceId: service.id, shippingSizeId: size.id },
    });
    const shippingFee = await admin.shippingFee.create({
      data: {
        shippingServiceId: service.id,
        shippingSizeId: size.id,
        fee: 750,
      },
    });
    testServiceIds.add(service.id);
    testSizeIds.add(size.id);
    testPlatformIds.add(platform.id);
    testShippingIds.add(shipping.id);
    testShippingFeeIds.add(shippingFee.id);

    const category = await admin.category.create({
      data: { userId, name: "detail category", color: "#112233" },
    });
    const item = await admin.item.create({
      data: { userId, status: "listed", name: "detail item", quantity: 1 },
    });
    await admin.plan.create({
      data: { itemId: item.id, plannedPurchaseYear: 2027 },
    });
    await admin.listing.create({
      data: {
        itemId: item.id,
        shippingId: shipping.id,
        platformId: platform.id,
        sellingPrice: 15_000,
      },
    });
    await admin.itemCategory.create({
      data: { itemId: item.id, categoryId: category.id },
    });

    const result = await repository.findDetail(userId, Number(item.id));
    const hidden = await repository.findDetail(otherUserId, Number(item.id));

    expect(result).toMatchObject({
      item: { id: Number(item.id), name: "detail item", status: "listed" },
      plan: { planned_purchase_year: 2027 },
      listing: {
        shipping_id: Number(shipping.id),
        platform_id: platform.id,
        selling_price: 15_000,
      },
      categories: [
        { id: category.id, name: "detail category", color: "#112233" },
      ],
      platform: { id: platform.id, name: platform.name },
      service: { id: service.id, shipping_service: service.shippingService },
      size: { id: size.id, shipping_size: size.shippingSize },
      shippingFee: 750,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(hidden).toBeNull();
  });
});
