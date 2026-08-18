import type {
  ItemEditFormData,
  ItemFormOptions,
} from "@/features/items/application/item-form-data";
import type { ItemFormQueryRepository } from "@/features/items/application/item-form-query-ports";

export type ItemFormQueryDependencies = Readonly<{
  repository: ItemFormQueryRepository;
}>;

export async function loadItemFormOptionsUseCase(
  dependencies: ItemFormQueryDependencies,
  query: Readonly<{ userId: string }>,
): Promise<ItemFormOptions> {
  return dependencies.repository.findOptions(query.userId);
}

export async function loadItemEditFormUseCase(
  dependencies: ItemFormQueryDependencies,
  query: Readonly<{ userId: string; itemId: number }>,
): Promise<ItemEditFormData | null> {
  return dependencies.repository.findEditData(query.userId, query.itemId);
}
