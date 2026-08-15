import { withUser, type Tx } from "@/db/client";
import type {
  ItemImageChange,
  ItemWriteRepository,
} from "@/features/items/application/item-write-ports";
import {
  resolveCategoryIds,
  syncItemCategories,
  syncItemListing,
  syncItemPlan,
} from "@/features/items/infrastructure/item-persistence";

export type UserTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

function imageUpdateData(imageChange: ItemImageChange) {
  switch (imageChange.type) {
    case "keep":
      return {};
    case "remove":
      return { imageUrl: null };
    case "replace":
      return { imageUrl: imageChange.key };
  }
}

export function createPrismaItemWriteRepository(
  runWithUser: UserTransactionRunner,
): ItemWriteRepository {
  return {
    async create(userId, input, imageKey) {
      return runWithUser(userId, async (tx) => {
        const categoryIds = await resolveCategoryIds(tx, input, userId);
        const row = await tx.item.create({
          data: {
            userId,
            status: input.status,
            name: input.name,
            imageUrl: imageKey,
            janCode: input.janCode,
            quantity: input.quantity,
            notes: input.notes,
            actualPrice: input.actualPrice,
            purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
          },
        });
        const itemId = Number(row.id);

        await syncItemCategories(tx, itemId, categoryIds);
        await syncItemPlan(tx, itemId, input);
        await syncItemListing(tx, itemId, input);

        return itemId;
      });
    },

    async update(userId, itemId, input, imageChange) {
      return runWithUser(userId, async (tx) => {
        const existing = await tx.item.findFirst({
          where: { id: BigInt(itemId) },
          select: { imageUrl: true },
        });
        if (!existing) return { type: "not_found" };

        const categoryIds = await resolveCategoryIds(tx, input, userId);

        await syncItemListing(tx, itemId, input);
        await tx.item.updateMany({
          where: { id: BigInt(itemId) },
          data: {
            status: input.status,
            name: input.name,
            janCode: input.janCode,
            quantity: input.quantity,
            notes: input.notes,
            actualPrice: input.actualPrice,
            purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
            ...imageUpdateData(imageChange),
          },
        });
        await syncItemCategories(tx, itemId, categoryIds);
        await syncItemPlan(tx, itemId, input);

        return {
          type: "updated",
          previousImageKey: existing.imageUrl,
        };
      });
    },

    async delete(userId, itemId) {
      return runWithUser(userId, async (tx) => {
        const existing = await tx.item.findFirst({
          where: { id: BigInt(itemId) },
          select: { imageUrl: true },
        });
        if (!existing) return { type: "not_found" };

        await tx.item.deleteMany({ where: { id: BigInt(itemId) } });
        return {
          type: "deleted",
          previousImageKey: existing.imageUrl,
        };
      });
    },
  };
}

export const prismaItemWriteRepository =
  createPrismaItemWriteRepository(withUser);
