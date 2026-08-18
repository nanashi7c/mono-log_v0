"use server";

import { randomUUID } from "node:crypto";
import {
  prepareItemImageUploadUseCase,
  type PrepareItemImageUploadResult,
} from "@/features/items/application/item-image-upload-use-cases";
import { prismaPendingItemImageUploadRepository } from "@/features/items/infrastructure/prisma-pending-item-image-upload-repository";
import {
  s3ItemImageStore,
  s3ItemImageUploadSigner,
} from "@/features/items/infrastructure/s3-item-image-store";
import { getCurrentUser } from "@/lib/auth/session";

const dependencies = {
  repository: prismaPendingItemImageUploadRepository,
  signer: s3ItemImageUploadSigner,
  objectStore: s3ItemImageStore,
  createId: randomUUID,
  now: Date.now,
  onCleanupError(error: unknown) {
    console.error("期限切れ画像アップロードの後処理に失敗しました。", error);
  },
} as const;

export async function prepareItemImageUpload(input: Readonly<{
  contentType: string;
  size: number;
}>): Promise<PrepareItemImageUploadResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "ログインし直してください。" };

  try {
    return await prepareItemImageUploadUseCase(dependencies, {
      userId: user.sub,
      contentType: input.contentType,
      size: input.size,
    });
  } catch (error) {
    console.error("画像アップロードの準備に失敗しました。", error);
    return { ok: false, error: "画像アップロードを準備できませんでした。" };
  }
}
