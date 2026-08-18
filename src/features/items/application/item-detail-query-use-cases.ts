import type { ItemDetailData } from "@/features/items/application/item-detail-data";
import type { ItemDetailQueryRepository } from "@/features/items/application/item-detail-query-ports";

export type ItemDetailQueryDependencies = Readonly<{
  repository: ItemDetailQueryRepository;
}>;

export async function loadItemDetailUseCase(
  dependencies: ItemDetailQueryDependencies,
  query: Readonly<{ userId: string; itemId: number }>,
): Promise<ItemDetailData | null> {
  return dependencies.repository.findDetail(query.userId, query.itemId);
}
