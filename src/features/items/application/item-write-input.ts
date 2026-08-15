import type { ItemStatus } from "@/features/items/domain/status";

export type ItemPlanInput = Readonly<{
  plannedPurchaseYear: number | null;
  plannedPurchaseMonth: number | null;
  listPrice: number | null;
  purchasePrice: number | null;
  productUrl: string | null;
  dealPeriod: string | null;
}>;

export type ItemListingInput = Readonly<{
  platformId: number | null;
  serviceId: number | null;
  sizeId: number | null;
  quantity: number | null;
  sellingPrice: number | null;
  packagingCost: number | null;
  workTimeHours: number | null;
  laborRate: number | null;
}>;

export type ItemWriteInput = Readonly<{
  name: string;
  status: ItemStatus;
  categoryIds: readonly number[];
  newCategoryNames: readonly string[];
  janCode: string | null;
  quantity: number;
  notes: string | null;
  actualPrice: number | null;
  purchasedAt: string | null;
  plan: ItemPlanInput;
  listing: ItemListingInput;
}>;
