import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';
import { isSafeRedirectTarget } from './short-link.service';

/**
 * 链接健康检查服务（M4 · PRD §9.15 / Codex §12）。
 *
 * 对 active 的演示入口 targetUrl 做 HTTP 探测（DNS/TLS/HTTP 状态/重定向目标/响应时间），
 * 依据状态机 healthy → warning → broken 更新 healthStatus 与 lastCheckedAt。
 *
 * 连续失败计数暂存于进程内存（ShowcaseDemoEndpoint schema 无持久化计数器字段，
 * M6 落看板时再补持久化 + 告警）。证书临近到期 / 响应慢 / 单次失败 → warning；
 * 连续失败达阈值 → broken；超过有效期 → expired；重定向到非白名单目标 → broken。
 */

export type HealthStatus = 'healthy' | 'warning' | 'broken' | 'expired';

/** 连续失败达该阈值判定 broken（Codex §12.2） */
export const FAILURE_THRESHOLD = 3;
/** 响应时间超过该毫秒数判 warning */
export const SLOW_RESPONSE_MS = 5000;
/** 证书剩余天数低于该阈值判 warning */
export const CERT_EXPIRING_DAYS = 30;
/** 探测超时毫秒数 */
export const PROBE_TIMEOUT_MS = 10000;

/** 可自动检查的入口类型（小程序码/预约需人工验证，不自动探测） */
export const AUTO_PROBE_ENDPOINT_TYPES = ['web', 'h5', 'download'] as const;

export interface ProbeResult {
  ok: boolean;
  httpStatus?: number;
  responseTimeMs?: number;
  finalUrl?: string;
  redirectTargetUnsafe?: boolean;
  certExpiringSoon?: boolean;
  error?: string;
}

export interface HealthCheckInput {
  previousStatus: string | null;
  /** 本次探测前已连续失败的次数 */
  consecutiveFailures: number;
  validUntil: Date | string | null;
  probe: ProbeResult;
}

export interface HealthCheckOutput {
  healthStatus: HealthStatus;
  consecutiveFailures: number;
}

export interface HealthCheckSummary {
  checked: number;
  changed: number;
}

@Injectable()
export class LinkHealthCheckService {
  private readonly logger = new Logger(LinkHealthCheckService.name);

  /** 进程内存连续失败计数（endpointId → 失败次数） */
  private readonly failureCounters = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  /** 每日定时检查（PRD §9.15「每日或按配置」；M6 再挂告警通知） */
  @Cron('0 1 * * *')
  async runDailyCheck(): Promise<HealthCheckSummary> {
    try {
      return await this.checkAllEndpoints();
    } catch (error) {
      this.logger.error(
        `链接健康检查任务执行失败：${this.errorMessage(error)}`,
      );
      return { checked: 0, changed: 0 };
    }
  }

  /** 遍历所有可自动检查的 active 演示入口并更新健康状态 */
  async checkAllEndpoints(): Promise<HealthCheckSummary> {
    const endpoints = await this.prisma.showcaseDemoEndpoint.findMany({
      where: {
        endpointType: { in: [...AUTO_PROBE_ENDPOINT_TYPES] },
      },
    });

    let checked = 0;
    let changed = 0;

    for (const endpoint of endpoints) {
      if (!endpoint.targetUrl) continue;

      const previousFailures =
        this.failureCounters.get(endpoint.id) ??
        seedFailureCount(endpoint.healthStatus);

      const probe = await this.probeUrl(endpoint.targetUrl);
      const result = computeHealthStatus({
        previousStatus: endpoint.healthStatus,
        consecutiveFailures: previousFailures,
        validUntil: endpoint.validUntil,
        probe,
      });

      this.failureCounters.set(endpoint.id, result.consecutiveFailures);

      if (result.healthStatus !== endpoint.healthStatus) {
        changed += 1;
      }

      await this.prisma.showcaseDemoEndpoint.update({
        where: { id: endpoint.id },
        data: {
          healthStatus: result.healthStatus,
          lastCheckedAt: new Date(),
        },
      });

      checked += 1;
    }

    this.logger.log(`链接健康检查完成：checked=${checked}, changed=${changed}`);
    return { checked, changed };
  }

