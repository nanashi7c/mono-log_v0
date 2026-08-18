import type { HomeOverviewData } from "@/features/home/application/home-overview-data";

export interface HomeOverviewQueryRepository {
  findByUserId(userId: string): Promise<HomeOverviewData>;
}
