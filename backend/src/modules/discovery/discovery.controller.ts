// 发现中心 Controller（P1-4，2026-08-17）
// 统一暴露：能力声明列表 + 单平台发现（draft-only 默认，结果人工确认后进线索池）。
import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { DiscoveryRegistry } from './discovery-registry.service';
import { BrowserDiscoverError } from './discovery-browser-runner';

/** 把发现层的各类错误映射为结构化错误码 + 正确的 HTTP 状态码（不再全吞成 200 + unsupported） */
function discoveryErrorToHttp(error: unknown): {
  status: number;
  code: string;
} {
  if (error instanceof BrowserDiscoverError) {
    const statusByCode: Record<string, number> = {
      quota_exceeded: 429,
      captcha_required: 422,
      risk_control: 422,
      no_browser_session: 400,
      parse_failed: 502,
      network_error: 502,
    };
    return {
      status: statusByCode[error.reasonCode] ?? 502,
      code: error.reasonCode,
    };
  }
  const message = (error as Error)?.message || '';
  if (message.startsWith('unsupported:')) {
    return { status: 400, code: 'unsupported' };
  }
  return { status: 500, code: 'discovery_internal_error' };
}

@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly registry: DiscoveryRegistry) {}

  private requireUser(@Req() request: Request): {
    userId: string;
    tenantId: string;
  } {
    const auth = (
      request as unknown as {
        authUser?: { id?: string; tenantId?: string };
      }
    ).authUser;
    const userId = auth?.id?.trim() || '';
    if (!userId) throw new UnauthorizedException('请先登录');
    return { userId, tenantId: auth?.tenantId || 'legacy-local-desktop' };
  }

  @Get('capabilities')
  async capabilities() {
    return this.registry.listCapabilities();
  }

  @Get('capabilities/:platform')
  async capability(@Param('platform') platform: string) {
    const cap = await this.registry.capabilitiesOf(platform);
    if (!cap) throw new UnauthorizedException(`平台 ${platform} 未注册`);
    return cap;
  }

  @Post(':platform/discover')
  async discover(
    @Req() request: Request,
    @Param('platform') platform: string,
    @Body()
    body: {
      mode: string;
      accountId?: string;
      keyword?: string;
      url?: string;
      targetId?: string;
      limit?: number;
    },
  ) {
    const { userId, tenantId } = this.requireUser(request);
    const input = {
      platform,
      accountId: body?.accountId ?? userId,
      mode: body?.mode,
      input: {
        keyword: body?.keyword,
        url: body?.url,
        targetId: body?.targetId,
      },
      timeWindow: {
        from: new Date(0).toISOString(),
        to: new Date().toISOString(),
      },
      limit: body?.limit ?? 20,
      riskMode: 'draft-only',
    } as never;
    const ctx = {
      tenantId,
      userId,
      accountId: body?.accountId ?? userId,
      runId: `discovery:${Date.now()}`,
      timeWindow: {
        from: new Date(0).toISOString(),
        to: new Date().toISOString(),
      },
      budget: { maxItems: 50, maxRequests: 3 },
      abortSignal: new AbortController().signal,
    } as never;
    try {
      return {
        platform,
        mode: body?.mode,
        items: await this.registry.collect(
          input,
          ctx,
          Math.min(body?.limit ?? 20, 50),
        ),
        riskMode: 'draft-only',
        message: '发现结果为草稿候选，需人工确认后才进入线索池',
      };
    } catch (error) {
      // 结构化错误码：不再把网络/解析/验证码/配额错误全吞成 HTTP 200 + unsupported
      const { status, code } = discoveryErrorToHttp(error);
      throw new HttpException(
        {
          code,
          message: (error as Error).message,
          platform,
          mode: body?.mode,
        },
        status,
      );
    }
  }
}
