// ============================================================
// P4 Agent Browser（文档 §7.4）：会话/策略/循环/执行器边界类型
// 通用网页 agent（general-web），不碰社媒登录态。
// 初始工具白名单：navigate/snapshot/click/fill_form/press_key/wait_for/tabs/受限文本提取
// 默认禁用任意 JavaScript、文件读取、支付、删除和任意跨域访问。
// ============================================================

/** Agent Browser 会话状态 */
export type AgentBrowserSessionStatus =
  | 'created' // 已创建（profile 就绪，未运行）
  | 'running' // observe-act-verify 循环运行中
  | 'paused' // 已暂停（可恢复）
  | 'needs-human' // 审计发现异常（提示注入/引擎断开）待人工接管（可恢复）
  | 'succeeded' // 执行成功（终态，文档 §6.1 running -> succeeded）
  | 'partial_success' // 部分成功（P2 复查 2026-08-22：保留"待重试"语义，非终态，可再次 run）
  | 'failed' // 全部失败（终态）
  | 'stopped' // 已停止（终态）
  | 'error'; // 异常终止（终态）

/** 工具白名单（P4 初始 8 个；执行时 PolicyService 审计） */
export type AgentBrowserTool =
  | 'navigate'
  | 'snapshot'
  | 'click'
  | 'fill_form'
  | 'press_key'
  | 'wait_for'
  | 'tabs'
  | 'extract_text';

export const AGENT_BROWSER_TOOLS: AgentBrowserTool[] = [
  'navigate',
  'snapshot',
  'click',
  'fill_form',
  'press_key',
  'wait_for',
  'tabs',
  'extract_text',
];

/** 默认禁用的高危能力（策略强制拦截，即使模型请求） */
export const AGENT_BROWSER_FORBIDDEN = [
  'evaluate_js',
  'read_file',
  'payment',
  'delete',
  'cross_origin_fetch',
] as const;

/** 会话租约 */
export interface AgentBrowserLease {
  acquiredAt: string;
  expiresAt: string;
  ownerId: string;
  /** §7.4 租户级隔离：会话所属租户（多租户用户可区分） */
  tenantId?: string;
}

/** Agent Browser 循环事件（Observe-Act-Verify 过程记录） */
export type AgentBrowserEvent = {
  type: 'snapshot' | 'step' | 'done' | 'error' | 'needs-human';
  stepIndex?: number;
  action?: string;
  ok?: boolean;
  message?: string;
  url?: string;
  extractText?: string;
  error?: string;
  at: string;
};

/** 会话（对外 DTO） */
export interface AgentBrowserSessionDto {
  id: string;
  accountId: string;
  status: AgentBrowserSessionStatus;
  url?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
  stepCount: number;
  lease?: AgentBrowserLease;
  error?: string;
}

/** 会话（内部含引擎句柄） */
export interface AgentBrowserSession extends AgentBrowserSessionDto {
  engineKey: string;
  allowDomains: string[];
  /** §7.4 会话租户（多租户隔离） */
  tenantId?: string;
  /** 循环事件缓冲（Observe-Act-Verify 过程记录，供 events 接口/回放） */
  events: AgentBrowserEvent[];
  // P1（复查 2026-08-22）：暂停/中断时的任务上下文——resume 后从断点续跑
  // （不再丢失 instruction / 剩余动作），恢复后再次 run 不会被重复执行保护拒绝
  pendingInstruction?: string;
  pendingActions?: import('./ai-browser-action.service').AiBrowserAction[];
  pendingStepIndex?: number;
}

/** 创建一个会话的输入 */
export interface CreateAgentBrowserSessionInput {
  startUrl?: string;
  /** 允许访问的域名白名单（默认仅 startUrl 的 origin；空=不限制但需显式确认） */
  allowDomains?: string[];
  /** 会话租约时长（ms，默认 30 分钟） */
  leaseMs?: number;
  description?: string;
}

/** 策略审计结果 */
export interface AgentBrowserPolicyDecision {
  allowed: boolean;
  tool: AgentBrowserTool;
  reason?: string;
  requiresConfirmation?: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
}
