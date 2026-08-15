import type {
  OwnedItemListData,
  OwnedItemsFilter,
  PlannedItemListRow,
  SellingItemListRow,
} from "@/features/items/application/item-list-data";
import type { ItemListQueryRepository } from "@/features/items/application/item-list-query-ports";

export type ItemListQueryDependencies = Readonly<{
  repository: ItemListQueryRepository;
}>;

export async function loadOwnedItemsUseCase(
  dependencies: ItemListQueryDependencies,
  query: Readonly<{ userId: string; filter: OwnedItemsFilter }>,
): Promise<OwnedItemListData> {
  return dependencies.repository.findOwned(query.userId, query.filter);
}

export async function loadPlannedItemsUseCase(
  dependencies: ItemListQueryDependencies,
  query: Readonly<{ userId: string }>,
): Promise<readonly PlannedItemListRow[]> {
  return dependencies.repository.findPlanned(query.userId);
}

export async function loadSellingItemsUseCase(
  dependencies: ItemListQueryDependencies,
  query: Readonly<{ userId: string }>,
): Promise<readonly SellingItemListRow[]> {
  return dependencies.repository.findSelling(query.userId);
}
