import type { Category, Item } from "@/types/item";

export const ITEM_BACKUP_VERSION = 1 as const;

export type ExportedItem = Readonly<Item> &
  Readonly<{
    category_ids: readonly number[];
  }>;

export type ItemExportData = Readonly<{
  categories: readonly Readonly<Category>[];
  items: readonly ExportedItem[];
}>;

export type ItemBackup = Readonly<{
  version: typeof ITEM_BACKUP_VERSION;
  exported_at: string;
  categories: readonly Readonly<Category>[];
  items: readonly ExportedItem[];
}>;

export function itemBackupFilename(backup: ItemBackup): string {
  return `mono-log-${backup.exported_at.slice(0, 10)}.json`;
}
