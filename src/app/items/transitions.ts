"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { transitionItemUseCase } from "@/features/items/application/item-transition-use-cases";
import type { ItemTransitionAction } from "@/features/items/domain/item-transition";
import { prismaItemTransitionRepository } from "@/features/items/infrastructure/prisma-item-transition-repository";
import { getCurrentUser } from "@/lib/auth/session";

const itemTransitionDependencies = {
  repository: prismaItemTransitionRepository,
};

async function authed() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

function revalidateItemViews() {
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath("/items/planned");
  revalidatePath("/items/selling");
  revalidatePath("/dashboard");
}

async function transitionItem(
  itemId: number,
  action: ItemTransitionAction,
): Promise<void> {
  const user = await authed();
  await transitionItemUseCase(itemTransitionDependencies, {
    userId: user.sub,
    itemId,
    action,
  });
  revalidateItemViews();
}

export async function markAsPurchased(itemId: number): Promise<void> {
  await transitionItem(itemId, "mark_purchased");
}

export async function listItem(itemId: number): Promise<void> {
  await transitionItem(itemId, "start_listing");
}

export async function restoreToPlanned(itemId: number): Promise<void> {
  await transitionItem(itemId, "restore_planned");
}

export async function markAsSold(itemId: number): Promise<void> {
  await transitionItem(itemId, "mark_sold");
}

export async function unlistItem(itemId: number): Promise<void> {
  await transitionItem(itemId, "cancel_listing");
}
