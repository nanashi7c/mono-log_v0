import { withUser, type Tx } from "@/db/client";
import type {
  ItemImportCategory,
  ItemImportInput,
  ItemImportRecord,
} from "@/features/items/application/item-import-input";
import type { ItemImportRepository } from "@/features/items/application/item-import-ports";

export type ItemImportTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

async function resolveImportedCategoryIds(
  tx: Tx,
  userId: string,
  categories: readonly ItemImportCategory[],
): Promise<ReadonlyMap<string, number>> {
  const visibleCategories = await tx.category.findMany({
    select: { id: true, name: true },
  });
  const idByName = new Map(
    visibleCategories.map(({ id, name }) => [name, id] as const),
  );
  const idBySourceId = new Map<string, number>();

  for (const category of categories) {
    let categoryId = idByName.get(category.name);
    if (categoryId == null) {
      const created = await tx.category.create({
        data: {
          userId,
          name: category.name,
          color: category.color,
        },
        select: { id: true },
      });
      categoryId = created.id;
      idByName.set(category.name, categoryId);
    }
    if (category.sourceId !== null) {
      idBySourceId.set(category.sourceId, categoryId);
    }
  }
  return idBySourceId;
}

async function createImportedItem(
  tx: Tx,
  userId: string,
  item: ItemImportRecord,
  categoryIdBySourceId: ReadonlyMap<string, number>,
): Promise<void> {
  const row = await tx.item.create({
    data: {
      userId,
      status: item.status,
      name: item.name,
      janCode: item.janCode,
      quantity: item.quantity,
      notes: item.notes,
      actualPrice: item.actualPrice,
      purchasedAt: item.purchasedAt ? new Date(item.purchasedAt) : null,
    },
    select: { id: true },
  });
  const categoryIds = [
    ...new Set(
      item.categorySourceIds
        .map((sourceId) => categoryIdBySourceId.get(sourceId))
        .filter((categoryId): categoryId is number => categoryId !== undefined),
    ),
  ];
  if (categoryIds.length === 0) return;

  await tx.itemCategory.createMany({
    data: categoryIds.map((categoryId) => ({
      itemId: row.id,
      categoryId,
    })),
  });
}

export function createPrismaItemImportRepository(
  runWithUser: ItemImportTransactionRunner,
): ItemImportRepository {
  return {
    async import(userId, input: ItemImportInput) {
      return runWithUser(userId, async (tx) => {
        const categoryIdBySourceId = await resolveImportedCategoryIds(
          tx,
          userId,
          input.categories,
        );
        for (const item of input.items) {
          await createImportedItem(tx, userId, item, categoryIdBySourceId);
        }
        return { insertedItems: input.items.length };
      });
    },
  };
}

export const prismaItemImportRepository =
  createPrismaItemImportRepository(withUser);