  /** HTTP 探测目标 URL（GET 流式，收到响应头即断开，避免下载大文件；测量响应时间与最终跳转目标） */
  async probeUrl(url: string): Promise<ProbeResult> {
    const startedAt = Date.now();

    try {
      const response = await axios.request({
        url,
        method: 'GET',
        timeout: PROBE_TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: () => true, // 4xx/5xx 不算异常，捕获后按状态判定
        responseType: 'stream', // 不消费响应体，下载类目标不落地完整文件
        headers: { 'User-Agent': 'JiuZhang-LinkHealthCheck/1.0' },
        // 禁止自动跟随到本机/私网（SSRF 兜底）；重定向目标另行校验
        beforeRedirect: (_options, redirect) => {
          const location =
            typeof redirect.headers?.location === 'string'
              ? redirect.headers.location
              : null;
          if (location && !isSafeRedirectTarget(location)) {
            throw new Error('redirect-to-unsafe-target');
          }
        },
      });

      // 立即断开响应流，仅取状态与目标，不下载响应体
      const stream = response.data as { destroy?: () => void } | null;
      stream?.destroy?.();

      const responseTimeMs = Date.now() - startedAt;
      const responseRequest = response.request as
        { res?: { responseUrl?: string } } | undefined;
      const finalUrl = responseRequest?.res?.responseUrl ?? url;
      const httpStatus = response.status;
      const ok = httpStatus >= 200 && httpStatus < 400;
      const certExpiringSoon = await this.isCertExpiringSoon(finalUrl);

      return {
        ok,
        httpStatus,
        responseTimeMs,
        finalUrl,
        certExpiringSoon,
      };
    } catch (error) {
      const message = this.errorMessage(error);
      return {
        ok: false,
        error: message,
        responseTimeMs: Date.now() - startedAt,
        redirectTargetUnsafe: message === 'redirect-to-unsafe-target',
      };
    }
  }

  /** https 目标探测 TLS 证书有效期（临近到期 → warning 依据） */
  private async isCertExpiringSoon(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:') return false;

    try {
      // 用 https.request 握手取对端证书，仅读取 valid_to，不做请求体消费
      const https = await import('node:https');
      const days = await new Promise<number | null>((resolve) => {
        const req = https.request(
          {
            hostname: parsed.hostname,
            port: 443,
            method: 'HEAD',
            timeout: PROBE_TIMEOUT_MS,
          },
          (res) => {
            const socket = res.socket as {
              getPeerCertificate?: () =>
                { valid_to?: string } | Record<string, never>;
            } | null;
            const cert = socket?.getPeerCertificate?.();
            const validTo =
              cert && typeof cert === 'object' && 'valid_to' in cert
                ? (cert as { valid_to?: string }).valid_to
                : undefined;
            res.resume();
            resolve(
              validTo
                ? Math.floor(
                    (new Date(validTo).getTime() - Date.now()) /
                      (24 * 3600 * 1000),
                  )
                : null,
            );
          },
        );
        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
        req.on('error', () => resolve(null));
        req.end();
      });
      return days !== null && days >= 0 && days < CERT_EXPIRING_DAYS;
    } catch {
      return false;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * 健康状态机（纯函数，可独立单测）：
 *   - expired：validUntil 已过期；
 *   - broken：连续失败达阈值，或重定向到非白名单目标；
 *   - warning：单次失败 / 响应慢 / 证书临近到期；
 *   - healthy：探测成功且无上述异常。
 * 成功探测重置连续失败计数。
 */
export function computeHealthStatus(
  input: HealthCheckInput,
): HealthCheckOutput {
  if (isExpired(input.validUntil)) {
    return { healthStatus: 'expired', consecutiveFailures: 0 };
  }

  // 重定向到非白名单目标 → 高优先级风险，直接 broken（Codex §12.2 / PRD §9.15）
  if (input.probe.redirectTargetUnsafe) {
    return {
      healthStatus: 'broken',
      consecutiveFailures: input.consecutiveFailures + 1,
    };
  }

  if (!input.probe.ok) {
    const consecutiveFailures = input.consecutiveFailures + 1;
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      return { healthStatus: 'broken', consecutiveFailures };
    }
    return { healthStatus: 'warning', consecutiveFailures };
  }

  if (
    (input.probe.responseTimeMs ?? 0) > SLOW_RESPONSE_MS ||
    input.probe.certExpiringSoon
  ) {
    return { healthStatus: 'warning', consecutiveFailures: 0 };
  }

  return { healthStatus: 'healthy', consecutiveFailures: 0 };
}

/** validUntil 是否已过期（null = 永久有效） */
export function isExpired(
  validUntil: Date | string | null | undefined,
): boolean {
  if (!validUntil) return false;
  const time =
    validUntil instanceof Date
      ? validUntil.getTime()
      : new Date(validUntil).getTime();
  return Number.isNaN(time) ? false : time <= Date.now();
}

/** 依据持久化 healthStatus 播种内存连续失败计数（进程重启后延续语义） */
export function seedFailureCount(healthStatus: string | null): number {
  if (healthStatus === 'broken') return FAILURE_THRESHOLD;
  if (healthStatus === 'warning') return 1;
  return 0;
}
