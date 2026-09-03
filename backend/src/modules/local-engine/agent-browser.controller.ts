import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import {
  BadRequestException,
  ForbiddenException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { AgentBrowserPolicyService } from './agent-browser-policy.service';
import { AgentBrowserLoopService } from './agent-browser-loop.service';
import { AgentBrowserExecutor } from './agent-browser-executor.service';
import { getPlatformProfile } from './platform-login-rules';
import type { CreateAgentBrowserSessionInput } from './agent-browser.types';

type AuthRequest = Request & { authUser?: { id: string } };

/**
 * P4 Agent Browser 接口（文档 §7.4）。
 * 命名空间：/local-engine/agent-browser/*
 * 通用网页 agent（general-web），不碰社媒登录态。
 */
@Controller('local-engine/agent-browser')
export class AgentBrowserController {
  constructor(
    private readonly sessions: AgentBrowserSessionService,
    private readonly policy: AgentBrowserPolicyService,
    private readonly loop: AgentBrowserLoopService,
    private readonly authRequestContext?: AuthRequestContextService,
    /** 阶段 5（2026-09-04）：登录态查询走面板执行链（Optional 兼容老测试构造） */
    @Optional() private readonly executor?: AgentBrowserExecutor,
  ) {}

  private getUserId(request: AuthRequest): string {
    // P0-1（审计 2026-08-22）：AuthGuard 写入 request.authUser，读 request.user 恒空
    // 回落 local-user 导致用户级隔离失效。无身份直接 401，禁止回落。
    const userId = request.authUser?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('请先登录');
    }
    return userId;
  }

  /** §7.4 请求租户（fail-closed：无上下文/无归属抛 403） */
  private async resolveTenantId(): Promise<string> {
    if (!this.authRequestContext) {
      throw new ForbiddenException('缺少租户上下文');
    }
    const prisma = (this.sessions as unknown as { prisma?: unknown })
      .prisma as never;
    if (!prisma) {
      throw new ForbiddenException('缺少数据库租户上下文');
    }
    return await this.authRequestContext.resolveTenantId(prisma);
  }

  /** 创建会话（Profile/租约/域名白名单） */
  @Post('sessions')
  @HttpCode(201)
  async create(
    @Req() request: AuthRequest,
    @Body() body: CreateAgentBrowserSessionInput = {},
  ) {
    const tenantId = await this.resolveTenantId();
    return this.sessions.create(this.getUserId(request), body, tenantId);
  }

  @Get('sessions')
  async list(@Req() request: AuthRequest) {
    const tenantId = await this.resolveTenantId();
    return this.sessions.list(this.getUserId(request), tenantId);
  }

  @Get('sessions/:id')
  async get(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  /**
   * 阶段 5 第一站（2026-09-04）：会话平台登录态查询（小红书先行）。
   *
   * 只读免单：面板 Runtime.evaluate 只读快照 + 启发式三态判定
   * （logged_in / login_prompt / unknown），仅用于「登录/只读」阶段 UI 引导
   * （提示用户扫码接管），不作为任何写动作放行依据（写动作仍走确认单审批链）。
   * 失败显式 400 带 reason——不静默降级，绝不回退到无头引擎查询。
   */
  @Get('sessions/:id/login-state')
  async loginState(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    const session = this.sessions.get(id);
    if (!getPlatformProfile(session.platform)) {
      throw new BadRequestException(
        `会话平台 ${session.platform} 不支持登录态查询（仅注册平台支持，如 xiaohongshu）`,
      );
    }
    if (!this.executor) {
      throw new BadRequestException('执行器未注入，登录态查询不可用');
    }
    // actor 同 loop 3.2 构造规则：租约身份就是面板桥断言身份（防跨会话/跨租户）
    const result = await this.executor.loginStateViaPanel(
      {
        ownerId: session.lease?.ownerId ?? '',
        tenantId: session.lease?.tenantId ?? tenantId,
      },
      session.platform,
    );
    if (!result.ok) {
      throw new BadRequestException(result.reason);
    }
    return result;
  }

  /** 运行：进入 Observe-Act-Verify 循环（P4-B 实现执行体） */
  @Post('sessions/:id/run')
  @HttpCode(202)
  async run(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Body()
    body: {
      instruction?: string;
      confirmedTools?: Array<{ action: string; target?: string; url?: string }>;
      // P0-2：服务端确认——批准时传确认单 id，后端查库校验（不信任裸 confirmedTools）
      confirmationIds?: string[];
    } = {},
  ) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    // §7.4 状态机校验：终态不可重跑——
    // P1（复查第三轮）：error 也是终态（类型定义如此），原来漏判导致异常会话
    // 可再次 run 重放已有副作用（重复点击/提交/发送），补进终态列表
    const cur = this.sessions.get(id);
    if (
      ['succeeded', 'stopped', 'failed', 'cancelled', 'error'].includes(
        cur.status,
      )
    ) {
      throw new BadRequestException(
        `会话已处于终态 ${cur.status}，不能重新运行`,
      );
    }
    // §12.2 反例"重复点击执行按钮"：running 中重复提交直接拒绝（幂等防重）
    if (cur.status === 'running') {
      throw new BadRequestException('任务执行中，请等待完成或先停止再重试');
    }
    // P1（复查 2026-08-22）：needs-human（提示注入/引擎断开）/ paused 必须
    // 经人工接管 resume 恢复，不允许客户端直接 run 绕过
    if (cur.status === 'needs-human' || cur.status === 'paused') {
      throw new BadRequestException(
        `会话处于 ${cur.status} 状态，请先人工接管（resume）恢复后再运行`,
      );
    }
    // P1（复查第三轮）：partial_success 重试幂等续跑——沿用保存的动作序列 +
    // 已完成动作索引（循环内跳过，不重放副作用）+ 动作来源 URL（§6.3 门禁依据，
    // 不重置为当前 URL 防止旧页面 selector 被误执行）
    const resumeFrom =
      cur.status === 'partial_success' && cur.pendingActions?.length
        ? {
            stepIndex: cur.pendingStepIndex ?? 0,
            actions: cur.pendingActions,
            completedIndices: cur.pendingCompletedIndices,
            actionOriginUrls: cur.pendingActionOriginUrls,
          }
        : undefined;
    const instruction = resumeFrom
      ? (cur.pendingInstruction ?? body.instruction ?? '')
      : body.instruction;
    // 1. 懒创建引擎会话 + 置 running
    this.sessions.updateStatus(id, 'created');
    // P1（复查 2026-08-22）：解析/观察/执行器抛异常时必须 markError——
    // 否则会话长期停留 running（脏会话），前端无法恢复
    try {
      await this.sessions.acquireEngineSession(id);
      // 2. 若有指令则跑一轮 Observe-Act-Verify（confirmationIds/confirmedTools 放行需确认动作）
      if (instruction?.trim()) {
        await this.loop.run(id, instruction, {
          confirmedTools: body.confirmedTools ?? [],
          confirmationIds: body.confirmationIds,
          ...(resumeFrom ? { resumeFrom } : {}),
        });
        // 终态由 loop 设置（success→succeeded / partial_success / failed）；
        // 不再对 !ok 误 markError（否则正常失败也被标成 error）
      }
    } catch (error) {
      // P1：任何异常 → 标记 error 终态（不留脏 running），再抛回给前端
      this.sessions.markError(
        id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  @Post('sessions/:id/pause')
  @HttpCode(202)
  async pause(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    // P4-4：只允许 running/needs-human → paused
    this.sessions.assertTransition(id, ['running', 'needs-human'], 'paused');
    this.sessions.updateStatus(id, 'paused');
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  @Post('sessions/:id/resume')
  @HttpCode(202)
  async resume(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    // P4-4：resume 走 SessionService.resume——校验 paused/needs-human 并重新获取引擎会话
    await this.sessions.resume(id);
    // P1（复查 2026-08-22）：恢复原任务——若暂停时留有未完成任务上下文，
    // 自动从断点续跑（不再丢失 instruction/剩余动作；也不会因 running 被重复执行保护拒绝）
    try {
      const s = this.sessions.get(id);
      const pending = s.pendingInstruction?.trim();
      if (pending) {
        if (s.pendingActions?.length) {
          await this.loop.run(id, pending, {
            confirmedTools: [],
            confirmationIds: undefined,
            resumeFrom: {
              stepIndex: s.pendingStepIndex ?? 0,
              actions: s.pendingActions,
              // P1（复查第三轮）：恢复时透传已完成动作（幂等跳过）+
              // 动作来源 URL（§6.3 门禁，不重置为当前 URL）
              completedIndices: s.pendingCompletedIndices,
              actionOriginUrls: s.pendingActionOriginUrls,
            },
          });
        } else {
          await this.loop.run(id, pending, {
            confirmedTools: [],
            confirmationIds: undefined,
          });
        }
      }
    } catch (error) {
      this.sessions.markError(
        id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  @Get('sessions/:id/events')
  async events(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    return this.sessions.listEvents(id);
  }

  @Post('sessions/:id/stop')
  @HttpCode(202)
  async stop(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    await this.sessions.stop(id);
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  /** 策略审计（供前端预检/调试） */
  @Post('policy/audit')
  audit(
    @Param() _unused: undefined,
    @Body()
    body: {
      tool: string;
      args?: Record<string, unknown>;
      url?: string;
      allowDomains?: string[];
    },
  ) {
    this.policy.assertToolAllowed(body.tool);
    return this.policy.audit(body.tool, body.args ?? {}, {
      url: body.url,
      allowDomains: body.allowDomains ?? [],
    });
  }

  // P4-C：@Get('sessions/:id/events') SSE 事件流
}
