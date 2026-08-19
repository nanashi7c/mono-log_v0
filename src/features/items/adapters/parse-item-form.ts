import type { ItemWriteInput } from "@/features/items/application/item-write-input";
import { isEditableItemStatus } from "@/features/items/domain/status";
import { parseActualPrice } from "@/lib/validation/actual-price";
import { parseOptionalDateOnly } from "@/lib/validation/date-only";
import {
  DECIMAL_8_2_MAX,
  DECIMAL_10_0_MAX,
  INTEGER_MAX,
  parseOptionalDecimal,
  parseOptionalInteger,
  parseRequiredInteger,
} from "@/lib/validation/numeric";

export type ParsedItemForm = Readonly<{
  input: ItemWriteInput;
  imageUploadId: string | null;
  deleteImage: boolean;
}>;

type ParseItemFormResult =
  | { ok: true; value: ParsedItemForm }
  | { ok: false; error: string };

function stringOrNull(value: FormDataEntryValue | null): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

export function parseItemForm(formData: FormData): ParseItemFormResult {
  const actualPrice = parseActualPrice(formData.get("actual_price"));
  if (!actualPrice.ok) return actualPrice;

  const purchasedAt = parseOptionalDateOnly(formData.get("purchased_at"), {
    label: "購入日",
  });
  if (!purchasedAt.ok) {
    return {
      ok: false,
      error: "購入日はYYYY-MM-DD形式の正しい日付で入力してください。",
    };
  }

  const quantityResult = parseOptionalInteger(formData.get("quantity"), {
    label: "数量",
    min: 1,
    max: INTEGER_MAX,
  });
  if (!quantityResult.ok) return quantityResult;

  const plannedPurchaseYear = parseOptionalInteger(formData.get("planned_purchase_year"), {
    label: "購入予定年",
    min: 2000,
    max: 2100,
  });
  if (!plannedPurchaseYear.ok) return plannedPurchaseYear;

  const plannedPurchaseMonth = parseOptionalInteger(formData.get("planned_purchase_month"), {
    label: "購入予定月",
    min: 1,
    max: 12,
  });
  if (!plannedPurchaseMonth.ok) return plannedPurchaseMonth;

  const listPrice = parseOptionalInteger(formData.get("list_price"), {
    label: "定価",
    min: 0,
    max: DECIMAL_10_0_MAX,
  });
  if (!listPrice.ok) return listPrice;

  const purchasePrice = parseOptionalInteger(formData.get("purchase_price"), {
    label: "購入予定価格",
    min: 0,
    max: DECIMAL_10_0_MAX,
  });
  if (!purchasePrice.ok) return purchasePrice;

  const platformId = parseOptionalInteger(formData.get("platform_id"), {
    label: "プラットフォーム",
    min: 1,
    max: INTEGER_MAX,
  });
  if (!platformId.ok) return platformId;

  const serviceId = parseOptionalInteger(formData.get("service_id"), {
    label: "配送サービス",
    min: 1,
    max: INTEGER_MAX,
  });
  if (!serviceId.ok) return serviceId;

  const sizeId = parseOptionalInteger(formData.get("size_id"), {
    label: "配送サイズ",
    min: 1,
    max: INTEGER_MAX,
  });
  if (!sizeId.ok) return sizeId;

  const listingQuantity = parseOptionalInteger(formData.get("listing_quantity"), {
    label: "出品数",
    min: 1,
    max: INTEGER_MAX,
  });
  if (!listingQuantity.ok) return listingQuantity;

  const sellingPrice = parseOptionalInteger(formData.get("selling_price"), {
    label: "売価",
    min: 0,
    max: DECIMAL_10_0_MAX,
  });
  if (!sellingPrice.ok) return sellingPrice;

  const packagingCost = parseOptionalInteger(formData.get("packaging_cost"), {
    label: "梱包材費",
    min: 0,
    max: DECIMAL_10_0_MAX,
  });
  if (!packagingCost.ok) return packagingCost;

  const workTimeHours = parseOptionalDecimal(formData.get("work_time_hours"), {
    label: "作業時間",
    min: 0,
    max: DECIMAL_8_2_MAX,
    decimalPlaces: 2,
    step: 0.25,
  });
  if (!workTimeHours.ok) return workTimeHours;

  const laborRate = parseOptionalInteger(formData.get("labor_rate"), {
    label: "時給",
    min: 0,
    max: DECIMAL_10_0_MAX,
  });
  if (!laborRate.ok) return laborRate;

  const statusRaw = String(formData.get("status") ?? "");
  const status = isEditableItemStatus(statusRaw) ? statusRaw : "owned";

  const categoryIds: number[] = [];
  for (const value of formData.getAll("category_ids")) {
    const categoryId = parseRequiredInteger(value, {
      label: "カテゴリ",
      min: 1,
      max: INTEGER_MAX,
    });
    if (!categoryId.ok) return categoryId;
    categoryIds.push(categoryId.value);
  }

  const newCategoryNames = String(formData.get("new_category_names") ?? "")
    .split(/[,、]/)
    .map((name) => name.trim())
    .filter(Boolean);

  const quantity = quantityResult.value ?? 1;

  const imageUploadId = stringOrNull(formData.get("image_upload_id"));
  if (
    imageUploadId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      imageUploadId,
    )
  ) {
    return { ok: false, error: "画像アップロードIDが不正です。" };
  }

  return {
    ok: true,
    value: {
      input: {
        name: String(formData.get("name") ?? "").trim(),
        status,
        categoryIds,
        newCategoryNames,
        janCode: stringOrNull(formData.get("jan_code")),
        quantity,
        notes: stringOrNull(formData.get("notes")),
        actualPrice: actualPrice.value,
        purchasedAt: purchasedAt.value,
        plan: {
          plannedPurchaseYear: plannedPurchaseYear.value,
          plannedPurchaseMonth: plannedPurchaseMonth.value,
          listPrice: listPrice.value,
          purchasePrice: purchasePrice.value,
          productUrl: stringOrNull(formData.get("product_url")),
          dealPeriod: stringOrNull(formData.get("deal_period")),
        },
        listing: {
          platformId: platformId.value,
          serviceId: serviceId.value,
          sizeId: sizeId.value,
          quantity: listingQuantity.value,
          sellingPrice: sellingPrice.value,
          packagingCost: packagingCost.value,
          workTimeHours: workTimeHours.value,
          laborRate: laborRate.value,
        },
      },
      imageUploadId,
      deleteImage: String(formData.get("delete_image") ?? "") === "1",
    },
  };
}
