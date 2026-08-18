import type { ItemApiData } from "@/features/items/application/item-api-data";
import type { Item } from "@/types/item";

export function toItemApiData(
  item: Item,
  categoryIds: readonly number[],
): ItemApiData {
  return Object.freeze({
    ...item,
    category_ids: Object.freeze([...categoryIds]),
  });
}
