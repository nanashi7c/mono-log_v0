import { withUser, type Tx } from "@/db/client";
import type {
  PendingItemImageUpload,
  PendingItemImageUploadRepository,
} from "@/features/items/application/item-image-upload-ports";

export type PendingImageUploadTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

function toPendingItemImageUpload(row: {
  id: string;
  objectKey: string;
  contentType: string;
  expiresAt: Date;
}): PendingItemImageUpload {
  return Object.freeze({
    id: row.id,
    objectKey: row.objectKey,
    contentType: row.contentType,
    expiresAtEpochMs: row.expiresAt.getTime(),
  });
}

export function createPrismaPendingItemImageUploadRepository(
  runWithUser: PendingImageUploadTransactionRunner,
): PendingItemImageUploadRepository {
  return {
    async reserve(userId, upload) {
      await runWithUser(userId, async (tx) => {
        await tx.pendingItemImageUpload.create({
          data: {
            id: upload.id,
            userId,
            objectKey: upload.objectKey,
            contentType: upload.contentType,
            expiresAt: new Date(upload.expiresAtEpochMs),
          },
        });
      });
    },

    async findById(userId, uploadId) {
      return runWithUser(userId, async (tx) => {
        const row = await tx.pendingItemImageUpload.findFirst({
          where: { id: uploadId, userId },
        });
        return row ? toPendingItemImageUpload(row) : null;
      });
    },

    async findExpired(userId, expiredBeforeEpochMs, limit) {
      return runWithUser(userId, async (tx) => {
        const rows = await tx.pendingItemImageUpload.findMany({
          where: {
            userId,
            expiresAt: { lte: new Date(expiredBeforeEpochMs) },
          },
          orderBy: { expiresAt: "asc" },
          take: limit,
        });
        return Object.freeze(rows.map(toPendingItemImageUpload));
      });
    },

    async remove(userId, uploadId) {
      await runWithUser(userId, async (tx) => {
        await tx.pendingItemImageUpload.deleteMany({
          where: { id: uploadId, userId },
        });
      });
    },
  };
}

export const prismaPendingItemImageUploadRepository =
  createPrismaPendingItemImageUploadRepository(withUser);
