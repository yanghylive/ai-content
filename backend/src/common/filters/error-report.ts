/**
 * 自动错误上报（v1.1.89+）：
 * 后端 500 级错误在 AllExceptionsFilter 中 fire-and-forget 采集，
 * 打包 requestId / 路由 / 堆栈 / 版本 / 系统信息 → 上传 OSS error-reports/。
 * 上传失败静默（不影响主流程）；带限流防止错误风暴打爆 OSS。
 */
import OSS from 'ali-oss';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname, platform, release, arch, cpus, totalmem } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const logger = new Logger('ErrorReport');
const ENABLED = process.env.ERROR_REPORT_ENABLED !== 'false';

// 限流：同 requestId 只报一次；全局 30s 窗口最多 5 条
const seen = new Set<string>();
let windowStart = Date.now();
let windowCount = 0;

function rateLimited(key: string): boolean {
  if (!key) return true;
  const now = Date.now();
  if (now - windowStart > 30_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (seen.has(key)) return true;
  if (windowCount >= 5) return true;
  seen.add(key);
  windowCount += 1;
  if (seen.size > 200) seen.clear();
  return false;
}

function readVersion(): string {
  try {
    // 优先从后端入口所在目录读 package.json（bundle 场景 cwd 不可靠）
    const candidates = [
      join(__dirname, '..', '..', '..', 'package.json'), // dist/ 场景
      join(__dirname, '..', 'package.json'), // bundle 场景
      join(process.cwd(), 'package.json'),
    ];
    for (const pkgPath of candidates) {
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        version?: string;
      };
      if (pkg.version) return pkg.version;
    }
  } catch {
    /* ignore */
  }
  return process.env.APP_VERSION || 'unknown';
}

function systemInfo(): Record<string, unknown> {
  return {
    platform: platform(),
    release: release(),
    arch: arch(),
    hostname: hostname(),
    cpus: cpus().length,
    totalMemMB: Math.round(totalmem() / 1048576),
    userData: process.env.APPDATA || '',
  };
}

function buildReport(input: {
  requestId: string;
  method: string;
  url: string;
  status: number;
  message: string;
  stack?: string;
}): Record<string, unknown> {
  return {
    schema: 'error-report/v1',
    reportId: randomUUID(),
    app: 'ai-content-desktop',
    version: readVersion(),
    requestId: input.requestId,
    method: input.method,
    url: input.url.slice(0, 500),
    status: input.status,
    message: (input.message || '').slice(0, 2000),
    stack: (input.stack || '').slice(0, 8000),
    system: systemInfo(),
    occurredAt: new Date().toISOString(),
  };
}

function makeOssClient() {
  const id = process.env.OSS_ACCESS_KEY_ID;
  const secret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!id || !secret) return null;
  return new OSS({
    accessKeyId: id,
    accessKeySecret: secret,
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    bucket: process.env.OSS_BUCKET || 'kaypal',
    secure: true,
  });
}

export function reportError(input: {
  requestId: string;
  method: string;
  url: string;
  status: number;
  message: string;
  stack?: string;
}): void {
  if (!ENABLED || input.status < 500) return;
  if (rateLimited(input.requestId)) return;
  const client = makeOssClient();
  if (!client) return;

  const report = buildReport(input);
  const ymd = new Date().toISOString().slice(0, 10);
  const key = `error-reports/${ymd}/${String(report.reportId)}.json`;

  void client
    .put(key, Buffer.from(JSON.stringify(report, null, 2)))
    .then(() => {
      logger.log(
        `错误已自动上报: ${key} (${input.method} ${input.url} ${input.status})`,
      );
    })
    .catch((err: unknown) => {
      // 上报失败静默，不影响主流程
      logger.debug(
        `错误上报失败(静默): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
