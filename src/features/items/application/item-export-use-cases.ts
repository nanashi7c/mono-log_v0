import {
  ITEM_BACKUP_VERSION,
  type ItemBackup,
} from "@/features/items/application/item-export-data";
import type { ItemExportRepository } from "@/features/items/application/item-export-ports";

export type ItemExportDependencies = Readonly<{
  repository: ItemExportRepository;
  now?: () => Date;
}>;

export type ExportItemsQuery = Readonly<{
  userId: string;
}>;

function currentTime(): Date {
  return new Date();
}

export async function exportItemsUseCase(
  dependencies: ItemExportDependencies,
  query: ExportItemsQuery,
): Promise<ItemBackup> {
  const data = await dependencies.repository.read(query.userId);
  return Object.freeze({
    version: ITEM_BACKUP_VERSION,
    exported_at: (dependencies.now ?? currentTime)().toISOString(),
    categories: data.categories,
    items: data.items,
  });
}
