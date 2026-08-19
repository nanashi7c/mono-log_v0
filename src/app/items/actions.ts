"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { parseItemForm } from "@/features/items/adapters/parse-item-form";
import { deleteItemUseCase } from "@/features/items/application/item-delete-use-case";
import { ItemWriteRejectedError } from "@/features/items/application/item-write-error";
import type { ItemUpdateResult } from "@/features/items/application/item-write-ports";
import {
  createItemUseCase,
  updateItemUseCase,
} from "@/features/items/application/item-write-use-cases";
import { prismaItemDeleteRepository } from "@/features/items/infrastructure/prisma-item-delete-repository";
import { prismaItemWriteRepository } from "@/features/items/infrastructure/prisma-item-write-repository";
import { prismaPendingItemImageUploadRepository } from "@/features/items/infrastructure/prisma-pending-item-image-upload-repository";
import { s3ItemImageStore } from "@/features/items/infrastructure/s3-item-image-store";
import { getCurrentUser } from "@/lib/auth/session";

const itemWriteDependencies = {
  repository: prismaItemWriteRepository,
  pendingImageUploads: prismaPendingItemImageUploadRepository,
  imageStore: s3ItemImageStore,
  now: Date.now,
  onCleanupError(error: unknown) {
    console.error("アイテム画像の後処理に失敗しました。", error);
  },
} as const;

const itemDeleteDependencies = {
  repository: prismaItemDeleteRepository,
  imageRemover: s3ItemImageStore,
  onCleanupError(error: unknown) {
    console.error("アイテム削除後の画像削除に失敗しました。", error);
  },
} as const;

function itemWriteErrorQueryValue(
  error: unknown,
  operation: "作成" | "更新",
): string {
  if (error instanceof ItemWriteRejectedError) return error.message;

  console.error(`アイテムの${operation}に失敗しました。`, error);
  return "save-failed";
}

async function authed() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

function revalidateAll(itemId?: number) {
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/items/planned");
  revalidatePath("/items/selling");
  revalidatePath("/dashboard");
  if (itemId != null) {
    revalidatePath(`/items/${itemId}`);
    revalidatePath(`/items/${itemId}/edit`);
  }
}

export async function createItem(formData: FormData) {
  const parsedResult = parseItemForm(formData);
  if (!parsedResult.ok) {
    redirect(`/items/new?error=${encodeURIComponent(parsedResult.error)}`);
  }
  const parsed = parsedResult.value;
  const input = parsed.input;
  if (!input.name) redirect("/items/new?error=name-required");

  const user = await authed();

  let newId: number;
  try {
    newId = await createItemUseCase(itemWriteDependencies, {
      userId: user.sub,
      input,
      imageUploadId: parsed.imageUploadId,
    });
  } catch (error) {
    redirect(
      `/items/new?error=${encodeURIComponent(itemWriteErrorQueryValue(error, "作成"))}`,
    );
  }

  revalidateAll(newId);
  redirect(`/items/${newId}`);
}

export async function updateItem(itemId: number, formData: FormData) {
  const parsedResult = parseItemForm(formData);
  if (!parsedResult.ok) {
    redirect(`/items/${itemId}/edit?error=${encodeURIComponent(parsedResult.error)}`);
  }
  const parsed = parsedResult.value;
  const input = parsed.input;
  if (!input.name) redirect(`/items/${itemId}/edit?error=name-required`);

  const user = await authed();

  let result: ItemUpdateResult;
  try {
    result = await updateItemUseCase(itemWriteDependencies, {
      userId: user.sub,
      itemId,
      input,
      imageUploadId: parsed.imageUploadId,
      deleteImage: parsed.deleteImage,
    });
  } catch (error) {
    redirect(
      `/items/${itemId}/edit?error=${encodeURIComponent(itemWriteErrorQueryValue(error, "更新"))}`,
    );
  }

  if (result.type === "not_found") notFound();

  revalidateAll(itemId);
  redirect(`/items/${itemId}`);
}

export async function deleteItem(itemId: number) {
  const user = await authed();

  const result = await deleteItemUseCase(itemDeleteDependencies, {
    userId: user.sub,
    itemId,
  });
  if (result.type === "not_found") notFound();

  revalidateAll();
  redirect("/items");
}
