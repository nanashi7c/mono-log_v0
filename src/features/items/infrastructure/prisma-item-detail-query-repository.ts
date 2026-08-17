import { withUser, type Tx } from "@/db/client";
import { toItem, toListing, toPlan } from "@/db/serialize";
import type { ItemDetailData } from "@/features/items/application/item-detail-data";
import type { ItemDetailQueryRepository } from "@/features/items/application/item-detail-query-ports";

export type ItemDetailQueryTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

export function createPrismaItemDetailQueryRepository(
  runWithUser: ItemDetailQueryTransactionRunner,
): ItemDetailQueryRepository {
  return {
    async findDetail(userId, itemId): Promise<ItemDetailData | null> {
      return runWithUser(userId, async (tx) => {
        const row = await tx.item.findFirst({
          where: { id: BigInt(itemId) },
          include: {
            plan: true,
            listing: {
              include: {
                platform: { select: { id: true, name: true } },
                shipping: {
                  select: {
                    shippingServiceId: true,
                    shippingSizeId: true,
                    service: {
                      select: { id: true, shippingService: true },
                    },
                    size: { select: { id: true, shippingSize: true } },
                  },
                },
              },
            },
            itemCategories: {
              select: {
                category: { select: { id: true, name: true, color: true } },
              },
            },
          },
        });
        if (!row) return null;

        const shipping = row.listing?.shipping;
        const shippingFee = shipping
          ? await tx.shippingFee.findUnique({
              where: {
                shippingServiceId_shippingSizeId: {
                  shippingServiceId: shipping.shippingServiceId,
                  shippingSizeId: shipping.shippingSizeId,
                },
              },
              select: { fee: true },
            })
          : null;

        return Object.freeze({
          item: Object.freeze(toItem(row)),
          plan: row.plan ? Object.freeze(toPlan(row.plan)) : null,
          listing: row.listing ? Object.freeze(toListing(row.listing)) : null,
          categories: Object.freeze(
            row.itemCategories.map(({ category }) =>
              Object.freeze({ ...category }),
            ),
          ),
          platform: row.listing?.platform
            ? Object.freeze({ ...row.listing.platform })
            : null,
          service: shipping
            ? Object.freeze({
                id: shipping.service.id,
                shipping_service: shipping.service.shippingService,
              })
            : null,
          size: shipping
            ? Object.freeze({
                id: shipping.size.id,
                shipping_size: shipping.size.shippingSize,
              })
            : null,
          shippingFee: shippingFee?.fee.toNumber() ?? null,
        });
      });
    },
  };
}

export const prismaItemDetailQueryRepository =
  createPrismaItemDetailQueryRepository(withUser);
