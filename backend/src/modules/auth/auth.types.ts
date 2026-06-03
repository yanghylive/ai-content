export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  name: string;
  status: string;
  lastLoginAt: Date | null;
  kaypalUserId?: string | null;
  kaypalPlan?: string;
  kaypalPlanExpired?: boolean;
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  kaypalPermissionNames?: string[];
  createdAt: Date;
  updatedAt: Date;
}
