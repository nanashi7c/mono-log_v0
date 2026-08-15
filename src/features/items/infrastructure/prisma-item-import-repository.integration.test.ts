import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import type { ItemImportInput } from "@/features/items/application/item-import-input";
import { createPrismaItemImportRepository } from "@/features/items/infrastructure/prisma-item-import-repository";

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
const repository = createPrismaItemImportRepository(
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

describe("prismaItemImportRepository", () => {
  it("カテゴリとアイテムを作成して旧カテゴリIDを関連付ける", async () => {
    const userId = await createTestUser("import-flow");
    const input: ItemImportInput = {
      categories: [
        { sourceId: "old-5", name: "import category", color: "#112233" },
        { sourceId: "old-6", name: "import category", color: "#112233" },
      ],
      items: [
        {
          name: "imported item",
          status: "owned",
          janCode: null,
          quantity: 2,
          notes: "memo",
          actualPrice: 12_000,
          purchasedAt: "2026-08-15",
          categorySourceIds: ["old-5", "old-6", "missing"],
        },
      ],
    };

    const result = await repository.import(userId, input);
    const imported = await admin.item.findFirst({
      where: { userId, name: "imported item" },
      include: {
        itemCategories: { include: { category: true } },
      },
    });

    expect(result).toEqual({ insertedItems: 1 });
    expect(imported).toMatchObject({
      status: "owned",
      quantity: 2,
      actualPrice: 12_000,
    });
    expect(imported?.purchasedAt?.toISOString()).toContain("2026-08-15");
    expect(
      imported?.itemCategories.map(({ category }) => category.name),
    ).toEqual(["import category"]);
  });

  it("アイテム作成失敗時は先に作成したカテゴリもロールバックする", async () => {
    const userId = await createTestUser("import-rollback");
    const input: ItemImportInput = {
      categories: [
        { sourceId: "old-1", name: "rollback category", color: "#112233" },
      ],
      items: [
        {
          name: "invalid item",
          status: "owned",
          janCode: "12345678901234",
          quantity: 1,
          notes: null,
          actualPrice: null,
          purchasedAt: null,
          categorySourceIds: ["old-1"],
        },
      ],
    };

    await expect(repository.import(userId, input)).rejects.toThrow();
    await expect(
      admin.category.findFirst({
        where: { userId, name: "rollback category" },
      }),
    ).resolves.toBeNull();
    await expect(
      admin.item.findFirst({ where: { userId, name: "invalid item" } }),
    ).resolves.toBeNull();
  });
});
