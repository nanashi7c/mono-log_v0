import { withUser, type Tx } from "@/db/client";
import type {
  DemoResetCommand,
  DemoResetRepository,
} from "@/features/demo/application/demo-reset-ports";

export type DemoResetTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

export function createPrismaDemoResetRepository(
  runWithUser: DemoResetTransactionRunner,
): DemoResetRepository {
  return {
    async reset(command: DemoResetCommand) {
      return runWithUser(command.userId, async (tx) => {
        await tx.user.upsert({
          where: { id: command.userId },
          update: { email: command.email, username: command.seed.username },
          create: {
            id: command.userId,
            email: command.email,
            username: command.seed.username,
          },
        });

        const [items, pendingUploads] = await Promise.all([
          tx.item.findMany({
            where: { userId: command.userId },
            select: { imageUrl: true },
          }),
          tx.pendingItemImageUpload.findMany({
            where: { userId: command.userId },
            select: { objectKey: true },
          }),
        ]);

        await tx.item.deleteMany({ where: { userId: command.userId } });
        await tx.pendingItemImageUpload.deleteMany({
          where: { userId: command.userId },
        });
        await tx.category.deleteMany({ where: { userId: command.userId } });

        const categoryIds = new Map<string, number>();
        for (const category of command.seed.categories) {
          const created = await tx.category.create({
            data: { userId: command.userId, ...category },
            select: { id: true },
          });
          categoryIds.set(category.name, created.id);
        }

        for (const item of command.seed.items) {
          const categoryId = categoryIds.get(item.categoryName);
          if (categoryId === undefined) {
            throw new Error(
              `Demo seed category is missing: ${item.categoryName}`,
            );
          }

          await tx.item.create({
            data: {
              userId: command.userId,
              name: item.name,
              status: item.status,
              quantity: item.quantity,
              actualPrice: item.actualPrice,
              purchasedAt: item.purchasedAt
                ? new Date(`${item.purchasedAt}T00:00:00Z`)
                : null,
              notes: item.notes,
              itemCategories: { create: [{ categoryId }] },
              ...(item.plan ? { plan: { create: item.plan } } : {}),
              ...(item.listing
                ? {
                    listing: {
                      create: {
                        ...item.listing,
                        sellingFee: 0,
                        isListing: true,
                      },
                    },
                  }
                : {}),
            },
          });
        }

        const staleImageKeys = new Set<string>();
        const ownedImagePrefix = `${command.userId}/items/`;
        for (const item of items) {
          if (item.imageUrl?.startsWith(ownedImagePrefix)) {
            staleImageKeys.add(item.imageUrl);
          }
        }
        for (const upload of pendingUploads) {
          if (upload.objectKey.startsWith(ownedImagePrefix)) {
            staleImageKeys.add(upload.objectKey);
          }
        }
        return Object.freeze({
          staleImageKeys: Object.freeze([...staleImageKeys]),
        });
      });
    },
  };
}

export const prismaDemoResetRepository =
  createPrismaDemoResetRepository(withUser);
