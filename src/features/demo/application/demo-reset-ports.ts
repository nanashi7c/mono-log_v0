import type { DemoSeedData } from "./demo-reset-data";

export type DemoResetCommand = Readonly<{
  userId: string;
  email: string;
  seed: DemoSeedData;
}>;

export type DemoResetResult = Readonly<{
  staleImageKeys: readonly string[];
}>;

export interface DemoResetRepository {
  reset(command: DemoResetCommand): Promise<DemoResetResult>;
}

export interface DemoImageRemover {
  remove(key: string): Promise<void>;
}
