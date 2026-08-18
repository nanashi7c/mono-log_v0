import { withUser, type Tx } from "@/db/client";
import type { HomeOverviewQueryRepository } from "@/features/home/application/home-overview-query-ports";

export type HomeOverviewQueryTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

export function createPrismaHomeOverviewQueryRepository(
  runWithUser: HomeOverviewQueryTransactionRunner,
): HomeOverviewQueryRepository {
  return {
    async findByUserId(userId) {
      return runWithUser(userId, async (tx) => {
        const [profile, owned, planned, listed] = await Promise.all([
          tx.user.findUnique({
            where: { id: userId },
            select: { username: true },
          }),
          tx.item.count({
            where: {
              status: { in: ["owned", "listed"] },
              deletedAt: null,
            },
          }),
          tx.item.count({
            where: { status: "planned", deletedAt: null },
          }),
          tx.item.count({
            where: { status: "listed", deletedAt: null },
          }),
        ]);

        return Object.freeze({
          username: profile?.username ?? null,
          owned,
          planned,
          listed,
        });
      });
    },
  };
}

export const prismaHomeOverviewQueryRepository =
  createPrismaHomeOverviewQueryRepository(withUser);
