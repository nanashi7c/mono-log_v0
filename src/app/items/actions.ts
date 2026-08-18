"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { parseItemForm } from "@/features/items/adapters/parse-item-form";
import { deleteItemUseCase } from "@/features/items/application/item-delete-use-case";
import type { ItemUpdateResult } from "@/features/items/application/item-write-ports";
import {
  createItemUseCase,
  updateItemUseCase,
} from "@/features/items/application/item-write-use-cases";
import { prismaItemDeleteRepository } from "@/features/items/infrastructure/prisma-item-delete-repository";
import { prismaItemWriteRepository } from "@/features/items/infrastructure/prisma-item-write-repository";
import { s3ItemImageStore } from "@/features/items/infrastructure/s3-item-image-store";
import { getCurrentUser } from "@/lib/auth/session";

const itemWriteDependencies = {
  repository: prismaItemWriteRepository,
  imageStore: s3ItemImageStore,
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
      image: parsed.image,
    });
  } catch (error) {
    redirect(`/items/new?error=${encodeURIComponent((error as Error).message)}`);
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
      image: parsed.image,
      deleteImage: parsed.deleteImage,
    });
  } catch (error) {
    redirect(
      `/items/${itemId}/edit?error=${encodeURIComponent((error as Error).message)}`,
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
