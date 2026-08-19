import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import { createPrismaItemExportRepository } from "@/features/items/infrastructure/prisma-item-export-repository";

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
const repository = createPrismaItemExportRepository(
  async <T>(userId: string, operation: (tx: Tx) => Promise<T>) =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
      return operation(tx);
    }),
);
const testUserIds = new Set<string>();

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

describe("prismaItemExportRepository", () => {
  it("復元に必要な可視カテゴリと指定ユーザーのアイテムを公開形式で返す", async () => {
    const userId = await createTestUser("export-owner");
    const otherUserId = await createTestUser("export-other");
    const category = await admin.category.create({
      data: { userId, name: "export category", color: "#112233" },
    });
    const presetCategory = await admin.category.findFirstOrThrow({
      where: { isPreset: true },
    });
    const item = await admin.item.create({
      data: {
        userId,
        status: "owned",
        name: "export item",
        quantity: 1,
        actualPrice: 12_000,
      },
    });
    await admin.itemCategory.create({
      data: { itemId: item.id, categoryId: category.id },
    });
    await admin.itemCategory.create({
      data: { itemId: item.id, categoryId: presetCategory.id },
    });
    await admin.item.create({
      data: {
        userId: otherUserId,
        status: "owned",
        name: "other item",
        quantity: 1,
      },
    });

    const result = await repository.read(userId);

    expect(result.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: category.id,
          user_id: userId,
          name: "export category",
        }),
        expect.objectContaining({
          id: presetCategory.id,
          user_id: null,
          is_preset: true,
        }),
      ]),
    );
    expect(result.categories).toHaveLength(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: Number(item.id),
      user_id: userId,
      name: "export item",
      actual_price: 12_000,
      category_ids: expect.arrayContaining([category.id, presetCategory.id]),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items[0].category_ids)).toBe(true);
  });
});
