import type { ItemWriteInput } from "@/features/items/application/item-write-input";
import type {
  ItemImageChange,
  ItemDeleteResult,
  ItemImageFile,
  ItemImageStore,
  ItemUpdateResult,
  ItemWriteRepository,
} from "@/features/items/application/item-write-ports";

export type ItemWriteDependencies = Readonly<{
  repository: ItemWriteRepository;
  imageStore: ItemImageStore;
  onCleanupError?: (error: unknown) => void;
}>;

export type CreateItemCommand = Readonly<{
  userId: string;
  input: ItemWriteInput;
  image: ItemImageFile | null;
}>;

export type UpdateItemCommand = Readonly<{
  userId: string;
  itemId: number;
  input: ItemWriteInput;
  image: ItemImageFile | null;
  deleteImage: boolean;
}>;

export type DeleteItemCommand = Readonly<{
  userId: string;
  itemId: number;
}>;

function reportCleanupError(
  dependencies: ItemWriteDependencies,
  error: unknown,
): void {
  try {
    dependencies.onCleanupError?.(error);
  } catch {
    // 後処理エラーの通知失敗で、完了済みのDB操作を失敗扱いにしない。
  }
}

async function removeImageBestEffort(
  dependencies: ItemWriteDependencies,
  key: string,
): Promise<void> {
  try {
    await dependencies.imageStore.remove(key);
  } catch (error) {
    reportCleanupError(dependencies, error);
  }
}

export async function createItemUseCase(
  dependencies: ItemWriteDependencies,
  command: CreateItemCommand,
): Promise<number> {
  let uploadedImageKey: string | null = null;

  try {
    if (command.image) {
      uploadedImageKey = await dependencies.imageStore.upload(
        command.userId,
        command.image,
      );
    }

    return await dependencies.repository.create(
      command.userId,
      command.input,
      uploadedImageKey,
    );
  } catch (error) {
    if (uploadedImageKey) {
      await removeImageBestEffort(dependencies, uploadedImageKey);
    }
    throw error;
  }
}

export async function updateItemUseCase(
  dependencies: ItemWriteDependencies,
  command: UpdateItemCommand,
): Promise<ItemUpdateResult> {
  let uploadedImageKey: string | null = null;

  try {
    if (command.image) {
      uploadedImageKey = await dependencies.imageStore.upload(
        command.userId,
        command.image,
      );
    }

    const imageChange: ItemImageChange = uploadedImageKey
      ? { type: "replace", key: uploadedImageKey }
      : command.deleteImage
        ? { type: "remove" }
        : { type: "keep" };

    const result = await dependencies.repository.update(
      command.userId,
      command.itemId,
      command.input,
      imageChange,
    );

    if (result.type === "not_found") {
      if (uploadedImageKey) {
        await removeImageBestEffort(dependencies, uploadedImageKey);
        uploadedImageKey = null;
      }
      return result;
    }

    if (
      imageChange.type !== "keep" &&
      result.previousImageKey &&
      result.previousImageKey !== uploadedImageKey
    ) {
      await removeImageBestEffort(dependencies, result.previousImageKey);
    }
    return result;
  } catch (error) {
    if (uploadedImageKey) {
      await removeImageBestEffort(dependencies, uploadedImageKey);
    }
    throw error;
  }
}

export async function deleteItemUseCase(
  dependencies: ItemWriteDependencies,
  command: DeleteItemCommand,
): Promise<ItemDeleteResult> {
  const result = await dependencies.repository.delete(
    command.userId,
    command.itemId,
  );

  if (result.type === "deleted" && result.previousImageKey) {
    await removeImageBestEffort(dependencies, result.previousImageKey);
  }
  return result;
}
