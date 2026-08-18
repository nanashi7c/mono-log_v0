import type { ItemDetailData } from "@/features/items/application/item-detail-data";

export interface ItemDetailQueryRepository {
  findDetail(userId: string, itemId: number): Promise<ItemDetailData | null>;
}
