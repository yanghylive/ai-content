/**
 * capabilities 能力簇 mixin（能力聚合/检查/文件访问）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { KaypalModelSyncService } from '../ai-models/kaypal-model-sync.service';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';

import { AgentSidecarService } from './agent-sidecar.service';
import {
  isDesktopWechatExecutionReady,
  summarizeDesktopWechatBlocker,
} from './local-engine.utils';
import { McpRuntimeService } from './mcp-runtime.service';
import { MemoryRuntimeService } from './memory-runtime.service';
import {
  PlaywrightMcpService,
  type PlaywrightMcpStatus,
} from './playwright-mcp.service';
import { PluginRuntimeService } from './plugin-runtime.service';
import { SandboxRuntimeService } from './sandbox-runtime.service';
import type {
  LocalEngineCapability,
  LocalEngineCapabilityStatus,
  LocalEngineDesktopScreenshotEvidence,
  LocalEngineDesktopStatus,
  LocalEngineEntitlementUser,
  LocalEngineExecutorsStatus,
  UpdateWechatSessionConfirmationInput,
} from './local-engine.types';

/** capabilities 簇的 host 接口 */
export interface CapabilitiesHost {
  agentSidecar: AgentSidecarService;
  kaypalModelSync?: KaypalModelSyncService;
  mcpRuntime: McpRuntimeService;
  memoryRuntime: MemoryRuntimeService;
  playwrightMcp?: PlaywrightMcpService;
  pluginRuntime: PluginRuntimeService;
  prisma: PrismaService;
  runtimeOrchestrator?: RuntimeOrchestrator;
  sandboxRuntime: SandboxRuntimeService;
  wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
  };
  getCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]>;
  checkAutoUploadEngine();
  checkInteractionCapabilities(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  checkContentPublishingCapability(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  checkEvidenceReplayCapability(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  checkAiReplyModelConfig(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  withKaypalModelSyncHint(result: {
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }): {
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  };
  checkFileAccess(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction?: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  withCapabilityTimeout<T>(
    name: string,
    promise: Promise<T>,
    fallback: T,
    timeoutMs?: unknown,
  ): Promise<T>;
  buildDesktopStatus(
    desktop: Awaited<ReturnType<typeof this.readWechatDesktopStatus>>,
    checkedAt: string,
    screenshot?: LocalEngineDesktopScreenshotEvidence,
  ): LocalEngineDesktopStatus;
  buildKaypalEntitlementCapability(
    now: string,
    explicitUser?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability>;
  buildKaypalEntitlementTimeoutFallback(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): LocalEngineCapability;
  buildLegacyAgentSCapability(
    now: string,
    sidecarStatus: Awaited<ReturnType<AgentSidecarService['getStatus']>>,
  ): LocalEngineCapability;
  buildNodeAgentRuntimeCapability(
    now: string,
    sidecarMessage?: unknown,
  ): Promise<LocalEngineCapability>;
  getPlaywrightMcpStatusWithCount(): Promise<PlaywrightMcpStatus>;
  getRequiredInteractionExecutorIdsForCurrentHost(): string[];
  getUnsupportedInteractionExecutorIdsForCurrentHost(): string[];
  hasWechatControlSurfaceEvidence(desktop: LocalEngineDesktopStatus): boolean;
  isDesktopWechatRuntimeRunnable(desktop: LocalEngineDesktopStatus): boolean;
  isPrismaTableMissingError(error: unknown, tableName?: string): boolean;
  loadExecutorsStatus(): Promise<LocalEngineExecutorsStatus>;
  readDesktopStatusWithEvidenceCached(
    checkedAt: string,
    ttlMs?: unknown,
  ): Promise<LocalEngineDesktopStatus>;
  resolveLocalRuntimePaths(): {
    root: string;
    materials: string;
    cookies: string;
    browserProfiles: string;
    evidence: string;
    screenshots: string;
    logs: string;
  };
  useNodeAgentRuntime(): boolean;
}

export async function getCapabilities(
  this: CapabilitiesHost,
  now: string,
  user?: LocalEngineEntitlementUser,
): Promise<LocalEngineCapability[]> {
  const useNodeRuntime = this.useNodeAgentRuntime();
  const [
    interactionCapabilities,
    publishingCapability,
    kaypalEntitlement,
    aiReplyModel,
    evidenceReplay,
    fileAccess,
    _mcpStatus,
    playwrightMcpStatus,
    sidecarStatus,
    sandboxStatus,
    pluginStatus,
    memoryStatus,
  ] = await Promise.all([
    this.withCapabilityTimeout(
      '互动接口能力',
      this.checkInteractionCapabilities(),
      {
        status: 'blocked' as const,
        summary: '互动接口能力检查超时。',
        nextAction: '刷新状态或重启本地浏览器控制服务后重试。',
        checks: [
          {
            name: '互动能力接口',
            status: 'blocked' as const,
            message: '检查超过 8 秒，不能证明真实互动执行器可用。',
          },
        ],
      },
      8000,
    ),
    this.withCapabilityTimeout(
      '内容发布能力',
      this.checkContentPublishingCapability(),
      {
        status: 'blocked' as const,
        summary: '内容发布能力检查超时。',
        nextAction: '刷新状态或重启 3011 本地 Runtime 后重试。',
        checks: [
          {
            name: '发布执行器',
            status: 'blocked' as const,
            message: '检查超过 2 秒，不能证明内容发布执行器可用。',
          },
        ],
      },
    ),
    this.withCapabilityTimeout(
      'Kaypal 账号与权益',
      this.buildKaypalEntitlementCapability(now, user),
      this.buildKaypalEntitlementTimeoutFallback(now, user),
      6000,
    ),
    this.withCapabilityTimeout('AI 回复模型', this.checkAiReplyModelConfig(), {
      status: 'blocked' as const,
      summary: 'AI 默认模型检查超时。',
      nextAction: '稍后刷新，或到模型配置页重新同步 Kaypal 模型台。',
      checks: [
        {
          name: '默认模型配置读取',
          status: 'blocked' as const,
          message: '检查超过 2 秒，不能证明 AI 模型授权/配置可用。',
        },
      ],
    }),
    this.withCapabilityTimeout(
      '证据链与回放',
      this.checkEvidenceReplayCapability(),
      {
        status: 'blocked' as const,
        summary: '证据链检查超时。',
        nextAction: '检查本地证据目录、任务记录表和 RuntimeExecution 表。',
        checks: [
          {
            name: '证据链检查',
            status: 'blocked' as const,
            message: '检查超过 8 秒，不能证明证据和诊断记录可用。',
          },
        ],
      },
      8000,
    ),
    this.withCapabilityTimeout(
      '文件访问',
      this.checkFileAccess(),
      {
        status: 'blocked' as const,
        summary: '文件访问检查超时。',
        nextAction: '检查本地目录权限后刷新。',
        checks: [
          {
            name: '目录读写检查',
            status: 'blocked' as const,
            message: '检查超过 8 秒，不能证明素材、账号档案和证据目录可读写。',
          },
        ],
      },
      8000,
    ),
    this.withCapabilityTimeout(
      'MCP 工具服务管理',
      Promise.resolve(this.mcpRuntime.getStatus()),
      {
        available: false,
        serverCount: 0,
        toolCount: 0,
        resourceCount: 0,
        strictMode: false,
        servers: [],
        message: 'MCP 状态检查超时',
      },
    ),
    this.withCapabilityTimeout(
      'playwright-mcp',
      this.getPlaywrightMcpStatusWithCount(),
      {
        online: false,
        childProcessRunning: Boolean(
          this.playwrightMcp?.getStatus().childProcessRunning,
        ),
        transport: 'none' as const,
        endpoint: '',
        pid: this.playwrightMcp?.getStatus().pid,
        toolCount: 0,
        profileKey: this.playwrightMcp?.getStatus().profileKey,
        profileDir: this.playwrightMcp?.getStatus().profileDir,
        visibleWindow: this.playwrightMcp?.getStatus().visibleWindow ?? false,
        isolated: this.playwrightMcp?.getStatus().isolated ?? false,
        message: 'playwright-mcp 工具发现超时',
      },
    ),
    useNodeRuntime
      ? Promise.resolve({
          available: false,
          version: null,
          runnerMode: null,
          sessionProtocol: false,
          eventStream: false,
          screenshotArtifacts: false,
          executionControl: false,
          message:
            'Node Runtime 模式下外部 17777 Python sidecar 为可选兼容项，未参与必需检查。',
        })
      : this.withCapabilityTimeout(
          'Agent-S 执行能力',
          this.agentSidecar.getStatus(),
          {
            available: false,
            version: null,
            runnerMode: null,
            sessionProtocol: false,
            eventStream: false,
            screenshotArtifacts: false,
            executionControl: false,
            message: 'Agent-S sidecar 状态检查超时',
          },
        ),
    this.withCapabilityTimeout(
      '沙箱执行',
      Promise.resolve(this.sandboxRuntime.getStatus()),
      {
        available: false,
        platform: platform(),
        dockerAvailable: false,
        sandboxType: 'none',
        message: '沙箱运行时检查超时',
      },
    ),
    this.withCapabilityTimeout(
      '插件与技能运行时',
      this.pluginRuntime.getStatus(),
      {
        available: false,
        skillDirectory: null,
        skillhubDirectory: null,
        skillhubSkills: [],
        installedSkillCount: 0,
        skillNames: [],
        runtimeApiAvailable: false,
        message: '插件运行时检查超时',
      },
    ),
    this.withCapabilityTimeout('记忆与上下文', this.memoryRuntime.getStatus(), {
      available: false,
      shortTermAvailable: false,
      dailyAvailable: false,
      longTermAvailable: false,
      runtimeApiAvailable: false,
      message: '记忆运行时检查超时',
    }),
  ]);
  const desktop = await this.withCapabilityTimeout(
    '桌面微信',
    this.readDesktopStatusWithEvidenceCached(now),
    this.buildDesktopStatus(
      {
        platform: 'wechat',
        available: false,
        running: false,
        appName: '微信',
        windowCount: 0,
        message: '桌面微信状态检查超时。',
        permissionHints: ['检查超过 4 秒，不能证明微信桌面链路可用。'],
        screenshotAvailable: false,
        inputControlAvailable: false,
        clickControlAvailable: false,
        fileSelectionAvailable: false,
      },
      now,
    ),
    4000,
  );
  const wechatDesktopReady = isDesktopWechatExecutionReady(desktop);
  const wechatDesktopRunnable = this.isDesktopWechatRuntimeRunnable(desktop);
  const wechatCommerciallyRunnable =
    wechatDesktopRunnable && this.hasWechatControlSurfaceEvidence(desktop);
  const wechatDesktopBlocker = summarizeDesktopWechatBlocker(desktop);
  const wechatSessionLocked =
    wechatDesktopReady &&
    Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
    this.wechatSessionConfirmation.currentWindowConfirmed === true &&
    this.wechatSessionConfirmation.contactConfirmed === true &&
    this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
    this.wechatSessionConfirmation.takeoverActive !== true &&
    !this.wechatSessionConfirmation.stoppedAt;
  const agentSCapability = useNodeRuntime
    ? await this.buildNodeAgentRuntimeCapability(now, sidecarStatus.message)
    : this.buildLegacyAgentSCapability(now, sidecarStatus);

  return [
    {
      key: 'browser-control',
      name: '浏览器引擎',
      status: playwrightMcpStatus.readyForAutomation ? 'ready' : 'blocked',
      required: true,
      summary: playwrightMcpStatus.readyForAutomation
        ? `浏览器控制已就绪，可通过 3011 Node Runtime/CDP/Playwright 操作平台后台（tools=${playwrightMcpStatus.toolCount ?? 0}）。`
        : '浏览器自动化工具未就绪，不能执行真实平台读取、发送和回读。',
      checkedAt: now,
      nextAction: playwrightMcpStatus.readyForAutomation
        ? ''
        : '检查包内 Playwright Chromium、@playwright/mcp、工具发现和 3011 启动日志。',
      checks: [
        {
          name: 'playwright-mcp',
          status: playwrightMcpStatus.readyForAutomation ? 'ready' : 'blocked',
          message: playwrightMcpStatus.message,
        },
        {
          name: '必需浏览器工具',
          status: playwrightMcpStatus.requiredToolsReady ? 'ready' : 'blocked',
          message: playwrightMcpStatus.requiredToolsReady
            ? `${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具已发现。`
            : `缺少必需工具：${(playwrightMcpStatus.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
        },
      ],
    },
    {
      key: 'interaction-capabilities',
      name: '真实互动执行器',
      status: interactionCapabilities.status,
      required: true,
      summary: interactionCapabilities.summary,
      checkedAt: now,
      nextAction: interactionCapabilities.nextAction,
      checks: interactionCapabilities.checks,
    },
    {
      key: 'content-publishing',
      name: '内容发布执行器',
      status: publishingCapability.status,
      required: true,
      summary: publishingCapability.summary,
      checkedAt: now,
      nextAction: publishingCapability.nextAction,
      checks: publishingCapability.checks,
    },
    kaypalEntitlement,
    {
      key: 'ai-reply-model',
      name: 'AI 回复模型',
      status: aiReplyModel.status,
      required: true,
      summary: aiReplyModel.summary,
      checkedAt: now,
      nextAction: aiReplyModel.nextAction,
      checks: aiReplyModel.checks,
    },
    {
      key: 'desktop-control',
      name: '桌面控制',
      status:
        wechatDesktopReady || wechatCommerciallyRunnable ? 'ready' : 'blocked',
      required: true,
      summary:
        wechatDesktopReady || wechatCommerciallyRunnable
          ? `桌面微信可控，当前窗口：${desktop.window.currentWindowTitle || '已检测到微信窗口'}。`
          : `桌面微信不可用：${wechatDesktopBlocker}`,
      checkedAt: now,
      nextAction:
        wechatDesktopReady || wechatCommerciallyRunnable
          ? '桌面微信已具备执行条件，微信任务会按自动/受控执行规则推进。'
          : desktop.nextAction,
      checks: desktop.permissionChecks.map((check) => ({
        name: check.label,
        status: check.status,
        message: check.message,
      })),
    },
    {
      key: 'mcp-manager',
      name: 'Playwright/MCP 工具',
      status: playwrightMcpStatus.readyForAutomation ? 'ready' : 'blocked',
      required: true,
      summary: playwrightMcpStatus.readyForAutomation
        ? `playwright-mcp sidecar 在线（${playwrightMcpStatus.message}）`
        : 'playwright-mcp 未运行；真实浏览器自动化工具不可用。',
      checkedAt: now,
      nextAction: playwrightMcpStatus.readyForAutomation
        ? `MCP 端点 ${playwrightMcpStatus.endpoint} 暴露 ${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具；任何 MCP 客户端（Claude/Cursor/Agent-S）都能通过 POST 调。`
        : '检查 PlaywrightMcpService 初始化日志（一般在 nest-start.log 顶部）',
      checks: [
        {
          name: 'sidecar 进程',
          status: playwrightMcpStatus.childProcessRunning ? 'ready' : 'blocked',
          message: playwrightMcpStatus.childProcessRunning
            ? `本地 @playwright/mcp 子进程运行中 (pid=${playwrightMcpStatus.pid ?? '?'})`
            : '子进程未启动',
        },
        {
          name: 'HTTP 端点',
          status: playwrightMcpStatus.online ? 'ready' : 'blocked',
          message: `${playwrightMcpStatus.endpoint} (${playwrightMcpStatus.transport})`,
        },
        {
          name: '工具发现',
          status: playwrightMcpStatus.requiredToolsReady ? 'ready' : 'blocked',
          message: playwrightMcpStatus.requiredToolsReady
            ? `${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具已暴露 (browser_navigate/click/type/snapshot/screenshot 等)`
            : `缺少必需工具：${(playwrightMcpStatus.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
        },
      ],
    },
    agentSCapability,
    {
      key: 'wechat-execution',
      name: '微信完整执行链',
      status:
        wechatDesktopReady || wechatCommerciallyRunnable ? 'ready' : 'blocked',
      required: true,
      summary:
        wechatDesktopReady || wechatCommerciallyRunnable
          ? '微信会话、回复、群发、加好友、朋友圈发布和朋友圈营销都已接入本机桌面执行链。'
          : `微信执行链未就绪：${wechatDesktopBlocker}`,
      checkedAt: now,
      nextAction:
        wechatDesktopReady || wechatCommerciallyRunnable
          ? '创建微信任务后，系统会回读目标、内容和当前窗口，条件通过后继续执行。'
          : desktop.nextAction,
      checks: [
        {
          name: '微信进程检测',
          status: desktop.running ? 'ready' : 'blocked',
          message: desktop.running
            ? `${desktop.appName || '微信'} 已运行。`
            : '桌面微信未运行。',
        },
        {
          name: '联系人锁定',
          status: wechatSessionLocked
            ? 'ready'
            : wechatDesktopReady || wechatCommerciallyRunnable
              ? 'warning'
              : 'blocked',
          message: wechatSessionLocked
            ? `当前已锁定：${this.wechatSessionConfirmation.targetContact?.trim()}。`
            : wechatDesktopReady || wechatCommerciallyRunnable
              ? '已取得可信微信窗口证据；当前未锁定具体联系人，按商用测试账号受控执行风险提示处理。'
              : '桌面微信未就绪，不能锁定联系人或群聊。',
        },
        {
          name: '执行保护',
          status:
            wechatDesktopReady || wechatCommerciallyRunnable
              ? 'ready'
              : 'blocked',
          message:
            '回复、群发、加好友和朋友圈动作会在自动/受控执行后写入截图、失败原因和任务记录。',
        },
      ],
    },
    {
      key: 'remote-control',
      name: '远程控制',
      status: 'optional',
      required: false,
      summary:
        '远程控制不纳入当前 AI 员工主流程，已保留接管审计和会话证据记录。',
      checkedAt: now,
      nextAction: '',
      checks: [
        {
          name: '远程会话',
          status: 'optional',
          message: '当前以本机执行和任务记录为主；远程接管只保留审计记录。',
        },
        {
          name: '用户接管审计',
          status: 'ready',
          message:
            'Agent 会话已包含 remoteTakeoverAuditRequired 和 remoteAudit，确认/拒绝会写入审批日志。',
        },
      ],
    },
    {
      key: 'plugin-runtime',
      name: '插件与技能运行时',
      status: pluginStatus.available ? 'ready' : 'optional',
      required: false,
      summary: pluginStatus.message,
      checkedAt: now,
      nextAction: pluginStatus.available
        ? `已发现 ${pluginStatus.installedSkillCount} 个本地技能、${pluginStatus.skillhubSkills.filter((skill) => skill.installed).length} 个 SkillHub 技能。`
        : '当前主流程使用已注册的本机执行链；需要扩展插件时再安装本地技能。',
      checks: [
        {
          name: '插件目录',
          status: pluginStatus.installedSkillCount > 0 ? 'ready' : 'optional',
          message:
            pluginStatus.installedSkillCount > 0
              ? `${pluginStatus.installedSkillCount} 个技能已安装于 ${pluginStatus.skillDirectory}。`
              : '未找到技能目录或目录为空。',
        },
        {
          name: 'SkillHub 技能',
          status: pluginStatus.skillhubSkills.some((skill) => skill.ready)
            ? 'ready'
            : pluginStatus.skillhubSkills.some((skill) => skill.installed)
              ? 'warning'
              : 'optional',
          message:
            pluginStatus.skillhubSkills
              .filter((skill) => skill.installed)
              .map(
                (skill) =>
                  `${skill.slug}${skill.ready ? ' 可执行' : ` 缺命令：${skill.missingCommands.join('、')}`}`,
              )
              .join('；') || '未安装 SkillHub 技能。',
        },
        {
          name: '插件运行',
          status: pluginStatus.runtimeApiAvailable ? 'ready' : 'optional',
          message: pluginStatus.runtimeApiAvailable
            ? 'Runtime API 在线，支持 commands、agents、hooks 执行。'
            : 'Runtime API 不可用，插件执行功能受限。',
        },
      ],
    },
    {
      key: 'memory-context',
      name: '记忆与上下文',
      status: memoryStatus.available ? 'ready' : 'optional',
      required: false,
      summary: memoryStatus.message,
      checkedAt: now,
      nextAction: memoryStatus.available
        ? '记忆系统已接入，支持消息历史和上下文管理。'
        : '当前按任务记录和操作证据保存上下文；需要长期记忆时再连接记忆服务。',
      checks: [
        {
          name: '消息历史',
          status:
            memoryStatus.shortTermAvailable || memoryStatus.dailyAvailable
              ? 'ready'
              : 'optional',
          message:
            memoryStatus.shortTermAvailable || memoryStatus.dailyAvailable
              ? `消息历史存储可用（${memoryStatus.shortTermAvailable ? '短期' : ''}${memoryStatus.shortTermAvailable && memoryStatus.dailyAvailable ? '+' : ''}${memoryStatus.dailyAvailable ? '日常' : ''}）。`
              : '消息历史存储不可用。',
        },
        {
          name: '上下文压缩',
          status: memoryStatus.longTermAvailable ? 'ready' : 'optional',
          message: memoryStatus.longTermAvailable
            ? '长期记忆和上下文压缩通过向量库支持。'
            : '向量库不可用，上下文压缩功能受限。',
        },
      ],
    },
    {
      key: 'sandbox-execution',
      name: '沙箱执行',
      status: sandboxStatus.available ? 'ready' : 'optional',
      required: false,
      summary: sandboxStatus.message,
      checkedAt: now,
      nextAction: sandboxStatus.available
        ? `沙箱类型：${sandboxStatus.sandboxType}，平台：${sandboxStatus.platform}。`
        : 'Docker 沙箱为后续或可选能力，小白安装包不要求用户安装 Docker。',
      checks: [
        {
          name: '平台适配',
          status: sandboxStatus.available ? 'ready' : 'optional',
          message: sandboxStatus.available
            ? `平台 ${sandboxStatus.platform}，沙箱类型 ${sandboxStatus.sandboxType}。`
            : '当前平台不支持沙箱执行。',
        },
        {
          name: '执行边界',
          status: sandboxStatus.available ? 'ready' : 'optional',
          message: sandboxStatus.available
            ? '命令、文件、路径操作的沙箱边界已通过 Docker/native 隔离。'
            : '等待沙箱运行时接入。',
        },
      ],
    },
    {
      key: 'evidence-replay',
      name: '证据链与回放',
      status: evidenceReplay.status,
      required: true,
      summary: evidenceReplay.summary,
      checkedAt: now,
      nextAction: evidenceReplay.nextAction,
      checks: evidenceReplay.checks,
    },
    {
      key: 'file-access',
      name: '文件访问',
      status: fileAccess.status === 'warning' ? 'blocked' : fileAccess.status,
      required: true,
      summary: fileAccess.summary,
      checkedAt: now,
      nextAction: fileAccess.nextAction,
      checks: fileAccess.checks.map((check) => ({
        ...check,
        status: check.status === 'warning' ? 'blocked' : check.status,
      })),
    },
    {
      key: 'permission-check',
      name: '权限检查',
      status: 'ready',
      required: true,
      summary:
        '已接入试用/商用边界、角色审批、白名单、禁止动作和误发误删保护字段。',
      checkedAt: now,
      nextAction: '',
      checks: [
        {
          name: '试用/商用权限',
          status: 'ready',
          message:
            '任务和 Agent 会话已返回 safetyBoundary、riskPolicy、requiredChecks。',
        },
        {
          name: '禁止动作',
          status: 'ready',
          message: '已配置禁止动作列表，高风险操作需要确认。',
        },
      ],
    },
  ];
}

export async function checkAutoUploadEngine(this: CapabilitiesHost) {
  // 2026-06-04: 5409 已下线；改查 playwright-mcp sidecar (in-process)
  if (!this.playwrightMcp) {
    return {
      ok: false,
      message: 'PlaywrightMcpService 未注入（无浏览器引擎可用）',
    };
  }
  try {
    const status = await this.playwrightMcp.getAutomationStatus();
    if (status.readyForAutomation) {
      return {
        ok: true,
        message: `in-process Chrome via playwright-mcp 已就绪 (pid=${status.pid ?? '?'}, ${status.endpoint}, tools=${status.toolCount ?? 0})`,
      };
    }
    return {
      ok: false,
      message: `playwright-mcp 未达到真实自动化标准：${status.message}${
        status.missingRequiredTools?.length
          ? `；缺少工具 ${status.missingRequiredTools.join(', ')}`
          : ''
      }`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return { ok: false, message: `playwright-mcp 状态检查失败：${message}` };
  }
}

export async function checkInteractionCapabilities(this: CapabilitiesHost) {
  try {
    const status = await this.loadExecutorsStatus();
    const requiredExecutorIds =
      this.getRequiredInteractionExecutorIdsForCurrentHost();
    const unsupportedExecutorIds =
      this.getUnsupportedInteractionExecutorIdsForCurrentHost();
    const requiredExecutors = status.executors.filter((executor) =>
      requiredExecutorIds.includes(String(executor.key)),
    );
    const missingIds = requiredExecutorIds.filter(
      (id) => !requiredExecutors.some((executor) => executor.key === id),
    );
    const ready = requiredExecutors.filter(
      (executor) => executor.status === 'ready',
    ).length;
    const awaitingConfirmation = requiredExecutors.filter(
      (executor) => executor.status === 'preflight_only',
    ).length;
    const readyTaskNames = requiredExecutors
      .filter(
        (executor) =>
          executor.status === 'ready' || executor.status === 'preflight_only',
      )
      .map((executor) => String(executor.key))
      .join('、');
    const taskNames = requiredExecutors
      .map((executor) => String(executor.key))
      .join('、');
    const hasExecutors =
      requiredExecutors.length === requiredExecutorIds.length;
    const allReady = hasExecutors && ready === requiredExecutors.length;
    const allRunnable =
      hasExecutors &&
      requiredExecutors.every(
        (executor) =>
          executor.status === 'ready' || executor.status === 'preflight_only',
      );
    const unsupportedMessage = unsupportedExecutorIds.length
      ? `；${process.platform} 本机不把 ${unsupportedExecutorIds.join(
          '、',
        )} 算入必需范围，这些微信操作需要在支持的桌面系统单独验收`
      : '';

    return {
      status: allReady
        ? ('ready' as const)
        : allRunnable
          ? ('warning' as const)
          : ('blocked' as const),
      summary:
        requiredExecutors.length === 0
          ? '未发现客户互动执行能力。'
          : allRunnable
            ? `客户互动能力已接通：${ready} 项可直接运行，${awaitingConfirmation} 项需要先确认目标会话${unsupportedMessage}。`
            : `客户互动能力 ${ready}/${requiredExecutorIds.length} 项可用：${taskNames || '无'}${unsupportedMessage}。`,
      nextAction: allReady
        ? unsupportedExecutorIds.length
          ? '抖音、视频号互动能力已可用；桌面微信群发、加好友和朋友圈请在支持的桌面系统验收。'
          : '抖音、视频号和桌面微信互动执行器已注册并可调度。'
        : allRunnable
          ? '微信任务选择目标会话并完成发送前确认后即可执行，不需要安装其他组件。'
          : '部分客户互动能力不可用；请检查平台账号登录状态和本地执行服务。',
      checks: [
        {
          name: '客户互动能力',
          status: hasExecutors ? ('ready' as const) : ('blocked' as const),
          message: `${requiredExecutors.length}/${requiredExecutorIds.length} 项已接入：${taskNames || '无'}${missingIds.length ? `；缺少 ${missingIds.join('、')}` : ''}`,
        },
        {
          name: '就绪率',
          status: allReady
            ? ('ready' as const)
            : allRunnable
              ? ('warning' as const)
              : ('blocked' as const),
          message: `${ready}/${requiredExecutorIds.length} 项可直接运行，${awaitingConfirmation} 项等待目标确认：${readyTaskNames || '无'}`,
        },
        ...(unsupportedExecutorIds.length
          ? [
              {
                name: '桌面微信写入能力',
                status: 'warning' as const,
                message: `${unsupportedExecutorIds.join(
                  '、',
                )} 当前系统不支持真实操作，只保留执行前检查。`,
              },
            ]
          : []),
        {
          name: '执行路径',
          status: allRunnable ? ('ready' as const) : ('blocked' as const),
          message:
            process.platform === 'darwin'
              ? '浏览器平台使用本机浏览器；桌面微信使用 Mac 微信自动化与结果留存。'
              : process.platform === 'win32'
                ? '浏览器平台使用本机浏览器；桌面微信使用 Windows 微信组件与结果留存。'
                : '浏览器平台使用本机浏览器；桌面微信在当前系统仅做执行前检查。',
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return {
      status: 'blocked' as const,
      summary: `发布服务未返回互动能力清单：${message}`,
      nextAction: '请升级或重启 3011 本地 Runtime，并确认互动能力清单可用。',
      checks: [
        {
          name: '互动能力接口',
          status: 'blocked' as const,
          message,
        },
      ],
    };
  }
}

export async function checkContentPublishingCapability(
  this: CapabilitiesHost,
): Promise<{
  status: LocalEngineCapabilityStatus;
  summary: string;
  nextAction: string;
  checks: Array<{
    name: string;
    status: LocalEngineCapabilityStatus;
    message: string;
  }>;
}> {
  if (!this.runtimeOrchestrator) {
    return {
      status: 'blocked',
      summary: 'RuntimeOrchestrator 未注入，无法读取内容发布执行器。',
      nextAction: '检查 RuntimeModule 与 LocalEngineModule 装配。',
      checks: [
        {
          name: '发布编排器',
          status: 'blocked',
          message: 'RuntimeOrchestrator 模块未连接。',
        },
      ],
    };
  }
  try {
    const healths = await this.runtimeOrchestrator.healthCheck();
    const publish = healths.find((health) => health.id === 'platform-publish');
    if (!publish) {
      return {
        status: 'blocked',
        summary: '未注册内容发布执行器。',
        nextAction: '检查 PlatformPublishService 是否注入 RuntimeModule。',
        checks: [
          {
            name: 'platform-publish',
            status: 'blocked',
            message: 'healthCheck 未返回 platform-publish。',
          },
        ],
      };
    }
    return {
      status: publish.ok ? 'ready' : 'blocked',
      summary: publish.ok
        ? '内容发布执行器已注册；发布能力单独验收，不计入客户互动四条链路。'
        : '内容发布执行器不可用。',
      nextAction: publish.ok
        ? '如需验收发布，请单独跑图文/视频发布读写流程。'
        : '检查 PlatformPublishService 健康详情和 3011 启动日志。',
      checks: [
        {
          name: 'platform-publish',
          status: publish.ok ? 'ready' : 'blocked',
          message:
            publish.details ||
            (publish.ok ? '发布执行器在线。' : '发布执行器离线。'),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return {
      status: 'blocked',
      summary: `内容发布执行器检查失败：${message}`,
      nextAction: '请重启 3011 本地 Runtime 后重试。',
      checks: [
        {
          name: 'platform-publish',
          status: 'blocked',
          message,
        },
      ],
    };
  }
}

export async function checkEvidenceReplayCapability(
  this: CapabilitiesHost,
): Promise<{
  status: LocalEngineCapabilityStatus;
  summary: string;
  nextAction: string;
  checks: Array<{
    name: string;
    status: LocalEngineCapabilityStatus;
    message: string;
  }>;
}> {
  const runtimePaths = this.resolveLocalRuntimePaths();
  const evidenceDir = runtimePaths.evidence;
  const checks: Array<{
    name: string;
    status: LocalEngineCapabilityStatus;
    message: string;
  }> = [];

  try {
    await mkdir(evidenceDir, { recursive: true });
    const probePath = join(
      evidenceDir,
      `.kaypal-evidence-runcheck-${process.pid}-${Date.now()}.probe`,
    );
    await writeFile(probePath, 'ok', 'utf8');
    await rm(probePath, { force: true });
    checks.push({
      name: '证据目录',
      status: 'ready',
      message: `${evidenceDir} 可创建、写入和删除证据探针。`,
    });
  } catch (error) {
    checks.push({
      name: '证据目录',
      status: 'blocked',
      message: error instanceof Error ? error.message : '证据目录读写失败',
    });
  }

  try {
    const [taskCount, runtimeExecutionCount] = await Promise.all([
      this.prisma.interactionTask.count(),
      this.prisma.runtimeExecution.count(),
    ]);
    checks.push({
      name: '任务记录表',
      status: 'ready',
      message: `interaction_tasks 可读，当前 ${taskCount} 条。`,
    });
    checks.push({
      name: 'Runtime 执行记录表',
      status: 'ready',
      message: `runtime_executions 可读，当前 ${runtimeExecutionCount} 条。`,
    });
  } catch (error) {
    checks.push({
      name: '执行记录表',
      status: 'blocked',
      message:
        error instanceof Error ? error.message : '任务或执行记录表读取失败',
    });
  }

  const blocked = checks.some((check) => check.status === 'blocked');
  return {
    status: blocked ? 'blocked' : 'ready',
    summary: blocked
      ? '证据目录或执行记录表不可用，不能保证截图、页面回读和诊断导出落库。'
      : '证据目录、互动任务表和 Runtime 执行记录表检查通过。',
    nextAction: blocked
      ? '检查本地 evidence 目录权限、SQLite schema 和 Prisma 迁移。'
      : '',
    checks,
  };
}

export async function checkAiReplyModelConfig(this: CapabilitiesHost): Promise<{
  status: LocalEngineCapabilityStatus;
  summary: string;
  nextAction: string;
  checks: Array<{
    name: string;
    status: LocalEngineCapabilityStatus;
    message: string;
  }>;
}> {
  try {
    const textPurposes = ['article_creation', 'topic_selection'];
    const configs = await this.prisma.defaultModelConfig.findMany({
      where: { purpose: { in: textPurposes } },
    });
    const configuredModelIds = [
      ...new Set(configs.map((config) => config.modelId).filter(Boolean)),
    ];

    if (!configuredModelIds.length) {
      return this.withKaypalModelSyncHint({
        status: 'warning',
        summary:
          '未配置文章创作或精选选题默认模型；微信本机任务可继续，AI 生成类回复会使用规则兜底或在具体任务中提示配置。',
        nextAction:
          '到 3010 系统设置 → Kaypal 模型同步发起一次同步，把 Kaypal 模型台的默认模型拉过来。',
        checks: [
          {
            name: '默认文本模型',
            status: 'warning',
            message:
              'default_model_configs 缺少 article_creation/topic_selection。',
          },
        ],
      });
    }

    const models = await this.prisma.aIModel.findMany({
      where: { id: { in: configuredModelIds } },
      include: { platform: true },
    });
    const usableModels = models.filter(
      (model) =>
        model.enabled &&
        model.platform?.enabled &&
        Boolean(model.platform?.baseUrl?.trim()) &&
        Boolean(model.platform?.apiKey?.trim()),
    );
    const configuredPurposes = new Set(configs.map((config) => config.purpose));
    const missingPurposes = textPurposes.filter(
      (purpose) => !configuredPurposes.has(purpose),
    );

    if (!usableModels.length) {
      return this.withKaypalModelSyncHint({
        status: 'warning',
        summary:
          '默认文本模型已填写，但模型不可用；微信本机任务可继续，AI 生成类动作会在具体任务中提示修复模型。',
        nextAction:
          '检查默认模型指向的 AI 模型、平台启用状态、Base URL 和 API Key；不要把规则兜底当作 AI 闭环通过。',
        checks: [
          {
            name: '默认文本模型',
            status: 'warning',
            message: configs
              .map((config) => `${config.purpose}:${config.modelId}`)
              .join('、'),
          },
          {
            name: '模型启用状态',
            status: 'warning',
            message: models.length
              ? models
                  .map(
                    (model) =>
                      `${model.name}: modelEnabled=${model.enabled}, platformEnabled=${model.platform?.enabled ?? false}`,
                  )
                  .join('、')
              : '默认模型 ID 没有匹配到 ai_models 记录。',
          },
        ],
      });
    }

    return {
      status: missingPurposes.length ? 'warning' : 'ready',
      summary: `已配置可用默认文本模型：${usableModels
        .map((model) => `${model.name}(${model.modelId})`)
        .join('、')}。`,
      nextAction: missingPurposes.length
        ? `建议补齐 ${missingPurposes.join('、')}，内容生产完整链路会用到。`
        : '',
      checks: [
        {
          name: '默认文本模型',
          status: 'ready',
          message: configs
            .map((config) => `${config.purpose}:${config.modelId}`)
            .join('、'),
        },
        {
          name: '模型启用状态',
          status: 'ready',
          message: usableModels
            .map((model) => `${model.name}/${model.platform.name}`)
            .join('、'),
        },
        {
          name: '完整用途覆盖',
          status: missingPurposes.length ? 'warning' : 'ready',
          message: missingPurposes.length
            ? `缺少 ${missingPurposes.join('、')}`
            : 'article_creation 与 topic_selection 均已配置。',
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const tableMissing =
      this.isPrismaTableMissingError(error, 'default_model_configs') ||
      this.isPrismaTableMissingError(error, 'ai_models') ||
      this.isPrismaTableMissingError(error, 'ai_platforms');
    return {
      status: tableMissing ? 'warning' : 'missing',
      summary: tableMissing
        ? `本机数据库缺少 AI 模型配置表；微信本机任务可继续，AI 生成类动作会在具体任务中提示配置。原始错误：${message}`
        : `无法读取 AI 默认模型配置：${message}`,
      nextAction: tableMissing
        ? '重启本机助手后会自动补齐 SQLite 表；随后到系统设置同步 Kaypal 模型。'
        : '检查 Prisma 数据库、ai_models、ai_platforms 和 default_model_configs 后重试。',
      checks: [
        {
          name: '默认模型配置读取',
          status: tableMissing ? 'warning' : 'missing',
          message,
        },
      ],
    };
  }
}

export function withKaypalModelSyncHint(
  this: CapabilitiesHost,
  result: {
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  },
) {
  if (!this.kaypalModelSync) {
    return {
      ...result,
      checks: [
        ...result.checks,
        {
          name: 'Kaypal 模型台同步',
          status:
            result.status === 'blocked'
              ? ('blocked' as const)
              : ('warning' as const),
          message: 'KaypalModelSyncService 未注入，不能读取模型台同步状态。',
        },
      ],
    };
  }

  return {
    ...result,
    checks: [
      ...result.checks,
      {
        name: 'Kaypal 模型台同步',
        status:
          result.status === 'blocked'
            ? ('blocked' as const)
            : ('warning' as const),
        message:
          '运行检查只读取 3010 本地默认模型配置，不主动请求 Kaypal 云端模型台；需要同步时请在系统设置里手动触发模型同步。',
      },
    ],
  };
}

export async function checkFileAccess(this: CapabilitiesHost): Promise<{
  status: LocalEngineCapabilityStatus;
  summary: string;
  nextAction?: string;
  checks: Array<{
    name: string;
    status: LocalEngineCapabilityStatus;
    message: string;
  }>;
}> {
  const runtimePaths = this.resolveLocalRuntimePaths();
  const targets = [
    { name: '本机数据目录', path: runtimePaths.root },
    {
      name: '本机日志目录',
      path: runtimePaths.logs,
    },
    { name: '3011 本地 Runtime 目录', path: runtimePaths.root },
    { name: '发布素材目录', path: runtimePaths.materials },
    { name: '平台账号浏览器档案目录', path: runtimePaths.browserProfiles },
    { name: '互动证据目录', path: runtimePaths.evidence },
  ];
  const checks = await Promise.all(
    targets.map(async (target) => {
      try {
        await mkdir(target.path, { recursive: true });
        const probePath = join(
          target.path,
          `.kaypal-runcheck-${process.pid}-${Date.now()}.probe`,
        );
        await writeFile(probePath, 'ok', 'utf8');
        await rm(probePath, { force: true });
        await access(target.path, constants.R_OK | constants.W_OK);
        return {
          name: target.name,
          status: 'ready' as const,
          message: `${target.path} 可创建、可写入、可删除探针文件`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        return {
          name: target.name,
          status: 'blocked' as const,
          message: `${target.path} 读写探针失败：${message}`,
        };
      }
    }),
  );
  const hasWarning = checks.some((check) => check.status !== 'ready');

  return {
    status: hasWarning ? ('blocked' as const) : ('ready' as const),
    summary: hasWarning
      ? '部分本地目录不可读写，素材、账号状态或证据日志可能无法保存。'
      : '主系统目录、3011 Runtime 目录、素材目录和账号状态目录读写检查通过。',
    nextAction: hasWarning
      ? '请检查目录权限，必要时重新创建缺失目录。'
      : undefined,
    checks,
  };
}

export function withCapabilityTimeout<T>(
  this: CapabilitiesHost,
  name: string,
  promise: Promise<T>,
  fallback: T,
  timeoutMs = 2000,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((resolveResult) => {
    timeout = setTimeout(() => {
      console.warn(
        `[LocalEngineHealth] ${name} check timed out after ${timeoutMs}ms`,
      );
      resolveResult(fallback);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const capabilitiesMethods = {
  getCapabilities,
  checkAutoUploadEngine,
  checkInteractionCapabilities,
  checkContentPublishingCapability,
  checkEvidenceReplayCapability,
  checkAiReplyModelConfig,
  withKaypalModelSyncHint,
  checkFileAccess,
  withCapabilityTimeout,
};
