export function buildOwnedItemsFilterHref(
  pathname: string,
  currentQuery: string,
  next: Readonly<Record<string, string | null>>,
): string {
  const params = new URLSearchParams(currentQuery);
  for (const [key, value] of Object.entries(next)) {
    if (value == null || value === "") params.delete(key);
    else params.set(key, value);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
