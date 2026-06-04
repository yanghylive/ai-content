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
  // 本地角色（user.role）：operator | manager | admin
  role: string;
  // 本地：是否允许商用执行（绕过 approval-send 走 auto-send）
  commercialExecutionAllowed: boolean;
  // 本地：计划模式 trial | commercial
  planMode: string;
  createdAt: Date;
  updatedAt: Date;
}
