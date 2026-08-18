import { describe, expect, it } from "vitest";
import {
  getItemTransitionPlan,
  type ItemTransitionAction,
  type ItemTransitionPlan,
} from "@/features/items/domain/item-transition";

const cases: readonly Readonly<{
  action: ItemTransitionAction;
  expected: ItemTransitionPlan;
}>[] = [
  {
    action: "mark_purchased",
    expected: {
      from: "planned",
      to: "owned",
      listingChange: "keep",
      markDeleted: false,
    },
  },
  {
    action: "start_listing",
    expected: {
      from: "owned",
      to: "listed",
      listingChange: "ensure",
      markDeleted: false,
    },
  },
  {
    action: "restore_planned",
    expected: {
      from: "owned",
      to: "planned",
      listingChange: "keep",
      markDeleted: false,
    },
  },
  {
    action: "mark_sold",
    expected: {
      from: "listed",
      to: "sold",
      listingChange: "keep",
      markDeleted: true,
    },
  },
  {
    action: "cancel_listing",
    expected: {
      from: "listed",
      to: "owned",
      listingChange: "keep",
      markDeleted: false,
    },
  },
];

describe("アイテム状態遷移", () => {
  it.each(cases)("$actionの遷移規則を返す", ({ action, expected }) => {
    expect(getItemTransitionPlan(action)).toEqual(expected);
  });

  it.each(cases)("$actionの遷移規則は変更できない", ({ action }) => {
    expect(Object.isFrozen(getItemTransitionPlan(action))).toBe(true);
  });
});
