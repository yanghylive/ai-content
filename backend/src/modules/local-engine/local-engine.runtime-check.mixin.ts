// local-engine runtime 服务检查簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 RuntimeCheckHost 接口：
// autoUploadService/configService/browserControl/nodeAgentRuntime 字段 + service 方法。

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';
import type { AutoUploadService } from '../auto-upload/auto-upload.service';
import type { BrowserControlService } from '../runtime/browser-control/browser-control.service';
import type { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import type {
  LocalEngineBrowserStatus,
  LocalEngineCapability,
  LocalEngineRuntimeService,
  UpdateWechatSessionConfirmationInput,
} from './local-engine.types';

/** runtime 服务检查簇的 host 接口：簇方法访问的 service 成员 */
export interface RuntimeCheckHost {
  autoUploadService: AutoUploadService;
  configService: ConfigService;
  browserControl?: BrowserControlService;
  nodeAgentRuntime?: NodeAgentRuntimeService;
  getProjectLogRoot(): string;
  useNodeAgentRuntime(): boolean;
  isPrismaTableMissingError(error: unknown, tableName?: string): boolean;
  wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
    lockCapturedAt?: string;
  };
  checkTcpPort(port: number): Promise<{
    open: boolean;
    message: string;
    pid?: number | null;
  }>;
  checkHttpUrl(
    url: string,
    options?: { attempts?: number; timeoutMs?: number; retryDelayMs?: number },
  ): Promise<{ ok: boolean; message: string }>;
  resolveBrowserSessionPlatformKey(
    platformName: string,
    platformType: number,
  ): string;
}

export function getRuntimeServiceDefinitions(this: RuntimeCheckHost) {
  const logDir = this.getProjectLogRoot();

  return [
    {
      key: 'frontend' as const,
      name: '主系统前端',
      url: 'http://localhost:3010/login',
      port: 3010,
      screenSession: 'ai-content-frontend',
      logPath: join(logDir, 'frontend-3010.log'),
    },
    {
      key: 'backend' as const,
      name: '主系统后端',
      url: 'http://localhost:3011/api/auth/setup-status',
      port: 3011,
      screenSession: 'ai-content-backend',
      logPath: join(logDir, 'backend-3011.log'),
    },
    {
      key: 'agent-s' as const,
      name: this.useNodeAgentRuntime()
        ? 'Agent-S 包内 Node Runtime'
        : 'Agent-S 桌面执行器',
      // Node Runtime 模式下不要求外部 17777 Python sidecar；Agent-S API 由 3011 进程提供。
      url: this.useNodeAgentRuntime()
        ? 'http://localhost:3011/api/agent-s/health'
        : 'http://127.0.0.1:17777/healthz',
      port: this.useNodeAgentRuntime() ? 3011 : 17777,
      screenSession: this.useNodeAgentRuntime()
        ? 'ai-content-backend'
        : 'agent-s',
      logPath: this.useNodeAgentRuntime()
        ? join(logDir, 'backend-3011.log')
        : join(logDir, 'agent-s-17777.log'),
    },
  ];
}

