import { withUser, type Tx } from "@/db/client";
import { toCategory, toItem } from "@/db/serialize";
import type { ItemExportRepository } from "@/features/items/application/item-export-ports";

export type ItemExportTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

async function categoryIdsByItem(
  tx: Tx,
  itemIds: readonly number[],
): Promise<ReadonlyMap<number, readonly number[]>> {
  const categoryIds = new Map<number, number[]>();
  if (itemIds.length === 0) return categoryIds;

  const links = await tx.itemCategory.findMany({
    where: { itemId: { in: itemIds.map(BigInt) } },
    select: { itemId: true, categoryId: true },
  });
  for (const link of links) {
    const itemId = Number(link.itemId);
    const ids = categoryIds.get(itemId) ?? [];
    ids.push(link.categoryId);
    categoryIds.set(itemId, ids);
  }
  return categoryIds;
}

export function createPrismaItemExportRepository(
  runWithUser: ItemExportTransactionRunner,
): ItemExportRepository {
  return {
    async read(userId) {
      return runWithUser(userId, async (tx) => {
        const itemRows = await tx.item.findMany();
        const categoryIds = await categoryIdsByItem(
          tx,
          itemRows.map(({ id }) => Number(id)),
        );
        const linkedCategoryIds = [
          ...new Set([...categoryIds.values()].flat()),
        ];
        const categoryRows = await tx.category.findMany({
          where:
            linkedCategoryIds.length === 0
              ? { userId }
              : { OR: [{ userId }, { id: { in: linkedCategoryIds } }] },
        });
        const categories = Object.freeze(
          categoryRows.map((row) => Object.freeze(toCategory(row))),
        );
        const items = Object.freeze(
          itemRows.map((row) => {
            const itemId = Number(row.id);
            return Object.freeze({
              ...toItem(row),
              category_ids: Object.freeze([...(categoryIds.get(itemId) ?? [])]),
            });
          }),
        );

        return Object.freeze({ categories, items });
      });
    },
  };
}

export const prismaItemExportRepository =
  createPrismaItemExportRepository(withUser);
