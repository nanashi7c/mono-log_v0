import type { ItemApiData } from "@/features/items/application/item-api-data";
import type { ItemApiQueryRepository } from "@/features/items/application/item-api-query-ports";
import type { ItemStatus } from "@/features/items/domain/status";

export type ItemApiQueryDependencies = Readonly<{
  repository: ItemApiQueryRepository;
}>;

export async function loadApiItemsUseCase(
  dependencies: ItemApiQueryDependencies,
  query: Readonly<{ userId: string; status: ItemStatus | null }>,
): Promise<readonly ItemApiData[]> {
  return dependencies.repository.findMany(query.userId, query.status);
}

export async function loadApiItemUseCase(
  dependencies: ItemApiQueryDependencies,
  query: Readonly<{ userId: string; itemId: number }>,
): Promise<ItemApiData | null> {
  return dependencies.repository.findById(query.userId, query.itemId);
}
