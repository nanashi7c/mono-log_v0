import type { HomeOverviewData } from "@/features/home/application/home-overview-data";
import type { HomeOverviewQueryRepository } from "@/features/home/application/home-overview-query-ports";

export type HomeOverviewQueryDependencies = Readonly<{
  repository: HomeOverviewQueryRepository;
}>;

export async function loadHomeOverviewUseCase(
  dependencies: HomeOverviewQueryDependencies,
  query: Readonly<{ userId: string }>,
): Promise<HomeOverviewData> {
  return dependencies.repository.findByUserId(query.userId);
}
