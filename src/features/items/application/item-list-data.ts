import type {
  Category,
  Item,
  ItemWithCategories,
  Listing,
  Plan,
} from "@/types/item";

export type ItemCategoryFilter =
  | Readonly<{ type: "all" }>
  | Readonly<{ type: "uncategorized" }>
  | Readonly<{ type: "category"; categoryId: number }>;

export type OwnedItemsFilter = Readonly<{
  query: string | null;
  category: ItemCategoryFilter;
}>;

export type OwnedItemListData = Readonly<{
  items: readonly Readonly<ItemWithCategories>[];
  categoryOptions: readonly Readonly<
    Pick<Category, "id" | "name" | "color">
  >[];
}>;

export type PlannedItemListRow = Readonly<Item> &
  Readonly<{
    categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
    plan: Readonly<Plan> | null;
  }>;

export type SellingItemListRow = Readonly<Item> &
  Readonly<{
    listing: Readonly<Listing> | null;
    shippingFee: number | null;
  }>;
