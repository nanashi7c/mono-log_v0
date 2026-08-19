import { DEMO_INITIAL_DATA } from "./demo-reset-data";
import type {
  DemoImageRemover,
  DemoResetRepository,
} from "./demo-reset-ports";

export type DemoResetDependencies = Readonly<{
  repository: DemoResetRepository;
  imageRemover: DemoImageRemover;
  onCleanupError?: (error: unknown) => void;
}>;

export async function resetDemoAccountUseCase(
  dependencies: DemoResetDependencies,
  account: Readonly<{ userId: string; email: string }>,
): Promise<void> {
  const result = await dependencies.repository.reset({
    ...account,
    seed: DEMO_INITIAL_DATA,
  });

  for (const key of result.staleImageKeys) {
    try {
      await dependencies.imageRemover.remove(key);
    } catch (error) {
      try {
        dependencies.onCleanupError?.(error);
      } catch {
        // DB reset is already committed; logging must not change the result.
      }
    }
  }
}
