import type { Item } from "@/types/item";

export type ItemApiData = Readonly<Item> &
  Readonly<{
    category_ids: readonly number[];
  }>;
