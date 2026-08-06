// local-engine 健康/能力/素材簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 HealthHost 接口：
// startedAt/tasks/wechatSessionConfirmation 字段 + capabilities/persist 簇方法。

import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import { resolveProjectLogPath } from '../../common/project-paths';
import type { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import type { PlaywrightMcpService } from './playwright-mcp.service';
import type { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import type { AutoUploadUploadFile } from '../auto-upload/auto-upload.client';
import type {
  InteractionTask,
  LocalEngineCapability,
  LocalEngineEntitlementUser,
  LocalEngineHealth,
  LocalEngineWechatSessionStatus,
  UpdateWechatSessionConfirmationInput,
} from './local-engine.types';

/** 健康/能力/素材簇的 host 接口：簇方法访问的 service 成员 */
export interface HealthHost {
  startedAt: number;
  tasks: Map<string, InteractionTask>;
  nodeAgentRuntime?: NodeAgentRuntimeService;
  playwrightMcp?: PlaywrightMcpService;
  runtimeOrchestrator: RuntimeOrchestrator;
  wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
    lockCapturedAt?: string;
    alignment?: LocalEngineWechatSessionStatus['alignment'];
  };
  ensureTaskStore(): Promise<void>;
  useNodeAgentRuntime(): boolean;
  withCapabilityTimeout<T>(
    name: string,
    promise: Promise<T>,
    fallback: T,
    timeoutMs?: unknown,
  ): Promise<T>;
  getFastCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]>;
}

export async function getHealth(
  this: HealthHost,
  user?: LocalEngineEntitlementUser,
): Promise<LocalEngineHealth> {
  await this.ensureTaskStore();
  const tasks = [...this.tasks.values()];
  const now = new Date().toISOString();
  const capabilities = await this.getFastCapabilities(now, user);
  const blockers = capabilities
    .filter(
      (capability) =>
        capability.required !== false &&
        ['blocked', 'missing', 'degraded'].includes(capability.status),
    )
    .map((capability) => ({
      capability: capability.name,
      message: capability.summary,
      nextAction: capability.nextAction,
    }));

  return {
    online: true,
    ready: blockers.length === 0,
    requiredBlocked: blockers.length,
    blockers,
    service: 'ai-content-local-engine',
    version: '0.1.0',
    mode: 'live',
    // engineUrl = 'internal://' 前缀：表示"我本身就是 local-engine，没有指向外部 runtime"
    // 8001 (kaypal-runtime) 已下线；Node Runtime 模式下 Agent-S 在 3011 进程内提供兼容 API。
    engineUrl: 'internal://ai-content/local-engine',
    engineNote: this.useNodeAgentRuntime()
      ? '内嵌：本机助手服务即本进程；Agent-S API 走包内 Node Runtime；外部 17777 sidecar 不是必需服务'
      : '内嵌：本机助手服务即本进程；Agent-S API 走旧 17777 sidecar；无外部 8001 runtime',
    checkedAt: now,
    uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    queue: {
      running: tasks.filter((task) => task.status === 'running').length,
      waitingForApproval: tasks.filter(
        (task) => task.status === 'waiting_for_send_confirmation',
      ).length,
      completed: tasks.filter((task) => task.status === 'completed').length,
      failed: tasks.filter(
        (task) => task.status === 'failed' || task.status === 'blocked',
      ).length,
    },
    capabilities,
  };
}

