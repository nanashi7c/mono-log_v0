import type { Tx } from "@/db/client";
import { ItemWriteRejectedError } from "@/features/items/application/item-write-error";
import type { ItemWriteInput } from "@/features/items/application/item-write-input";
import {
  computeListingMetrics,
  computeOrdinaryProfit,
} from "@/lib/listing-calc";
import { fitsSignedDecimal10 } from "@/lib/validation/numeric";

async function resolveShippingId(
  tx: Tx,
  serviceId: number | null,
  sizeId: number | null,
): Promise<bigint | null> {
  if (serviceId == null || sizeId == null) return null;
  const row = await tx.shipping.upsert({
    where: {
      shippingServiceId_shippingSizeId: {
        shippingServiceId: serviceId,
        shippingSizeId: sizeId,
      },
    },
    update: {},
    create: { shippingServiceId: serviceId, shippingSizeId: sizeId },
    select: { id: true },
  });
  return row.id;
}

export async function resolveCategoryIds(
  tx: Tx,
  input: ItemWriteInput,
  userId: string,
): Promise<number[]> {
  const requestedIds = [...new Set(input.categoryIds)];
  const visibleCategories =
    requestedIds.length === 0
      ? []
      : await tx.category.findMany({
          where: { id: { in: requestedIds } },
          select: { id: true },
        });

  if (visibleCategories.length !== requestedIds.length) {
    throw new ItemWriteRejectedError("invalid_categories");
  }

  const ids = new Set(visibleCategories.map(({ id }) => id));
  for (const name of input.newCategoryNames) {
    let category = await tx.category.findFirst({
      where: { userId, name },
      select: { id: true },
    });
    if (!category) {
      category = await tx.category.create({
        data: { userId, name },
        select: { id: true },
      });
    }
    ids.add(category.id);
  }
  return [...ids];
}

export async function syncItemCategories(
  tx: Tx,
  itemId: number,
  categoryIds: readonly number[],
): Promise<void> {
  await tx.itemCategory.deleteMany({ where: { itemId: BigInt(itemId) } });
  if (categoryIds.length === 0) return;
  await tx.itemCategory.createMany({
    data: categoryIds.map((categoryId) => ({
      itemId: BigInt(itemId),
      categoryId,
    })),
  });
}

export async function syncItemPlan(
  tx: Tx,
  itemId: number,
  input: ItemWriteInput,
): Promise<void> {
  if (input.status !== "planned") {
    await tx.plan.deleteMany({ where: { itemId: BigInt(itemId) } });
    return;
  }

  const data = {
    plannedPurchaseYear: input.plan.plannedPurchaseYear,
    plannedPurchaseMonth: input.plan.plannedPurchaseMonth,
    listPrice: input.plan.listPrice,
    purchasePrice: input.plan.purchasePrice,
    productUrl: input.plan.productUrl,
    dealPeriod: input.plan.dealPeriod,
  };
  await tx.plan.upsert({
    where: { itemId: BigInt(itemId) },
    update: data,
    create: { itemId: BigInt(itemId), ...data },
  });
}

async function lookupShippingFee(
  tx: Tx,
  serviceId: number | null,
  sizeId: number | null,
): Promise<number | null> {
  if (serviceId == null || sizeId == null) return null;
  const row = await tx.shippingFee.findUnique({
    where: {
      shippingServiceId_shippingSizeId: {
        shippingServiceId: serviceId,
        shippingSizeId: sizeId,
      },
    },
    select: { fee: true },
  });
  return row ? row.fee.toNumber() : null;
}

async function lookupPlatformFeeRate(
  tx: Tx,
  platformId: number | null,
): Promise<number | null> {
  if (platformId == null) return null;
  const row = await tx.platform.findUnique({
    where: { id: platformId },
    select: { feeRate: true },
  });
  return row ? row.feeRate.toNumber() : null;
}

export async function syncItemListing(
  tx: Tx,
  itemId: number,
  input: ItemWriteInput,
): Promise<void> {
  if (input.status !== "listed") {
    await refreshListingProfitForActualPrice(
      tx,
      BigInt(itemId),
      input.actualPrice,
    );
    return;
  }

  const shippingId = await resolveShippingId(
    tx,
    input.listing.serviceId,
    input.listing.sizeId,
  );
  const shippingFee = await lookupShippingFee(
    tx,
    input.listing.serviceId,
    input.listing.sizeId,
  );
  const platformFeeRate = await lookupPlatformFeeRate(
    tx,
    input.listing.platformId,
  );

  const metrics = computeListingMetrics({
    actual_price: input.actualPrice,
    selling_price: input.listing.sellingPrice,
    packaging_cost: input.listing.packagingCost,
    work_time_hours: input.listing.workTimeHours,
    labor_rate: input.listing.laborRate,
    shipping_fee: shippingFee,
    platform_fee_rate: platformFeeRate,
  });
  const calculatedValues = [
    metrics.selling_fee,
    metrics.work_time_cost,
    metrics.operating_benefit,
    metrics.ordinary_profit,
  ];
  if (!calculatedValues.every(fitsSignedDecimal10)) {
    throw new ItemWriteRejectedError("calculated_values_out_of_range");
  }

  const data = {
    shippingId,
    platformId: input.listing.platformId,
    quantity: input.listing.quantity,
    sellingPrice: input.listing.sellingPrice,
    packagingCost: input.listing.packagingCost,
    workTimeHours: input.listing.workTimeHours,
    laborRate: input.listing.laborRate,
    sellingFee: metrics.selling_fee,
    workTimeCost: metrics.work_time_cost,
    operatingBenefit: metrics.operating_benefit,
    ordinaryProfit: metrics.ordinary_profit,
    isListing: metrics.is_listing,
  };
  await tx.listing.upsert({
    where: { itemId: BigInt(itemId) },
    update: data,
    create: { itemId: BigInt(itemId), ...data },
  });
}

export async function refreshListingProfitForActualPrice(
  tx: Tx,
  itemId: bigint,
  actualPrice: number | null,
): Promise<void> {
  const listing = await tx.listing.findUnique({
    where: { itemId },
    select: { operatingBenefit: true, workTimeCost: true },
  });
  if (!listing) return;

  const ordinaryProfit = computeOrdinaryProfit({
    net_proceeds: listing.operatingBenefit?.toNumber() ?? null,
    work_time_cost: listing.workTimeCost?.toNumber() ?? null,
    actual_price: actualPrice,
  });
  if (!fitsSignedDecimal10(ordinaryProfit)) {
    throw new ItemWriteRejectedError("calculated_values_out_of_range");
  }

  await tx.listing.update({
    where: { itemId },
    data: {
      ordinaryProfit,
      isListing: ordinaryProfit == null ? null : ordinaryProfit >= 0,
    },
  });
}
