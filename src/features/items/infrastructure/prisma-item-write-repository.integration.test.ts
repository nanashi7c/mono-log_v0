import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Tx } from "@/db/client";
import type { ItemWriteInput } from "@/features/items/application/item-write-input";
import { createPrismaItemWriteRepository } from "@/features/items/infrastructure/prisma-item-write-repository";

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
const repository = createPrismaItemWriteRepository(
  async <T>(userId: string, operation: (tx: Tx) => Promise<T>) =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
      return operation(tx);
    }),
);
const testUserIds = new Set<string>();

function ownedInput(name: string): ItemWriteInput {
  return {
    name,
    status: "owned",
    categoryIds: [],
    newCategoryNames: [],
    janCode: null,
    quantity: 1,
    notes: null,
    actualPrice: null,
    purchasedAt: null,
    plan: {
      plannedPurchaseYear: null,
      plannedPurchaseMonth: null,
      listPrice: null,
      purchasePrice: null,
      productUrl: null,
      dealPeriod: null,
    },
    listing: {
      platformId: null,
      serviceId: null,
      sizeId: null,
      quantity: null,
      sellingPrice: null,
      packagingCost: null,
      workTimeHours: null,
      laborRate: null,
    },
  };
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

async function reserveImageUpload(
  userId: string,
  objectKey: string,
): Promise<string> {
  const uploadId = randomUUID();
  await admin.pendingItemImageUpload.create({
    data: {
      id: uploadId,
      userId,
      objectKey,
      contentType: "image/png",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return uploadId;
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

describe("prismaItemWriteRepository", () => {
  it("作成・更新を通して関連データと画像キーを同期する", async () => {
    const userId = await createTestUser("write-flow");
    const plannedInput: ItemWriteInput = {
      ...ownedInput("planned item"),
      status: "planned",
      newCategoryNames: ["integration category"],
      plan: {
        plannedPurchaseYear: 2027,
        plannedPurchaseMonth: 4,
        listPrice: 12_000,
        purchasePrice: 10_000,
        productUrl: "https://example.com/item",
        dealPeriod: "spring",
      },
    };
    const initialUploadId = await reserveImageUpload(userId, "old-image.png");

    const itemId = await repository.create(
      userId,
      plannedInput,
      initialUploadId,
    );
    const created = await admin.item.findUnique({
      where: { id: BigInt(itemId) },
      include: {
        plan: true,
        itemCategories: { include: { category: true } },
      },
    });
    expect(created).toMatchObject({
      userId,
      status: "planned",
      name: "planned item",
      imageUrl: "old-image.png",
    });
    expect(created?.plan?.purchasePrice?.toNumber()).toBe(10_000);
    expect(
      created?.itemCategories.map(({ category }) => category.name),
    ).toContain("integration category");
    await expect(
      admin.pendingItemImageUpload.findUnique({
        where: { id: initialUploadId },
      }),
    ).resolves.toBeNull();

    const listedInput: ItemWriteInput = {
      ...ownedInput("listed item"),
      status: "listed",
      listing: {
        ...ownedInput("unused").listing,
        quantity: 1,
        sellingPrice: 15_000,
        packagingCost: 300,
        workTimeHours: 1,
        laborRate: 1_200,
      },
    };
    const replacementUploadId = await reserveImageUpload(
      userId,
      "new-image.png",
    );
    const updateResult = await repository.update(
      userId,
      itemId,
      listedInput,
      { type: "replace", uploadId: replacementUploadId },
    );
    const updated = await admin.item.findUnique({
      where: { id: BigInt(itemId) },
      include: { plan: true, listing: true },
    });
    expect(updateResult).toEqual({
      type: "updated",
      previousImageKey: "old-image.png",
    });
    expect(updated).toMatchObject({
      status: "listed",
      name: "listed item",
      imageUrl: "new-image.png",
      plan: null,
    });
    expect(updated?.listing?.sellingPrice?.toNumber()).toBe(15_000);

    const ownedUpdateResult = await repository.update(
      userId,
      itemId,
      ownedInput("owned item"),
      { type: "keep" },
    );
    const owned = await admin.item.findUnique({
      where: { id: BigInt(itemId) },
      include: { listing: true },
    });
    expect(ownedUpdateResult).toEqual({
      type: "updated",
      previousImageKey: "new-image.png",
    });
    expect(owned).toMatchObject({ status: "owned", name: "owned item" });
    expect(owned?.listing?.quantity).toBe(1);
    expect(owned?.listing?.sellingPrice?.toNumber()).toBe(15_000);
    expect(owned?.listing?.packagingCost?.toNumber()).toBe(300);
    expect(owned?.listing?.workTimeHours?.toNumber()).toBe(1);
    expect(owned?.listing?.laborRate?.toNumber()).toBe(1_200);
  });

  it("DB制約違反時は先に作成したカテゴリもロールバックする", async () => {
    const userId = await createTestUser("rollback");
    const invalidInput: ItemWriteInput = {
      ...ownedInput("invalid item"),
      quantity: 0,
      newCategoryNames: ["rollback category"],
    };

    await expect(
      repository.create(userId, invalidInput, null),
    ).rejects.toThrow();
    await expect(
      admin.category.findFirst({
        where: { userId, name: "rollback category" },
      }),
    ).resolves.toBeNull();
  });

  it("DB作成に失敗した場合はpending画像を消費しない", async () => {
    const userId = await createTestUser("image-rollback");
    const uploadId = await reserveImageUpload(userId, "rollback-image.png");
    const invalidInput: ItemWriteInput = {
      ...ownedInput("invalid image item"),
      quantity: 0,
    };

    await expect(
      repository.create(userId, invalidInput, uploadId),
    ).rejects.toThrow();
    await expect(
      admin.pendingItemImageUpload.findUnique({ where: { id: uploadId } }),
    ).resolves.toMatchObject({ objectKey: "rollback-image.png" });
  });

  it("他ユーザーのpending画像を使用できない", async () => {
    const ownerId = await createTestUser("upload-owner");
    const intruderId = await createTestUser("upload-intruder");
    const uploadId = await reserveImageUpload(ownerId, "private-image.png");

    await expect(
      repository.create(
        intruderId,
        ownedInput("invalid upload owner"),
        uploadId,
      ),
    ).rejects.toThrow("画像アップロードの有効期限");
    await expect(
      admin.item.count({ where: { userId: intruderId } }),
    ).resolves.toBe(0);
    await expect(
      admin.pendingItemImageUpload.findUnique({ where: { id: uploadId } }),
    ).resolves.toMatchObject({ userId: ownerId });
  });

  it("期限切れのpending画像を使用できない", async () => {
    const userId = await createTestUser("expired-upload");
    const uploadId = await reserveImageUpload(userId, "expired-image.png");
    await admin.pendingItemImageUpload.update({
      where: { id: uploadId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(
      repository.create(userId, ownedInput("expired image"), uploadId),
    ).rejects.toThrow("画像アップロードの有効期限");
    await expect(
      admin.pendingItemImageUpload.findUnique({ where: { id: uploadId } }),
    ).resolves.toMatchObject({ objectKey: "expired-image.png" });
  });

  it("他ユーザーのアイテムを更新できない", async () => {
    const ownerId = await createTestUser("owner");
    const intruderId = await createTestUser("intruder");
    const ownerUploadId = await reserveImageUpload(ownerId, "owner-image.png");
    const itemId = await repository.create(
      ownerId,
      ownedInput("owner item"),
      ownerUploadId,
    );

    const updateResult = await repository.update(
      intruderId,
      itemId,
      ownedInput("changed by intruder"),
      { type: "remove" },
    );
    const persisted = await admin.item.findUnique({
      where: { id: BigInt(itemId) },
    });

    expect(updateResult).toEqual({ type: "not_found" });
    expect(persisted).toMatchObject({
      userId: ownerId,
      name: "owner item",
      imageUrl: "owner-image.png",
    });
  });

  it("他ユーザーのカテゴリを関連付けられない", async () => {
    const ownerId = await createTestUser("category-owner");
    const intruderId = await createTestUser("category-intruder");
    const category = await admin.category.create({
      data: { userId: ownerId, name: "private category" },
    });
    const input: ItemWriteInput = {
      ...ownedInput("invalid category item"),
      categoryIds: [category.id],
    };

    await expect(repository.create(intruderId, input, null)).rejects.toThrow(
      "選択されたカテゴリが存在しないか、このユーザーには利用できません。",
    );
    await expect(
      admin.item.count({ where: { userId: intruderId } }),
    ).resolves.toBe(0);
  });
});
