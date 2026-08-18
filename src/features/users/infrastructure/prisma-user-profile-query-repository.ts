import { withUser, type Tx } from "@/db/client";
import type { UserProfileQueryRepository } from "@/features/users/application/user-profile-query-ports";

export type UserProfileQueryTransactionRunner = <T>(
  userId: string,
  operation: (tx: Tx) => Promise<T>,
) => Promise<T>;

export function createPrismaUserProfileQueryRepository(
  runWithUser: UserProfileQueryTransactionRunner,
): UserProfileQueryRepository {
  return {
    async findById(userId) {
      return runWithUser(userId, async (tx) => {
        const row = await tx.user.findUnique({
          where: { id: userId },
          select: { username: true, createdAt: true },
        });
        if (!row) return null;

        return Object.freeze({
          username: row.username,
          createdAt: row.createdAt.toISOString(),
        });
      });
    },
  };
}

export const prismaUserProfileQueryRepository =
  createPrismaUserProfileQueryRepository(withUser);
