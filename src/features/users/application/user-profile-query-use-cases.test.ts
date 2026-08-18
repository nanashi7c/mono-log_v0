import { describe, expect, it, vi } from "vitest";
import type { UserProfileQueryRepository } from "@/features/users/application/user-profile-query-ports";
import { loadUserProfileUseCase } from "@/features/users/application/user-profile-query-use-cases";

describe("ユーザープロフィール読み取りユースケース", () => {
  it("ユーザーIDをRepositoryへ渡してプロフィールを返す", async () => {
    const profile = Object.freeze({
      username: "mono",
      createdAt: "2026-08-19T00:00:00.000Z",
    });
    const repository: UserProfileQueryRepository = {
      findById: vi.fn(async () => profile),
    };

    const result = await loadUserProfileUseCase(
      { repository },
      { userId: "user-1" },
    );

    expect(repository.findById).toHaveBeenCalledWith("user-1");
    expect(result).toBe(profile);
  });
});
