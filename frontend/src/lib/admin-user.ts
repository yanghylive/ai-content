/**
 * 管理员判断工具
 * 管理员身份来自 kaypal.cn 统一身份平台(kaypalRole / kaypalPlatformRole),
 * 兜底本地 role;与 capabilities/account 的 formatAccountRole 约定一致。
 */

const ADMIN_ROLES = new Set(["admin", "administrator", "owner"]);

export function isAdminUser(user?: {
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  role?: string | null;
} | null): boolean {
  if (!user) return false;
  const candidates = [user.kaypalRole, user.kaypalPlatformRole, user.role];
  return candidates.some((v) => {
    if (!v) return false;
    return ADMIN_ROLES.has(String(v).trim().toLowerCase());
  });
}
