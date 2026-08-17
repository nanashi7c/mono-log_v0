import type {
  OwnedItemListData,
  OwnedItemsFilter,
  PlannedItemListRow,
  SellingItemListRow,
} from "@/features/items/application/item-list-data";

export interface ItemListQueryRepository {
  findOwned(
    userId: string,
    filter: OwnedItemsFilter,
  ): Promise<OwnedItemListData>;
  findPlanned(userId: string): Promise<readonly PlannedItemListRow[]>;
  findSelling(userId: string): Promise<readonly SellingItemListRow[]>;
}
