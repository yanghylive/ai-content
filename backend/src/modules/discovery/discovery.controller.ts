// 发现中心 Controller（P1-4，2026-08-17）
// 统一暴露：能力声明列表 + 单平台发现（draft-only 默认，结果人工确认后进线索池）。
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { DiscoveryRegistry } from './discovery-registry.service';

@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly registry: DiscoveryRegistry) {}

  private requireUser(@Req() request: Request): { userId: string; tenantId: string } {
    const auth = (request as unknown as {
      authUser?: { id?: string; tenantId?: string };
    }).authUser;
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
      timeWindow: { from: new Date(0).toISOString(), to: new Date().toISOString() },
      limit: body?.limit ?? 20,
      riskMode: 'draft-only',
    } as never;
    const ctx = {
      tenantId,
      userId,
      accountId: body?.accountId ?? userId,
      runId: `discovery:${Date.now()}`,
      timeWindow: { from: new Date(0).toISOString(), to: new Date().toISOString() },
      budget: { maxItems: 50, maxRequests: 3 },
      abortSignal: new AbortController().signal,
    } as never;
    try {
      return {
        platform,
        mode: body?.mode,
        items: await this.registry.collect(input, ctx, Math.min(body?.limit ?? 20, 50)),
        riskMode: 'draft-only',
        message: '发现结果为草稿候选，需人工确认后才进入线索池',
      };
    } catch (error) {
      return {
        platform,
        mode: body?.mode,
        items: [],
        riskMode: 'draft-only',
        unsupported: true,
        reason: (error as Error).message,
      };
    }
  }
}
