import type { ItemExportData } from "@/features/items/application/item-export-data";

export interface ItemExportRepository {
  read(userId: string): Promise<ItemExportData>;
}
