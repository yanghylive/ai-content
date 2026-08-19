import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 短链服务（M4 · 安全边界核心）。
 *
 * 目标 URL 一律来自服务端存储的 ShowcaseShortLink.targetUrl（创建时已校验），
 * 跳转前再经 isSafeRedirectTarget 复核协议 + 主机黑名单（回环/私网），
 * 绝不接受请求中的任意 url 参数作为跳转目标，杜绝开放重定向与 SSRF。
 */

/** 跳转状态码：临时重定向（目标后续可变，客户端不缓存语义） */
export const SHORT_LINK_REDIRECT_STATUS = 302 as const;

/** 短码默认长度（8 字符，base64url 字符集，约 48bit 熵） */
export const SHORT_CODE_DEFAULT_LENGTH = 8;

export type ShortLinkUnavailableReason =
  'not_found' | 'disabled' | 'expired' | 'invalid_target';

export type ShortLinkResolveResult =
  | { kind: 'redirect'; url: string; statusCode: 302 | 307 }
  | { kind: 'unavailable'; reason: ShortLinkUnavailableReason };

@Injectable()
export class ShortLinkService {
  private readonly logger = new Logger(ShortLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成随机短码：crypto.randomBytes + base64url，URL 安全且不可顺序猜测。
   * 字符集为 [A-Za-z0-9_-]，天然无需 URL 编码，可在二维码/分享链接中直接使用。
   */
  generateShortCode(length: number = SHORT_CODE_DEFAULT_LENGTH): string {
    const safeLength = Math.max(4, Math.min(16, Math.floor(length)));
    const byteCount = Math.ceil((safeLength * 3) / 4);
    return randomBytes(byteCount).toString('base64url').slice(0, safeLength);
  }

  /**
   * 解析短链跳转目标。
   *
   * 校验顺序：短码存在 → status=active → validUntil 未过期 → targetUrl 非空且安全。
   * 合法时原子自增 openCount 并更新 lastOpenAt，返回 302 跳转目标；
   * 非法时返回品牌化不可用原因，绝不抛出携带内部信息的裸错误。
   */
  async resolveShortLink(code: string): Promise<ShortLinkResolveResult> {
    const normalized = typeof code === 'string' ? code.trim() : '';
    if (!normalized) {
      return { kind: 'unavailable', reason: 'not_found' };
    }

    const link = await this.prisma.showcaseShortLink.findUnique({
      where: { shortCode: normalized },
    });
    if (!link) {
      return { kind: 'unavailable', reason: 'not_found' };
    }

    if (link.status !== 'active') {
      return { kind: 'unavailable', reason: 'disabled' };
    }

    if (link.validUntil && new Date(link.validUntil).getTime() <= Date.now()) {
      return { kind: 'unavailable', reason: 'expired' };
    }

    if (!link.targetUrl || !isSafeRedirectTarget(link.targetUrl)) {
      this.logger.warn(
        `短链 ${normalized} 目标非法（协议/主机校验未通过），拒绝跳转`,
      );
      return { kind: 'unavailable', reason: 'invalid_target' };
    }

    // 原子自增 openCount（increment）+ 更新 lastOpenAt；聚合事件失败不影响跳转。
    try {
      await this.prisma.showcaseShortLink.update({
        where: { id: link.id },
        data: { openCount: { increment: 1 }, lastOpenAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `短链 ${normalized} openCount 自增失败（不影响跳转）：${this.errorMessage(error)}`,
      );
    }

    return {
      kind: 'redirect',
      url: link.targetUrl,
      statusCode: SHORT_LINK_REDIRECT_STATUS,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * 校验跳转目标是合法公开地址：
 *   - 协议仅 http/https；
 *   - 主机名非空；
 *   - 拒绝本机回环、链路本地与私网网段（防 SSRF/开放重定向）。
 *
 * 注意：该函数仅做「安全兜底」，创建短链时的白名单校验仍由后台管理端负责。
 */
export function isSafeRedirectTarget(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname;
  if (!hostname) return false;

  return !isLoopbackOrPrivateHost(hostname);
}

/** 判定主机名是否为回环/链路本地/私网地址（含 IPv4/IPv6 及 IPv4 映射 IPv6） */
export function isLoopbackOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;

  if (host.includes(':')) {
    // IPv6（含 IPv4 映射形式 ::ffff:x.x.x.x）
    if (
      host.startsWith('fe80:') ||
      host.startsWith('fc') ||
      host.startsWith('fd')
    ) {
      return true;
    }
    const mappedIpv4 = ipv4MappedToIpv4(host);
    if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
    return false;
  }

  return isPrivateIpv4(host);
}

/**
 * 从 IPv4 映射的 IPv6 地址提取内嵌 IPv4（点分十进制），非映射地址返回 null。
 * 兼容两种写法：::ffff:127.0.0.1（点分）与 ::ffff:7f00:1（Node URL 规范化的十六进制）。
 */
function ipv4MappedToIpv4(host: string): string | null {
  if (!host.startsWith('::ffff:')) return null;
  const suffix = host.slice('::ffff:'.length);
  if (!suffix) return null;

  // 点分十进制直写（未规范化输入）
  if (/^\d+\.\d+\.\d+\.\d+$/.test(suffix)) return suffix;

  // 十六进制组：最后两个 16-bit 组拼成 32-bit IPv4（高位在前）
  const groups = suffix.split(':').filter(Boolean);
  if (groups.length === 0 || groups.length > 2) return null;
  const lo = Number.parseInt(groups[groups.length - 1], 16);
  const hi = groups.length === 2 ? Number.parseInt(groups[0], 16) : 0;
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;

  const ipv4 = ((hi << 16) | lo) >>> 0;
  return `${(ipv4 >>> 24) & 0xff}.${(ipv4 >>> 16) & 0xff}.${(ipv4 >>> 8) & 0xff}.${ipv4 & 0xff}`;
}

/** 判定 IPv4 是否为回环/私网/链路本地/运营商级 NAT 地址 */
function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  ) {
    // 非 IPv4 字面量（域名），不按私网拦截
    return false;
  }

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8、10.0.0.0/8、127.0.0.0/8
  if (a === 169 && b === 254) return true; // 链路本地 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 私网 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 私网 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 运营商级 NAT 100.64.0.0/10
  return false;
}
