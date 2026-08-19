import { withUser, type Tx } from "@/db/client";
import type {
  ItemImageChange,
  ItemWriteRepository,
} from "@/features/items/application/item-write-ports";
import { ItemWriteRejectedError } from "@/features/items/application/item-write-error";
import {
  resolveCategoryIds,
  syncItemCategories,
  syncItemListing,
  syncItemPlan,
} from "@/features/items/infrastructure/item-persistence";

export type UserTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

async function consumePendingImageUpload(
  tx: Tx,
  userId: string,
  uploadId: string,
): Promise<string> {
  const upload = await tx.pendingItemImageUpload.findFirst({
    where: {
      id: uploadId,
      userId,
      expiresAt: { gt: new Date() },
    },
    select: { objectKey: true },
  });
  if (!upload) {
    throw new ItemWriteRejectedError("image_upload_expired");
  }

  const consumed = await tx.pendingItemImageUpload.deleteMany({
    where: { id: uploadId, userId },
  });
  if (consumed.count !== 1) {
    throw new ItemWriteRejectedError("image_upload_consumed");
  }
  return upload.objectKey;
}

async function imageUpdateData(
  tx: Tx,
  userId: string,
  imageChange: ItemImageChange,
) {
  switch (imageChange.type) {
    case "keep":
      return {};
    case "remove":
      return { imageUrl: null };
    case "replace":
      return {
        imageUrl: await consumePendingImageUpload(
          tx,
          userId,
          imageChange.uploadId,
        ),
      };
  }
}

export function createPrismaItemWriteRepository(
  runWithUser: UserTransactionRunner,
): ItemWriteRepository {
  return {
    async create(userId, input, imageUploadId) {
      return runWithUser(userId, async (tx) => {
        const categoryIds = await resolveCategoryIds(tx, input, userId);
        const imageKey = imageUploadId
          ? await consumePendingImageUpload(tx, userId, imageUploadId)
          : null;
        const row = await tx.item.create({
          data: {
            userId,
            status: input.status,
            name: input.name,
            imageUrl: imageKey,
            janCode: input.janCode,
            quantity: input.quantity,
            notes: input.notes,
            actualPrice: input.actualPrice,
            purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
          },
        });
        const itemId = Number(row.id);

        await syncItemCategories(tx, itemId, categoryIds);
        await syncItemPlan(tx, itemId, input);
        await syncItemListing(tx, itemId, input);

        return itemId;
      });
    },

    async update(userId, itemId, input, imageChange) {
      return runWithUser(userId, async (tx) => {
        const existing = await tx.item.findFirst({
          where: { id: BigInt(itemId) },
          select: { imageUrl: true },
        });
        if (!existing) return { type: "not_found" };

        const categoryIds = await resolveCategoryIds(tx, input, userId);
        const imageData = await imageUpdateData(tx, userId, imageChange);

        await syncItemListing(tx, itemId, input);
        await tx.item.updateMany({
          where: { id: BigInt(itemId) },
          data: {
            status: input.status,
            name: input.name,
            janCode: input.janCode,
            quantity: input.quantity,
            notes: input.notes,
            actualPrice: input.actualPrice,
            purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
            ...imageData,
          },
        });
        await syncItemCategories(tx, itemId, categoryIds);
        await syncItemPlan(tx, itemId, input);

        return {
          type: "updated",
          previousImageKey: existing.imageUrl,
        };
      });
    },

  };
}

export const prismaItemWriteRepository =
  createPrismaItemWriteRepository(withUser);
