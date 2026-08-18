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
async function runWithAppUser<T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
    return operation(tx);
  });
}

const repository = createPrismaItemApiCommandRepository(runWithAppUser);
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
    if (result.status !== "created") {
      throw new Error(`unexpected create result: ${result.status}`);
    }
    const createdItem = result.item;
    const user = await admin.user.findUnique({ where: { id: userId } });
    const persisted = await admin.item.findUnique({
      where: { id: BigInt(createdItem.id) },
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
    expect(createdItem).toMatchObject({
      id: Number(persisted?.id),
      user_id: userId,
      name: "API item",
      category_ids: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(createdItem)).toBe(true);
    expect(Object.isFrozen(createdItem.category_ids)).toBe(true);
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
    if (result.status !== "updated") {
      throw new Error(`unexpected update result: ${result.status}`);
    }
    const updatedItem = result.item;
    const persisted = await admin.item.findUnique({
      where: { id: item.id },
      include: {
        plan: true,
        listing: true,
        itemCategories: true,
      },
    });

    expect(updatedItem).toMatchObject({
      id: Number(item.id),
      status: "sold",
      name: "after update",
      quantity: 2,
      image_url: "keep-image.png",
      category_ids: [newCategory.id],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(updatedItem)).toBe(true);
    expect(Object.isFrozen(updatedItem.category_ids)).toBe(true);
    expect(updatedItem.category_ids).not.toBe(updateInput.categoryIds);
    expect(hidden).toEqual({ status: "not_found" });
    expect(persisted).toMatchObject({
      status: "sold",
      name: "after update",
      imageUrl: "keep-image.png",
      plan: { plannedPurchaseYear: 2027 },
      itemCategories: [{ categoryId: newCategory.id }],
    });
    expect(persisted?.listing?.sellingPrice?.toNumber()).toBe(15_000);
  });

  it("accepts categories owned by the user and preset categories", async () => {
    const userId = await createTestUser("api-category-owner");
    const ownCategory = await admin.category.create({
      data: { userId, name: "own category" },
    });
    const presetCategory = await admin.category.create({
      data: {
        userId: null,
        name: `api-command-visible-preset-${randomUUID()}`,
        isPreset: true,
      },
    });
    testPresetCategoryIds.add(presetCategory.id);

    const result = await repository.create(
      { userId, email: "api-category-owner@example.com" },
      apiInput("visible categories", {
        categoryIds: Object.freeze([ownCategory.id, presetCategory.id]),
      }),
    );

    expect(result).toMatchObject({
      status: "created",
      item: {
        category_ids: [ownCategory.id, presetCategory.id],
      },
    });
  });

  it("rejects another user's private category without creating API user or item", async () => {
    const otherUserId = await createTestUser("api-category-other");
    const privateCategory = await admin.category.create({
      data: { userId: otherUserId, name: "private category" },
    });
    const apiUserId = randomUUID();
    testUserIds.add(apiUserId);

    const result = await repository.create(
      { userId: apiUserId, email: "invalid-category@example.com" },
      apiInput("must not be created", {
        categoryIds: Object.freeze([privateCategory.id]),
      }),
    );

    expect(result).toEqual({ status: "invalid_categories" });
    await expect(
      admin.user.findUnique({ where: { id: apiUserId } }),
    ).resolves.toBeNull();
    await expect(
      admin.item.count({ where: { userId: apiUserId } }),
    ).resolves.toBe(0);
  });

  it("rejects another user's private category without changing an existing item", async () => {
    const userId = await createTestUser("api-category-update-owner");
    const otherUserId = await createTestUser("api-category-update-other");
    const ownCategory = await admin.category.create({
      data: { userId, name: "existing category" },
    });
    const privateCategory = await admin.category.create({
      data: { userId: otherUserId, name: "other private category" },
    });
    const item = await admin.item.create({
      data: {
        userId,
        status: "owned",
        name: "before invalid update",
        quantity: 1,
      },
    });
    await admin.itemCategory.create({
      data: { itemId: item.id, categoryId: ownCategory.id },
    });

    const result = await repository.update(
      userId,
      Number(item.id),
      apiInput("must not change", {
        categoryIds: Object.freeze([privateCategory.id]),
      }),
    );
    const persisted = await admin.item.findUnique({
      where: { id: item.id },
      include: { itemCategories: true },
    });

    expect(result).toEqual({ status: "invalid_categories" });
    expect(persisted).toMatchObject({
      name: "before invalid update",
      itemCategories: [{ categoryId: ownCategory.id }],
    });
  });

  it("enforces category ownership in the database policy", async () => {
    const userId = await createTestUser("api-policy-owner");
    const otherUserId = await createTestUser("api-policy-other");
    const item = await admin.item.create({
      data: {
        userId,
        status: "owned",
        name: "policy protected item",
        quantity: 1,
      },
    });
    const privateCategory = await admin.category.create({
      data: { userId: otherUserId, name: "policy private category" },
    });

    await expect(
      runWithAppUser(userId, (tx) =>
        tx.itemCategory.create({
          data: { itemId: item.id, categoryId: privateCategory.id },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      admin.itemCategory.findUnique({
        where: {
          itemId_categoryId: {
            itemId: item.id,
            categoryId: privateCategory.id,
          },
        },
      }),
    ).resolves.toBeNull();
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
