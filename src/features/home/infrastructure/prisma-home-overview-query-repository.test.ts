import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/db/client";
import {
  createPrismaHomeOverviewQueryRepository,
  type HomeOverviewQueryTransactionRunner,
} from "@/features/home/infrastructure/prisma-home-overview-query-repository";

describe("Prismaトップ概要Query Repository", () => {
  it("ユーザー名と件数を同じRLSトランザクションで取得する", async () => {
    const findUnique = vi.fn(async () => ({ username: "mono" }));
    const count = vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const tx = { user: { findUnique }, item: { count } } as unknown as Tx;
    const requestedUserIds: string[] = [];
    const runWithUser: HomeOverviewQueryTransactionRunner = async <T>(
      userId: string,
      operation: (client: Tx) => Promise<T>,
    ) => {
      requestedUserIds.push(userId);
      return operation(tx);
    };
    const repository = createPrismaHomeOverviewQueryRepository(runWithUser);

    const result = await repository.findByUserId("user-1");

    expect(requestedUserIds).toEqual(["user-1"]);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { username: true },
    });
    expect(count).toHaveBeenNthCalledWith(1, {
      where: {
        status: { in: ["owned", "listed"] },
        deletedAt: null,
      },
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: { status: "planned", deletedAt: null },
    });
    expect(count).toHaveBeenNthCalledWith(3, {
      where: { status: "listed", deletedAt: null },
    });
    expect(result).toEqual({
      username: "mono",
      owned: 3,
      planned: 2,
      listed: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
