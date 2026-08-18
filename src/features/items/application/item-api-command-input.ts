import type { ItemStatus } from "@/features/items/domain/status";

export type ItemApiCommandInput = Readonly<{
  status: ItemStatus;
  name: string;
  janCode: string | null;
  quantity: number;
  notes: string | null;
  actualPrice: number | null;
  purchasedAt: string | null;
  categoryIds: readonly number[];
}>;

export type ItemApiActor = Readonly<{
  userId: string;
  email: string;
}>;
