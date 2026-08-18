import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import type { ItemApiCommandInput } from "@/features/items/application/item-api-command-input";
import { createPrismaItemApiCommandRepository } from "@/features/items/infrastructure/prisma-item-api-command-repository";

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
const repository = createPrismaItemApiCommandRepository(
  async <T>(userId: string, operation: (tx: Tx) => Promise<T>) =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
      return operation(tx);
    }),
);
const testUserIds = new Set<string>();
const testPresetCategoryIds = new Set<number>();

function apiInput(
  name: string,
  overrides: Partial<ItemApiCommandInput> = {},
): ItemApiCommandInput {
  return Object.freeze({
    status: "owned",
    name,
    janCode: null,
    quantity: 1,
    notes: null,
    actualPrice: null,
    purchasedAt: null,
    categoryIds: Object.freeze([]),
    ...overrides,
  });
}

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
  const presetCategoryIds = [...testPresetCategoryIds];
  if (presetCategoryIds.length > 0) {
    await admin.category.deleteMany({ where: { id: { in: presetCategoryIds } } });
  }
  testUserIds.clear();
  testPresetCategoryIds.clear();
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

describe("prismaItemApiCommandRepository", () => {
  it("creates the API user and item in one RLS transaction", async () => {
    const userId = randomUUID();
    testUserIds.add(userId);

    const result = await repository.create(
      { userId, email: "api-only@example.com" },
      apiInput("API item", { actualPrice: 12_000 }),
    );
    const user = await admin.user.findUnique({ where: { id: userId } });
    const persisted = await admin.item.findUnique({
      where: { id: BigInt(result.id) },
    });

    expect(user).toMatchObject({
      email: "api-only@example.com",
      username: "api-only",
    });
    expect(persisted).toMatchObject({
      userId,
      name: "API item",
      actualPrice: 12_000,
    });
    expect(result).toMatchObject({
      id: Number(persisted?.id),
      user_id: userId,
      name: "API item",
      category_ids: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.category_ids)).toBe(true);
  });

  it("updates only API fields and categories while preserving image, plan, and listing", async () => {
    const userId = await createTestUser("api-update-owner");
    const otherUserId = await createTestUser("api-update-other");
    const oldCategory = await admin.category.create({
      data: { userId, name: "old category" },
    });
    const newCategory = await admin.category.create({
      data: { userId, name: "new category" },
    });
    const item = await admin.item.create({
      data: {
        userId,
        status: "planned",
        name: "before update",
        imageUrl: "keep-image.png",
        quantity: 1,
      },
    });
    await admin.plan.create({
      data: { itemId: item.id, plannedPurchaseYear: 2027 },
    });
    await admin.listing.create({
      data: { itemId: item.id, sellingPrice: 15_000 },
    });
    await admin.itemCategory.create({
      data: { itemId: item.id, categoryId: oldCategory.id },
    });

    const updateInput = apiInput("after update", {
      status: "sold",
      quantity: 2,
      categoryIds: Object.freeze([newCategory.id]),
    });
    const result = await repository.update(
      userId,
      Number(item.id),
      updateInput,
    );
    const hidden = await repository.update(
      otherUserId,
      Number(item.id),
      apiInput("intruder update"),
    );
    const persisted = await admin.item.findUnique({
      where: { id: item.id },
      include: {
        plan: true,
        listing: true,
        itemCategories: true,
      },
    });

    expect(result).toMatchObject({
      id: Number(item.id),
      status: "sold",
      name: "after update",
      quantity: 2,
      image_url: "keep-image.png",
      category_ids: [newCategory.id],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.category_ids)).toBe(true);
    expect(result?.category_ids).not.toBe(updateInput.categoryIds);
    expect(hidden).toBeNull();
    expect(persisted).toMatchObject({
      status: "sold",
      name: "after update",
      imageUrl: "keep-image.png",
      plan: { plannedPurchaseYear: 2027 },
      itemCategories: [{ categoryId: newCategory.id }],
    });
    expect(persisted?.listing?.sellingPrice?.toNumber()).toBe(15_000);
  });

  it("rolls back user, item, and category writes when category insertion fails", async () => {
    const userId = randomUUID();
    testUserIds.add(userId);
    const presetCategory = await admin.category.create({
      data: {
        userId: null,
        name: `api-command-preset-${randomUUID()}`,
        isPreset: true,
      },
    });
    testPresetCategoryIds.add(presetCategory.id);

    await expect(
      repository.create(
        { userId, email: "rollback@example.com" },
        apiInput("rollback item", {
          categoryIds: Object.freeze([presetCategory.id, presetCategory.id]),
        }),
      ),
    ).rejects.toThrow();

    await expect(
      admin.user.findUnique({ where: { id: userId } }),
    ).resolves.toBeNull();
    await expect(
      admin.item.count({ where: { userId } }),
    ).resolves.toBe(0);
  });
});
