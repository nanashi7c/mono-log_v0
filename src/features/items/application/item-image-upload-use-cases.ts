import type {
  ItemImageObjectStore,
  ItemImageUploadSigner,
  PendingItemImageUpload,
  PendingItemImageUploadRepository,
} from "@/features/items/application/item-image-upload-ports";
import { ItemWriteRejectedError } from "@/features/items/application/item-write-error";

export const ITEM_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_UPLOAD_TTL_SECONDS = 5 * 60;
const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const EXPIRED_UPLOAD_CLEANUP_LIMIT = 20;

const EXTENSION_BY_CONTENT_TYPE = Object.freeze({
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const);

export type ItemImageContentType = keyof typeof EXTENSION_BY_CONTENT_TYPE;

export type PrepareItemImageUploadCommand = Readonly<{
  userId: string;
  contentType: string;
  size: number;
}>;

export type PrepareItemImageUploadResult =
  | Readonly<{ ok: false; error: string }>
  | Readonly<{
      ok: true;
      value: Readonly<{
        uploadId: string;
        url: string;
        fields: Readonly<Record<string, string>>;
      }>;
    }>;

export type ItemImageUploadDependencies = Readonly<{
  repository: PendingItemImageUploadRepository;
  signer: ItemImageUploadSigner;
  objectStore: ItemImageObjectStore;
  createId: () => string;
  now: () => number;
  onCleanupError?: (error: unknown) => void;
}>;

function reportCleanupError(
  dependencies: ItemImageUploadDependencies,
  error: unknown,
): void {
  try {
    dependencies.onCleanupError?.(error);
  } catch {
    // Cleanup reporting must not prevent a new upload from being prepared.
  }
}

async function cleanupExpiredUploads(
  dependencies: ItemImageUploadDependencies,
  userId: string,
  nowEpochMs: number,
): Promise<void> {
  let uploads: readonly PendingItemImageUpload[];
  try {
    uploads = await dependencies.repository.findExpired(
      userId,
      nowEpochMs,
      EXPIRED_UPLOAD_CLEANUP_LIMIT,
    );
  } catch (error) {
    reportCleanupError(dependencies, error);
    return;
  }

  for (const upload of uploads) {
    try {
      await dependencies.objectStore.remove(upload.objectKey);
      await dependencies.repository.remove(userId, upload.id);
    } catch (error) {
      reportCleanupError(dependencies, error);
    }
  }
}

export async function prepareItemImageUploadUseCase(
  dependencies: ItemImageUploadDependencies,
  command: PrepareItemImageUploadCommand,
): Promise<PrepareItemImageUploadResult> {
  const extension = EXTENSION_BY_CONTENT_TYPE[
    command.contentType as ItemImageContentType
  ];
  if (!extension) {
    return { ok: false, error: "JPEG、PNG、GIF、WebP形式の画像を選択してください。" };
  }
  if (
    !Number.isSafeInteger(command.size) ||
    command.size < 1 ||
    command.size > ITEM_IMAGE_MAX_BYTES
  ) {
    return { ok: false, error: "画像は10MB以下にしてください。" };
  }

  const nowEpochMs = dependencies.now();
  await cleanupExpiredUploads(dependencies, command.userId, nowEpochMs);

  const uploadId = dependencies.createId();
  const objectKey = `${command.userId}/items/${uploadId}.${extension}`;
  const expiresAtEpochMs = nowEpochMs + PENDING_UPLOAD_TTL_MS;
  const signedUpload = await dependencies.signer.sign({
    key: objectKey,
    contentType: command.contentType,
    maxBytes: ITEM_IMAGE_MAX_BYTES,
    expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
  });

  await dependencies.repository.reserve(command.userId, {
    id: uploadId,
    objectKey,
    contentType: command.contentType,
    expiresAtEpochMs,
  });

  return {
    ok: true,
    value: {
      uploadId,
      url: signedUpload.url,
      fields: Object.freeze({ ...signedUpload.fields }),
    },
  };
}

export async function verifyPendingItemImageUpload(
  dependencies: Pick<ItemImageUploadDependencies, "repository" | "objectStore" | "now">,
  userId: string,
  uploadId: string,
): Promise<void> {
  const upload = await dependencies.repository.findById(userId, uploadId);
  if (!upload || upload.expiresAtEpochMs <= dependencies.now()) {
    throw new ItemWriteRejectedError("image_upload_expired");
  }
  const storedImage = await dependencies.objectStore.inspect(upload.objectKey);
  if (!storedImage) {
    throw new ItemWriteRejectedError("image_upload_incomplete");
  }
  if (
    storedImage.contentType !== upload.contentType ||
    storedImage.size == null ||
    storedImage.size < 1 ||
    storedImage.size > ITEM_IMAGE_MAX_BYTES
  ) {
    throw new ItemWriteRejectedError("invalid_image_upload");
  }
}
