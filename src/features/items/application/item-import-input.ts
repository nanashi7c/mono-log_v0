import type { ItemStatus } from "@/features/items/domain/status";

export type ItemImportCategory = Readonly<{
  sourceId: string | null;
  name: string;
  color: string;
}>;

export type ItemImportRecord = Readonly<{
  name: string;
  status: ItemStatus;
  janCode: string | null;
  quantity: number;
  notes: string | null;
  actualPrice: number | null;
  purchasedAt: string | null;
  categorySourceIds: readonly string[];
}>;

export type ItemImportInput = Readonly<{
  categories: readonly ItemImportCategory[];
  items: readonly ItemImportRecord[];
}>;
