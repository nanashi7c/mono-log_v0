import { withUser, type Tx } from "@/db/client";
import { toItem } from "@/db/serialize";
import type { ItemApiData } from "@/features/items/application/item-api-data";
import type { ItemApiQueryRepository } from "@/features/items/application/item-api-query-ports";
import { toItemApiData } from "@/features/items/infrastructure/item-api-data-mapper";

export type ItemApiQueryTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

async function categoryIdsByItem(
  tx: Tx,
  itemIds: readonly number[],
): Promise<Map<number, readonly number[]>> {
  if (itemIds.length === 0) return new Map();

  const links = await tx.itemCategory.findMany({
    where: { itemId: { in: itemIds.map((itemId) => BigInt(itemId)) } },
    select: { itemId: true, categoryId: true },
  });
  const mutableIdsByItem = new Map<number, number[]>();
  for (const link of links) {
    const itemId = Number(link.itemId);
    const categoryIds = mutableIdsByItem.get(itemId) ?? [];
    categoryIds.push(link.categoryId);
    mutableIdsByItem.set(itemId, categoryIds);
  }

  return new Map(
    [...mutableIdsByItem].map(([itemId, categoryIds]) => [
      itemId,
      Object.freeze([...categoryIds]),
    ]),
  );
}

export function createPrismaItemApiQueryRepository(
  runWithUser: ItemApiQueryTransactionRunner,
): ItemApiQueryRepository {
  return {
    async findMany(userId, status): Promise<readonly ItemApiData[]> {
      return runWithUser(userId, async (tx) => {
        const rows = await tx.item.findMany({
          where: { deletedAt: null, ...(status ? { status } : {}) },
        });
        const itemIds = rows.map((row) => Number(row.id));
        const categoryIds = await categoryIdsByItem(tx, itemIds);

        return Object.freeze(
          rows.map((row) => {
            const itemId = Number(row.id);
            return toItemApiData(
              toItem(row),
              categoryIds.get(itemId) ?? Object.freeze([]),
            );
          }),
        );
      });
    },

    async findById(userId, itemId): Promise<ItemApiData | null> {
      return runWithUser(userId, async (tx) => {
        const row = await tx.item.findFirst({ where: { id: BigInt(itemId) } });
        if (!row) return null;

        const categoryIds = await categoryIdsByItem(tx, [itemId]);
        return toItemApiData(
          toItem(row),
          categoryIds.get(itemId) ?? Object.freeze([]),
        );
      });
    },
  };
}

export const prismaItemApiQueryRepository =
  createPrismaItemApiQueryRepository(withUser);
