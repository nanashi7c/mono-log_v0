import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import { DEMO_INITIAL_DATA } from "@/features/demo/application/demo-reset-data";
import { createPrismaDemoResetRepository } from "./prisma-demo-reset-repository";

const LOCAL_ADMIN_DATABASE_URL =
  "postgresql://monolog_admin:localdev@localhost:5433/monolog";
const LOCAL_APP_DATABASE_URL =
  "postgresql://monolog_app:localapppw@localhost:5433/monolog";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function localDatabaseUrl(environmentName: string, fallback: string): string {
  const value = process.env[environmentName] ?? fallback;
  const host = new URL(value).hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`${environmentName} must point to a loopback database.`);
  }
  return value;
}

const admin = new PrismaClient({
  datasourceUrl: localDatabaseUrl("TEST_DATABASE_URL", LOCAL_ADMIN_DATABASE_URL),
});
const app = new PrismaClient({
  datasourceUrl: localDatabaseUrl("TEST_APP_DATABASE_URL", LOCAL_APP_DATABASE_URL),
});
const repository = createPrismaDemoResetRepository(
  async <T>(userId: string, operation: (tx: Tx) => Promise<T>) =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
      return operation(tx);
    }),
);
const testUserIds = new Set<string>();

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  testUserIds.add(id);
  await admin.user.create({
    data: { id, email: `${label}-${id}@integration.test`, username: label },
  });
  return id;
}

async function cleanup(): Promise<void> {
  const ids = [...testUserIds];
  if (ids.length > 0) await admin.user.deleteMany({ where: { id: { in: ids } } });
  testUserIds.clear();
}

beforeAll(async () => {
  await Promise.all([admin.$queryRaw`select 1`, app.$queryRaw`select 1`]);
});
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("prismaDemoResetRepository", () => {
  it("replaces only demo-owned data and returns its stale image keys", async () => {
    const demoUserId = await createUser("demo-before");
    const otherUserId = await createUser("other");
    const demoCategory = await admin.category.create({
      data: { userId: demoUserId, name: "old demo category" },
    });
    await admin.item.create({
      data: {
        userId: demoUserId,
        status: "owned",
        name: "old demo item",
        imageUrl: `${demoUserId}/items/demo-old.png`,
        quantity: 1,
        itemCategories: { create: [{ categoryId: demoCategory.id }] },
      },
    });
    await admin.pendingItemImageUpload.create({
      data: {
        id: randomUUID(),
        userId: demoUserId,
        objectKey: `${demoUserId}/items/demo-pending.png`,
        contentType: "image/png",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await admin.item.create({
      data: {
        userId: otherUserId,
        status: "owned",
        name: "other user's item",
        imageUrl: "other.png",
        quantity: 1,
      },
    });

    const result = await repository.reset({
      userId: demoUserId,
      email: `demo-reset-${demoUserId}@integration.test`,
      seed: DEMO_INITIAL_DATA,
    });

    expect(result.staleImageKeys).toEqual([
      `${demoUserId}/items/demo-old.png`,
      `${demoUserId}/items/demo-pending.png`,
    ]);
    await expect(
      admin.item.findMany({
        where: { userId: demoUserId },
        orderBy: { name: "asc" },
        select: { name: true },
      }),
    ).resolves.toEqual(
      [...DEMO_INITIAL_DATA.items]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name }) => ({ name })),
    );
    await expect(
      admin.category.count({ where: { userId: demoUserId } }),
    ).resolves.toBe(DEMO_INITIAL_DATA.categories.length);
    await expect(
      admin.pendingItemImageUpload.count({ where: { userId: demoUserId } }),
    ).resolves.toBe(0);
    await expect(
      admin.item.findFirst({ where: { userId: otherUserId } }),
    ).resolves.toMatchObject({ name: "other user's item", imageUrl: "other.png" });
  });
});
