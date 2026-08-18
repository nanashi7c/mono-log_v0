import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import { createPrismaItemApiQueryRepository } from "@/features/items/infrastructure/prisma-item-api-query-repository";

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
const repository = createPrismaItemApiQueryRepository(
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

async function removeTestData(): Promise<void> {
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

afterEach(removeTestData);

afterAll(async () => {
  await removeTestData();
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("prismaItemApiQueryRepository", () => {
  it("lists visible active items, filters status, and includes category ids", async () => {
    const userId = await createTestUser("api-query-owner");
    const otherUserId = await createTestUser("api-query-other");
    const category = await admin.category.create({
      data: { userId, name: "API query category", color: "#123456" },
    });
    const owned = await admin.item.create({
      data: { userId, status: "owned", name: "owned item", quantity: 1 },
    });
    const planned = await admin.item.create({
      data: { userId, status: "planned", name: "planned item", quantity: 1 },
    });
    const listed = await admin.item.create({
      data: { userId, status: "listed", name: "listed item", quantity: 1 },
    });
    const sold = await admin.item.create({
      data: { userId, status: "sold", name: "active sold item", quantity: 1 },
    });
    await admin.item.create({
      data: {
        userId,
        status: "sold",
        name: "deleted item",
        quantity: 1,
        deletedAt: new Date("2026-08-18T00:00:00.000Z"),
      },
    });
    await admin.item.create({
      data: { userId: otherUserId, status: "owned", name: "hidden item", quantity: 1 },
    });
    await admin.itemCategory.create({
      data: { itemId: owned.id, categoryId: category.id },
    });

    const all = await repository.findMany(userId, null);
    const plannedOnly = await repository.findMany(userId, "planned");

    expect(all).toHaveLength(4);
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: Number(owned.id),
          name: "owned item",
          category_ids: [category.id],
        }),
        expect.objectContaining({
          id: Number(planned.id),
          name: "planned item",
          category_ids: [],
        }),
        expect.objectContaining({
          id: Number(listed.id),
          status: "listed",
          category_ids: [],
        }),
        expect.objectContaining({
          id: Number(sold.id),
          status: "sold",
          category_ids: [],
        }),
      ]),
    );
    expect(plannedOnly).toEqual([
      expect.objectContaining({ id: Number(planned.id), status: "planned" }),
    ]);
    expect(Object.isFrozen(all)).toBe(true);
    expect(all.every(Object.isFrozen)).toBe(true);
    expect(all.every((item) => Object.isFrozen(item.category_ids))).toBe(true);
  });

  it("returns a soft-deleted detail for its owner but hides it through RLS", async () => {
    const userId = await createTestUser("api-detail-owner");
    const otherUserId = await createTestUser("api-detail-other");
    const category = await admin.category.create({
      data: { userId, name: "Deleted detail category", color: "#654321" },
    });
    const deleted = await admin.item.create({
      data: {
        userId,
        status: "sold",
        name: "deleted detail",
        quantity: 1,
        deletedAt: new Date("2026-08-18T00:00:00.000Z"),
      },
    });
    await admin.itemCategory.create({
      data: { itemId: deleted.id, categoryId: category.id },
    });

    const visible = await repository.findById(userId, Number(deleted.id));
    const hidden = await repository.findById(otherUserId, Number(deleted.id));

    expect(visible).toMatchObject({
      id: Number(deleted.id),
      name: "deleted detail",
      category_ids: [category.id],
    });
    expect(visible?.deleted_at).not.toBeNull();
    expect(Object.isFrozen(visible)).toBe(true);
    expect(Object.isFrozen(visible?.category_ids)).toBe(true);
    expect(hidden).toBeNull();
  });
});
