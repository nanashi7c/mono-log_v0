import { Prisma } from "@prisma/client";
import { withUser, type Tx } from "@/db/client";
import { toItem, toListing, toPlan } from "@/db/serialize";
import type {
  OwnedItemListData,
  OwnedItemsFilter,
  PlannedItemListRow,
  SellingItemListRow,
} from "@/features/items/application/item-list-data";
import type { ItemListQueryRepository } from "@/features/items/application/item-list-query-ports";

export type ItemListQueryTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

function ownedItemsWhere(filter: OwnedItemsFilter): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = {
    status: { in: ["owned", "listed"] },
    deletedAt: null,
  };
  if (filter.query) {
    where.OR = [
      { name: { contains: filter.query, mode: "insensitive" } },
      { notes: { contains: filter.query, mode: "insensitive" } },
    ];
  }
  switch (filter.category.type) {
    case "all":
      return where;
    case "uncategorized":
      where.itemCategories = { none: {} };
      return where;
    case "category":
      where.itemCategories = {
        some: { categoryId: filter.category.categoryId },
      };
      return where;
  }
}

function frozenCategories(
  links: readonly Readonly<{
    category: Readonly<{ id: number; name: string; color: string }>;
  }>[],
) {
  return Object.freeze(
    links.map(({ category }) => Object.freeze({ ...category })),
  );
}

function shippingPairKey(serviceId: number, sizeId: number): string {
  return `${serviceId}:${sizeId}`;
}

export function createPrismaItemListQueryRepository(
  runWithUser: ItemListQueryTransactionRunner,
): ItemListQueryRepository {
  return {
    async findOwned(userId, filter): Promise<OwnedItemListData> {
      return runWithUser(userId, async (tx) => {
        const categoryRows = await tx.category.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, color: true },
        });
        const rows = await tx.item.findMany({
          where: ownedItemsWhere(filter),
          orderBy: { createdAt: "desc" },
          include: {
            itemCategories: {
              select: {
                category: { select: { id: true, name: true, color: true } },
              },
            },
          },
        });

        return Object.freeze({
          items: Object.freeze(
            rows.map((row) =>
              Object.freeze({
                ...toItem(row),
                categories: frozenCategories(row.itemCategories),
              }),
            ),
          ),
          categoryOptions: Object.freeze(
            categoryRows.map((row) => Object.freeze(row)),
          ),
        });
      });
    },

    async findPlanned(userId): Promise<readonly PlannedItemListRow[]> {
      return runWithUser(userId, async (tx) => {
        const rows = await tx.item.findMany({
          where: { status: "planned", deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: {
            plan: true,
            itemCategories: {
              select: {
                category: { select: { id: true, name: true, color: true } },
              },
            },
          },
        });

        return Object.freeze(
          rows.map((row) =>
            Object.freeze({
              ...toItem(row),
              categories: frozenCategories(row.itemCategories),
              plan: row.plan ? Object.freeze(toPlan(row.plan)) : null,
            }),
          ),
        );
      });
    },

    async findSelling(userId): Promise<readonly SellingItemListRow[]> {
      return runWithUser(userId, async (tx) => {
        const rows = await tx.item.findMany({
          where: { status: "listed", deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: {
            listing: {
              include: {
                shipping: {
                  select: {
                    shippingServiceId: true,
                    shippingSizeId: true,
                  },
                },
              },
            },
          },
        });
        const shippingPairs = new Map<
          string,
          Readonly<{ serviceId: number; sizeId: number }>
        >();
        for (const row of rows) {
          const shipping = row.listing?.shipping;
          if (!shipping) continue;
          shippingPairs.set(
            shippingPairKey(
              shipping.shippingServiceId,
              shipping.shippingSizeId,
            ),
            {
              serviceId: shipping.shippingServiceId,
              sizeId: shipping.shippingSizeId,
            },
          );
        }
        const pairs = [...shippingPairs.values()];
        const feeRows =
          pairs.length === 0
            ? []
            : await tx.shippingFee.findMany({
                where: {
                  OR: pairs.map(({ serviceId, sizeId }) => ({
                    shippingServiceId: serviceId,
                    shippingSizeId: sizeId,
                  })),
                },
                select: {
                  shippingServiceId: true,
                  shippingSizeId: true,
                  fee: true,
                },
              });
        const feeByPair = new Map(
          feeRows.map((row) => [
            shippingPairKey(row.shippingServiceId, row.shippingSizeId),
            row.fee.toNumber(),
          ]),
        );

        return Object.freeze(
          rows.map((row) => {
            const shipping = row.listing?.shipping;
            const shippingFee = shipping
              ? (feeByPair.get(
                  shippingPairKey(
                    shipping.shippingServiceId,
                    shipping.shippingSizeId,
                  ),
                ) ?? null)
              : null;
            return Object.freeze({
              ...toItem(row),
              listing: row.listing
                ? Object.freeze(toListing(row.listing))
                : null,
              shippingFee,
            });
          }),
        );
      });
    },
  };
}

export const prismaItemListQueryRepository =
  createPrismaItemListQueryRepository(withUser);
