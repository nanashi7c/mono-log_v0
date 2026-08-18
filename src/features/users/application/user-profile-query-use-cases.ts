import type { UserProfileData } from "@/features/users/application/user-profile-data";
import type { UserProfileQueryRepository } from "@/features/users/application/user-profile-query-ports";

export type UserProfileQueryDependencies = Readonly<{
  repository: UserProfileQueryRepository;
}>;

export async function loadUserProfileUseCase(
  dependencies: UserProfileQueryDependencies,
  query: Readonly<{ userId: string }>,
): Promise<UserProfileData | null> {
  return dependencies.repository.findById(query.userId);
}
