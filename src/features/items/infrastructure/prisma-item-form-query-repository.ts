import { withUser, type Tx } from "@/db/client";
import { toItem, toListing, toPlan } from "@/db/serialize";
import type {
  ItemEditFormData,
  ItemFormOptions,
} from "@/features/items/application/item-form-data";
import type { ItemFormQueryRepository } from "@/features/items/application/item-form-query-ports";

export type ItemFormQueryTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

async function loadFormOptions(tx: Tx): Promise<ItemFormOptions> {
  const categoryRows = await tx.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true },
  });
  const platformRows = await tx.platform.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const serviceRows = await tx.service.findMany({
    orderBy: { shippingService: "asc" },
    select: { id: true, shippingService: true },
  });
  const sizeRows = await tx.size.findMany({
    orderBy: { shippingSize: "asc" },
    select: { id: true, shippingSize: true },
  });

  return Object.freeze({
    categories: Object.freeze(categoryRows.map((row) => Object.freeze(row))),
    platforms: Object.freeze(platformRows.map((row) => Object.freeze(row))),
    services: Object.freeze(
      serviceRows.map((row) =>
        Object.freeze({
          id: row.id,
          shipping_service: row.shippingService,
        }),
      ),
    ),
    sizes: Object.freeze(
      sizeRows.map((row) =>
        Object.freeze({ id: row.id, shipping_size: row.shippingSize }),
      ),
    ),
  });
}

export function createPrismaItemFormQueryRepository(
  runWithUser: ItemFormQueryTransactionRunner,
): ItemFormQueryRepository {
  return {
    async findOptions(userId) {
      return runWithUser(userId, loadFormOptions);
    },

    async findEditData(userId, itemId): Promise<ItemEditFormData | null> {
      return runWithUser(userId, async (tx) => {
        const itemRow = await tx.item.findFirst({
          where: { id: BigInt(itemId) },
          include: {
            plan: true,
            listing: true,
            itemCategories: { select: { categoryId: true } },
          },
        });
        if (!itemRow) return null;

        let initialServiceId: number | null = null;
        let initialSizeId: number | null = null;
        if (itemRow.listing?.shippingId != null) {
          const shipping = await tx.shipping.findUnique({
            where: { id: itemRow.listing.shippingId },
            select: { shippingServiceId: true, shippingSizeId: true },
          });
          initialServiceId = shipping?.shippingServiceId ?? null;
          initialSizeId = shipping?.shippingSizeId ?? null;
        }
        const options = await loadFormOptions(tx);

        return Object.freeze({
          ...options,
          item: Object.freeze(toItem(itemRow)),
          plan: itemRow.plan ? Object.freeze(toPlan(itemRow.plan)) : null,
          listing: itemRow.listing
            ? Object.freeze(toListing(itemRow.listing))
            : null,
          selectedCategoryIds: Object.freeze(
            itemRow.itemCategories.map(({ categoryId }) => categoryId),
          ),
          initialServiceId,
          initialSizeId,
        });
      });
    },
  };
}

export const prismaItemFormQueryRepository =
  createPrismaItemFormQueryRepository(withUser);
