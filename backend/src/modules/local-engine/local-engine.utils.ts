// local-engine 纯工具函数层（god class 拆解第一步）
// 这些函数无 this 依赖，可从 LocalEngineService 安全提取；
// 新增纯函数优先放这里，避免继续膨胀主 service。

import { extname } from 'node:path';

import { resolveProjectRoot } from '../../common/project-paths';
import type {
  AgentEvidence,
  AgentExecutionScope,
  AgentRiskLevel,
  AgentSession,
  InteractionBatchTarget,
  InteractionExecutorDraftResult,
  InteractionTask,
  InteractionTaskStatus,
  InteractionTaskType,
  LocalEngineDesktopStatus,
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

export function collectAgentSessionEvidence(
  session: AgentSession,
): AgentEvidence[] {
  return session.events
    .filter((event) => event.evidence)
    .map((event) => ({
      ...event.evidence!,
      id: event.evidence?.id || event.id,
      eventId: event.id,
      sessionId: session.id,
      createdAt: event.evidence?.createdAt || event.createdAt,
    }));
}

export function groupEvidenceByType(evidenceItems: AgentEvidence[]) {
  const empty: Record<AgentEvidence['type'], number> = {
    text: 0,
    snapshot: 0,
    screenshot: 0,
    page_snapshot: 0,
    desktop_screenshot: 0,
    stage_log: 0,
    failure_reason: 0,
    diagnostic_bundle: 0,
    file: 0,
  };
  return evidenceItems.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, empty);
}

export function isPlaceholderInteractionText(text?: string | null): boolean {
  const value = String(text || '')
    .replace(/\s+/g, '')
    .trim();
  return (
    !value ||
    value === '测试对象' ||
    (value.includes('等待本机读取真实') &&
      (value.includes('对象') ||
        value.includes('评论') ||
        value.includes('私信'))) ||
    value.includes('等待本机读取真实对象') ||
    value.includes('等待系统读取真实') ||
    value.includes('等待读取真实') ||
    value.includes('浏览器预检将自动打开') ||
    value.includes('浏览器读取评论') ||
    value.includes('浏览器读取私信') ||
    value.includes('读取第一条可处理评论') ||
    value.includes('读取第一条可处理私信') ||
    value.includes('自动打开抖音后台') ||
    value.includes('自动打开视频号后台')
  );
}

export function shouldPreserveCompletedBusinessResult(task: InteractionTask) {
  const summaryCompleted =
    task.batchSummary && Number(task.batchSummary.completed || 0) > 0;
  const targetCompleted = Boolean(
    task.batchTargets?.some((target) => target.status === 'completed'),
  );
  const stepCompleted = Boolean(
    task.steps?.some(
      (step) => step.key === 'send-result' && step.status === 'completed',
    ),
  );
  const successEvent = task.events.some((event) => event.level === 'success');
  return (
    task.status === 'completed' ||
    summaryCompleted ||
    targetCompleted ||
    stepCompleted ||
    successEvent
  );
}

export function shouldPreserveEvidenceIntegrityBlocker(task: InteractionTask) {
  if (['blocked', 'skipped', 'no_target'].includes(task.status)) {
    return true;
  }
  const text = [
    task.status,
    task.failureReason,
    task.nextAction,
    task.resultSummary?.detail,
    task.resultSummary?.nextAction,
    task.diagnostics?.summary,
  ]
    .filter(Boolean)
    .join('\n');
  return /需要登录|未登录|重新登录|登录失效|登录过期|扫码|验证码|账号|权限|无对象|无可处理|没有可处理|no target|no_target|target_not_found|平台未就绪|仍在加载|执行器|本地引擎/i.test(
    text,
  );
}

export function buildTaskFailureAnalysis(task: InteractionTask) {
  const failedStep = task.steps?.find((step) => step.status === 'blocked');
  const failureEvents = task.events.filter(
    (event) =>
      event.level === 'error' || event.evidence?.type === 'failure_reason',
  );
  return {
    failed:
      task.status === 'failed' ||
      task.status === 'blocked' ||
      Boolean(task.failureReason),
    failureReason: task.failureReason || failedStep?.message,
    failedStage: failedStep?.key,
    nextAction: task.nextAction,
    eventCount: failureEvents.length,
    events: failureEvents.map((event) => ({
      id: event.id,
      message: event.message,
      createdAt: event.createdAt,
      evidence: event.evidence,
    })),
  };
}

