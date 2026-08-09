import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { request, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveProjectDataPath } from '../../common/project-paths';
import type {
  VideoWorkshopDownloadInput,
  VideoWorkshopDownloadPolicy,
  VideoWorkshopFailureCode,
  VideoWorkshopMaterialFile,
} from './video-workshop.types';

const DEFAULT_ALLOWED_HOSTS = [
  'v.douyin.com',
  'www.douyin.com',
  'douyin.com',
  '*.douyinvod.com',
  '*.byteimg.com',
  'b23.tv',
  'www.bilibili.com',
  'bilibili.com',
  '*.bilivideo.com',
  'www.xiaohongshu.com',
  'xiaohongshu.com',
  '*.xhscdn.com',
];

const DEFAULT_MAX_BYTES = 250 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_REDIRECTS = 3;

export interface VideoWorkshopDownloadOptions {
  taskId: string;
  signal: AbortSignal;
  onProgress: (
    progress: number,
    stage: string,
    bytesReceived: number,
    totalBytes?: number,
  ) => Promise<void> | void;
}

export class VideoWorkshopDownloadCancelledError extends Error {
  constructor() {
    super('下载任务已取消');
    this.name = 'VideoWorkshopDownloadCancelledError';
  }
}

export class VideoWorkshopDownloadError extends Error {
  constructor(
    readonly reasonCode: Exclude<VideoWorkshopFailureCode, 'cancelled'>,
    message: string,
    readonly technicalDetail?: string,
  ) {
    super(message);
    this.name = 'VideoWorkshopDownloadError';
  }
}

function ipv4ToNumber(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return null;
  }
  return parts.reduce((value, part) => value * 256 + part, 0) >>> 0;
}

function inIpv4Range(address: number, base: string, prefix: number) {
  const baseValue = ipv4ToNumber(base);
  if (baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (baseValue & mask);
}

function isBlockedIpv4(address: string) {
  const value = ipv4ToNumber(address);
  if (value === null) return true;
  return [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ].some(([base, prefix]) => inIpv4Range(value, String(base), Number(prefix)));
}

function expandIpv6(address: string) {
  const normalized = address.toLowerCase().split('%')[0];
  const mappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch)
    return { mappedIpv4: mappedMatch[1], groups: [] as number[] };

  const [head = '', tail = ''] = normalized.split('::');
  const readGroups = (value: string) =>
    value
      .split(':')
      .filter(Boolean)
      .flatMap((group) => {
        if (!group.includes('.')) return [Number.parseInt(group, 16)];
        const ipv4 = ipv4ToNumber(group);
        return ipv4 === null ? [Number.NaN] : [ipv4 >>> 16, ipv4 & 0xffff];
      });
  const headGroups = readGroups(head);
  const tailGroups = readGroups(tail);
  const fill: number[] = normalized.includes('::')
    ? Array.from(
        { length: Math.max(0, 8 - headGroups.length - tailGroups.length) },
        () => 0,
      )
    : [];
  return { groups: [...headGroups, ...fill, ...tailGroups] };
}

function isBlockedIpv6(address: string) {
  const expanded = expandIpv6(address);
  if (expanded.mappedIpv4) return isBlockedIpv4(expanded.mappedIpv4);
  if (
    expanded.groups.length !== 8 ||
    expanded.groups.some(
      (group) => !Number.isInteger(group) || group < 0 || group > 0xffff,
    )
  ) {
    return true;
  }
  const [first, second] = expanded.groups;
  if (first < 0x2000 || first > 0x3fff) return true;
  if (first === 0x2001 && second === 0x0db8) return true;
  if (first === 0x2001 && second < 0x0200) return true;
  if (first >= 0xfc00 && first <= 0xfdff) return true;
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  return first >= 0xff00;
}

export function isBlockedVideoDownloadAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

export function isAllowedVideoDownloadHostname(
  hostname: string,
  allowlist: string[],
) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return allowlist.some((entry) => {
    const allowed = entry.toLowerCase().replace(/\.$/, '');
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1);
      return normalized.endsWith(suffix) && normalized.length > suffix.length;
    }
    return normalized === allowed;
  });
}

