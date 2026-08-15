import { withUser, type Tx } from "@/db/client";
import type {
  ItemTransitionRepository,
  ItemTransitionResult,
} from "@/features/items/application/item-transition-ports";
import type { ItemTransitionPlan } from "@/features/items/domain/item-transition";

export type ItemTransitionTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

function transitionData(
  plan: ItemTransitionPlan,
  transitionedAt: Date | null,
) {
  if (plan.markDeleted) {
    if (!transitionedAt) {
      throw new Error("売却済みへの遷移には遷移時刻が必要です。");
    }
    return { status: plan.to, deletedAt: transitionedAt };
  }
  return { status: plan.to };
}

async function syncListingForTransition(
  tx: Tx,
  itemId: bigint,
  plan: ItemTransitionPlan,
): Promise<void> {
  switch (plan.listingChange) {
    case "keep":
      return;
    case "ensure":
      await tx.listing.upsert({
        where: { itemId },
        update: {},
        create: { itemId },
      });
      return;
    case "remove":
      await tx.listing.deleteMany({ where: { itemId } });
  }
}

export function createPrismaItemTransitionRepository(
  runWithUser: ItemTransitionTransactionRunner,
): ItemTransitionRepository {
  return {
    async transition(
      userId,
      itemId,
      plan,
      transitionedAt,
    ): Promise<ItemTransitionResult> {
      return runWithUser(userId, async (tx) => {
        const persistedItemId = BigInt(itemId);
        const result = await tx.item.updateMany({
          where: { id: persistedItemId, status: plan.from },
          data: transitionData(plan, transitionedAt),
        });
        if (result.count === 0) {
          return { type: "not_found_or_invalid_status" };
        }

        await syncListingForTransition(tx, persistedItemId, plan);
        return { type: "transitioned" };
      });
    },
  };
}

export const prismaItemTransitionRepository =
  createPrismaItemTransitionRepository(withUser);
