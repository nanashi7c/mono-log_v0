import type {
  ItemDeleteRepository,
  ItemDeleteResult,
  ItemImageRemover,
} from "@/features/items/application/item-delete-ports";

export type ItemDeleteDependencies = Readonly<{
  repository: ItemDeleteRepository;
  imageRemover: ItemImageRemover;
  onCleanupError?: (error: unknown) => void;
}>;

export type DeleteItemCommand = Readonly<{
  userId: string;
  itemId: number;
}>;

function reportCleanupError(
  dependencies: ItemDeleteDependencies,
  error: unknown,
): void {
  try {
    dependencies.onCleanupError?.(error);
  } catch {
    // DB deletion is already committed, so cleanup reporting must not change the result.
  }
}

export async function deleteItemUseCase(
  dependencies: ItemDeleteDependencies,
  command: DeleteItemCommand,
): Promise<ItemDeleteResult> {
  const result = await dependencies.repository.delete(
    command.userId,
    command.itemId,
  );

  if (result.type === "deleted" && result.previousImageKey) {
    try {
      await dependencies.imageRemover.remove(result.previousImageKey);
    } catch (error) {
      reportCleanupError(dependencies, error);
    }
  }
  return result;
}
