import type {
  ItemApiActor,
  ItemApiCommandInput,
} from "@/features/items/application/item-api-command-input";
import type {
  CreateItemApiResult,
  ItemApiCommandRepository,
  UpdateItemApiResult,
} from "@/features/items/application/item-api-command-ports";

export type ItemApiCommandDependencies = Readonly<{
  repository: ItemApiCommandRepository;
}>;

export type CreateApiItemCommand = Readonly<{
  actor: ItemApiActor;
  input: ItemApiCommandInput;
}>;

export type UpdateApiItemCommand = Readonly<{
  userId: string;
  itemId: number;
  input: ItemApiCommandInput;
}>;

export async function createApiItemUseCase(
  dependencies: ItemApiCommandDependencies,
  command: CreateApiItemCommand,
): Promise<CreateItemApiResult> {
  return dependencies.repository.create(command.actor, command.input);
}

export async function updateApiItemUseCase(
  dependencies: ItemApiCommandDependencies,
  command: UpdateApiItemCommand,
): Promise<UpdateItemApiResult> {
  return dependencies.repository.update(
    command.userId,
    command.itemId,
    command.input,
  );
}
