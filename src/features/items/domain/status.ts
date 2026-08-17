export const ITEM_STATUSES = [
  "planned",
  "owned",
  "listed",
  "sold",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const EDITABLE_ITEM_STATUSES = [
  "planned",
  "owned",
  "listed",
] as const satisfies readonly ItemStatus[];

export type EditableItemStatus = (typeof EDITABLE_ITEM_STATUSES)[number];

export function isItemStatus(value: unknown): value is ItemStatus {
  return (
    typeof value === "string" &&
    ITEM_STATUSES.some((status) => status === value)
  );
}

export function isEditableItemStatus(
  value: unknown,
): value is EditableItemStatus {
  return (
    typeof value === "string" &&
    EDITABLE_ITEM_STATUSES.some((status) => status === value)
  );
}

export function itemStatusOrDefault(
  value: unknown,
  fallback: ItemStatus = "owned",
): ItemStatus {
  return isItemStatus(value) ? value : fallback;
}
