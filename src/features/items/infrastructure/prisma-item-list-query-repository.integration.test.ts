import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import { createPrismaItemListQueryRepository } from "@/features/items/infrastructure/prisma-item-list-query-repository";

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
const repository = createPrismaItemListQueryRepository(
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

describe("prismaItemListQueryRepository", () => {
  it("所有・購入予定・出品一覧を条件と関連データ付きで取得する", async () => {
    const userId = await createTestUser("list-owner");
    const otherUserId = await createTestUser("list-other");
    const suffix = randomUUID();
    const service = await admin.service.create({
      data: { shippingService: `list-service-${suffix}` },
    });
    const size = await admin.size.create({
      data: { shippingSize: `list-size-${suffix}` },
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
    testShippingIds.add(shipping.id);
    testShippingFeeIds.add(shippingFee.id);

    const category = await admin.category.create({
      data: { userId, name: "camera category", color: "#112233" },
    });
    const camera = await admin.item.create({
      data: { userId, status: "owned", name: "camera", quantity: 1 },
    });
    await admin.item.create({
      data: { userId, status: "owned", name: "uncategorized", quantity: 1 },
    });
    const planned = await admin.item.create({
      data: { userId, status: "planned", name: "planned", quantity: 1 },
    });
    const listed = await admin.item.create({
      data: { userId, status: "listed", name: "listed", quantity: 2 },
    });
    await admin.itemCategory.createMany({
      data: [
        { itemId: camera.id, categoryId: category.id },
        { itemId: planned.id, categoryId: category.id },
        { itemId: listed.id, categoryId: category.id },
      ],
    });
    await admin.plan.create({
      data: { itemId: planned.id, plannedPurchaseYear: 2027 },
    });
    await admin.listing.create({
      data: { itemId: listed.id, shippingId: shipping.id, sellingPrice: 15_000 },
    });
    await admin.item.create({
      data: {
        userId: otherUserId,
        status: "owned",
        name: "other camera",
        quantity: 1,
      },
    });

    const owned = await repository.findOwned(userId, {
      query: null,
      category: { type: "all" },
    });
    const searched = await repository.findOwned(userId, {
      query: "camera",
      category: { type: "category", categoryId: category.id },
    });
    const withoutCategory = await repository.findOwned(userId, {
      query: null,
      category: { type: "uncategorized" },
    });
    const plannedRows = await repository.findPlanned(userId);
    const sellingRows = await repository.findSelling(userId);

    expect(owned.items.map(({ name }) => name).sort()).toEqual([
      "camera",
      "listed",
      "uncategorized",
    ]);
    expect(owned.categoryOptions.map(({ name }) => name)).toContain(
      "camera category",
    );
    expect(searched.items.map(({ name }) => name)).toEqual(["camera"]);
    expect(withoutCategory.items.map(({ name }) => name)).toEqual([
      "uncategorized",
    ]);
    expect(plannedRows).toHaveLength(1);
    expect(plannedRows[0]).toMatchObject({
      id: Number(planned.id),
      plan: { planned_purchase_year: 2027 },
      categories: [{ id: category.id }],
    });
    expect(sellingRows).toHaveLength(1);
    expect(sellingRows[0]).toMatchObject({
      id: Number(listed.id),
      quantity: 2,
      listing: { selling_price: 15_000 },
      shippingFee: 750,
    });
    expect(Object.isFrozen(owned.items)).toBe(true);
    expect(Object.isFrozen(sellingRows)).toBe(true);
  });
});
