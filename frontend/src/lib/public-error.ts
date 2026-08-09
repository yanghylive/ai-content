const AUTH_ERROR_PATTERN =
  /(?:\b401\b|unauthori[sz]ed|not[ _-]?authenticated|login required|登录(?:状态)?(?:已)?失效|请重新登录)/i;
const PERMISSION_ERROR_PATTERN =
  /(?:\b403\b|forbidden|permission denied|access denied|无权|没有权限|权限不足)/i;
const NETWORK_ERROR_PATTERN =
  /(?:network error|network request failed|failed to fetch|fetch failed|connection refused|econnrefused|enotfound|网络(?:连接)?(?:异常|错误|不可用)|账号服务不可用|线上地址可访问)/i;
const TIMEOUT_ERROR_PATTERN =
  /(?:timeout|timed out|etimedout|请求超时|连接超时)/i;
const QUOTA_ERROR_PATTERN =
  /(?:quota|rate limit|too many requests|\b429\b|用量不足|额度不足|积分不足|超出.*限制)/i;

/**
 * Converts an unknown failure into copy that is safe for customer-facing UI.
 * Raw server messages, status codes, paths and stack details must stay in
 * diagnostics and must never be rendered directly by a page or toast.
 */
export function toPublicError(
  error: unknown,
  fallback = "操作未完成，请重试。",
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (AUTH_ERROR_PATTERN.test(message)) {
    return "登录状态已失效，请重新登录后再试。";
  }
  if (PERMISSION_ERROR_PATTERN.test(message)) {
    return "当前账号没有执行此操作的权限，请联系管理员。";
  }
  if (QUOTA_ERROR_PATTERN.test(message)) {
    return "当前可用额度不足，请检查账号用量后再试。";
  }
  if (TIMEOUT_ERROR_PATTERN.test(message)) {
    return "等待响应超时，请稍后重试。";
  }
  if (NETWORK_ERROR_PATTERN.test(message)) {
    return "网络连接不稳定，请检查网络后重试。";
  }

  return fallback;
}

/** 技术细节特征：含这些的不直接展示给用户 */
const TECHNICAL_DETAIL_PATTERN =
  /(?:\bat\s+\S+\s+\(|\/Users\/|\/home\/|node_modules|\.tsx?:\d+|ECONNREFUSED|ETIMEDOUT|prisma|SELECT\s|INSERT\s)/i;

/**
 * 表单/操作场景的错误展示：后端的业务校验文案（如「客户名称不能为空」）
 * 本来就是写给用户看的，直接透出才能让人知道怎么改；
 * 只有带技术细节的错误才走 toPublicError 的安全兜底。
 */
export function toActionableError(
  error: unknown,
  fallback = "操作未完成，请重试。",
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const trimmed = message.trim();
  if (
    trimmed &&
    trimmed.length <= 120 &&
    !TECHNICAL_DETAIL_PATTERN.test(trimmed) &&
    !/^\s*\{/.test(trimmed) // 不把原始 JSON 拍用户脸上
  ) {
    return trimmed;
  }

  return toPublicError(error, fallback);
}
