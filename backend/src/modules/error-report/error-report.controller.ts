/**
 * 前端错误上报代理（v1.1.89+）：
 * 浏览器/桌面 UI 捕获的错误（window.onerror / ApiError 5xx）POST 到这里，
 * 由后端用内置 OSS 凭据转发到 error-reports/，避免前端暴露凭据。
 * P2（P5 门禁 2026-08-22）：匿名端点独立 IP 级限流——
 * reportError 的全局限流与后端 500 自动上报共享预算，客户端刷请求会挤掉
 * 真实错误上报；本控制器按 IP 限流，且不占后端预算。
 */
import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { reportError } from '../../common/filters/error-report';
import { Public } from '../auth/auth.decorator';

/** P2：匿名上报每 IP 窗口内最多条数（防日志/OSS 滥用） */
const IP_WINDOW_MS = 60_000;
const IP_MAX_PER_WINDOW = 20;
const ipBuckets = new Map<string, { count: number; windowStart: number }>();

function clientIpOf(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket?.remoteAddress || 'unknown';
}

function ipRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > IP_WINDOW_MS) {
    ipBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  if (bucket.count > IP_MAX_PER_WINDOW) {
    ipBuckets.set(ip, { count: bucket.count, windowStart: now - IP_WINDOW_MS });
    return true;
  }
  return false;
}

@Controller('error-report')
export class ErrorReportController {
  private readonly logger = new Logger(ErrorReportController.name);

  @Post('client')
  @HttpCode(204)
  @Public()
  async clientError(
    @Req() request: Request,
    @Body()
    body: {
      requestId?: string;
      url?: string;
      message?: string;
      stack?: string;
      status?: number;
      context?: string;
    },
  ): Promise<void> {
    // P2（P5 门禁 2026-08-22）：匿名接口 IP 级限流——超限静默丢弃（204），
    // 不落 OSS、不记日志，防日志/OSS 滥用
    if (ipRateLimited(clientIpOf(request))) {
      this.logger.debug('错误上报超出单 IP 限流，已丢弃');
      return;
    }
    const status = Number(body?.status) || 500;
    const message =
      (body?.message || '前端未知错误').slice(0, 2000) || '前端未知错误';
    // 前端上报：4xx 业务错误也带 requestId 回来便于关联（后端 500 由过滤器自报）
    reportError({
      requestId: body?.requestId || 'client-' + Date.now(),
      method: 'UI',
      url: (body?.url || request.url || '').slice(0, 500),
      status: status >= 400 ? status : 500,
      message,
      stack: (body?.stack || '').slice(0, 8000),
    });
    this.logger.debug(`前端错误已代理上报: ${message.slice(0, 120)}`);
  }
}
