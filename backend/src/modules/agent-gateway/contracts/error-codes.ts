import { AppError, ErrorCode } from '../core/types';

/**
 * 冻结错误码表 —— 对齐《开发前补充文档包》3.2/3.4 与各控制面。
 * retryable=false 的码绝不自动重试；计费类需人工对账。
 */
interface ErrorSpec {
  message: string;
  retryable: boolean;
  httpStatus: number;
}

export const ERROR_SPECS: Record<ErrorCode, ErrorSpec> = {
  INVALID_PLAN: { message: '计划不合法，无法创建任务', retryable: false, httpStatus: 422 },
  DUPLICATE_REQUEST: { message: '重复请求', retryable: false, httpStatus: 409 },
  APPROVAL_EXPIRED: { message: '确认已过期，请重新预览', retryable: false, httpStatus: 410 },
  PREVIEW_CHANGED: { message: '待执行内容已被修改，请重新预览', retryable: false, httpStatus: 409 },
  NOT_PAUSABLE: { message: '当前任务状态不可暂停', retryable: false, httpStatus: 409 },
  TASK_TERMINAL: { message: '任务已进入终态，不可继续执行', retryable: false, httpStatus: 409 },
  CHECKPOINT_MISSING: { message: '缺少恢复检查点', retryable: false, httpStatus: 409 },
  DEVICE_OFFLINE: { message: '设备离线，无法恢复', retryable: true, httpStatus: 409 },
  CANCEL_TIMEOUT: { message: '取消超时，请检查设备状态', retryable: true, httpStatus: 504 },
  TOOL_NOT_ALLOWED: { message: '该工具不在当前模式白名单内', retryable: false, httpStatus: 403 },
  TOOL_EXECUTION_FAILED: { message: '工具执行失败', retryable: true, httpStatus: 500 },
  CONTENT_REVIEW_FAILED: { message: '内容审核未通过', retryable: true, httpStatus: 422 },
  IDEMPOTENCY_CONFLICT: { message: '幂等键冲突，已存在进行中的相同请求', retryable: false, httpStatus: 409 },
  MEMORY_TIMEOUT: { message: '远程记忆超时，已降级为本地结果', retryable: true, httpStatus: 200 },
  NAMESPACE_INVALID: { message: '记忆命名空间非法', retryable: false, httpStatus: 400 },
  MEMORY_REJECTED: { message: '远程记忆拒绝写入', retryable: true, httpStatus: 502 },
  DUPLICATE_EVENT: { message: '记忆事件重复，已忽略', retryable: false, httpStatus: 200 },
  OCTOP_DEGRADED: { message: 'Octop 能力降级', retryable: true, httpStatus: 200 },
  OCTOP_UNAVAILABLE: { message: 'Octop 不可用，已切换到 3010 原生工具', retryable: true, httpStatus: 200 },
  RESUME_WINDOW_EXPIRED: { message: '事件重放窗口已过期，请拉取任务快照', retryable: false, httpStatus: 409 },
  SESSION_EXPIRED: { message: '会话已过期', retryable: false, httpStatus: 401 },
  UNAUTHORIZED: { message: '未授权', retryable: false, httpStatus: 401 },
  AUTH_INVALID: { message: '身份令牌无效或签名校验失败', retryable: false, httpStatus: 401 },
  FORBIDDEN: { message: '禁止访问', retryable: false, httpStatus: 403 },
  APPROVAL_MISMATCH: { message: '审批与当前任务/请求不匹配或已被消费', retryable: false, httpStatus: 403 },
  IDEMPOTENCY_KEY_REQUIRED: { message: '高风险写请求必须携带 Idempotency-Key', retryable: false, httpStatus: 400 },
  RATE_LIMITED: { message: '速率受限', retryable: true, httpStatus: 429 },
};

export function errorSpec(code: string): ErrorSpec {
  return ERROR_SPECS[code as ErrorCode] ?? { message: '未知错误', retryable: false, httpStatus: 500 };
}

/** 统一应用错误：既是 Error（可 catch / 有堆栈），又携带 code / retryable 等结构化字段 */
export class AppErrorError extends Error {
  code: ErrorCode;
  retryable: boolean;
  requestId?: string;
  taskId?: string;
  details?: Record<string, unknown>;
  constructor(
    code: ErrorCode,
    message: string,
    retryable: boolean,
    extra: Partial<Omit<AppError, 'code' | 'message' | 'retryable'>> = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = retryable;
    Object.assign(this, extra);
  }
}

export function makeError(
  code: ErrorCode,
  overrides: Partial<Omit<AppError, 'code' | 'message' | 'retryable'>> = {},
): AppError {
  const spec = errorSpec(code);
  return new AppErrorError(code, spec.message, spec.retryable, overrides);
}

/** 把 AppError 封装成《补充包》3.4 的统一错误响应体 */
export function errorBody(err: AppError) {
  return { error: err };
}
