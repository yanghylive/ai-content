import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { safeText } from '../../../common/text.utils';

export type JpageVerifiedFile = {
  id: string;
  name: string;
  fileType: string;
  size: number;
  isPublic: false;
  sha256: string;
  authenticatedRenderUrl: string;
  tags: string[];
};

type JpageRequestOptions = {
  baseUrl: string;
  token: string;
};

@Injectable()
export class JpagePreviewClientService {
  constructor(private readonly config: ConfigService) {}

  normalizeBaseUrl(value: string) {
    let parsed: URL;
    try {
      parsed = new URL(value.trim());
    } catch {
      throw new BadRequestException('JPage 服务地址无效');
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '')
    ) {
      throw new BadRequestException(
        'JPage 服务地址必须是无凭据、无路径的 HTTPS 地址',
      );
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (this.isPrivateHostname(hostname)) {
      throw new BadRequestException('JPage 服务地址不能指向本机或私网');
    }
    const allowedHosts = new Set(
      (this.config.get<string>('JPAGE_ALLOWED_HOSTS') || 'jpage.cn')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
    if (!allowedHosts.has(hostname)) {
      throw new BadRequestException(
        `JPage 域名不在 JPAGE_ALLOWED_HOSTS 白名单：${hostname}`,
      );
    }
    return `${parsed.protocol}//${parsed.host}`;
  }

  async ensurePrivateFile(
    options: JpageRequestOptions & {
      name: string;
      content: string;
      tags: string[];
    },
  ): Promise<JpageVerifiedFile> {
    const baseUrl = this.normalizeBaseUrl(options.baseUrl);
    const expectedSha256 = this.sha256(options.content);
    const existing = await this.findExactFile(
      { ...options, baseUrl },
      options.name,
    );
    if (existing) {
      try {
        return await this.verifyPrivateFile(
          { ...options, baseUrl },
          existing.id,
          options.name,
          expectedSha256,
          options.tags,
        );
      } catch {
        // The confirmed upload below safely overwrites the same user-owned name.
      }
    }

    const uploaded = await this.requestJson<Record<string, unknown>>(
      { ...options, baseUrl },
      '/api/files/upload-json',
      {
        method: 'POST',
        body: JSON.stringify({
          name: options.name,
          content: options.content,
          isPublic: false,
        }),
      },
    );
    const id = this.requiredId(uploaded.id, 'JPage 文件 ID');
    return this.verifyPrivateFile(
      { ...options, baseUrl },
      id,
      options.name,
      expectedSha256,
      options.tags,
    );
  }

  async verifyPrivateFile(
    options: JpageRequestOptions,
    fileId: string,
    expectedName: string,
    expectedSha256: string,
    tags: string[] = [],
  ): Promise<JpageVerifiedFile> {
    const baseUrl = this.normalizeBaseUrl(options.baseUrl);
    if (tags.length) {
      await this.applyTags({ ...options, baseUrl }, fileId, tags);
    }
    const [metadata, source] = await Promise.all([
      this.requestJson<Record<string, unknown>>(
        { ...options, baseUrl },
        `/api/files/${encodeURIComponent(fileId)}`,
      ),
      this.requestJson<Record<string, unknown>>(
        { ...options, baseUrl },
        `/api/files/${encodeURIComponent(fileId)}/content`,
      ),
    ]);
    const name = safeText(metadata.original_name || '');
    const content = typeof source.content === 'string' ? source.content : '';
    const remoteSha256 = this.sha256(content);
    const isPublic = metadata.is_public === true || metadata.is_public === 1;
    if (name !== expectedName || isPublic || remoteSha256 !== expectedSha256) {
      throw new BadRequestException(
        'JPage 私有预览回读不匹配，已阻止公众号草稿写入',
      );
    }
    const remoteTags = Array.isArray(metadata.tags)
      ? (metadata.tags as unknown[])
          .map((item) =>
            item && typeof item === 'object' && 'name' in item
              ? String(item.name)
              : '',
          )
          .filter(Boolean)
      : [];
    if (tags.some((tag) => !remoteTags.includes(tag))) {
      throw new BadRequestException('JPage 私有预览标签回读不完整');
    }
    return {
      id: this.requiredId(metadata.id || fileId, 'JPage 文件 ID'),
      name,
      fileType: safeText(metadata.file_type || ''),
      size: Number(metadata.size || Buffer.byteLength(content, 'utf8')),
      isPublic: false,
      sha256: remoteSha256,
      authenticatedRenderUrl: `${baseUrl}/api/files/${encodeURIComponent(fileId)}/render`,
      tags: remoteTags,
    };
  }

  private async findExactFile(
    options: JpageRequestOptions,
    name: string,
  ): Promise<{ id: string } | null> {
    const result = await this.requestJson<Record<string, unknown>>(
      options,
      `/api/files?keyword=${encodeURIComponent(name)}&limit=20`,
    );
    const files = Array.isArray(result.files) ? result.files : [];
    for (const file of files) {
      if (!file || typeof file !== 'object') continue;
      const record = file as Record<string, unknown>;
      if (record.original_name === name) {
        return { id: this.requiredId(record.id, 'JPage 文件 ID') };
      }
    }
    return null;
  }

  private async applyTags(
    options: JpageRequestOptions,
    fileId: string,
    names: string[],
  ) {
    const result = await this.requestJson<Record<string, unknown>>(
      options,
      '/api/tags',
    );
    const tags = Array.isArray(result.tags) ? result.tags : [];
    const byName = new Map<string, string>();
    for (const tag of tags) {
      if (!tag || typeof tag !== 'object') continue;
      const record = tag as Record<string, unknown>;
      if (typeof record.name === 'string') {
        byName.set(record.name, this.requiredId(record.id, 'JPage 标签 ID'));
      }
    }
    const tagIds: string[] = [];
    for (const name of names) {
      let id = byName.get(name);
      if (!id) {
        const created = await this.requestJson<Record<string, unknown>>(
          options,
          '/api/tags',
          { method: 'POST', body: JSON.stringify({ name }) },
        );
        id = this.requiredId(created.id, 'JPage 标签 ID');
      }
      tagIds.push(id);
    }
    await this.requestJson(
      options,
      `/api/files/${encodeURIComponent(fileId)}/tags`,
      { method: 'PUT', body: JSON.stringify({ tagIds }) },
    );
  }

  private async requestJson<T = Record<string, unknown>>(
    options: JpageRequestOptions,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const token = options.token.trim();
    if (!token) throw new BadRequestException('JPage Token 未配置');
    const timeoutMs = Math.max(
      3_000,
      Math.min(
        60_000,
        Number(this.config.get<string>('JPAGE_TIMEOUT_MS') || 20_000),
      ),
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${options.baseUrl}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-upload-source': 'kaypal-agentwaker',
          ...(init.headers || {}),
        },
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 6 * 1024 * 1024) {
        throw new BadRequestException('JPage 响应超过安全大小限制');
      }
      let body: Record<string, unknown> = {};
      if (text) {
        try {
          body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new BadRequestException('JPage 返回了无效 JSON');
        }
      }
      if (!response.ok) {
        const error = typeof body.error === 'string' ? body.error : '';
        throw new BadRequestException(
          `JPage 请求失败（HTTP ${response.status}）${error ? `：${error.slice(0, 160)}` : ''}`,
        );
      }
      return body as T;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (controller.signal.aborted) {
        throw new BadRequestException('JPage 请求超时');
      }
      throw new BadRequestException('JPage 服务暂时不可用');
    } finally {
      clearTimeout(timer);
    }
  }

  private requiredId(value: unknown, label: string) {
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new BadRequestException(`${label}缺失`);
  }

  private sha256(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private isPrivateHostname(hostname: string) {
    if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
    if (!isIP(hostname)) return false;
    if (
      hostname === '::' ||
      hostname === '::1' ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      /^fe[89ab]/.test(hostname)
    ) {
      return true;
    }
    const octets = hostname.split('.').map(Number);
    if (octets.length !== 4) return false;
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }
}
