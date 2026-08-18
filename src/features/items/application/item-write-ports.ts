import type { ItemWriteInput } from "@/features/items/application/item-write-input";

export type ItemImageChange =
  | Readonly<{ type: "keep" }>
  | Readonly<{ type: "remove" }>
  | Readonly<{ type: "replace"; uploadId: string }>;

export type ItemNotFoundResult = Readonly<{
  type: "not_found";
}>;

export type ItemUpdateResult =
  | ItemNotFoundResult
  | Readonly<{
      type: "updated";
      previousImageKey: string | null;
    }>;

export interface ItemWriteRepository {
  create(
    userId: string,
    input: ItemWriteInput,
    imageUploadId: string | null,
  ): Promise<number>;
  update(
    userId: string,
    itemId: number,
    input: ItemWriteInput,
    imageChange: ItemImageChange,
  ): Promise<ItemUpdateResult>;
}
