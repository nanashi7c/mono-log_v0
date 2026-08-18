import { withUser, type Tx } from "@/db/client";
import type { ItemDeleteRepository } from "@/features/items/application/item-delete-ports";

export type ItemDeleteTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

export function createPrismaItemDeleteRepository(
  runWithUser: ItemDeleteTransactionRunner,
): ItemDeleteRepository {
  return {
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

export const prismaItemDeleteRepository =
  createPrismaItemDeleteRepository(withUser);