export function buildRecordsSummary(records: InteractionTask[]) {
  const summary = records.reduce(
    (acc, task) => {
      acc.total += 1;
      if (task.status === 'completed') acc.completed += 1;
      if (task.status === 'failed' || task.status === 'blocked')
        acc.failed += 1;
      if (task.status === 'blocked') acc.blocked += 1;
      if (task.status === 'skipped') acc.skipped += 1;
      if (task.status === 'no_target') acc.noTarget += 1;
      acc.evidenceCount += task.events.filter((event) =>
        Boolean(event.evidence),
      ).length;
      acc.byType[task.type] = (acc.byType[task.type] || 0) + 1;
      if (
        !acc.lastUpdatedAt ||
        task.updatedAt.localeCompare(acc.lastUpdatedAt) > 0
      ) {
        acc.lastUpdatedAt = task.updatedAt;
      }
      return acc;
    },
    {
      total: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      noTarget: 0,
      evidenceCount: 0,
      byType: {
        'douyin-comment-reply': 0,
        'douyin-direct-message-reply': 0,
        'wechat-channel-comment-reply': 0,
        'wechat-channel-direct-message-reply': 0,
        'wechat-reply-draft': 0,
        'wechat-friend-accept': 0,
        'wechat-group-broadcast': 0,
        'wechat-contact-add': 0,
        'wechat-moments-publish': 0,
        'wechat-moments-marketing': 0,
        'customer-follow-up': 0,
      },
      lastUpdatedAt: undefined as string | undefined,
    },
  );

  return summary;
}

export function toCsv(rows: string[][]) {
  const bom = '\uFEFF';
  return `${bom}${rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '');
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(','),
    )
    .join('\n')}`;
}

export function formatConfirmationIndexForCsv(
  items: Array<Record<string, unknown>>,
) {
  const field = (value: unknown) =>
    value == null
      ? ''
      : typeof value === 'string'
        ? value
        : (JSON.stringify(value) ?? '');
  return items
    .map((item) =>
      [
        item.id ? `id=${field(item.id)}` : '',
        item.operator ? `operator=${field(item.operator)}` : '',
        item.status ? `status=${field(item.status)}` : '',
        item.confirmedAt ? `confirmedAt=${field(item.confirmedAt)}` : '',
        item.decidedAt ? `decidedAt=${field(item.decidedAt)}` : '',
      ]
        .filter(Boolean)
        .join('/'),
    )
    .filter(Boolean)
    .join('；');
}

export function normalizeTaskDisplayText(value: string) {
  return String(value || '')
    .replaceAll('发送确认', '执行保护')
    .replaceAll('确认后发送模式', '受控执行模式')
    .replaceAll('确认后发送', '受控发送')
    .replaceAll('确认后发布', '受控发布')
    .replaceAll('确认后提交', '受控提交')
    .replaceAll('等待人工确认或发送策略判定', '等待自动/受控执行策略判定')
    .replaceAll('等待人工确认', '等待继续执行')
    .replaceAll('等待用户确认', '等待继续执行')
    .replaceAll('等待确认后发送', '等待继续执行')
    .replaceAll('等待确认', '等待继续执行')
    .replaceAll('待确认', '待继续')
    .replaceAll(
      '请确认目标和内容后继续',
      '目标、内容和当前窗口通过回读后继续执行',
    )
    .replaceAll('请确认后继续', '条件通过后继续执行')
    .replaceAll('确认目标和内容', '回读目标和内容')
    .replaceAll('停在发送前等待确认', '条件不完整时停止并留下证据')
    .replaceAll('停在发表前等待确认', '条件不完整时停止并留下证据')
    .replaceAll('停在提交前等待确认', '条件不完整时停止并留下证据')
    .replaceAll('停在发送前', '等待继续执行')
    .replaceAll('停在发表前', '等待继续执行')
    .replaceAll('停在提交前', '等待继续执行')
    .replaceAll('停在确认前', '等待继续执行')
    .replaceAll('二次确认', '高风险继续保护');
}

