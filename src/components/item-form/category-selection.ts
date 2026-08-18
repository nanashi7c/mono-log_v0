export function toggleCategorySelection(
  selectedCategoryIds: ReadonlySet<number>,
  categoryId: number,
): Set<number> {
  const nextSelectedCategoryIds = new Set(selectedCategoryIds);

  if (nextSelectedCategoryIds.has(categoryId)) {
    nextSelectedCategoryIds.delete(categoryId);
  } else {
    nextSelectedCategoryIds.add(categoryId);
  }

  return nextSelectedCategoryIds;
}
