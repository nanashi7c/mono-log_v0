import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import { createPrismaItemFormQueryRepository } from "@/features/items/infrastructure/prisma-item-form-query-repository";

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
const repository = createPrismaItemFormQueryRepository(
  async <T>(userId: string, operation: (tx: Tx) => Promise<T>) =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
      return operation(tx);
    }),
);
const testUserIds = new Set<string>();
const testShippingIds = new Set<bigint>();
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

describe("prismaItemFormQueryRepository", () => {
  it("所有者の編集データとフォーム選択肢を取得する", async () => {
    const userId = await createTestUser("form-owner");
    const otherUserId = await createTestUser("form-other");
    const suffix = randomUUID();
    const service = await admin.service.create({
      data: { shippingService: `service-${suffix}` },
    });
    const size = await admin.size.create({
      data: { shippingSize: `size-${suffix}` },
    });
    const shipping = await admin.shipping.create({
      data: { shippingServiceId: service.id, shippingSizeId: size.id },
    });
    testServiceIds.add(service.id);
    testSizeIds.add(size.id);
    testShippingIds.add(shipping.id);

    const category = await admin.category.create({
      data: { userId, name: "form category", color: "#112233" },
    });
    await admin.category.create({
      data: { userId: otherUserId, name: "other category", color: "#445566" },
    });
    const item = await admin.item.create({
      data: { userId, status: "listed", name: "form item", quantity: 1 },
    });
    await admin.plan.create({
      data: { itemId: item.id, plannedPurchaseYear: 2027 },
    });
    await admin.listing.create({
      data: { itemId: item.id, shippingId: shipping.id, quantity: 1 },
    });
    await admin.itemCategory.create({
      data: { itemId: item.id, categoryId: category.id },
    });

    const options = await repository.findOptions(userId);
    const result = await repository.findEditData(userId, Number(item.id));
    const hidden = await repository.findEditData(otherUserId, Number(item.id));

    expect(options.categories.map(({ name }) => name)).toContain("form category");
    expect(options.categories.map(({ name }) => name)).not.toContain(
      "other category",
    );
    expect(result).toMatchObject({
      item: { id: Number(item.id), name: "form item", status: "listed" },
      plan: { planned_purchase_year: 2027 },
      listing: { shipping_id: Number(shipping.id), quantity: 1 },
      selectedCategoryIds: [category.id],
      initialServiceId: service.id,
      initialSizeId: size.id,
    });
    expect(result?.services.map(({ id }) => id)).toContain(service.id);
    expect(result?.sizes.map(({ id }) => id)).toContain(size.id);
    expect(Object.isFrozen(result)).toBe(true);
    expect(hidden).toBeNull();
  });
});
