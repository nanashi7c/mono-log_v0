export type ItemDeleteResult =
  | Readonly<{ type: "not_found" }>
  | Readonly<{
      type: "deleted";
      previousImageKey: string | null;
    }>;

export interface ItemDeleteRepository {
  delete(userId: string, itemId: number): Promise<ItemDeleteResult>;
}

export interface ItemImageRemover {
  remove(key: string): Promise<void>;
}
