import {
  isItemStatus,
  type ItemStatus,
} from "@/features/items/domain/status";
import type { ItemApiCommandInput } from "@/features/items/application/item-api-command-input";
import { parseActualPrice } from "@/lib/validation/actual-price";
import { parseOptionalDateOnly } from "@/lib/validation/date-only";
import {
  INTEGER_MAX,
  parseOptionalInteger,
  parseRequiredInteger,
} from "@/lib/validation/numeric";

type ParseItemApiBodyResult =
  | { ok: true; value: ItemApiCommandInput }
  | { ok: false; error: string };

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

// 画像・plan・listing は v1 API では扱わない。
export function parseItemApiBody(body: unknown): ParseItemApiBodyResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const input = body as Record<string, unknown>;

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };

  let status: ItemStatus = "owned";
  if (input.status !== undefined) {
    if (!isItemStatus(input.status)) {
      return { ok: false, error: `invalid status: ${String(input.status)}` };
    }
    status = input.status;
  }

  const quantityResult = parseOptionalInteger(input.quantity, {
    label: "quantity",
    min: 1,
    max: INTEGER_MAX,
  });
  if (!quantityResult.ok) return quantityResult;
  const quantity = quantityResult.value ?? 1;

  const actualPrice = parseActualPrice(input.actual_price);
  if (!actualPrice.ok) return { ok: false, error: actualPrice.error };

  const purchasedAt = parseOptionalDateOnly(input.purchased_at, {
    label: "purchased_at",
  });
  if (!purchasedAt.ok) return purchasedAt;

  const categoryIds: number[] = [];
  if (input.category_ids !== undefined) {
    if (!Array.isArray(input.category_ids)) {
      return { ok: false, error: "category_ids must be an array" };
    }
    for (const value of input.category_ids) {
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
      janCode: stringOrNull(input.jan_code),
      quantity,
      notes: stringOrNull(input.notes),
      actualPrice: actualPrice.value,
      purchasedAt: purchasedAt.value,
      categoryIds,
    },
  };
}
