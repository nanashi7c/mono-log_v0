import { describe, expect, it, vi } from "vitest";
import type { HomeOverviewQueryRepository } from "@/features/home/application/home-overview-query-ports";
import { loadHomeOverviewUseCase } from "@/features/home/application/home-overview-query-use-cases";

describe("トップ概要読み取りユースケース", () => {
  it("ユーザーIDをRepositoryへ渡して概要を返す", async () => {
    const overview = Object.freeze({
      username: "mono",
      owned: 3,
      planned: 2,
      listed: 1,
    });
    const repository: HomeOverviewQueryRepository = {
      findByUserId: vi.fn(async () => overview),
    };

    const result = await loadHomeOverviewUseCase(
      { repository },
      { userId: "user-1" },
    );

    expect(repository.findByUserId).toHaveBeenCalledWith("user-1");
    expect(result).toBe(overview);
  });
});
