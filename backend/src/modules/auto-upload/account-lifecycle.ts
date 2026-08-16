/**
 * 账号生命周期状态机（报告 16.3 第 12 项「商用缺口」）。
 * 把散落在 statusLabel / sessionStatus / loggedIn 里的隐式状态，
 * 归一成显式的标准状态，供前端展示、报表、授权判断统一使用。
 */
export type AccountLifecycleStatus =
  | 'unbound' // 未绑定
  | 'login_pending' // 待登录/待校验
  | 'online' // 在线可用
  | 'degraded' // 降级（浏览器阻断 / 引擎错误）
  | 'expired' // 登录失效
  | 'reauth' // 需要重新登录
  | 'disabled'; // 已禁用

export const ACCOUNT_LIFECYCLE_LABEL: Record<AccountLifecycleStatus, string> = {
  unbound: '未绑定',
  login_pending: '待校验',
  online: '已登录',
  degraded: '浏览器阻断',
  expired: '登录失效',
  reauth: '需要重新登录',
  disabled: '已禁用',
};

/** 每个状态对应的「用户下一步动作」 */
export const ACCOUNT_LIFECYCLE_ACTION: Record<AccountLifecycleStatus, string> = {
  unbound: '绑定账号',
  login_pending: '等待校验',
  online: '可用',
  degraded: '检查浏览器',
  expired: '重新登录',
  reauth: '重新登录',
  disabled: '联系管理员',
};

/**
 * 从现有字段推导标准生命周期状态。
 * 优先级：sessionStatus(needs_login/error) > statusLabel 语义 > loggedIn/status。
 */
export function deriveAccountLifecycle(input: {
  sessionStatus?: string | null;
  statusLabel?: string | null;
  loggedIn?: boolean | null;
  status?: number | null;
}): AccountLifecycleStatus {
  if (input.sessionStatus === 'needs_login') return 'reauth';
  if (input.statusLabel === '浏览器阻断' || input.sessionStatus === 'error') {
    return 'degraded';
  }
  if (input.statusLabel === '需要重新登录') return 'reauth';
  if (input.statusLabel === '登录失效') return 'expired';
  if (input.statusLabel === '待校验') return 'login_pending';
  if (input.loggedIn === true || input.status === 1) return 'online';
  if (input.loggedIn === false) return 'expired';
  return 'unbound';
}
