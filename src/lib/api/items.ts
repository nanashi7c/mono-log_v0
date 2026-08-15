// REST API(items) で使う検証・整形ロジック。route ハンドラ間で共有する。
import type { Tx } from "@/db/client";
import {
  isItemStatus,
  type ItemStatus,
} from "@/features/items/domain/status";
import { parseActualPrice } from "@/lib/validation/actual-price";
import {
  INTEGER_MAX,
  parseOptionalInteger,
  parseRequiredInteger,
} from "@/lib/validation/numeric";

// INSERT/UPDATE 用に整えた item の値（camelCase）。
export type ItemInput = {
  status: ItemStatus;
  name: string;
  janCode: string | null;
  quantity: number;
  notes: string | null;
  actualPrice: number | null;
  purchasedAt: string | null;
  categoryIds: number[];
};

// items に紐づくカテゴリ ID を item_id ごとにまとめて返す（item_id は number）。
export async function categoryIdsByItem(tx: Tx, ids: number[]): Promise<Map<number, number[]>> {
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

// 入力 JSON を検証して ItemInput に整える。画像・plan・listing は v1 では扱わない。
export function parseItemBody(
  body: unknown,
): { ok: true; value: ItemInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };

  let status: ItemStatus = "owned";
  if (b.status !== undefined) {
    if (!isItemStatus(b.status)) {
      return { ok: false, error: `invalid status: ${String(b.status)}` };
    }
    status = b.status;
  }

  const quantityResult = parseOptionalInteger(b.quantity, {
    label: "quantity",
    min: 1,
    max: INTEGER_MAX,
  });
  if (!quantityResult.ok) return quantityResult;
  const quantity = quantityResult.value ?? 1;

  const strOrNull = (v: unknown): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
  const actualPrice = parseActualPrice(b.actual_price);
  if (!actualPrice.ok) return { ok: false, error: actualPrice.error };

  let categoryIds: number[] = [];
  if (b.category_ids !== undefined) {
    if (!Array.isArray(b.category_ids)) return { ok: false, error: "category_ids must be an array" };
    for (const value of b.category_ids) {
      const categoryId = parseRequiredInteger(value, {
        label: "category_ids",
        min: 1,
        max: INTEGER_MAX,
      });
      if (!categoryId.ok) return categoryId;
      categoryIds.push(categoryId.value);
    }
  }

  return {
    ok: true,
    value: {
      status,
      name,
      janCode: strOrNull(b.jan_code),
      quantity,
      notes: strOrNull(b.notes),
      actualPrice: actualPrice.value,
      purchasedAt: strOrNull(b.purchased_at),
      categoryIds,
    },
  };
}