export async function inspectRuntimeService(
  this: RuntimeCheckHost,
  service: Omit<
    LocalEngineRuntimeService,
    'online' | 'managedByScreen' | 'logExists' | 'message' | 'pid'
  >,
  screenSessions: Set<string>,
): Promise<LocalEngineRuntimeService> {
  const isNodeRuntimeAgentS =
    service.key === 'agent-s' && this.useNodeAgentRuntime();
  const httpProbeOptions =
    service.key === 'frontend'
      ? { attempts: 3, timeoutMs: 5000, retryDelayMs: 500 }
      : { attempts: 1, timeoutMs: 1500, retryDelayMs: 0 };
  const [portStatus, httpStatus] = await Promise.all([
    this.checkTcpPort(service.port),
    isNodeRuntimeAgentS
      ? Promise.resolve({
          ok: true,
          message: 'Agent-S API 由 3011 进程内 Node Runtime 提供',
        })
      : this.checkHttpUrl(service.url, httpProbeOptions),
  ]);
  const agentSHealth = isNodeRuntimeAgentS
    ? await this.nodeAgentRuntime?.health()
    : null;
  const nodeRuntimeMissing = isNodeRuntimeAgentS && !this.nodeAgentRuntime;
  const online =
    !nodeRuntimeMissing &&
    portStatus.open &&
    httpStatus.ok &&
    (isNodeRuntimeAgentS ? agentSHealth?.ok === true : true);
  const managedByScreen = screenSessions.has(service.screenSession);
  const logExists = existsSync(service.logPath);

  return {
    ...service,
    online,
    managedByScreen,
    logExists,
    pid: portStatus.pid,
    message: online
      ? `${service.name} 在线${managedByScreen ? '，由 screen 托管' : '，但未检测到托管会话'}`
      : nodeRuntimeMissing
        ? `${service.name} 阻断：NodeAgentRuntimeService 未注入`
        : agentSHealth && !agentSHealth.ok
          ? `${service.name} 阻断：${agentSHealth.reasons?.[0] || agentSHealth.blockers?.[0] || agentSHealth.status}`
          : `${service.name} 不可用：${httpStatus.message || portStatus.message}`,
  };
}

export async function readManagedScreenSessions(
  this: RuntimeCheckHost,
  logDir: string,
) {
  const sessions = new Set<string>();
  await Promise.all(
    [
      ['frontend-3010.pid', 'ai-content-frontend'],
      ['backend-3011.pid', 'ai-content-backend'],
      ['agent-s-17777.pid', 'agent-s'],
    ].map(async ([filename, expectedSession]) => {
      try {
        const content = await readFile(join(logDir, filename), 'utf8');
        if (content.includes(expectedSession)) {
          sessions.add(expectedSession);
        }
      } catch {
        // Missing pid marker means the service may still be running, but not through our script.
      }
    }),
  );

  return sessions;
}

export function checkTcpPort(this: RuntimeCheckHost, port: number) {
  return new Promise<{ open: boolean; message: string; pid?: number | null }>(
    (resolveResult) => {
      const socket = net.createConnection({
        host: '127.0.0.1',
        port,
        timeout: 800,
      });
      socket.once('connect', () => {
        socket.destroy();
        resolveResult({
          open: true,
          message: `端口 ${port} 可连接`,
          pid: null,
        });
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolveResult({
          open: false,
          message: `端口 ${port} 连接超时`,
          pid: null,
        });
      });
      socket.once('error', (error) => {
        resolveResult({ open: false, message: error.message, pid: null });
      });
    },
  );
}

export async function checkHttpUrl(
  this: RuntimeCheckHost,
  url: string,
  options?: { attempts?: number; timeoutMs?: number; retryDelayMs?: number },
) {
  const attempts = Math.max(1, options?.attempts ?? 1);
  const timeoutMs = Math.max(1, options?.timeoutMs ?? 1500);
  const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 0);
  let lastMessage = 'HTTP 请求失败';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // 17777 (Agent-S) 的 /healthz 需要带 x-kaypal-agent-s-token
      // 8001 已下线；其他 (frontend/backend) 用 Accept-only
      const headers: Record<string, string> = {
        Accept: 'application/json,text/html,*/*',
      };
      if (url.includes('127.0.0.1:17777') || url.includes('localhost:17777')) {
        const token =
          this.configService?.get<string>('KAYPAL_AGENT_S_TOKEN') || '';
        if (token) {
          headers['x-kaypal-agent-s-token'] = token;
        }
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      return {
        ok: response.ok,
        message: response.ok ? 'HTTP 可访问' : `HTTP ${response.status}`,
      };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : 'HTTP 请求失败';
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  return {
    ok: false,
    message: lastMessage,
  };
}

