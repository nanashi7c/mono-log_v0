// REST API(items) のカテゴリ参照をrouteハンドラ間で共有する。
import type { Tx } from "@/db/client";

// items に紐づくカテゴリ ID を item_id ごとにまとめて返す（item_id は number）。
export async function categoryIdsByItem(
  tx: Tx,
  ids: readonly number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (ids.length === 0) return map;
  const links = await tx.itemCategory.findMany({
    where: { itemId: { in: ids.map((n) => BigInt(n)) } },
    select: { itemId: true, categoryId: true },
  });
  for (const l of links) {
    const k = Number(l.itemId);
    const arr = map.get(k) ?? [];
    arr.push(l.categoryId);
    map.set(k, arr);
  }
  return map;
}