export function isDesktopWechatExecutionReady(
  desktop: LocalEngineDesktopStatus,
) {
  return (
    desktop.available &&
    desktop.blockers.length === 0 &&
    desktop.window.currentWindowLikelyWechatChat === true
  );
}

export function summarizeDesktopWechatBlocker(
  desktop: LocalEngineDesktopStatus,
) {
  if (desktop.blockers.length > 0) {
    return desktop.blockers[0];
  }
  if (desktop.available && !desktop.window.currentWindowLikelyWechatChat) {
    const windowHint =
      desktop.warnings.find((warning) =>
        /检测到 \d+ 个微信窗口/.test(warning),
      ) ||
      desktop.permissionChecks.find((check) => check.key === 'window-list')
        ?.message;
    return windowHint
      ? `无法确认当前前台窗口是唯一微信目标会话。${windowHint}`
      : '无法确认当前前台窗口是唯一微信目标会话。';
  }
  return desktop.message;
}

export function normalizeBatchTargetStatus(
  status: InteractionBatchTarget['status'],
) {
  const allowed: InteractionBatchTarget['status'][] = [
    'queued',
    'running',
    'waiting_confirmation',
    'completed',
    'failed',
    'skipped',
    'no_target',
  ];
  return allowed.includes(status) ? status : 'queued';
}

export function buildBatchSummary(targets: InteractionBatchTarget[] = []) {
  return targets.reduce(
    (summary, target) => {
      summary.total += 1;
      if (target.status === 'queued') summary.queued += 1;
      if (target.status === 'running') summary.running += 1;
      if (target.status === 'waiting_confirmation')
        summary.waitingConfirmation += 1;
      if (target.status === 'completed') summary.completed += 1;
      if (target.status === 'failed') summary.failed += 1;
      if (target.status === 'skipped') summary.skipped += 1;
      if (target.status === 'no_target') summary.noTarget += 1;
      return summary;
    },
    {
      total: 0,
      queued: 0,
      running: 0,
      waitingConfirmation: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      noTarget: 0,
    },
  );
}

export function hasNoInteractionTarget(task: InteractionTask) {
  const emptyMarkers = [
    '无对象',
    '没有对象',
    '暂无对象',
    '无客户',
    '暂无客户',
    '无群',
    '暂无群',
    '无评论',
    '无私信',
    '无素材',
    'empty',
    'none',
    'no target',
  ];
  const haystack = [
    task.targetName,
    task.sourceText,
    task.replyText,
    ...(task.batchTargets || []).flatMap((target) => [
      target.targetName,
      target.sourceText,
      target.replyText,
    ]),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return emptyMarkers.some((marker) => haystack.includes(marker.toLowerCase()));
}

export function defaultNextActionForStatus(status: InteractionTaskStatus) {
  const actions: Record<InteractionTaskStatus, string> = {
    queued: '等待本地引擎领取任务。',
    running: '继续观察执行记录和证据回放。',
    paused: '任务已暂停；如需继续，请创建重试任务。',
    blocked: '任务已阻断；请查看失败原因、阶段日志和证据后重试。',
    cancelled: '已取消的计划不会继续执行。',
    waiting_for_send_confirmation:
      '请在任务卡或待我确认中核对目标、内容和当前窗口。',
    completed: '可回到执行记录查看结果，或导出诊断包留存。',
    failed: '请查看失败原因、阶段日志和证据后重试。',
    skipped: '任务已跳过；如需继续，请创建重试任务。',
    no_target: '无可处理对象；补充对象后重新创建任务。',
  };
  return actions[status];
}

export function taskNeedsBrowserEvidence(task: InteractionTask) {
  return (
    task.executionMode === 'browser-assisted' &&
    !isDesktopInteractionTask(task.type)
  );
}

export function taskNeedsDesktopEvidence(task: InteractionTask) {
  return isDesktopInteractionTask(task.type);
}

/** 可选清洗文本（空/纯空白 → undefined） */
export function optionalTrimmedText(value: unknown): string | undefined {
  const text =
    typeof value === 'string'
      ? value
      : value == null
        ? ''
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : (JSON.stringify(value) ?? '');
  const trimmed = text.trim();
  return trimmed || undefined;
}
