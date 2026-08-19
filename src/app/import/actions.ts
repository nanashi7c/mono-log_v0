"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseItemBackupCsv } from "@/features/items/adapters/item-backup-csv";
import { importItemsUseCase } from "@/features/items/application/item-import-use-cases";
import { prismaItemImportRepository } from "@/features/items/infrastructure/prisma-item-import-repository";
import { getCurrentUser } from "@/lib/auth/session";

const itemImportDependencies = {
  repository: prismaItemImportRepository,
};

function importErrorPath(message: string): string {
  return `/import?error=${encodeURIComponent(message)}`;
}

export async function importBackup(formData: FormData): Promise<never> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/import?error=no-file");
  }

  const parsed = parseItemBackupCsv(await file.text());
  if (!parsed.ok) redirect(importErrorPath(parsed.error));

  let insertedItems: number;
  try {
    const result = await importItemsUseCase(itemImportDependencies, {
      userId: user.sub,
      input: parsed.value,
    });
    insertedItems = result.insertedItems;
  } catch (error) {
    console.error("CSVインポートの保存に失敗しました。", error);
    redirect("/import?error=import-failed");
  }

  revalidatePath("/");
  revalidatePath("/items");
  redirect(
    `/import?ok=${encodeURIComponent(`${insertedItems} 件のアイテムを取り込みました。`)}`,
  );
}
