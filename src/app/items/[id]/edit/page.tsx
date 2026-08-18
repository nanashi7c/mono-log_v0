import { notFound, redirect } from "next/navigation";
import ItemForm from "@/components/item-form";
import { loadItemEditFormUseCase } from "@/features/items/application/item-form-query-use-cases";
import { prismaItemFormQueryRepository } from "@/features/items/infrastructure/prisma-item-form-query-repository";
import { getCurrentUser } from "@/lib/auth/session";
import { signedImageUrl } from "@/lib/image";
import { deleteItem, updateItem } from "../../actions";
import { prepareItemImageUpload } from "../../image-upload-actions";

export const dynamic = "force-dynamic";

const itemFormQueryDependencies = {
  repository: prismaItemFormQueryRepository,
};

export default async function EditItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) notFound();

  const { error } = await searchParams;

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const result = await loadItemEditFormUseCase(itemFormQueryDependencies, {
    userId: user.sub,
    itemId,
  });

  if (!result) notFound();

  const imageUrl = await signedImageUrl(result.item.image_url);

  const updateAction = updateItem.bind(null, itemId);
  const deleteAction = deleteItem.bind(null, itemId);

  return (
    <ItemForm
      mode="edit"
      item={result.item}
      plan={result.plan}
      listing={result.listing}
      imageUrl={imageUrl}
      categories={result.categories}
      selectedCategoryIds={result.selectedCategoryIds}
      platforms={result.platforms}
      services={result.services}
      sizes={result.sizes}
      initialServiceId={result.initialServiceId}
      initialSizeId={result.initialSizeId}
      action={updateAction}
      prepareImageUpload={prepareItemImageUpload}
      onDelete={deleteAction}
      error={error}
    />
  );
}
