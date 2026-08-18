import { redirect } from "next/navigation";
import ItemForm from "@/components/item-form";
import { loadItemFormOptionsUseCase } from "@/features/items/application/item-form-query-use-cases";
import { prismaItemFormQueryRepository } from "@/features/items/infrastructure/prisma-item-form-query-repository";
import { getCurrentUser } from "@/lib/auth/session";
import { createItem } from "../actions";
import { prepareItemImageUpload } from "../image-upload-actions";

export const dynamic = "force-dynamic";

const itemFormQueryDependencies = {
  repository: prismaItemFormQueryRepository,
};

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const options = await loadItemFormOptionsUseCase(itemFormQueryDependencies, {
    userId: user.sub,
  });

  return (
    <ItemForm
      mode="create"
      categories={options.categories}
      platforms={options.platforms}
      services={options.services}
      sizes={options.sizes}
      action={createItem}
      prepareImageUpload={prepareItemImageUpload}
      error={error}
    />
  );
}
