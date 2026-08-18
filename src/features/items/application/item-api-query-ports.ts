import type { ItemApiData } from "@/features/items/application/item-api-data";
import type { ItemStatus } from "@/features/items/domain/status";

export interface ItemApiQueryRepository {
  findMany(
    userId: string,
    status: ItemStatus | null,
  ): Promise<readonly ItemApiData[]>;
  findById(userId: string, itemId: number): Promise<ItemApiData | null>;
}
