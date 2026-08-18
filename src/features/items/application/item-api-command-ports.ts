import type {
  ItemApiActor,
  ItemApiCommandInput,
} from "@/features/items/application/item-api-command-input";
import type { ItemApiData } from "@/features/items/application/item-api-data";

export type CreateItemApiResult = Readonly<
  | { status: "created"; item: ItemApiData }
  | { status: "invalid_categories" }
>;

export type UpdateItemApiResult = Readonly<
  | { status: "updated"; item: ItemApiData }
  | { status: "not_found" }
  | { status: "invalid_categories" }
>;

export interface ItemApiCommandRepository {
  create(
    actor: ItemApiActor,
    input: ItemApiCommandInput,
  ): Promise<CreateItemApiResult>;
  update(
    userId: string,
    itemId: number,
    input: ItemApiCommandInput,
  ): Promise<UpdateItemApiResult>;
}
