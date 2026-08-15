import type { ItemTransitionPlan } from "@/features/items/domain/item-transition";

export type ItemTransitionResult =
  | Readonly<{ type: "transitioned" }>
  | Readonly<{ type: "not_found_or_invalid_status" }>;

export interface ItemTransitionRepository {
  transition(
    userId: string,
    itemId: number,
    plan: ItemTransitionPlan,
    transitionedAt: Date | null,
  ): Promise<ItemTransitionResult>;
}
