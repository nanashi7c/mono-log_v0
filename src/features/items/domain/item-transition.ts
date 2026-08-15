import type { ItemStatus } from "@/features/items/domain/status";

export type ItemTransitionAction =
  | "mark_purchased"
  | "start_listing"
  | "restore_planned"
  | "mark_sold"
  | "cancel_listing";

export type ItemListingChange = "keep" | "ensure" | "remove";

export type ItemTransitionPlan = Readonly<{
  from: ItemStatus;
  to: ItemStatus;
  listingChange: ItemListingChange;
  markDeleted: boolean;
}>;

function frozenPlan(plan: ItemTransitionPlan): ItemTransitionPlan {
  return Object.freeze(plan);
}

const ITEM_TRANSITION_PLANS = Object.freeze({
  mark_purchased: frozenPlan({
    from: "planned",
    to: "owned",
    listingChange: "keep",
    markDeleted: false,
  }),
  start_listing: frozenPlan({
    from: "owned",
    to: "listed",
    listingChange: "ensure",
    markDeleted: false,
  }),
  restore_planned: frozenPlan({
    from: "owned",
    to: "planned",
    listingChange: "keep",
    markDeleted: false,
  }),
  mark_sold: frozenPlan({
    from: "listed",
    to: "sold",
    listingChange: "keep",
    markDeleted: true,
  }),
  cancel_listing: frozenPlan({
    from: "listed",
    to: "owned",
    listingChange: "remove",
    markDeleted: false,
  }),
} satisfies Readonly<Record<ItemTransitionAction, ItemTransitionPlan>>);

export function getItemTransitionPlan(
  action: ItemTransitionAction,
): ItemTransitionPlan {
  return ITEM_TRANSITION_PLANS[action];
}
