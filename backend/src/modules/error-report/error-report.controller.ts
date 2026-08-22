/**
 * 前端错误上报代理（v1.1.89+）：
 * 浏览器/桌面 UI 捕获的错误（window.onerror / ApiError 5xx）POST 到这里，
 * 由后端用内置 OSS 凭据转发到 error-reports/，避免前端暴露凭据。
 */
import { Body, Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { reportError } from '../../common/filters/error-report';
import { Public } from '../auth/auth.decorator';

@Controller('error-report')
export class ErrorReportController {
  private readonly logger = new Logger(ErrorReportController.name);

  @Post('client')
  @HttpCode(204)
  @Public()
  // eslint-disable-next-line @typescript-eslint/require-await
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
