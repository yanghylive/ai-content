import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { createHash } from 'node:crypto';
import {
  AiEmployeeService,
  type AutoAcquisitionBillingRecord,
} from '../ai-employee/ai-employee.service';
import { RedfoxCallLogService } from './redfox-call-log.service';
import { RedfoxCostGuardService } from './redfox-cost-guard.service';
import {
  RedfoxClientRequestOptions,
  RedfoxEffectiveConnection,
  RedfoxScope,
} from './redfox.types';

@Injectable()
export class RedfoxClientService {
  private readonly logger = new Logger(RedfoxClientService.name);

  constructor(
    private readonly callLogs: RedfoxCallLogService,
    private readonly costGuard: RedfoxCostGuardService,
    @Optional() private readonly aiEmployeeService?: AiEmployeeService,
  ) {}

  async request<T>(
    scope: RedfoxScope,
    connection: RedfoxEffectiveConnection,
    options: RedfoxClientRequestOptions,
  ): Promise<T> {
    const method = options.method || 'GET';
    const endpoint = `${method} ${options.path}`;
    const requestHash = this.hashRequest(
      method,
      options.path,
      options.query,
      options.body,
    );
    const startedAt = Date.now();
    const estimatedCostPoints = Math.max(0, options.estimatedCostPoints ?? 1);
    let externalSucceeded = false;

    try {
      if (!connection.enabled) {
        throw new HttpException(
          {
            code: 'REDFOX_CONNECTOR_DISABLED',
            message: '系统数据服务已停用，请联系管理员处理。',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (options.requireApiKey !== false && !connection.apiKey) {
        throw new BadRequestException({
          code: 'REDFOX_API_KEY_REQUIRED',
          message: '系统数据服务暂未开通，请联系管理员处理。',
        });
      }

      await this.costGuard.assertWithinLimits(
        scope,
        connection,
        estimatedCostPoints,
        { confirmHighCost: options.confirmHighCost === true },
      );

      const response = await axios.request<T, AxiosResponse<T>>({
        method,
        baseURL: connection.baseUrl,
        url: this.ensureLeadingSlash(options.path),
        params: this.cleanQuery(options.query),
        data: this.buildRequestData(options),
        timeout: connection.timeoutMs,
        headers: this.buildHeaders(connection.apiKey, options),
        validateStatus: () => true,
      } satisfies AxiosRequestConfig);

      if (response.status >= 200 && response.status < 300) {
        externalSucceeded = true;
        const redfoxCostPoints = this.resolveCostPoints(
          response.headers,
          estimatedCostPoints,
        );
        const billing = await this.deductRedfoxCredits(
          scope,
          endpoint,
          requestHash,
          redfoxCostPoints,
          Date.now() - startedAt,
          options,
        );
        const billedCostPoints = this.resolveBilledCostPoints(
          billing,
          redfoxCostPoints,
        );
        const log = await this.callLogs.record({
          scope,
          endpoint,
          method,
          operation: options.operation,
          skillCode: options.skillCode || null,
          status: 'success',
          costPoints: billedCostPoints,
          latencyMs: Date.now() - startedAt,
          requestHash,
          responseStatus: response.status,
          errorCode: null,
          errorMessage: null,
        });
        options.onCallLogRecorded?.(log);
        return response.data;
      }

      throw this.mapHttpStatus(response.status, response.data);
    } catch (error) {
      const mapped = this.mapError(error);
      const status = mapped instanceof HttpException ? mapped.getStatus() : 500;
      const errorCode = this.readErrorCode(mapped);
      const errorMessage = this.readErrorMessage(mapped);
      const logStatus = status === 429 ? 'blocked' : 'failed';

      if (externalSucceeded) {
        this.logger.warn(
          `RedFox ${endpoint} succeeded but billing failed: ${
            errorMessage || errorCode || status
          }`,
        );
      }

      const log = await this.callLogs.record({
        scope,
        endpoint,
        method,
        operation: options.operation,
        skillCode: options.skillCode || null,
        status: logStatus,
        costPoints: 0,
        latencyMs: Date.now() - startedAt,
        requestHash,
        responseStatus: status || null,
        errorCode,
        errorMessage,
      });
      options.onCallLogRecorded?.(log);

      this.logger.warn(
        `RedFox ${endpoint} failed: ${errorCode || status} ${errorMessage}`,
      );
      throw mapped;
    }
  }

  private shouldBillRedfoxCredits(
    options: RedfoxClientRequestOptions,
    estimatedCostPoints: number,
  ) {
    return (
      estimatedCostPoints > 0 &&
      options.requireApiKey !== false &&
      options.operation.startsWith('intelligence.')
    );
  }

  private resolveBilledCostPoints(
    billing: AutoAcquisitionBillingRecord | undefined,
    redfoxCostPoints: number,
  ) {
    const billedAmount = Number(billing?.amount);
    if (Number.isFinite(billedAmount) && billedAmount > 0) {
      return Math.max(1, Math.round(billedAmount));
    }
    const remoteAmount = Number(redfoxCostPoints);
    if (!Number.isFinite(remoteAmount) || remoteAmount <= 0) return 0;
    return Math.round(remoteAmount);
  }

  private async deductRedfoxCredits(
    scope: RedfoxScope,
    endpoint: string,
    requestHash: string,
    costPoints: number,
    latencyMs: number,
    options: RedfoxClientRequestOptions,
  ) {
    if (!this.shouldBillRedfoxCredits(options, costPoints)) return undefined;
    if (!this.aiEmployeeService) {
      throw new ServiceUnavailableException(
        '数据情报扣积分服务未接入，不能执行真实采集。',
      );
    }
    const amount = Math.max(1, Math.round(costPoints || 1));
    return this.aiEmployeeService.deductExternalDataCredits({
      idempotencyKey: `ai-content:redfox:${scope.key}:${options.operation}:${requestHash}:${Date.now()}`,
      mode: 'intelligence_redfox',
      taskType: 'redfox_external_data',
      amount,
      runtimeMinutes: Math.max(1, Math.ceil(latencyMs / 60_000)),
      replies: 0,
      platformActions: 1,
      leads: 0,
      evidences: 1,
      metadata: {
        endpoint,
        method: options.method || 'GET',
        operation: options.operation,
        requestHash,
        skillCode: options.skillCode || null,
        redfoxCostPoints: amount,
        scopeKey: scope.key,
      },
    });
  }

  private buildRequestData(options: RedfoxClientRequestOptions) {
    if (
      options.bodyEncoding === 'form' &&
      options.body &&
      typeof options.body === 'object' &&
      !Array.isArray(options.body)
    ) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(
        options.body as Record<string, unknown>,
      )) {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, this.formValueToString(value));
        }
      }
      return params.toString();
    }
    return options.body;
  }

  private formValueToString(value: unknown) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  private buildHeaders(apiKey: string, options: RedfoxClientRequestOptions) {
    return {
      Accept: 'application/json',
      'Content-Type':
        options.bodyEncoding === 'form'
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
      Authorization: apiKey ? `Bearer ${apiKey}` : undefined,
      'X-API-Key': apiKey || undefined,
      REDFOX_API_KEY: apiKey || undefined,
      'X-Kaypal-Client': 'ai-content-backend',
      ...options.headers,
    };
  }

  private resolveCostPoints(
    headers: Record<string, unknown>,
    fallback: number,
  ) {
    const headerValue =
      headers['x-redfox-cost-points'] ||
      headers['x-cost-points'] ||
      headers['x-points-cost'];
    const parsed = Number(
      Array.isArray(headerValue) ? headerValue[0] : headerValue,
    );
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private mapHttpStatus(status: number, body: unknown) {
    const detail = this.extractRemoteMessage(body);
    const suffix = detail ? `：${detail}` : '';
    if (status === 401) {
      return new UnauthorizedException({
        code: 'REDFOX_UNAUTHORIZED',
        message: `系统数据服务授权已失效${suffix}`,
      });
    }
    if (status === 403) {
      return new ForbiddenException({
        code: 'REDFOX_FORBIDDEN',
        message: `当前账号无权访问该数据服务${suffix}`,
      });
    }
    if (status === 408 || status === 504) {
      return new GatewayTimeoutException({
        code: 'REDFOX_TIMEOUT',
        message: `系统数据服务请求超时${suffix}`,
      });
    }
    if (status === 429) {
      return new HttpException(
        {
          code: 'REDFOX_RATE_LIMITED',
          message: `系统数据服务调用频率受限${suffix}`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (status === Number(HttpStatus.PAYMENT_REQUIRED)) {
      return new HttpException(
        {
          code: 'INSUFFICIENT_CREDITS',
          message: '积分余额不足，请充值或调整任务消耗后再试。',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    if (status >= 500) {
      return new ServiceUnavailableException({
        code: 'REDFOX_UPSTREAM_UNAVAILABLE',
        message: `系统数据服务暂不可用${suffix}`,
      });
    }
    return new BadRequestException({
      code: 'REDFOX_UPSTREAM_BAD_REQUEST',
      message: `数据服务请求失败${suffix}`,
    });
  }

  private mapError(error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      if (this.isTimeoutError(error)) {
        return new GatewayTimeoutException({
          code: 'REDFOX_TIMEOUT',
          message: '系统数据服务请求超时，请稍后重试。',
        });
      }

      return new ServiceUnavailableException({
        code: 'REDFOX_NETWORK_ERROR',
        message: '系统数据服务暂时不可达，请稍后重试。',
      });
    }

    return new ServiceUnavailableException({
      code: 'REDFOX_UNKNOWN_ERROR',
      message: error instanceof Error ? error.message : '数据服务调用失败',
    });
  }

  private isTimeoutError(error: AxiosError) {
    return (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      /timeout/i.test(error.message)
    );
  }

  private readErrorCode(error: HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'code' in response) {
      const code = (response as { code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }
    return null;
  }

  private readErrorMessage(error: HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      return Array.isArray(message)
        ? message
            .filter((item): item is string => typeof item === 'string')
            .join('; ')
        : typeof message === 'string'
          ? message
          : '';
    }
    return error.message;
  }

  private extractRemoteMessage(body: unknown) {
    if (!body || typeof body !== 'object') return '';
    const record = body as Record<string, unknown>;
    const value =
      record.message ||
      record.msg ||
      record.error ||
      record.errorMessage ||
      record.detail;
    if (typeof value === 'string') return value.slice(0, 300);
    return '';
  }

  private hashRequest(
    method: string,
    path: string,
    query?: Record<string, unknown>,
    body?: unknown,
  ) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          method,
          path,
          query: this.cleanQuery(query),
          body: this.sanitizeBody(body),
        }),
      )
      .digest('hex');
  }

  private sanitizeBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    if (Array.isArray(body)) return body.map((item) => this.sanitizeBody(item));
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>).map(([key, value]) => [
        key,
        /api[-_]?key|token|secret|password/i.test(key)
          ? '[redacted]'
          : this.sanitizeBody(value),
      ]),
    );
  }

  private cleanQuery(query?: Record<string, unknown>) {
    if (!query) return undefined;
    return Object.fromEntries(
      Object.entries(query).filter(
        ([, value]) => value !== undefined && value !== null && value !== '',
      ),
    );
  }

  private ensureLeadingSlash(path: string) {
    return path.startsWith('/') ? path : `/${path}`;
  }
}
