import type {
  ItemEditFormData,
  ItemFormOptions,
} from "@/features/items/application/item-form-data";

export interface ItemFormQueryRepository {
  findOptions(userId: string): Promise<ItemFormOptions>;
  findEditData(
    userId: string,
    itemId: number,
  ): Promise<ItemEditFormData | null>;
}
