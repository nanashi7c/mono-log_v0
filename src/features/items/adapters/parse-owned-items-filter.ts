import type { OwnedItemsFilter } from "@/features/items/application/item-list-data";

export function parseOwnedItemsFilter(
  query: string | undefined,
  category: string | undefined,
): OwnedItemsFilter {
  const normalizedQuery = query?.trim() || null;
  if (category === "__none__") {
    return Object.freeze({
      query: normalizedQuery,
      category: Object.freeze({ type: "uncategorized" }),
    });
  }

  const categoryId = category ? Number(category) : Number.NaN;
  if (Number.isInteger(categoryId) && categoryId > 0) {
    return Object.freeze({
      query: normalizedQuery,
      category: Object.freeze({ type: "category", categoryId }),
    });
  }
  return Object.freeze({
    query: normalizedQuery,
    category: Object.freeze({ type: "all" }),
  });
}
