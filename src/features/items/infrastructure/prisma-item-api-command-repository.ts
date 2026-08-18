import { withUser, type Tx } from "@/db/client";
import { toItem } from "@/db/serialize";
import type { ItemApiCommandRepository } from "@/features/items/application/item-api-command-ports";
import { toItemApiData } from "@/features/items/infrastructure/item-api-data-mapper";

export type ItemApiCommandTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

const invalidCategoriesResult = Object.freeze({
  status: "invalid_categories" as const,
});
const notFoundResult = Object.freeze({ status: "not_found" as const });

async function hasOnlyVisibleCategories(
  tx: Tx,
  categoryIds: readonly number[],
): Promise<boolean> {
  const requestedIds = [...new Set(categoryIds)];
  if (requestedIds.length === 0) return true;

  const visibleCategoryCount = await tx.category.count({
    where: { id: { in: requestedIds } },
  });
  return visibleCategoryCount === requestedIds.length;
}

async function insertItemCategories(
  tx: Tx,
  itemId: bigint,
  categoryIds: readonly number[],
): Promise<void> {
  if (categoryIds.length === 0) return;

  await tx.itemCategory.createMany({
    data: categoryIds.map((categoryId) => ({ itemId, categoryId })),
  });
}

async function replaceItemCategories(
  tx: Tx,
  itemId: bigint,
  categoryIds: readonly number[],
): Promise<void> {
  await tx.itemCategory.deleteMany({ where: { itemId } });
  await insertItemCategories(tx, itemId, categoryIds);
}

export function createPrismaItemApiCommandRepository(
  runWithUser: ItemApiCommandTransactionRunner,
): ItemApiCommandRepository {
  return {
    async create(actor, input) {
      return runWithUser(actor.userId, async (tx) => {
        if (!(await hasOnlyVisibleCategories(tx, input.categoryIds))) {
          return invalidCategoriesResult;
        }

        await tx.user.upsert({
          where: { id: actor.userId },
          update: {},
          create: {
            id: actor.userId,
            email: actor.email,
            username: actor.email.split("@")[0],
          },
        });

        const row = await tx.item.create({
          data: {
            userId: actor.userId,
            status: input.status,
            name: input.name,
            janCode: input.janCode,
            quantity: input.quantity,
            notes: input.notes,
            actualPrice: input.actualPrice,
            purchasedAt: input.purchasedAt
              ? new Date(input.purchasedAt)
              : null,
          },
        });
        await insertItemCategories(tx, row.id, input.categoryIds);

        return Object.freeze({
          status: "created" as const,
          item: toItemApiData(toItem(row), input.categoryIds),
        });
      });
    },

    async update(userId, itemId, input) {
      return runWithUser(userId, async (tx) => {
        const existing = await tx.item.findFirst({
          where: { id: BigInt(itemId) },
          select: { id: true },
        });
        if (!existing) return notFoundResult;
        if (!(await hasOnlyVisibleCategories(tx, input.categoryIds))) {
          return invalidCategoriesResult;
        }

        const row = await tx.item.update({
          where: { id: BigInt(itemId) },
          data: {
            status: input.status,
            name: input.name,
            janCode: input.janCode,
            quantity: input.quantity,
            notes: input.notes,
            actualPrice: input.actualPrice,
            purchasedAt: input.purchasedAt
              ? new Date(input.purchasedAt)
              : null,
          },
        });
        await replaceItemCategories(tx, BigInt(itemId), input.categoryIds);

        return Object.freeze({
          status: "updated" as const,
          item: toItemApiData(toItem(row), input.categoryIds),
        });
      });
    },
  };
}

export const prismaItemApiCommandRepository =
  createPrismaItemApiCommandRepository(withUser);
