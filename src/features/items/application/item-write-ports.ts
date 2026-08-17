import type { ItemWriteInput } from "@/features/items/application/item-write-input";

export type ItemImageFile = Readonly<{
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type ItemImageChange =
  | Readonly<{ type: "keep" }>
  | Readonly<{ type: "remove" }>
  | Readonly<{ type: "replace"; key: string }>;

export type ItemNotFoundResult = Readonly<{
  type: "not_found";
}>;

export type ItemUpdateResult =
  | ItemNotFoundResult
  | Readonly<{
      type: "updated";
      previousImageKey: string | null;
    }>;

export type ItemDeleteResult =
  | ItemNotFoundResult
  | Readonly<{
      type: "deleted";
      previousImageKey: string | null;
    }>;

export interface ItemWriteRepository {
  create(
    userId: string,
    input: ItemWriteInput,
    imageKey: string | null,
  ): Promise<number>;
  update(
    userId: string,
    itemId: number,
    input: ItemWriteInput,
    imageChange: ItemImageChange,
  ): Promise<ItemUpdateResult>;
  delete(userId: string, itemId: number): Promise<ItemDeleteResult>;
}

export interface ItemImageStore {
  upload(userId: string, file: ItemImageFile): Promise<string>;
  remove(key: string): Promise<void>;
}
