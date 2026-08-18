import type { ItemImportInput } from "@/features/items/application/item-import-input";

export type ItemImportResult = Readonly<{
  insertedItems: number;
}>;

export interface ItemImportRepository {
  import(userId: string, input: ItemImportInput): Promise<ItemImportResult>;
}
