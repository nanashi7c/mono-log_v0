import type { UserProfileData } from "@/features/users/application/user-profile-data";

export interface UserProfileQueryRepository {
  findById(userId: string): Promise<UserProfileData | null>;
}
