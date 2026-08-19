import { describe, expect, it, vi } from "vitest";
import type {
  DemoImageRemover,
  DemoResetRepository,
} from "./demo-reset-ports";
import { resetDemoAccountUseCase } from "./demo-reset-use-case";

describe("resetDemoAccountUseCase", () => {
  it("resets DB data before removing the returned stale images", async () => {
    const repository: DemoResetRepository = {
      reset: vi.fn(async () => ({ staleImageKeys: ["old.png", "pending.png"] })),
    };
    const imageRemover: DemoImageRemover = {
      remove: vi.fn(async () => undefined),
    };

    await resetDemoAccountUseCase(
      { repository, imageRemover },
      { userId: "demo-user", email: "test@example.com" },
    );

    expect(repository.reset).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "demo-user",
        email: "test@example.com",
      }),
    );
    expect(imageRemover.remove).toHaveBeenNthCalledWith(1, "old.png");
    expect(imageRemover.remove).toHaveBeenNthCalledWith(2, "pending.png");
    expect(vi.mocked(repository.reset).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(imageRemover.remove).mock.invocationCallOrder[0],
    );
  });

  it("keeps a successful DB reset when image cleanup fails", async () => {
    const cleanupError = new Error("S3 unavailable");
    const repository: DemoResetRepository = {
      reset: vi.fn(async () => ({ staleImageKeys: ["old.png"] })),
    };
    const imageRemover: DemoImageRemover = {
      remove: vi.fn(async () => {
        throw cleanupError;
      }),
    };
    const onCleanupError = vi.fn();

    await expect(
      resetDemoAccountUseCase(
        { repository, imageRemover, onCleanupError },
        { userId: "demo-user", email: "test@example.com" },
      ),
    ).resolves.toBeUndefined();
    expect(onCleanupError).toHaveBeenCalledWith(cleanupError);
  });
});
