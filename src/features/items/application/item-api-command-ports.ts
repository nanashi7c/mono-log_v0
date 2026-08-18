import type {
  ItemApiActor,
  ItemApiCommandInput,
} from "@/features/items/application/item-api-command-input";
import type { ItemApiData } from "@/features/items/application/item-api-data";

export interface ItemApiCommandRepository {
  create(
    actor: ItemApiActor,
    input: ItemApiCommandInput,
  ): Promise<ItemApiData>;
  update(
    userId: string,
    itemId: number,
    input: ItemApiCommandInput,
  ): Promise<ItemApiData | null>;
}