export async function getFastCapabilities(
  this: HealthHost,
  now: string,
  user?: LocalEngineEntitlementUser,
): Promise<LocalEngineCapability[]> {
  const playwrightStatus = this.playwrightMcp
    ? await this.withCapabilityTimeout(
        'playwright-mcp',
        this.playwrightMcp.getAutomationStatus(),
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
          readyForAutomation: false,
          requiredToolsReady: false,
          requiredTools: [],
          missingRequiredTools: [],
          message: 'playwright-mcp 工具发现超时',
        },
      )
    : undefined;
  const useNodeRuntime = this.useNodeAgentRuntime();
  const nodeRuntimeInjected = Boolean(this.nodeAgentRuntime);
  const wechatSessionLocked =
    Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
    this.wechatSessionConfirmation.currentWindowConfirmed === true &&
    this.wechatSessionConfirmation.contactConfirmed === true &&
    this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
    this.wechatSessionConfirmation.takeoverActive !== true &&
    !this.wechatSessionConfirmation.stoppedAt;
  const hasKaypalUser = Boolean(user?.kaypalUserId);
  const hasCommercialSignal =
    user?.commercialExecutionAllowed === true ||
    user?.planMode === 'commercial' ||
    Boolean(user?.kaypalPlan && user.kaypalPlanExpired !== true);
  const agentSCapability: LocalEngineCapability = useNodeRuntime
    ? {
        key: 'agent-s-sidecar',
        name: 'Agent-S 执行能力',
        status: nodeRuntimeInjected ? 'optional' : 'blocked',
        required: !nodeRuntimeInjected,
        summary: nodeRuntimeInjected
          ? 'Node Agent Runtime 已注入；快速健康检查不递归调用真实执行器状态。'
          : 'Node Runtime 模式已启用，但 NodeAgentRuntimeService 未注入。',
        checkedAt: now,
        nextAction: nodeRuntimeInjected
          ? '需要确认真实执行器、截图证据和浏览器控制时查看 /api/agent-s/status 或完整运行检查。'
          : '检查 RuntimeModule 与 LocalEngineModule 的依赖装配。',
        checks: [
          {
            name: 'NodeAgentRuntimeService',
            status: nodeRuntimeInjected ? 'optional' : 'blocked',
            message: nodeRuntimeInjected
              ? '服务已注入；真实执行细节由 Agent-S 状态接口和 readiness 负责。'
              : '服务未注入，/api/agent-s/* 不能提供包内 Agent-S 执行能力。',
          },
        ],
      }
    : {
        key: 'agent-s-sidecar',
        name: 'Agent-S 执行能力',
        status: 'optional',
        required: false,
        summary:
          '旧 sidecar 模式需要完整检查确认 runner_mode=real；快速健康检查不阻塞等待 17777。',
        checkedAt: now,
        nextAction:
          '查看完整运行检查或 /api/agent-s/status；mock、不可达或缺少执行控制必须修复。',
        checks: [
          {
            name: '17777 sidecar',
            status: 'optional',
            message:
              '旧实现需要外部 sidecar，但快速检查不阻塞等待；完整 readiness 会读取真实状态。',
          },
        ],
      };
  return [
    {
      key: 'browser-control',
      name: '浏览器引擎',
      status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
      required: true,
      summary: playwrightStatus?.readyForAutomation
        ? `本地浏览器控制已启动（pid=${playwrightStatus.pid ?? '?'}）。`
        : '本地浏览器引擎未就绪，不能执行真实平台读取、发送和回读。',
      checkedAt: now,
      nextAction: playwrightStatus?.readyForAutomation
        ? ''
        : '检查包内 Playwright Chromium、@playwright/mcp 和 3011 启动日志。',
      checks: [
        {
          name: 'playwright-mcp',
          status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
          message:
            playwrightStatus?.message || '未检测到 playwright-mcp 状态。',
        },
      ],
    },
    {
      key: 'interaction-capabilities',
      name: '真实互动执行器',
      status: this.runtimeOrchestrator ? 'optional' : 'blocked',
      required: !this.runtimeOrchestrator,
      summary: this.runtimeOrchestrator
        ? '快速健康检查不下发真实互动任务；完整 readiness 会检查各平台 executor。'
        : 'RuntimeOrchestrator 未注入，真实互动执行器不可用。',
      checkedAt: now,
      nextAction: this.runtimeOrchestrator
        ? '查看 /local-engine/readiness 的完整 executor 结果。'
        : '检查 RuntimeModule 与 LocalEngineModule 装配。',
      checks: [
        {
          name: '执行入口',
          status: this.runtimeOrchestrator ? 'optional' : 'blocked',
          message: this.runtimeOrchestrator
            ? '已注册 RuntimeOrchestrator，但快速检查不证明真实读写发送回读成功。'
            : 'RuntimeOrchestrator 模块未连接。',
        },
      ],
    },
    {
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: hasKaypalUser ? 'optional' : 'blocked',
      required: false,
      summary: hasKaypalUser
        ? hasCommercialSignal
          ? '已读取本地 Kaypal 登录态和套餐信号；云端套餐、积分余额和授权有效期由完整检查或真实扣点动作确认。'
          : '已读取本地 Kaypal 登录态；未在健康接口中确认商用套餐和积分余额。'
        : '快速健康检查未读取到 Kaypal 用户上下文；完整检查会给出登录和权益处理建议。',
      checkedAt: now,
      nextAction:
        '需要确认套餐、积分余额或外部授权时运行完整检查；真实采集/扣点接口会按云端授权拦截。',
      checks: [
        {
          name: '本地登录态',
          status: hasKaypalUser ? 'optional' : 'blocked',
          message: hasKaypalUser
            ? `本地会话已绑定 Kaypal 用户 ${user?.kaypalUserId}；未在健康接口中请求云端余额。`
            : '当前请求没有可用 Kaypal 用户上下文。',
        },
        {
          name: '积分余额',
          status: 'optional',
          message:
            '健康接口不再读取云端积分余额，避免系统首页被外部授权/网络拖慢。',
        },
      ],
    },
    {
      key: 'ai-reply-model',
      name: 'AI 回复模型',
      status: 'optional',
      required: false,
      summary:
        '默认模型配置不在快速健康检查里读取；需要生成回复时由具体任务和完整检查确认。',
      checkedAt: now,
      nextAction:
        '到模型配置或完整运行检查确认文章创作/选题/互动回复模型是否已同步。',
      checks: [
        {
          name: '默认模型配置',
          status: 'optional',
          message:
            '已跳过数据库和模型平台检查；真实 AI 任务会在执行前校验模型授权。',
        },
      ],
    },
    {
      key: 'desktop-control',
      name: '桌面控制',
      status: wechatSessionLocked ? 'ready' : 'optional',
      required: false,
      summary: wechatSessionLocked
        ? `已锁定微信联系人：${this.wechatSessionConfirmation.targetContact?.trim()}。`
        : '桌面微信状态不在快速健康检查里执行 AppleScript 探测；完整检查会确认窗口、权限和截图能力。',
      checkedAt: now,
      nextAction: wechatSessionLocked
        ? '微信任务仍会在发送/发布前回读目标和内容。'
        : '需要跑微信任务前先运行完整检查或进入桌面能力页确认权限。',
      checks: [
        {
          name: '联系人锁定',
          status: wechatSessionLocked ? 'ready' : 'optional',
          message: wechatSessionLocked
            ? '当前联系人、窗口和草稿确认状态已锁定。'
            : '快速健康检查未触发桌面窗口读取。',
        },
      ],
    },
    {
      key: 'mcp-manager',
      name: 'Playwright/MCP 工具',
      status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
      required: true,
      summary: playwrightStatus?.readyForAutomation
        ? `playwright-mcp sidecar 在线（${playwrightStatus.message}）。`
        : 'playwright-mcp 未就绪；浏览器自动化工具不可用。',
      checkedAt: now,
      nextAction: playwrightStatus?.readyForAutomation
        ? `MCP 端点 ${playwrightStatus.endpoint}；工具数 ${playwrightStatus.toolCount ?? 0}。`
        : '检查 3011 启动日志或在运行检查的浏览器页单独刷新 MCP 状态。',
      checks: [
        {
          name: 'sidecar 进程',
          status: playwrightStatus?.childProcessRunning ? 'ready' : 'blocked',
          message: playwrightStatus?.childProcessRunning
            ? `本地 @playwright/mcp 子进程运行中 (pid=${playwrightStatus.pid ?? '?'})`
            : '子进程未启动或正在启动。',
        },
        {
          name: 'HTTP 端点',
          status: playwrightStatus?.online ? 'ready' : 'blocked',
          message: playwrightStatus?.endpoint || '端点未就绪。',
        },
        {
          name: '浏览器工具',
          status: playwrightStatus?.requiredToolsReady ? 'ready' : 'blocked',
          message: playwrightStatus?.requiredToolsReady
            ? `${playwrightStatus.toolCount ?? 0} 个 browser_* 工具已发现。`
            : `缺少必需工具：${(playwrightStatus?.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
        },
      ],
    },
    agentSCapability,
    {
      key: 'wechat-execution',
      name: '微信完整执行链',
      status: wechatSessionLocked ? 'ready' : 'optional',
      required: false,
      summary: wechatSessionLocked
        ? '微信会话已锁定，执行链仍会在动作前做回读和确认。'
        : '微信执行链的进程、窗口、权限和截图能力只在完整检查或具体任务前校验。',
      checkedAt: now,
      nextAction:
        '创建微信任务后，系统会回读目标、内容和当前窗口，条件通过后继续执行。',
      checks: [
        {
          name: '微信进程检测',
          status: 'optional',
          message:
            '快速健康检查未读取桌面进程，避免首页触发系统权限弹窗或超时。',
        },
        {
          name: '受控执行',
          status: 'ready',
          message: '微信任务只在确认后执行真实发送、发布、评论或加好友。',
        },
      ],
    },
    {
      key: 'remote-control',
      name: '远程控制',
      status: 'optional',
      required: false,
      summary:
        '远程任务通道保留会话、审计和证据字段；本机 AI 员工任务不依赖远程接管。',
      checkedAt: now,
      nextAction: '本机任务按当前电脑的浏览器、桌面微信和发布执行器状态判断。',
      checks: [
        {
          name: '远程会话',
          status: 'optional',
          message: '远程接管不是当前本机执行必需条件。',
        },
        {
          name: '用户接管审计',
          status: 'ready',
          message: 'Agent 会话已保留接管审计字段。',
        },
      ],
    },
    {
      key: 'plugin-runtime',
      name: '插件与技能运行时',
      status: 'optional',
      required: false,
      summary: '插件和技能目录不在快速健康检查里做磁盘扫描，避免启动页卡顿。',
      checkedAt: now,
      nextAction: '需要诊断插件时进入后续插件页或单独运行插件检查。',
      checks: [
        {
          name: '插件目录',
          status: 'optional',
          message: '快速健康检查已跳过目录扫描。',
        },
        {
          name: '插件运行',
          status: 'optional',
          message: '插件执行不影响当前内容生产和客户互动主流程。',
        },
      ],
    },
    {
      key: 'memory-context',
      name: '记忆与上下文',
      status: 'optional',
      required: false,
      summary:
        '记忆系统不在快速健康检查里访问外部 Runtime，避免无配置时误报阻塞。',
      checkedAt: now,
      nextAction: '需要长期记忆时再配置 Redis/向量库或 Kaypal Runtime。',
      checks: [
        {
          name: '消息历史',
          status: 'optional',
          message: '快速健康检查未访问记忆服务。',
        },
        {
          name: '上下文压缩',
          status: 'optional',
          message: '向量库状态不影响当前本地发布和互动主流程。',
        },
      ],
    },
    {
      key: 'sandbox-execution',
      name: '沙箱执行',
      status: 'optional',
      required: false,
      summary:
        '当前一键桌面版不要求用户安装 Docker；沙箱执行保留为下一阶段能力。',
      checkedAt: now,
      nextAction: '本地用户安装包优先使用内置 Node Runtime，不依赖 Docker。',
      checks: [
        {
          name: '平台适配',
          status: 'optional',
          message: '未在快速健康检查中探测 Docker 或 native 沙箱。',
        },
        {
          name: '执行边界',
          status: 'optional',
          message: '当前主流程通过任务风险边界和证据链控制。',
        },
      ],
    },
    {
      key: 'evidence-replay',
      name: '证据链与回放',
      status: 'optional',
      required: false,
      summary: '证据链结构已接入；快速健康检查不扫描本地证据目录和任务记录表。',
      checkedAt: now,
      nextAction: '需要确认历史证据、截图和诊断包时运行完整检查。',
      checks: [
        {
          name: '截图证据',
          status: 'optional',
          message: '快速健康检查未访问截图目录。',
        },
        {
          name: '步骤回放',
          status: 'optional',
          message: '快速健康检查未访问任务记录和 evidenceReplay 结构。',
        },
      ],
    },
    {
      key: 'file-access',
      name: '文件访问',
      status: 'optional',
      required: false,
      summary:
        '素材、账号档案和证据目录读写不在快速健康检查里扫描；文件页会做完整验证。',
      checkedAt: now,
      nextAction: '进入文件访问页或运行完整检查确认目录读写权限。',
      checks: [
        {
          name: '目录读写检查',
          status: 'optional',
          message: '快速健康检查已跳过本地目录扫描。',
        },
      ],
    },
    {
      key: 'permission-check',
      name: '权限检查',
      status: 'ready',
      summary: '接口权限由 Kaypal 登录态和套餐守卫实时拦截。',
      checkedAt: now,
      nextAction: '',
      checks: [
        {
          name: '套餐权限',
          status: 'ready',
          message: '本地接口使用 AuthGuard 注入的 Kaypal 套餐判断。',
        },
      ],
    },
  ];
}

export async function saveInteractionAsset(
  this: HealthHost,
  file: AutoUploadUploadFile | undefined,
) {
  if (!file) {
    throw new BadRequestException('请选择朋友圈图片素材');
  }
  if (!file.buffer?.length) {
    throw new BadRequestException('图片素材为空，不能用于发布');
  }
  if (!file.mimetype?.startsWith('image/')) {
    throw new BadRequestException('朋友圈素材必须是图片文件');
  }
  const maxBytes = 30 * 1024 * 1024;
  if (file.buffer.length > maxBytes) {
    throw new BadRequestException('朋友圈图片不能超过 30MB');
  }

  const assetDir = resolveProjectLogPath('interaction-assets');
  await mkdir(assetDir, { recursive: true });

  const fallbackExt =
    file.mimetype === 'image/png'
      ? '.png'
      : file.mimetype === 'image/webp'
        ? '.webp'
        : '.jpg';
  const ext = extname(file.originalname || '').toLowerCase() || fallbackExt;
  const safeBaseName =
    (file.originalname || 'moments-asset')
      .replace(extname(file.originalname || ''), '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'moments-asset';
  const filename = `${Date.now()}-${safeBaseName}${ext}`;
  const filepath = join(assetDir, filename);

  await writeFile(filepath, file.buffer);

  return {
    filename,
    filepath,
    mimeType: file.mimetype,
    sizeBytes: file.buffer.length,
    uploadedAt: new Date().toISOString(),
  };
}

export const healthMethods = {
  getHealth,
  getFastCapabilities,
  saveInteractionAsset,
};
