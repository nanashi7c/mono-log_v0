import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import { createPrismaItemDeleteRepository } from "@/features/items/infrastructure/prisma-item-delete-repository";

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
  datasourceUrl: localDatabaseUrl(
    "TEST_DATABASE_URL",
    LOCAL_ADMIN_DATABASE_URL,
  ),
});
const app = new PrismaClient({
  datasourceUrl: localDatabaseUrl(
    "TEST_APP_DATABASE_URL",
    LOCAL_APP_DATABASE_URL,
  ),
});
const repository = createPrismaItemDeleteRepository(
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

async function createTestItem(userId: string, imageUrl: string) {
  return admin.item.create({
    data: {
      userId,
      name: "delete target",
      status: "owned",
      quantity: 1,
      imageUrl,
      itemCategories: {
        create: {
          category: {
            create: { userId, name: "delete category" },
          },
        },
      },
    },
    include: { itemCategories: true },
  });
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

describe("prismaItemDeleteRepository", () => {
  it("所有者のアイテムを関連データごと削除し、以前の画像キーを返す", async () => {
    const userId = await createTestUser("delete-owner");
    const item = await createTestItem(userId, "owner-image.png");
    expect(item.itemCategories).toHaveLength(1);

    const result = await repository.delete(userId, Number(item.id));

    expect(result).toEqual({
      type: "deleted",
      previousImageKey: "owner-image.png",
    });
    await expect(
      admin.item.findUnique({ where: { id: item.id } }),
    ).resolves.toBeNull();
    await expect(
      admin.itemCategory.findFirst({ where: { itemId: item.id } }),
    ).resolves.toBeNull();
  });

  it("他ユーザーのアイテムは存在を隠して削除しない", async () => {
    const ownerId = await createTestUser("delete-owner");
    const intruderId = await createTestUser("delete-intruder");
    const item = await createTestItem(ownerId, "owner-image.png");

    const result = await repository.delete(intruderId, Number(item.id));

    expect(result).toEqual({ type: "not_found" });
    await expect(
      admin.item.findUnique({ where: { id: item.id } }),
    ).resolves.toMatchObject({
      userId: ownerId,
      imageUrl: "owner-image.png",
    });
  });
});
