import type { ItemWriteInput } from "@/features/items/application/item-write-input";
import type {
  ItemImageObjectStore,
  PendingItemImageUploadRepository,
} from "@/features/items/application/item-image-upload-ports";
import { verifyPendingItemImageUpload } from "@/features/items/application/item-image-upload-use-cases";
import type {
  ItemImageChange,
  ItemUpdateResult,
  ItemWriteRepository,
} from "@/features/items/application/item-write-ports";

export type ItemWriteDependencies = Readonly<{
  repository: ItemWriteRepository;
  pendingImageUploads: PendingItemImageUploadRepository;
  imageStore: ItemImageObjectStore;
  now: () => number;
  onCleanupError?: (error: unknown) => void;
}>;

export type CreateItemCommand = Readonly<{
  userId: string;
  input: ItemWriteInput;
  imageUploadId: string | null;
}>;

export type UpdateItemCommand = Readonly<{
  userId: string;
  itemId: number;
  input: ItemWriteInput;
  imageUploadId: string | null;
  deleteImage: boolean;
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
  if (command.imageUploadId) {
    await verifyPendingItemImageUpload(
      {
        repository: dependencies.pendingImageUploads,
        objectStore: dependencies.imageStore,
        now: dependencies.now,
      },
      command.userId,
      command.imageUploadId,
    );
  }

  return dependencies.repository.create(
    command.userId,
    command.input,
    command.imageUploadId,
  );
}

export async function updateItemUseCase(
  dependencies: ItemWriteDependencies,
  command: UpdateItemCommand,
): Promise<ItemUpdateResult> {
  if (command.imageUploadId) {
    await verifyPendingItemImageUpload(
      {
        repository: dependencies.pendingImageUploads,
        objectStore: dependencies.imageStore,
        now: dependencies.now,
      },
      command.userId,
      command.imageUploadId,
    );
  }

  const imageChange: ItemImageChange = command.imageUploadId
    ? { type: "replace", uploadId: command.imageUploadId }
    : command.deleteImage
      ? { type: "remove" }
      : { type: "keep" };

  const result = await dependencies.repository.update(
    command.userId,
    command.itemId,
    command.input,
    imageChange,
  );

  if (
    result.type === "updated" &&
    imageChange.type !== "keep" &&
    result.previousImageKey
  ) {
    await removeImageBestEffort(dependencies, result.previousImageKey);
  }
  return result;
}