export async function getBrowserStatus(
  this: RuntimeCheckHost,
): Promise<LocalEngineBrowserStatus> {
  const checkedAt = new Date().toISOString();
  const health = await this.autoUploadService.getHealth().catch((error) => ({
    online: false,
    service: 'ai-content local browser runtime',
    version: 'unknown',
    message: error instanceof Error ? error.message : 'HTTP 请求失败',
  }));
  try {
    // 高频轮询接口：不触发账号验证（validate 会打开浏览器+带到前台导致窗口乱跳）。
    // 状态由 CDP 会话映射（只读）提供，登录态变化由用户手动刷新/账号页触发。
    const accounts = await this.autoUploadService.listAccounts();
    const cdpSessions = await this.autoUploadService
      .getCdpSessions()
      .catch(() => null);
    const sessionByAccount = new Map(
      (cdpSessions?.sessions || []).map((session) => [
        `${session.platform}:${String(session.accountId)}`,
        session,
      ]),
    );
    const mappedAccounts = accounts.map((account) => {
      const platformKey = this.resolveBrowserSessionPlatformKey(
        account.platform,
        account.type,
      );
      const session = sessionByAccount.get(
        `${platformKey}:${String(account.id)}`,
      );
      const sessionStatus = session?.status;
      const status:
        | 'ready'
        | 'expired'
        | 'needs_login'
        | 'blocked'
        | 'unverified' =
        sessionStatus === 'ready'
          ? 'ready'
          : sessionStatus === 'needs_login' ||
              sessionStatus === 'blocked' ||
              sessionStatus === 'stopped'
            ? sessionStatus === 'stopped'
              ? 'blocked'
              : sessionStatus
            : account.status === 1
              ? 'unverified'
              : 'expired';
      const statusLabel =
        status === 'ready'
          ? '已登录'
          : status === 'needs_login'
            ? '需要重新登录'
            : status === 'blocked'
              ? '浏览器阻断'
              : status === 'unverified'
                ? '待确认登录'
                : account.statusLabel;
      return {
        id: account.id,
        platform: account.platform,
        type: account.type,
        displayName:
          account.profileName || account.userName || `账号 ${account.id}`,
        status,
        statusLabel,
        filePath: account.filePath,
        avatarUrl: account.avatarUrl,
        currentUrl: session?.currentUrl ?? null,
        lastError: session?.lastError ?? null,
        nextAction:
          status === 'needs_login'
            ? `请在已打开的 ${account.platform} 后台重新登录。`
            : status === 'blocked'
              ? session?.lastError || '请先恢复本地浏览器 Runtime。'
              : status === 'unverified'
                ? `请打开 ${account.platform} 后台，等待页面进入平台管理后台后刷新。`
                : undefined,
      };
    });

    return {
      checkedAt,
      engineOnline: health.online,
      engineMessage: `${health.service} ${health.version} 在线`,
      totalAccounts: mappedAccounts.length,
      readyAccounts: mappedAccounts.filter(
        (account) => account.status === 'ready',
      ).length,
      expiredAccounts: mappedAccounts.filter(
        (account) => account.status === 'expired',
      ).length,
      accounts: mappedAccounts,
      recovery: {
        waitingTasks: 0,
        resumableTasks: 0,
        nextAction: mappedAccounts.some(
          (account) => account.status === 'expired',
        )
          ? '存在失效账号，请到平台账号页重新登录后恢复阻断任务。'
          : mappedAccounts.some((account) => account.status === 'needs_login')
            ? '存在需要重新登录的平台账号，请在已打开的平台后台完成登录后刷新。'
            : mappedAccounts.some((account) => account.status === 'blocked')
              ? '存在浏览器阻断账号，请先恢复本地浏览器 Runtime。'
              : mappedAccounts.some(
                    (account) => account.status === 'unverified',
                  )
                ? '存在待确认登录的平台账号，请先打开平台后台确认登录态。'
                : '账号状态正常。',
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const tableMissing = this.isPrismaTableMissingError(
      error,
      'publish_accounts',
    );
    return {
      checkedAt,
      engineOnline: Boolean(health.online),
      engineMessage: health.online
        ? tableMissing
          ? `${health.service} ${health.version} 在线；平台账号表正在自修复，当前微信本机任务不依赖该表。`
          : `${health.service} ${health.version} 在线；平台账号读取失败：${message}`
        : `浏览器控制不可用：${'message' in health ? health.message : message}`,
      totalAccounts: 0,
      readyAccounts: 0,
      expiredAccounts: 0,
      accounts: [],
      recovery: {
        waitingTasks: 0,
        resumableTasks: 0,
        nextAction: health.online
          ? tableMissing
            ? '本机数据库会在下次启动自动补齐 publish_accounts；抖音/小红书/视频号任务需要平台账号，微信桌面任务可继续。'
            : '检查平台账号表、CDP 会话和发布账号登录态；微信桌面任务不依赖平台账号。'
          : '先启动发布服务 本地浏览器引擎，再刷新账号状态。',
      },
    };
  }
}

export function resolveBrowserSessionPlatformKey(
  this: RuntimeCheckHost,
  platformName: string,
  platformType: number,
) {
  if (platformType === 2) return 'wechat-channel';
  if (platformType === 3) return 'douyin';
  if (platformType === 4) return 'kuaishou';
  if (platformType === 1) return 'xiaohongshu';
  if (platformType === 5) return 'bilibili';
  if (platformName === '视频号') return 'wechat-channel';
  if (platformName === '抖音') return 'douyin';
  if (platformName === '快手') return 'kuaishou';
  if (platformName === '小红书') return 'xiaohongshu';
  if (platformName === 'B站') return 'bilibili';
  return platformName;
}

export function checkRequiredPlatformAccounts(
  this: RuntimeCheckHost,
  browserStatus: LocalEngineBrowserStatus,
  capabilities: LocalEngineCapability[] = [],
) {
  const executorCapability = capabilities.find(
    (capability) => capability.key === 'interaction-capabilities',
  );
  const readyExecutorText =
    executorCapability?.checks?.find((check) => check.name === '就绪率')
      ?.message || '';
  const requiredPlatforms = [
    {
      key: 'douyin',
      label: '抖音',
      executorKeys: ['douyin-comment-reply', 'douyin-direct-message-reply'],
    },
    {
      key: 'wechat-channel',
      label: '视频号',
      executorKeys: [
        'wechat-channel-comment-reply',
        'wechat-channel-direct-message-reply',
      ],
    },
  ];
  const missing = requiredPlatforms.filter(
    (platform) =>
      !browserStatus.accounts.some(
        (account) =>
          this.resolveBrowserSessionPlatformKey(
            account.platform,
            account.type,
          ) === platform.key && account.status === 'ready',
      ) &&
      !platform.executorKeys.every((executorKey) =>
        readyExecutorText.includes(executorKey),
      ),
  );
  if (!missing.length) {
    return {
      ready: true,
      message: '抖音和视频号账号均有可用登录态。',
      nextAction: '',
    };
  }
  return {
    ready: false,
    message: `缺少可用的必需平台账号：${missing
      .map((platform) => platform.label)
      .join('、')}。`,
    nextAction: '请到发布中心的平台账号页重新登录或校验抖音、视频号账号状态。',
  };
}

export function isWechatReadinessSessionLocked(
  this: RuntimeCheckHost,
  capabilities: LocalEngineCapability[] = [],
) {
  const interactionCapability = capabilities.find(
    (capability) => capability.key === 'interaction-capabilities',
  );
  const readyText =
    interactionCapability?.checks?.find((check) => check.name === '就绪率')
      ?.message || '';
  const wechatExecutorReady = [
    'wechat-reply-draft',
    'wechat-group-broadcast',
    'wechat-contact-add',
    'wechat-moments-publish',
    'wechat-moments-marketing',
  ].every((executorKey) => readyText.includes(executorKey));
  return (
    wechatExecutorReady &&
    Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
    this.wechatSessionConfirmation.currentWindowConfirmed === true &&
    this.wechatSessionConfirmation.contactConfirmed === true &&
    this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
    this.wechatSessionConfirmation.contactAmbiguityResolved === true &&
    this.wechatSessionConfirmation.takeoverActive !== true &&
    !this.wechatSessionConfirmation.stoppedAt
  );
}

export const runtimeCheckMethods = {
  getRuntimeServiceDefinitions,
  inspectRuntimeService,
  readManagedScreenSessions,
  checkTcpPort,
  checkHttpUrl,
  getBrowserStatus,
  resolveBrowserSessionPlatformKey,
  checkRequiredPlatformAccounts,
  isWechatReadinessSessionLocked,
};
