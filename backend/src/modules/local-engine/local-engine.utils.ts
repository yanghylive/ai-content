// local-engine 纯工具函数层（god class 拆解第一步）
// 这些函数无 this 依赖，可从 LocalEngineService 安全提取；
// 新增纯函数优先放这里，避免继续膨胀主 service。

import { extname } from 'node:path';

import { resolveProjectRoot } from '../../common/project-paths';
import type {
  AgentExecutionScope,
  AgentRiskLevel,
  AgentSession,
  InteractionExecutorDraftResult,
  InteractionTaskType,
} from './local-engine.types';

/** 生成本地引擎任务/会话唯一 ID */
export function createId(): string {
  return `le_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 延时（最小 0ms） */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** 安全转非负整数（非法/负数返回 0） */
export function toNonNegativeInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

/** 可选数值（undefined/null/空串/非法 → undefined） */
export function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

/** 从源文本提取回复主题（清理换行/问候前缀，截断 24 字符） */
export function extractReplySubject(sourceText: string): string {
  const cleaned = sourceText
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(你好|您好|在吗|哈喽|hello|hi)[，,、\s]*/i, '')
    .trim();
  if (!cleaned) return '这个问题';
  return cleaned.length > 24 ? `${cleaned.slice(0, 24)}...` : cleaned;
}

/** 回复结尾兜底（话术含风险表述 → 标准话术） */
export function resolveSafeReplyClosing(closingText?: string | null): string {
  const cleaned = String(closingText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !cleaned ||
    /收到(您的)?(留言|咨询)|专人跟进|马上(帮您)?安排|给您合适方案|感谢咨询|欢迎了解|亲亲|亲爱的|^亲[，,、\s]|尊敬的客户|方便留个联系方式|留下联系方式|留个联系方式|私信我们吗|[~～]/.test(
      cleaned,
    )
  ) {
    return '你把具体款式、订单或时间发我，我按实际情况帮你看。';
  }
  return cleaned.slice(0, 140);
}

/** 是否为浏览器平台互动任务（评论/私信回复） */
export function isBrowserPlatformInteractionTask(
  type: InteractionTaskType,
): boolean {
  return (
    type === 'douyin-comment-reply' ||
    type === 'douyin-direct-message-reply' ||
    type === 'wechat-channel-comment-reply' ||
    type === 'wechat-channel-direct-message-reply'
  );
}

/** 是否含证据链完整性风险文案 */
export function isEvidenceIntegrityText(value: unknown): boolean {
  return /证据链不完整|导出证据链不完整|阶段日志缺失|证据导出/.test(
    typeof value === 'string' ? value : '',
  );
}

/** 构建 Agent 会话标题（截断 22 字符） */
export function buildAgentTitle(instruction: string): string {
  const normalized = instruction.replace(/\s+/g, ' ').trim();
  return normalized.length > 22 ? `${normalized.slice(0, 22)}...` : normalized;
}

/** 从指令解析目标平台（微信/抖音/小红书/B站） */
export function resolveAgentTargetApp(instruction: string): string | undefined {
  if (/微信/.test(instruction)) return '微信';
  if (/抖音/.test(instruction)) return '抖音后台';
  if (/小红书/.test(instruction)) return '小红书后台';
  if (/B站|哔哩/.test(instruction)) return 'B站后台';
  return undefined;
}

/** unknown → Record（仅当是普通对象） */
export function toRuntimeRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** unknown → 清洗后的字符串 */
export function toRuntimeString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** 项目根目录（runtime 状态目录的上级） */
export function getProjectRoot(): string {
  return resolveProjectRoot(process.cwd());
}

/** 按扩展名解析图片 MIME */
export function resolveImageMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

/** 是否为桌面交互任务（微信桌面自动化执行） */
export function isDesktopInteractionTask(type: InteractionTaskType): boolean {
  return [
    'wechat-reply-draft',
    'wechat-friend-accept',
    'wechat-group-broadcast',
    'wechat-contact-add',
    'wechat-moments-publish',
    'wechat-moments-marketing',
  ].includes(type);
}

export function normalizeWechatContactTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 50),
    ),
  ];
}

export function normalizeStringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 50);
  return normalized.length ? normalized : fallback;
}

export function sanitizeInteractionFailureMessage(message: string): string {
  return String(message || '真实读取失败')
    .replace(/\s*\|\s*pageText=[\s\S]*?(?=\s*\|\s*evidence=|\)$|$)/, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 600)
    .trim();
}

export function buildAutoSendReadbackMessage(
  result: InteractionExecutorDraftResult,
) {
  const readbackText = result.readbackText?.trim();
  if (readbackText) {
    return `自动发送已完成，回读确认：${readbackText}`;
  }
  return '自动发送已完成，但没有记录到可比对的页面回读文本；不能作为真实回读成功证据。';
}

export function isWechatAccountProtectionBlocker(message: string) {
  return /验证码|频繁|风险|账号异常|账号限制|操作过快|安全验证|稍后再试|被限制|登录过期|未登录|登录/.test(
    message,
  );
}

export function isWechatNoTargetMessage(message: string) {
  return /未进入好友申请页面|没有找到可添加对象|目标已是联系人|已是联系人|不可添加|无可添加对象/.test(
    message,
  );
}

export function normalizeStringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);

  return normalized.length ? normalized : fallback;
}

export function normalizeEditableStringList(
  value: unknown,
  fallback: string[],
) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 50);
}

export function previewEvidenceValue(value: string, maxLength = 120) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

export function agentSessionNeedsBrowserEvidence(session: AgentSession) {
  return ['browser', 'mixed', 'remote'].includes(session.executionScope);
}

export function resolveAgentRisk(instruction: string): AgentRiskLevel {
  if (
    /(发布|发送|提交|删除|移除|转账|支付|购买|扣费|改配置|写文件|清空|群发|朋友圈)/.test(
      instruction,
    )
  ) {
    return 'high';
  }
  if (
    /(打开|登录|读取|采集|导出|整理|生成|回复|评论|私信|微信)/.test(instruction)
  ) {
    return 'medium';
  }
  return 'low';
}

export function resolveAgentScope(instruction: string): AgentExecutionScope {
  if (/(微信|桌面|窗口|键盘|鼠标)/.test(instruction)) return 'desktop';
  if (/(网页|浏览器|抖音|小红书|B站|视频号|后台)/.test(instruction))
    return 'browser';
  if (/(文件|目录|素材|下载|导出|保存)/.test(instruction)) return 'local-files';
  if (/(服务器|远程|线上)/.test(instruction)) return 'remote';
  return 'mixed';
}
