import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/db/client";
import {
  createPrismaUserProfileQueryRepository,
  type UserProfileQueryTransactionRunner,
} from "@/features/users/infrastructure/prisma-user-profile-query-repository";

describe("PrismaユーザープロフィールQuery Repository", () => {
  it("DB行を不変なプロフィールデータへ変換する", async () => {
    const createdAt = new Date("2026-08-19T00:00:00.000Z");
    const findUnique = vi.fn(async () => ({ username: "mono", createdAt }));
    const tx = { user: { findUnique } } as unknown as Tx;
    const requestedUserIds: string[] = [];
    const runWithUser: UserProfileQueryTransactionRunner = async <T>(
      userId: string,
      operation: (client: Tx) => Promise<T>,
    ) => {
      requestedUserIds.push(userId);
      return operation(tx);
    };
    const repository = createPrismaUserProfileQueryRepository(runWithUser);

    const result = await repository.findById("user-1");

    expect(requestedUserIds).toEqual(["user-1"]);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { username: true, createdAt: true },
    });
    expect(result).toEqual({
      username: "mono",
      createdAt: "2026-08-19T00:00:00.000Z",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("ユーザーが存在しない場合はnullを返す", async () => {
    const tx = {
      user: { findUnique: vi.fn(async () => null) },
    } as unknown as Tx;
    const repository = createPrismaUserProfileQueryRepository(
      async (_userId, operation) => operation(tx),
    );

    await expect(repository.findById("missing-user")).resolves.toBeNull();
  });
});