@Injectable()
export class VideoWorkshopDownloader {
  policy(): VideoWorkshopDownloadPolicy {
    const configured = (process.env.VIDEO_WORKSHOP_DOWNLOAD_ALLOWLIST || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const maxBytes = this.readPositiveInteger(
      process.env.VIDEO_WORKSHOP_DOWNLOAD_MAX_BYTES,
      DEFAULT_MAX_BYTES,
      1024 * 1024,
      1024 * 1024 * 1024,
    );
    const timeoutMs = this.readPositiveInteger(
      process.env.VIDEO_WORKSHOP_DOWNLOAD_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      5000,
      10 * 60 * 1000,
    );
    return {
      allowedHosts: configured.length ? configured : DEFAULT_ALLOWED_HOSTS,
      maxBytes,
      timeoutMs,
      maxRedirects: MAX_REDIRECTS,
    };
  }

  async download(
    input: VideoWorkshopDownloadInput,
    options: VideoWorkshopDownloadOptions,
  ): Promise<VideoWorkshopMaterialFile> {
    const policy = this.policy();
    const initialUrl = this.parseAndValidateUrl(input.url, policy);
    const requestedMax = Number(input.maxBytes);
    const maxBytes = Number.isFinite(requestedMax)
      ? Math.max(
          1024 * 1024,
          Math.min(policy.maxBytes, Math.round(requestedMax)),
        )
      : policy.maxBytes;
    const materialDir = resolveProjectDataPath('materials');
    const tempDir = resolveProjectDataPath('video-workshop', 'downloads');
    const tempPath = join(tempDir, `${options.taskId}.partial`);
    await Promise.all([
      mkdir(materialDir, { recursive: true }),
      mkdir(tempDir, { recursive: true }),
    ]);
    await rm(tempPath, { force: true });

    try {
      const response = await this.openResponse(
        initialUrl,
        policy,
        options.signal,
        policy.maxRedirects,
        Date.now() + policy.timeoutMs,
      );
      const parsedContentLength = Number(response.headers['content-length']);
      const contentLength =
        Number.isFinite(parsedContentLength) && parsedContentLength >= 0
          ? parsedContentLength
          : undefined;
      if (contentLength !== undefined && contentLength > maxBytes) {
        response.destroy();
        throw new VideoWorkshopDownloadError(
          'invalid_input',
          '远程视频超过下载大小限制',
        );
      }
      const contentType = String(response.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (
        contentType &&
        !contentType.startsWith('video/') &&
        contentType !== 'application/octet-stream' &&
        contentType !== 'binary/octet-stream'
      ) {
        response.destroy();
        throw new VideoWorkshopDownloadError(
          'missing_asset',
          '链接没有返回可导入的视频文件',
        );
      }

      let bytesReceived = 0;
      let lastReportedAt = 0;
      const meter = new Transform({
        transform: (value, _encoding, callback) => {
          void (async () => {
            if (options.signal.aborted) {
              throw new VideoWorkshopDownloadCancelledError();
            }
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            bytesReceived += chunk.length;
            if (bytesReceived > maxBytes) {
              throw new VideoWorkshopDownloadError(
                'invalid_input',
                '远程视频超过下载大小限制',
              );
            }
            const now = Date.now();
            if (now - lastReportedAt >= 250) {
              lastReportedAt = now;
              const progress = contentLength
                ? Math.min(
                    94,
                    Math.round(8 + (bytesReceived / contentLength) * 86),
                  )
                : Math.min(90, Math.round(8 + (bytesReceived / maxBytes) * 82));
              await options.onProgress(
                progress,
                '正在安全下载远程视频',
                bytesReceived,
                contentLength,
              );
            }
            callback(null, chunk);
          })().catch((error) => callback(error as Error));
        },
      });
      await pipeline(
        response,
        meter,
        createWriteStream(tempPath, { flags: 'wx' }),
        { signal: options.signal },
      );
      if (options.signal.aborted) {
        throw new VideoWorkshopDownloadCancelledError();
      }

      if (!bytesReceived) {
        throw new VideoWorkshopDownloadError(
          'missing_asset',
          '远程视频内容为空',
        );
      }
      await options.onProgress(
        96,
        '正在校验视频文件',
        bytesReceived,
        bytesReceived,
      );
      const extension = await this.detectVideoExtension(tempPath);
      if (!extension) {
        throw new VideoWorkshopDownloadError(
          'missing_asset',
          '下载内容不是受支持的视频文件',
        );
      }
      const outputName = this.normalizeOutputName(
        input.outputName,
        initialUrl,
        extension,
      );
      const outputPath = this.uniquePath(materialDir, outputName);
      await rename(tempPath, outputPath);
      if (options.signal.aborted) {
        await rm(outputPath, { force: true });
        throw new VideoWorkshopDownloadCancelledError();
      }
      const outputStat = await stat(outputPath);
      return {
        id: `${Math.round(outputStat.mtimeMs)}-${basename(outputPath)}`,
        name: basename(outputPath),
        path: outputPath,
        kind: 'video',
        sizeBytes: outputStat.size,
        updatedAt: new Date(outputStat.mtimeMs).toISOString(),
      };
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      if (options.signal.aborted)
        throw new VideoWorkshopDownloadCancelledError();
      throw error;
    }
  }

  private parseAndValidateUrl(
    value: unknown,
    policy: VideoWorkshopDownloadPolicy,
  ) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > 2048) {
      throw new VideoWorkshopDownloadError(
        'invalid_input',
        '请填写有效的视频链接',
      );
    }
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new VideoWorkshopDownloadError(
        'invalid_input',
        '请填写有效的视频链接',
      );
    }
    if (url.protocol !== 'https:') {
      throw new VideoWorkshopDownloadError(
        'invalid_input',
        '下载任务只允许 HTTPS 链接',
      );
    }
    if (url.username || url.password || (url.port && url.port !== '443')) {
      throw new VideoWorkshopDownloadError(
        'invalid_input',
        '视频链接包含不允许的认证信息或端口',
      );
    }
    if (!isAllowedVideoDownloadHostname(url.hostname, policy.allowedHosts)) {
      throw new VideoWorkshopDownloadError(
        'invalid_input',
        '该链接域名不在视频下载白名单中',
      );
    }
    return url;
  }

  private async openResponse(
    url: URL,
    policy: VideoWorkshopDownloadPolicy,
    signal: AbortSignal,
    redirectsRemaining: number,
    deadline: number,
  ): Promise<import('node:http').IncomingMessage> {
    if (signal.aborted) throw new VideoWorkshopDownloadCancelledError();
    if (Date.now() >= deadline) throw new Error('下载任务超过总时间限制');
    const validated = this.parseAndValidateUrl(url.toString(), policy);
    const addresses = await this.lookupWithDeadline(
      validated.hostname,
      signal,
      deadline,
    );
    if (
      !addresses.length ||
      addresses.some((item) => isBlockedVideoDownloadAddress(item.address))
    ) {
      throw new VideoWorkshopDownloadError(
        'invalid_input',
        '视频链接无法通过安全检查',
      );
    }
    const pinned = addresses[0];

    const response = await new Promise<import('node:http').IncomingMessage>(
      (resolveResponse, rejectResponse) => {
        const remainingMs = Math.max(1, deadline - Date.now());
        const requestOptions: RequestOptions = {
          method: 'GET',
          protocol: 'https:',
          hostname: validated.hostname,
          port: 443,
          path: `${validated.pathname}${validated.search}`,
          servername: validated.hostname,
          headers: {
            Accept: 'video/*,application/octet-stream;q=0.8',
            'User-Agent': 'Kaypal-Video-Workshop/1.0',
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, pinned.address, pinned.family);
          },
        };
        const outgoing = request(requestOptions, resolveResponse);
        const abort = () =>
          outgoing.destroy(new VideoWorkshopDownloadCancelledError());
        signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(
          () => outgoing.destroy(new Error('下载任务超过总时间限制')),
          remainingMs,
        );
        outgoing.setTimeout(Math.min(15000, remainingMs), () =>
          outgoing.destroy(new Error('远程视频响应超时')),
        );
        outgoing.once('error', rejectResponse);
        outgoing.once('close', () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
        });
        outgoing.end();
      },
    );

    const status = response.statusCode || 0;
    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      response.resume();
      if (!location || redirectsRemaining <= 0) {
        throw new VideoWorkshopDownloadError(
          'invalid_input',
          '视频链接跳转次数过多',
        );
      }
      return this.openResponse(
        new URL(location, validated),
        policy,
        signal,
        redirectsRemaining - 1,
        deadline,
      );
    }
    if (status < 200 || status >= 300) {
      response.resume();
      if (status === 404 || status === 410) {
        throw new VideoWorkshopDownloadError(
          'missing_asset',
          '链接中的视频已经不存在',
          `HTTP ${status}`,
        );
      }
      throw new VideoWorkshopDownloadError(
        'processing_failure',
        '远程视频暂时无法下载，请稍后重试',
        `HTTP ${status}`,
      );
    }
    return response;
  }

  private async detectVideoExtension(path: string) {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
        return '.mp4';
      }
      if (
        bytesRead >= 4 &&
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
      ) {
        return '.webm';
      }
      return '';
    } finally {
      await handle.close();
    }
  }

  private async lookupWithDeadline(
    hostname: string,
    signal: AbortSignal,
    deadline: number,
  ) {
    const remainingMs = Math.max(1, deadline - Date.now());
    return new Promise<LookupAddress[]>((resolveLookup, rejectLookup) => {
      const timer = setTimeout(
        () => rejectLookup(new Error('视频链接 DNS 解析超时')),
        remainingMs,
      );
      const abort = () =>
        rejectLookup(new VideoWorkshopDownloadCancelledError());
      signal.addEventListener('abort', abort, { once: true });
      lookup(hostname, { all: true, verbatim: true }).then(
        (addresses) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          resolveLookup(addresses);
        },
        (error) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          rejectLookup(
            error instanceof Error ? error : new Error('视频链接 DNS 解析失败'),
          );
        },
      );
    });
  }

  private normalizeOutputName(
    value: unknown,
    url: URL,
    detectedExtension: string,
  ) {
    const requested = typeof value === 'string' ? value.trim() : '';
    let decodedPath = url.pathname;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      decodedPath = url.pathname;
    }
    const fromUrl = basename(decodedPath);
    const baseName = basename(
      requested || fromUrl || `linked-video-${Date.now()}`,
    );
    const withoutControlCharacters = Array.from(baseName)
      .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .join('');
    const candidate = withoutControlCharacters
      .replace(/[\\/:"*?<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 100);
    const stem =
      basename(candidate, extname(candidate)) || `linked-video-${Date.now()}`;
    return `${stem}${detectedExtension}`;
  }

  private uniquePath(directory: string, name: string) {
    const direct = join(directory, name);
    if (!existsSync(direct)) return direct;
    const extension = extname(name);
    return join(
      directory,
      `${basename(name, extension)}-${Date.now()}${extension}`,
    );
  }

  private readPositiveInteger(
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }
}
