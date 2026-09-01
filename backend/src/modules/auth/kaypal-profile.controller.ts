import { execFile } from 'child_process';
import { mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { inflateRawSync } from 'zlib';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UnauthorizedException,
  UseInterceptors,
  Optional,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import type { Prisma } from '@prisma/client';
import { safeText } from '../../common/text.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialEnvelopeService } from '../../common/credential-envelope.service';
import {
  encryptSessionToken,
  decryptSessionToken,
} from './session-token-cipher';
import {
  KaypalAuthClient,
  type KaypalDesktopTokenRefreshResult,
} from './kaypal-auth.client';
import { resolveCommercialGrant } from './plan-order';

const execFileAsync = promisify(execFile);

type AuthenticatedRequest = {
  authSessionId?: string;
  authUser?: {
    id: string;
    username?: string | null;
    email?: string | null;
    name?: string | null;
    kaypalUserId?: string | null;
    kaypalPlan?: string | null;
    kaypalPlanExpired?: boolean;
    kaypalRole?: string | null;
    kaypalPlatformRole?: string | null;
    kaypalPermissionNames?: string[];
    kaypalDesktopAccessToken?: string | null;
    kaypalDesktopRefreshToken?: string | null;
    kaypalDesktopTokenExpiresAt?: string | null;
    kaypalDesktopDeviceId?: string | null;
    kaypalLocalOnly?: boolean;
  };
};

class LinkByUserIdDto {
  @IsString()
  @MinLength(1)
  kaypalUserId!: string;
}

class BindWithCredentialsDto {
  @IsString()
  @MinLength(1)
  identifier!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class SearchKaypalKnowledgeDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceTypes?: string[];

  @IsOptional()
  @IsBoolean()
  includeCloud?: boolean;
}

type UploadedKnowledgeFile = {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
};

class CreateKaypalKnowledgeTextDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsBoolean()
  syncCloud?: boolean;
}

class SyncKaypalKnowledgeDto {
  @IsOptional()
  @IsString()
  id?: string;
}

type LocalKnowledgeListItem = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  fileName: string | null;
  contentType: string | null;
  fileSize: number | null;
  parsed: boolean;
  syncStatus: string;
  createdAt: string;
  updatedAt: string;
};

const MOJIBAKE_MARKERS =
  /[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]|[\u0080-\u009f]/;

@Controller('kaypal')
export class KaypalProfileController {
  private readonly desktopTokenRefreshes = new Map<string, Promise<string>>();
  private readonly localKnowledgePlatform = 'LocalKnowledge';

  constructor(
    private readonly prisma: PrismaService,
    private readonly kaypalClient: KaypalAuthClient,
    @Optional() private readonly envelope?: CredentialEnvelopeService,
  ) {}

  private async getLinkedKaypalUserId(req: AuthenticatedRequest) {
    const localUserId = req.authUser?.id;
    if (!localUserId) {
      throw new BadRequestException('当前用户未登录');
    }
    const user = await this.prisma.system.user.findUnique({
      where: { id: localUserId },
      select: { kaypalUserId: true },
    });
    if (!user?.kaypalUserId) {
      throw new BadRequestException(
        '当前本地账号未绑定 Kaypal 账号，请先在账号页绑定',
      );
    }
    return user.kaypalUserId;
  }

  private async getKaypalAccessToken(
    req: AuthenticatedRequest,
    options?: { forceRefresh?: boolean },
  ) {
    await this.getLinkedKaypalUserId(req);
    if (this.isLocalOnlyKaypalSnapshot(req) && !this.hasRealKaypalToken(req)) {
      throw new UnauthorizedException('本地验收会话不调用 Kaypal 云端授权');
    }
    const accessToken = req.authUser?.kaypalDesktopAccessToken?.trim();
    if (
      accessToken &&
      !options?.forceRefresh &&
      !this.isDesktopTokenExpiring(req.authUser?.kaypalDesktopTokenExpiresAt)
    ) {
      return accessToken;
    }

    const refreshToken = req.authUser?.kaypalDesktopRefreshToken?.trim();
    const deviceId = req.authUser?.kaypalDesktopDeviceId?.trim();
    if (!refreshToken || !deviceId || !req.authSessionId) {
      throw new UnauthorizedException(
        'Kaypal 测试站授权已失效，请重新登录 Kaypal 账号',
      );
    }

    const existingRefresh = this.desktopTokenRefreshes.get(req.authSessionId);
    if (existingRefresh) {
      return existingRefresh;
    }

    const refreshTask = this.refreshAndPersistKaypalAccessToken({
      sessionId: req.authSessionId,
      refreshToken,
      deviceId,
    });
    this.desktopTokenRefreshes.set(req.authSessionId, refreshTask);
    try {
      return await refreshTask;
    } finally {
      if (this.desktopTokenRefreshes.get(req.authSessionId) === refreshTask) {
        this.desktopTokenRefreshes.delete(req.authSessionId);
      }
    }
  }

  private isKaypalUnauthorizedError(error: unknown) {
    return /Kaypal 云端返回 401|unauthorized|授权.*失效|授权.*过期/i.test(
      this.getErrorMessage(error),
    );
  }

  private async callKaypalWithFreshToken<T>(
    req: AuthenticatedRequest,
    action: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const accessToken = await this.getKaypalAccessToken(req);
    try {
      return await action(accessToken);
    } catch (error) {
      if (!this.isKaypalUnauthorizedError(error)) {
        throw error;
      }
      const refreshedToken = await this.getKaypalAccessToken(req, {
        forceRefresh: true,
      });
      return action(refreshedToken);
    }
  }

  private async refreshAndPersistKaypalAccessToken(input: {
    sessionId: string;
    refreshToken: string;
    deviceId: string;
  }): Promise<string> {
    const currentSession = await this.prisma.system.userSession.findUnique({
      where: { id: input.sessionId },
      select: { metadata: true },
    });
    const currentMetadata = this.toMetadataRecord(currentSession?.metadata);
    // S4 修复：metadata 中 token 加密存储，读取时解密（兼容存量明文）
    const currentAccessToken = this.envelope
      ? decryptSessionToken(
          this.envelope,
          currentMetadata.kaypalDesktopAccessToken,
        )
      : this.toOptionalString(currentMetadata.kaypalDesktopAccessToken);
    const currentExpiresAt = this.toOptionalString(
      currentMetadata.kaypalDesktopTokenExpiresAt,
    );
    const currentRefreshToken = this.envelope
      ? decryptSessionToken(
          this.envelope,
          currentMetadata.kaypalDesktopRefreshToken,
        )
      : this.toOptionalString(currentMetadata.kaypalDesktopRefreshToken);

    if (
      currentAccessToken &&
      currentRefreshToken &&
      currentRefreshToken !== input.refreshToken &&
      !this.isDesktopTokenExpiring(currentExpiresAt)
    ) {
      return currentAccessToken;
    }

    let refreshed: KaypalDesktopTokenRefreshResult;
    try {
      refreshed = await this.kaypalClient.refreshDesktopAuthToken({
        refreshToken: currentRefreshToken || input.refreshToken,
        deviceId:
          this.toOptionalString(currentMetadata.kaypalDesktopDeviceId) ||
          input.deviceId,
      });
    } catch {
      await this.prisma.system.userSession
        .update({
          where: { id: input.sessionId },
          data: {
            metadata: this.stripKaypalDesktopTokens(
              currentMetadata,
            ) as Prisma.InputJsonObject,
          },
        })
        .catch(() => undefined);
      throw new UnauthorizedException(
        'Kaypal 测试站授权已过期，请重新登录 Kaypal 账号',
      );
    }
    const nextMetadata = {
      // S4 修复：refresh 后写回加密存储
      kaypalDesktopAccessToken: this.envelope
        ? encryptSessionToken(this.envelope, refreshed.access_token)
        : refreshed.access_token,
      kaypalDesktopRefreshToken: this.envelope
        ? encryptSessionToken(this.envelope, refreshed.refresh_token)
        : refreshed.refresh_token,
      kaypalDesktopTokenExpiresAt: new Date(
        Date.now() + refreshed.expires_in * 1000,
      ).toISOString(),
      kaypalDesktopDeviceId: refreshed.device_id || input.deviceId,
    };
    await this.prisma.system.userSession.update({
      where: { id: input.sessionId },
      data: {
        metadata: {
          ...currentMetadata,
          ...nextMetadata,
        },
      },
    });
    return refreshed.access_token;
  }

  private toMetadataRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toOptionalString(value: unknown) {
    return typeof value === 'string' ? value : null;
  }

  private toNumberOrNull(value: unknown) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private stripKaypalDesktopTokens(metadata: Record<string, unknown>) {
    const {
      kaypalDesktopAccessToken: _accessToken,
      kaypalDesktopRefreshToken: _refreshToken,
      kaypalDesktopTokenExpiresAt: _tokenExpiresAt,
      kaypalDesktopDeviceId: _deviceId,
      ...rest
    } = metadata;
    return rest;
  }

  private normalizeKnowledgeText(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private decodePossiblyLatin1Text(value: string | null | undefined) {
    if (!value || !MOJIBAKE_MARKERS.test(value)) {
      return value || '';
    }

    const decodeSegment = (segment: string) => {
      const decoded = Buffer.from(segment, 'latin1').toString('utf8');
      if (!decoded || decoded.includes('\uFFFD')) {
        return segment;
      }
      return decoded;
    };

    if (/[\u4e00-\u9fff]/.test(value)) {
      return value.replace(/[^\s]+/g, (segment) =>
        MOJIBAKE_MARKERS.test(segment) ? decodeSegment(segment) : segment,
      );
    }

    return decodeSegment(value);
  }

  private buildLocalKnowledgeTerms(query: string) {
    return Array.from(
      new Set(
        this.normalizeKnowledgeText(query)
          .toLowerCase()
          .match(/[a-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,}/gi) || [],
      ),
    ).slice(0, 12);
  }

  private localKnowledgeMetadata(extra?: Record<string, unknown>) {
    return {
      knowledgeBase: true,
      source: 'local',
      cloudSyncStatus: 'local_only',
      ...extra,
    } as Prisma.InputJsonObject;
  }

  private buildLocalKnowledgeSnippet(content: string, terms: string[]) {
    const normalized = this.normalizeKnowledgeText(content);
    if (!normalized) return '';
    const lower = normalized.toLowerCase();
    const firstIndex = terms
      .map((term) => lower.indexOf(term.toLowerCase()))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    const start = firstIndex === undefined ? 0 : Math.max(0, firstIndex - 80);
    const snippet = normalized.slice(start, start + 260);
    return `${start > 0 ? '...' : ''}${snippet}${start + 260 < normalized.length ? '...' : ''}`;
  }

  private scoreLocalKnowledge(input: {
    title: string;
    summary?: string | null;
    content?: string | null;
    terms: string[];
    updatedAt: Date;
  }) {
    const title = this.normalizeKnowledgeText(input.title).toLowerCase();
    const summary = this.normalizeKnowledgeText(
      input.summary || '',
    ).toLowerCase();
    const content = this.normalizeKnowledgeText(
      input.content || '',
    ).toLowerCase();
    let score = 0.05;
    for (const term of input.terms) {
      const normalized = term.toLowerCase();
      if (title.includes(normalized)) score += 0.3;
      if (summary.includes(normalized)) score += 0.16;
      if (content.includes(normalized)) score += 0.1;
    }
    const ageMs = Date.now() - input.updatedAt.getTime();
    if (
      Number.isFinite(ageMs) &&
      ageMs >= 0 &&
      ageMs < 14 * 24 * 60 * 60 * 1000
    ) {
      score += 0.04;
    }
    return Math.min(0.95, score);
  }

  private async createLocalKnowledge(input: {
    title: string;
    content: string;
    sourceUrl?: string;
    metadata?: Record<string, unknown>;
    ownerId?: string | null;
    tenantId?: string | null;
  }) {
    const title =
      this.decodePossiblyLatin1Text(input.title).trim().slice(0, 180) ||
      '本地知识';
    const content = this.decodePossiblyLatin1Text(input.content).trim();
    return this.prisma.material.create({
      data: {
        title,
        content,
        summary: content.slice(0, 500),
        sourceUrl: input.sourceUrl || `local://knowledge/${Date.now()}`,
        platform: this.localKnowledgePlatform,
        status: 'mined',
        keywords: this.buildLocalKnowledgeTerms(`${title} ${content}`).slice(
          0,
          8,
        ),
        metadata: this.localKnowledgeMetadata(input.metadata),
        // P1-6 归属：本地知识默认私有，owner 为上传者
        ownerId: input.ownerId ?? null,
        tenantId: input.tenantId ?? null,
        visibility: 'private',
      },
    });
  }

  private async upsertLocalKnowledgeFile(input: {
    fileName: string;
    content: string;
    fileSize?: number;
    contentType?: string;
    parsed: boolean;
    ownerId?: string | null;
    tenantId?: string | null;
  }) {
    const fileName = this.decodePossiblyLatin1Text(input.fileName).trim();
    const content = this.decodePossiblyLatin1Text(input.content).trim();
    const metadata = {
      fileName,
      fileSize: input.fileSize,
      contentType: input.contentType,
      parsed: input.parsed,
    };
    const existing = await this.findExistingLocalKnowledgeFile(
      fileName,
      input.fileSize,
      input.ownerId ?? null,
    );

    if (!existing) {
      return this.createLocalKnowledge({
        title: fileName,
        content,
        sourceUrl: `local://knowledge-file/${fileName || Date.now()}`,
        metadata,
        ownerId: input.ownerId ?? null,
        tenantId: input.tenantId ?? null,
      });
    }

    const existingMetadata = this.toMetadataRecord(existing.metadata);
    const existingParsed = existingMetadata.parsed !== false;
    if (
      !input.parsed &&
      existingParsed &&
      this.isUsefulKnowledgeText(existing.content)
    ) {
      return existing;
    }

    return this.prisma.material.update({
      where: { id: existing.id },
      data: {
        title: fileName,
        content,
        summary: content.slice(0, 500),
        sourceUrl: `local://knowledge-file/${fileName || Date.now()}`,
        keywords: this.buildLocalKnowledgeTerms(`${fileName} ${content}`).slice(
          0,
          8,
        ),
        metadata: this.localKnowledgeMetadata({
          ...existingMetadata,
          ...metadata,
        }),
      },
    });
  }

  private async findExistingLocalKnowledgeFile(
    fileName: string,
    fileSize?: number,
    ownerId?: string | null,
  ) {
    const decodedName = this.decodePossiblyLatin1Text(fileName).trim();
    if (
      !decodedName ||
      typeof fileSize !== 'number' ||
      !Number.isFinite(fileSize)
    ) {
      return null;
    }

    const candidates = await this.prisma.material.findMany({
      where: {
        platform: this.localKnowledgePlatform,
        // P1-6：只查当前 owner 的知识（null owner 兼容旧数据）
        ownerId: ownerId ?? null,
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    const matches = candidates.filter((item) => {
      const identity = this.localKnowledgeFileIdentity(item);
      return (
        identity?.fileName === decodedName && identity.fileSize === fileSize
      );
    });

    return this.pickPreferredLocalKnowledgeFile(matches);
  }

  private localKnowledgeFileIdentity(item: {
    title: string;
    metadata?: Prisma.JsonValue | null;
  }) {
    const metadata = this.toMetadataRecord(item.metadata);
    const fileName = this.decodePossiblyLatin1Text(
      this.toOptionalString(metadata.fileName) || item.title,
    ).trim();
    const fileSize =
      typeof metadata.fileSize === 'number' &&
      Number.isFinite(metadata.fileSize)
        ? metadata.fileSize
        : null;
    if (
      !fileName ||
      typeof fileSize !== 'number' ||
      !Number.isFinite(fileSize)
    ) {
      return null;
    }
    return { fileName, fileSize };
  }

  private pickPreferredLocalKnowledgeFile<
    T extends {
      content?: string | null;
      summary?: string | null;
      metadata?: Prisma.JsonValue | null;
      updatedAt?: Date;
    },
  >(items: T[]) {
    return (
      [...items].sort((left, right) => {
        const leftMetadata = this.toMetadataRecord(left.metadata);
        const rightMetadata = this.toMetadataRecord(right.metadata);
        const leftParsed =
          leftMetadata.parsed !== false &&
          this.isUsefulKnowledgeText(left.content || left.summary || '');
        const rightParsed =
          rightMetadata.parsed !== false &&
          this.isUsefulKnowledgeText(right.content || right.summary || '');
        if (leftParsed !== rightParsed) return leftParsed ? -1 : 1;
        const leftUpdated = left.updatedAt?.getTime?.() || 0;
        const rightUpdated = right.updatedAt?.getTime?.() || 0;
        return rightUpdated - leftUpdated;
      })[0] || null
    );
  }

  private toLocalKnowledgeListItem(item: {
    id: string;
    title: string;
    summary?: string | null;
    content?: string | null;
    sourceUrl: string;
    metadata?: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }): LocalKnowledgeListItem {
    const metadata = this.toMetadataRecord(item.metadata);
    const title = this.decodePossiblyLatin1Text(item.title);
    const summary = this.decodePossiblyLatin1Text(
      item.summary || item.content || '',
    );
    const fileName = this.decodePossiblyLatin1Text(
      this.toOptionalString(metadata.fileName),
    );
    const fileSize =
      typeof metadata.fileSize === 'number' &&
      Number.isFinite(metadata.fileSize)
        ? metadata.fileSize
        : null;
    return {
      id: item.id,
      title,
      summary: this.normalizeKnowledgeText(summary).slice(0, 240),
      sourceUrl: item.sourceUrl,
      fileName: fileName || null,
      contentType: this.toOptionalString(metadata.contentType),
      fileSize,
      parsed:
        metadata.parsed !== false &&
        !this.hasCorruptKnowledgeText(summary || item.content || ''),
      syncStatus:
        this.toOptionalString(metadata.cloudSyncStatus) || 'local_only',
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private isPdfFile(file: UploadedKnowledgeFile) {
    return (
      file.mimetype === 'application/pdf' ||
      /\.pdf$/i.test(file.originalname || '')
    );
  }

  private isMarkItDownKnowledgeFile(file: UploadedKnowledgeFile) {
    const mime = file.mimetype || '';
    return (
      this.isPdfFile(file) ||
      mime.includes('officedocument') ||
      mime.startsWith('image/') ||
      mime.startsWith('audio/') ||
      [
        'application/msword',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint',
        'application/json',
        'application/xml',
        'application/zip',
        'text/html',
        'text/csv',
      ].includes(mime) ||
      /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|csv|html|htm|json|xml|zip|epub|msg|wav|mp3|m4a|jpg|jpeg|png)$/i.test(
        file.originalname || '',
      )
    );
  }

  private isTextKnowledgeFile(file: UploadedKnowledgeFile) {
    const mime = file.mimetype || '';
    return (
      mime.startsWith('text/') ||
      [
        'application/json',
        'application/xml',
        'application/x-ndjson',
        'application/javascript',
      ].includes(mime) ||
      /\.(txt|md|markdown|csv|json|xml|html|htm|log)$/i.test(
        file.originalname || '',
      )
    );
  }

  private isImageFile(file: UploadedKnowledgeFile) {
    const mime = file.mimetype || '';
    return (
      mime.startsWith('image/') ||
      /\.(jpg|jpeg|png|webp|tiff?|bmp)$/i.test(file.originalname || '')
    );
  }

  private isOfficeOpenXmlFile(file: UploadedKnowledgeFile) {
    const name = file.originalname || '';
    const mime = file.mimetype || '';
    return (
      /\.(docx|pptx|xlsx)$/i.test(name) ||
      /officedocument\.(wordprocessingml|presentationml|spreadsheetml)/i.test(
        mime,
      )
    );
  }

  private async extractKnowledgeFileText(file: UploadedKnowledgeFile) {
    if (this.isOfficeOpenXmlFile(file)) {
      const officeText = this.extractOfficeOpenXmlText(file.buffer);
      if (this.isUsefulKnowledgeText(officeText)) return officeText;
    }

    if (this.isMarkItDownKnowledgeFile(file)) {
      const markdown = await this.extractKnowledgeFileTextWithMarkItDown(file);
      if (this.isUsefulKnowledgeText(markdown)) return markdown;
    }

    if (this.isPdfFile(file)) {
      const ocrText = await this.extractPdfTextWithMacVisionOcr(file);
      if (this.isUsefulKnowledgeText(ocrText)) return ocrText;

      let parser:
        | {
            getText: () => Promise<{ text?: string }>;
            destroy?: () => Promise<void>;
          }
        | undefined;
      try {
        const parserModule = await import('pdf-parse');
        parser = new parserModule.PDFParse({ data: file.buffer });
        const parsed = await parser.getText();
        const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
        return this.isUsefulKnowledgeText(text) ? text : '';
      } catch {
        return '';
      } finally {
        if (parser?.destroy) {
          await parser.destroy();
        }
      }
    }
    if (this.isImageFile(file)) {
      const ocrText = await this.extractImageTextWithMacVisionOcr(file);
      if (this.isUsefulKnowledgeText(ocrText)) return ocrText;
    }
    if (this.isTextKnowledgeFile(file)) {
      return file.buffer.toString('utf8').trim();
    }
    return '';
  }

  private extractOfficeOpenXmlText(buffer: Buffer) {
    const entries = this.readZipEntries(buffer);
    const wanted = entries
      .filter((entry) =>
        /^(word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|numbering)\.xml|ppt\/(slides|notesSlides)\/[^/]+\.xml|xl\/(sharedStrings|worksheets\/[^/]+)\.xml)$/i.test(
          entry.name,
        ),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const text = wanted
      .map((entry) =>
        this.xmlToPlainKnowledgeText(entry.content.toString('utf8')),
      )
      .filter(Boolean)
      .join('\n');
    return this.normalizeKnowledgeText(text);
  }

  private readZipEntries(buffer: Buffer) {
    const entries: Array<{ name: string; content: Buffer }> = [];
    const eocdOffset = this.findZipEndOfCentralDirectory(buffer);
    if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) return entries;

    const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
    const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
    let offset = centralDirOffset;
    const centralDirEnd = Math.min(
      buffer.length,
      centralDirOffset + centralDirSize,
    );

    while (
      offset + 46 <= centralDirEnd &&
      buffer.readUInt32LE(offset) === 0x02014b50
    ) {
      const compressionMethod = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const nameStart = offset + 46;
      const nameEnd = nameStart + fileNameLength;
      const name = buffer
        .subarray(nameStart, nameEnd)
        .toString('utf8')
        .replace(/\\/g, '/');

      const content = this.readZipLocalEntry(
        buffer,
        localHeaderOffset,
        compressedSize,
        uncompressedSize,
        compressionMethod,
      );
      if (content) {
        entries.push({ name, content });
      }
      offset = nameEnd + extraLength + commentLength;
    }
    return entries;
  }

  private findZipEndOfCentralDirectory(buffer: Buffer) {
    const minOffset = Math.max(0, buffer.length - 65557);
    for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
      if (buffer.readUInt32LE(offset) === 0x06054b50) {
        return offset;
      }
    }
    return -1;
  }

  private readZipLocalEntry(
    buffer: Buffer,
    localHeaderOffset: number,
    compressedSize: number,
    uncompressedSize: number,
    compressionMethod: number,
  ) {
    if (
      localHeaderOffset < 0 ||
      localHeaderOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      return null;
    }
    const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart < 0 || dataEnd > buffer.length) return null;

    const compressed = buffer.subarray(dataStart, dataEnd);
    try {
      if (compressionMethod === 0) return compressed;
      if (compressionMethod === 8) {
        const inflated = inflateRawSync(compressed);
        if (uncompressedSize && inflated.length !== uncompressedSize) {
          return inflated.subarray(0, Math.max(0, uncompressedSize));
        }
        return inflated;
      }
    } catch {
      return null;
    }
    return null;
  }

  private xmlToPlainKnowledgeText(xml: string) {
    return xml
      .replace(/<[^>]+\/>/g, ' ')
      .replace(/<\/(w:p|a:p|p|row|si|c)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  private isUsefulKnowledgeText(text: string | undefined | null) {
    const normalized = this.normalizeKnowledgeText(text || '');
    if (normalized.length < 8) return false;

    if (this.hasCorruptKnowledgeText(normalized)) return false;

    const visibleLength = normalized.replace(/\s/g, '').length;
    if (!visibleLength) return false;

    const cjkMatches = normalized.match(/[\u4e00-\u9fff]/g)?.length || 0;
    const latinMatches = normalized.match(/[A-Za-z0-9]/g)?.length || 0;
    return cjkMatches + latinMatches >= 8;
  }

  private hasCorruptKnowledgeText(text: string | undefined | null) {
    const normalized = this.normalizeKnowledgeText(text || '');
    if (!normalized) return false;

    const cidMatches = normalized.match(/\(cid:\d+\)/gi)?.length || 0;
    if (cidMatches > 10) return true;

    const visibleLength = normalized.replace(/\s/g, '').length;
    if (!visibleLength) return false;

    const controlMatches =
      // eslint-disable-next-line no-control-regex -- 故意检测控制字符占比（判定乱码/损坏文本）
      normalized.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g)?.length ||
      0;
    return controlMatches / visibleLength > 0.02;
  }

  private async extractPdfTextWithMacVisionOcr(file: UploadedKnowledgeFile) {
    if (process.platform !== 'darwin') return '';

    const tempDir = await mkdtemp(path.join(tmpdir(), 'ai-content-pdf-ocr-'));
    const inputPath = path.join(tempDir, 'input.pdf');
    const outputPrefix = path.join(tempDir, 'page');
    const scriptPath = path.join(tempDir, 'vision-ocr.swift');

    try {
      await writeFile(inputPath, file.buffer);
      await this.execFirstAvailable(
        [
          { bin: '/opt/homebrew/bin/pdftoppm', args: [] },
          { bin: 'pdftoppm', args: [] },
        ],
        ['-png', '-r', '144', inputPath, outputPrefix],
        {
          timeout: 180000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );

      const pageImages = (await readdir(tempDir))
        .filter((name) => /^page-\d+\.png$/i.test(name))
        .sort()
        .map((name) => path.join(tempDir, name));
      if (!pageImages.length) return '';

      await writeFile(scriptPath, this.macVisionOcrSwiftSource());
      const result = await execFileAsync(
        '/usr/bin/swift',
        [scriptPath, ...pageImages],
        {
          encoding: 'utf8',
          timeout: 300000,
          maxBuffer: Math.max(file.buffer.length * 3, 64 * 1024 * 1024),
        },
      );
      return String(result.stdout || '').trim();
    } catch {
      return '';
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async extractImageTextWithMacVisionOcr(file: UploadedKnowledgeFile) {
    if (process.platform !== 'darwin') return '';

    const tempDir = await mkdtemp(path.join(tmpdir(), 'ai-content-image-ocr-'));
    const extension =
      path.extname(file.originalname || '').replace(/[^\w.]/g, '') || '.png';
    const inputPath = path.join(tempDir, `input${extension}`);
    const scriptPath = path.join(tempDir, 'vision-ocr.swift');

    try {
      await writeFile(inputPath, file.buffer);
      await writeFile(scriptPath, this.macVisionOcrSwiftSource());
      const result = await execFileAsync(
        '/usr/bin/swift',
        [scriptPath, inputPath],
        {
          encoding: 'utf8',
          timeout: 120000,
          maxBuffer: Math.max(file.buffer.length * 2, 16 * 1024 * 1024),
        },
      );
      return String(result.stdout || '').trim();
    } catch {
      return '';
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async execFirstAvailable(
    commands: Array<{ bin: string; args: string[] }>,
    args: string[],
    options: {
      timeout: number;
      maxBuffer: number;
    },
  ) {
    let lastError: unknown;
    for (const command of commands) {
      try {
        return await execFileAsync(command.bin, [...command.args, ...args], {
          encoding: 'utf8',
          timeout: options.timeout,
          maxBuffer: options.maxBuffer,
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private macVisionOcrSwiftSource() {
    return `
import Foundation
import Vision
import AppKit

for imagePath in CommandLine.arguments.dropFirst() {
  autoreleasepool {
    let url = URL(fileURLWithPath: imagePath)
    guard
      let image = NSImage(contentsOf: url),
      let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cgImage = bitmap.cgImage
    else {
      return
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
      try handler.perform([request])
      let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
      if !lines.isEmpty {
        print(lines.joined(separator: "\\n"))
        print("\\n--- PAGE ---\\n")
      }
    } catch {
      return
    }
  }
}
`;
  }

  private async extractKnowledgeFileTextWithMarkItDown(
    file: UploadedKnowledgeFile,
  ) {
    const commands = this.resolveMarkItDownCommands();
    if (commands.length === 0) return '';

    const tempDir = await mkdtemp(
      path.join(tmpdir(), 'ai-content-markitdown-'),
    );
    const safeName =
      path
        .basename(file.originalname || 'knowledge-source')
        .replace(/[^\w .-]/g, '_') || 'knowledge-source';
    const inputPath = path.join(tempDir, safeName);

    try {
      await writeFile(inputPath, file.buffer);
      for (const command of commands) {
        try {
          const result = await execFileAsync(
            command.bin,
            [...command.args, inputPath],
            {
              encoding: 'utf8',
              timeout: 180000,
              maxBuffer: Math.max(file.buffer.length * 4, 64 * 1024 * 1024),
            },
          );
          const text = String(result.stdout || '').trim();
          if (text) return text;
        } catch {
          continue;
        }
      }
      return '';
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private resolveMarkItDownCommands() {
    const configured = process.env.MARKITDOWN_COMMAND?.trim();
    if (configured) {
      const parts = configured.split(/\s+/).filter(Boolean);
      const [bin, ...args] = parts;
      return bin ? [{ bin, args }] : [];
    }

    return [
      { bin: 'markitdown', args: [] },
      {
        bin: '/opt/homebrew/bin/uvx',
        args: ['--from', 'markitdown[all]', 'markitdown'],
      },
      {
        bin: 'uvx',
        args: ['--from', 'markitdown[all]', 'markitdown'],
      },
    ];
  }

  private async searchLocalKnowledge(
    query: string,
    limit: number,
    ownerId?: string | null,
  ) {
    const terms = this.buildLocalKnowledgeTerms(query);
    const searchTerms = terms.length ? terms : [query];
    const candidates = await this.prisma.material.findMany({
      where: {
        platform: this.localKnowledgePlatform,
        // P1-6：只搜当前 owner 的知识
        ownerId: ownerId ?? null,
        OR: searchTerms.flatMap((term) => [
          { title: { contains: term } },
          { summary: { contains: term } },
          { content: { contains: term } },
        ]),
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(limit * 4, 20),
    });
    return candidates
      .map((item) => {
        const metadata = this.toMetadataRecord(item.metadata);
        return {
          assetId: item.id,
          title: item.title,
          sourceType: 'local',
          sourceUrl: item.sourceUrl,
          snippet: this.buildLocalKnowledgeSnippet(
            item.content || item.summary || item.title,
            terms,
          ),
          relevanceScore: this.scoreLocalKnowledge({
            title: item.title,
            summary: item.summary,
            content: item.content,
            terms,
            updatedAt: item.updatedAt,
          }),
          rankingReason: 'local_match',
          indexedAt: item.updatedAt.toISOString(),
          chunkId: null,
          chunkIndex: null,
          syncStatus:
            typeof metadata.cloudSyncStatus === 'string'
              ? metadata.cloudSyncStatus
              : 'local_only',
        };
      })
      .filter((item) => item.snippet)
      .sort((left, right) => right.relevanceScore - left.relevanceScore)
      .slice(0, limit);
  }

  private async syncLocalKnowledgeToCloud(
    req: AuthenticatedRequest,
    id: string,
  ) {
    const item = await this.prisma.material.findUnique({ where: { id } });
    if (!item || item.platform !== this.localKnowledgePlatform) {
      throw new BadRequestException('本地知识不存在');
    }
    const content = item.content || item.summary || '';
    if (!content.trim()) {
      throw new BadRequestException('本地知识内容为空，不能同步');
    }
    const filename = `${item.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.txt`;
    const result = await this.callKaypalWithFreshToken(req, (accessToken) =>
      this.kaypalClient.uploadCloudKnowledge(accessToken, {
        files: [
          {
            buffer: Buffer.from(content, 'utf8'),
            filename,
            contentType: 'text/plain;charset=utf-8',
          },
        ],
      }),
    );
    await this.prisma.material.update({
      where: { id },
      data: {
        metadata: this.localKnowledgeMetadata({
          ...this.toMetadataRecord(item.metadata),
          cloudSyncStatus: 'synced',
          cloudSyncedAt: new Date().toISOString(),
          cloudUploadTotal: result.total,
        }),
      },
    });
    return result;
  }

  private extractSubscriptionMetadata(value: unknown) {
    const record = this.asRecord(value) || {};
    const data = this.asRecord(record.data) || record;
    const subscription =
      this.asRecord(data.subscription) ||
      this.asRecord(record.subscription) ||
      data;
    const planRecord = this.asRecord(subscription.plan);
    const plan =
      this.toOptionalString(planRecord?.legacyId) ||
      this.toOptionalString(planRecord?.code) ||
      this.toOptionalString(planRecord?.id) ||
      this.toOptionalString(subscription.plan) ||
      this.toOptionalString(subscription.subscriptionPlan);
    const periodEnd =
      this.toOptionalString(subscription.periodEnd) ||
      this.toOptionalString(subscription.currentPeriodEnd) ||
      this.toOptionalString(subscription.endDate) ||
      this.toOptionalString(subscription.nextBillingDate) ||
      this.toOptionalString(subscription.subscriptionPeriodEnd);

    return {
      plan: plan?.trim() || '',
      periodEnd: periodEnd?.trim() || null,
    };
  }

  private async syncSessionSubscriptionMetadata(
    req: AuthenticatedRequest,
    subscriptionPayload: unknown,
  ) {
    if (!req.authSessionId) return;
    const extracted = this.extractSubscriptionMetadata(subscriptionPayload);
    if (!extracted.plan) return;

    const session = await this.prisma.system.userSession.findUnique({
      where: { id: req.authSessionId },
      select: { metadata: true },
    });
    const metadata = this.toMetadataRecord(session?.metadata);
    await this.prisma.system.userSession.update({
      where: { id: req.authSessionId },
      data: {
        metadata: {
          ...metadata,
          kaypalSubscriptionPlan: extracted.plan,
          kaypalSubscriptionPeriodEnd: extracted.periodEnd,
          kaypalMetadataSyncedAt: new Date().toISOString(),
        },
      },
    });
  }

  private extractBillingBalanceValue(value: unknown) {
    const record = this.asRecord(value);
    if (!record) return null;
    const nestedBalance = this.asRecord(record.balance);
    return (
      (typeof record.balance === 'number' || typeof record.balance === 'string'
        ? record.balance
        : nestedBalance?.balance) ??
      record.creditBalance ??
      record.credit_balance ??
      record.remainingBalance ??
      record.remaining_balance ??
      record.balanceAfter ??
      record.balance_after ??
      record.credits ??
      record.points ??
      record.availablePoints ??
      record.available_points ??
      record.availableCredits ??
      record.available_credits ??
      null
    );
  }

  private extractBillingBalanceMetadata(billingPayload: unknown) {
    const billingRecord = this.toMetadataRecord(billingPayload);
    const balanceRecord = this.toMetadataRecord(billingRecord.balance);
    const raw = this.toMetadataRecord(balanceRecord.raw);
    const data = this.toMetadataRecord(raw.data);
    const user = this.asRecord(data.user) || this.asRecord(raw.user) || {};
    const balance = this.toNumberOrNull(
      this.extractBillingBalanceValue(balanceRecord) ??
        this.extractBillingBalanceValue(data) ??
        this.extractBillingBalanceValue(user) ??
        this.extractBillingBalanceValue(raw),
    );
    if (balance === null) return null;
    return {
      balance,
      userId:
        this.toOptionalString(balanceRecord.userId) ||
        this.toOptionalString(data.userId) ||
        this.toOptionalString(data.user_id) ||
        this.toOptionalString(user.id),
    };
  }

  private async getSessionMetadata(req: AuthenticatedRequest) {
    if (!req.authSessionId) return {};
    const session = await this.prisma.system.userSession.findUnique({
      where: { id: req.authSessionId },
      select: { metadata: true },
    });
    return this.toMetadataRecord(session?.metadata);
  }

  private buildLocalBalanceSnapshot(
    req: AuthenticatedRequest,
    message: string,
  ) {
    return {
      balance: null,
      unavailable: true,
      source: 'kaypal-cloud-billing',
      message,
    };
  }

  private async syncSessionBillingMetadata(
    req: AuthenticatedRequest,
    billingPayload: unknown,
  ) {
    if (!req.authSessionId) return;
    const extracted = this.extractBillingBalanceMetadata(billingPayload);
    if (!extracted) return;

    const metadata = await this.getSessionMetadata(req);
    await this.prisma.system.userSession.update({
      where: { id: req.authSessionId },
      data: {
        metadata: {
          ...metadata,
          kaypalCreditBalance: extracted.balance,
          kaypalCreditBalanceUserId: extracted.userId || null,
          kaypalCreditBalanceSyncedAt: new Date().toISOString(),
        },
      },
    });
  }

  private isDesktopTokenExpiring(value?: string | null) {
    if (!value) return true;
    const expiresAt = new Date(value).getTime();
    if (!Number.isFinite(expiresAt)) return true;
    return expiresAt - Date.now() < 60_000;
  }

  private getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : safeText(error || '');
  }

  private async canReadKaypalCloudProfile(req: AuthenticatedRequest) {
    if (this.isLocalOnlyKaypalSnapshot(req) && !this.hasRealKaypalToken(req)) {
      return false;
    }
    try {
      await this.callKaypalWithFreshToken(req, (accessToken) =>
        this.kaypalClient.getCloudProfile(accessToken),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async formatKnowledgeCloudWarning(
    req: AuthenticatedRequest,
    error: unknown,
  ) {
    const message = this.getErrorMessage(error) || 'Kaypal 云端暂时不可用';
    if (this.isKaypalUnauthorizedError(error)) {
      if (await this.canReadKaypalCloudProfile(req)) {
        return '本机知识已保存，可本机检索使用；Kaypal 登录已生效，但云端知识库接口未放行当前桌面授权，请开通知识库 API 权限后再同步。';
      }
      return '本机知识已保存，可本机检索使用；Kaypal 云端授权已失效，请重新登录后再同步到团队知识库。';
    }
    return `本机知识已保存，可本机检索使用；云端同步未完成：${message}`;
  }

  private async formatKnowledgeSearchCloudWarning(
    req: AuthenticatedRequest,
    error: unknown,
  ) {
    const message = this.getErrorMessage(error) || 'Kaypal 主知识库暂时不可用';
    if (this.isKaypalUnauthorizedError(error)) {
      if (await this.canReadKaypalCloudProfile(req)) {
        return 'Kaypal 登录已生效，但云端知识库检索接口未放行当前桌面授权。';
      }
      return 'Kaypal 云端授权已失效，请重新登录后再检索团队知识库。';
    }
    return message;
  }

  private canUseLocalKaypalSnapshot(req: AuthenticatedRequest) {
    const user = req.authUser;
    return Boolean(
      user?.kaypalUserId &&
      (user.kaypalDesktopAccessToken || user.kaypalDesktopRefreshToken),
    );
  }

  private isLocalOnlyKaypalSnapshot(req: AuthenticatedRequest) {
    return req.authUser?.kaypalLocalOnly === true;
  }

  /** localOnly 会话是否带真实云 token（扫码/密码登录 guard 标记 localOnly，但桌面 token 是 kda_ 开头、真实有效） */
  private hasRealKaypalToken(req: AuthenticatedRequest) {
    const token = req.authUser?.kaypalDesktopAccessToken?.trim() || '';
    return token.startsWith('kda_');
  }

  private hasKaypalCloudSession(req: AuthenticatedRequest) {
    const user = req.authUser;
    if (!user?.id) return false;
    if (user.kaypalLocalOnly === true) return true;
    return Boolean(
      user.kaypalUserId &&
      (user.kaypalDesktopAccessToken || user.kaypalDesktopRefreshToken),
    );
  }

  private buildLocalSubscriptionSnapshot(
    req: AuthenticatedRequest,
    error: unknown,
  ) {
    const plan =
      req.authUser?.kaypalPlan && !req.authUser.kaypalPlanExpired
        ? req.authUser.kaypalPlan
        : 'FREE';
    const expired = req.authUser?.kaypalPlanExpired === true;
    const message = this.getErrorMessage(error) || 'Kaypal 云端暂时不可用';
    return {
      plan,
      status: expired ? 'expired' : 'active',
      renewsAt: null,
      periodEnd: null,
      expired,
      features: [],
      unavailable: true,
      source: 'local-session-cache',
      message,
      warning: `Kaypal 云端暂时不可用，已使用本机授权缓存：${message}`,
    };
  }

  private buildLocalProfileSnapshot(req: AuthenticatedRequest, error: unknown) {
    const user = req.authUser;
    const message = this.getErrorMessage(error) || 'Kaypal 云端暂时不可用';
    return {
      userId: user?.kaypalUserId || user?.id || '',
      username: user?.username || user?.email || user?.kaypalUserId || '',
      email: user?.email || '',
      displayName:
        user?.name || user?.username || user?.email || user?.kaypalUserId || '',
      avatarUrl: null,
      createdAt: '',
      updatedAt: '',
      subscriptionPlan: user?.kaypalPlan || null,
      role: user?.kaypalRole || null,
      platformRole: user?.kaypalPlatformRole || null,
      permissions: user?.kaypalPermissionNames || [],
      unavailable: true,
      source: 'local-session-cache',
      message,
      warning: `Kaypal 云端暂时不可用，已使用本机授权缓存：${message}`,
    };
  }

  @Get('profile')
  async getProfile(@Req() req: AuthenticatedRequest) {
    if (!this.hasKaypalCloudSession(req)) {
      return this.buildLocalProfileSnapshot(
        req,
        new Error('本地账号未绑定 Kaypal 云端'),
      );
    }
    if (this.isLocalOnlyKaypalSnapshot(req) && !this.hasRealKaypalToken(req)) {
      return this.buildLocalProfileSnapshot(req, new Error('本地验收授权快照'));
    }
    try {
      const profile = await this.callKaypalWithFreshToken(req, (accessToken) =>
        this.kaypalClient.getCloudProfile(accessToken),
      );
      const profileRecord = this.toMetadataRecord(profile);
      if (
        this.canUseLocalKaypalSnapshot(req) &&
        !this.toOptionalString(profileRecord.userId)
      ) {
        return this.buildLocalProfileSnapshot(
          req,
          new Error('Kaypal 云端 profile 为空'),
        );
      }
      return profile;
    } catch (error) {
      if (!this.canUseLocalKaypalSnapshot(req)) {
        throw error;
      }
      return this.buildLocalProfileSnapshot(req, error);
    }
  }

  @Get('devices')
  async getDevices(@Req() req: AuthenticatedRequest) {
    if (
      !this.hasKaypalCloudSession(req) ||
      (this.isLocalOnlyKaypalSnapshot(req) && !this.hasRealKaypalToken(req))
    ) {
      return [];
    }
    return this.callKaypalWithFreshToken(req, (accessToken) =>
      Promise.resolve(this.kaypalClient.getCloudDevices(accessToken)),
    );
  }

  @Get('subscription')
  async getSubscription(@Req() req: AuthenticatedRequest) {
    if (!this.hasKaypalCloudSession(req)) {
      return this.buildLocalSubscriptionSnapshot(
        req,
        new Error('本地账号未绑定 Kaypal 云端'),
      );
    }
    if (this.isLocalOnlyKaypalSnapshot(req) && !this.hasRealKaypalToken(req)) {
      return this.buildLocalSubscriptionSnapshot(
        req,
        new Error('本地验收授权快照'),
      );
    }
    try {
      const subscription = await this.callKaypalWithFreshToken(
        req,
        (accessToken) => this.kaypalClient.getCloudSubscription(accessToken),
      );
      await this.syncSessionSubscriptionMetadata(req, subscription);
      return subscription;
    } catch (error) {
      if (!this.canUseLocalKaypalSnapshot(req)) {
        throw error;
      }
      return this.buildLocalSubscriptionSnapshot(req, error);
    }
  }

  @Get('billing')
  async getBilling(@Req() req: AuthenticatedRequest) {
    if (!this.hasKaypalCloudSession(req)) {
      const message = '本地账号未绑定 Kaypal 云端';
      const kaypalUserId = req.authUser?.kaypalUserId?.trim();
      if (kaypalUserId) {
        try {
          const billing = await this.kaypalClient.getCloudBilling('', {
            userId: kaypalUserId,
          });
          const billingRecord = this.toMetadataRecord(billing);
          const balanceRecord = this.toMetadataRecord(billingRecord.balance);
          const balanceValue = this.toNumberOrNull(balanceRecord.balance);
          if (balanceRecord.unavailable !== true && balanceValue !== null) {
            await this.syncSessionBillingMetadata(req, billing);
            return {
              ...billing,
              subscription: this.buildLocalSubscriptionSnapshot(
                req,
                new Error('Kaypal 云端登录授权未同步'),
              ),
            };
          }
          return {
            subscription: this.buildLocalSubscriptionSnapshot(
              req,
              new Error(message),
            ),
            balance: this.buildLocalBalanceSnapshot(
              req,
              this.toOptionalString(balanceRecord.message) ||
                'Kaypal 云端余额暂时不可用',
            ),
          };
        } catch (error) {
          return {
            subscription: this.buildLocalSubscriptionSnapshot(req, error),
            balance: this.buildLocalBalanceSnapshot(
              req,
              this.getErrorMessage(error) || 'Kaypal 云端余额暂时不可用',
            ),
          };
        }
      }
      return {
        subscription: this.buildLocalSubscriptionSnapshot(
          req,
          new Error(message),
        ),
        balance: this.buildLocalBalanceSnapshot(req, message),
      };
    }
    if (this.isLocalOnlyKaypalSnapshot(req) && !this.hasRealKaypalToken(req)) {
      const message = '本地验收授权快照';
      return {
        subscription: this.buildLocalSubscriptionSnapshot(
          req,
          new Error(message),
        ),
        balance: this.buildLocalBalanceSnapshot(req, message),
      };
    }
    try {
      const billing = await this.callKaypalWithFreshToken(req, (accessToken) =>
        this.kaypalClient.getCloudBilling(accessToken, {
          userId: req.authUser?.kaypalUserId || null,
        }),
      );
      const billingRecord = this.toMetadataRecord(billing);
      const subscriptionRecord = this.toMetadataRecord(
        billingRecord.subscription,
      );
      let billingResult = billing;
      let shouldSyncBillingBalance = false;
      const balanceRecord = this.toMetadataRecord(billingRecord.balance);
      const balanceValue = this.toNumberOrNull(balanceRecord.balance);
      if (balanceRecord.unavailable === true || balanceValue === null) {
        const unavailableMessage =
          this.toOptionalString(balanceRecord.message) ||
          'Kaypal 云端余额暂时不可用';
        billingResult = {
          ...billing,
          balance: this.buildLocalBalanceSnapshot(req, unavailableMessage),
        };
      } else {
        shouldSyncBillingBalance = true;
      }
      if (
        this.canUseLocalKaypalSnapshot(req) &&
        subscriptionRecord.unavailable === true
      ) {
        if (shouldSyncBillingBalance) {
          await this.syncSessionBillingMetadata(req, billing);
        }
        return {
          ...billingResult,
          subscription: this.buildLocalSubscriptionSnapshot(
            req,
            new Error(
              this.toOptionalString(subscriptionRecord.message) ||
                'Kaypal 云端订阅暂时不可用',
            ),
          ),
        };
      }
      await this.syncSessionSubscriptionMetadata(
        req,
        billingRecord.subscription || billing,
      );
      if (shouldSyncBillingBalance) {
        await this.syncSessionBillingMetadata(req, billing);
      }
      return billingResult;
    } catch (error) {
      if (!this.canUseLocalKaypalSnapshot(req)) {
        throw error;
      }
      const message =
        this.getErrorMessage(error) || 'Kaypal 云端余额暂时不可用';
      return {
        subscription: this.buildLocalSubscriptionSnapshot(req, error),
        balance: this.buildLocalBalanceSnapshot(req, message),
      };
    }
  }

  @Post('knowledge/search')
  @HttpCode(200)
  async searchKnowledge(
    @Req() req: AuthenticatedRequest,
    @Body() body: SearchKaypalKnowledgeDto,
  ) {
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (!query) {
      throw new BadRequestException('知识库检索 query 不能为空');
    }
    const limit =
      typeof body.limit === 'number' && Number.isFinite(body.limit)
        ? Math.max(1, Math.min(20, Math.floor(body.limit)))
        : 8;
    const localMatches = await this.searchLocalKnowledge(
      query,
      limit,
      req.authUser?.id ?? null,
    );
    let cloudWarning = '';
    let cloudMatches: Array<Record<string, unknown>> = [];
    if (this.isLocalOnlyKaypalSnapshot(req) && !this.hasRealKaypalToken(req)) {
      cloudWarning = '本地验收会话已跳过 Kaypal 主知识库';
    } else if (body.includeCloud !== false) {
      try {
        const cloud = await this.callKaypalWithFreshToken(req, (accessToken) =>
          this.kaypalClient.searchCloudKnowledge(accessToken, {
            query,
            limit,
            sourceTypes: Array.isArray(body.sourceTypes)
              ? body.sourceTypes.filter(
                  (item): item is string => typeof item === 'string',
                )
              : undefined,
          }),
        );
        cloudMatches = cloud.matches.map((item) => ({
          ...item,
          sourceType: item.sourceType || 'cloud',
          syncStatus: 'cloud',
        }));
      } catch (error) {
        cloudWarning = await this.formatKnowledgeSearchCloudWarning(req, error);
      }
    }
    const matches = [...localMatches, ...cloudMatches]
      .sort((left, right) => {
        const leftScore =
          typeof left.relevanceScore === 'number' ? left.relevanceScore : 0;
        const rightScore =
          typeof right.relevanceScore === 'number' ? right.relevanceScore : 0;
        return rightScore - leftScore;
      })
      .slice(0, limit);
    return {
      query,
      tenantId: '',
      total: matches.length,
      matches,
      diagnostics: {
        localHitCount: localMatches.length,
        cloudHitCount: cloudMatches.length,
        cloudWarning,
      },
    };
  }

  @Get('knowledge/local')
  async listLocalKnowledge(@Req() req: AuthenticatedRequest) {
    const items = await this.prisma.material.findMany({
      where: {
        platform: this.localKnowledgePlatform,
        // P1-6：只列当前 owner 的知识
        ownerId: req.authUser?.id ?? null,
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const groups = new Map<string, typeof items>();
    const passthroughItems: typeof items = [];
    for (const item of items) {
      const identity = this.localKnowledgeFileIdentity(item);
      if (!identity) {
        passthroughItems.push(item);
        continue;
      }
      const key = `${identity.fileName}:${identity.fileSize}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    const dedupedItems = [
      ...passthroughItems,
      ...Array.from(groups.values())
        .map((group) => this.pickPreferredLocalKnowledgeFile(group))
        .filter((item): item is (typeof items)[number] => Boolean(item)),
    ].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
    return {
      total: dedupedItems.length,
      items: dedupedItems.map((item) => this.toLocalKnowledgeListItem(item)),
    };
  }

  @Post('knowledge/uploads')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      // multipart 层限制，避免超大文档在 PDF/OCR 解析前就占满内存（P1-9）
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  async uploadKnowledgeFile(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: UploadedKnowledgeFile | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请选择要上传到知识库的文件');
    }
    const fileName =
      this.decodePossiblyLatin1Text(file.originalname) ||
      'knowledge-source.txt';
    const normalizedFile = {
      ...file,
      originalname: fileName,
    };
    const text = await this.extractKnowledgeFileText(normalizedFile);
    const parsed = Boolean(text);
    const item = await this.upsertLocalKnowledgeFile({
      fileName,
      content:
        text ||
        `[未解析文件] ${fileName} 已保存到本机知识库，但当前未能提取可检索文本。`,
      fileSize: file.size,
      contentType: file.mimetype,
      parsed,
      ownerId: req.authUser?.id ?? null,
      tenantId: null,
    });
    return { items: [item], total: 1, local: true, parsed };
  }

  @Delete('knowledge/local/:id')
  async deleteLocalKnowledge(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const item = await this.prisma.material.findUnique({ where: { id } });
    if (!item || item.platform !== this.localKnowledgePlatform) {
      throw new BadRequestException('本机知识不存在');
    }
    // P1-6：只能删自己的知识；ownerId 为 null 的旧数据（归属不明）禁止删除
    const ownerId = req.authUser?.id ?? null;
    if (item.ownerId !== ownerId) {
      throw new ForbiddenException('无权删除他人的知识');
    }
    await this.prisma.material.delete({ where: { id } });
    return { ok: true, id };
  }

  @Post('knowledge/text')
  @HttpCode(201)
  async createKnowledgeText(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateKaypalKnowledgeTextDto,
  ) {
    const content =
      typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) {
      throw new BadRequestException('知识库内容不能为空');
    }
    const safeTitle =
      typeof body?.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : 'ai-content-knowledge';
    const filename = `${safeTitle.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.txt`;
    const item = await this.createLocalKnowledge({
      title: safeTitle,
      content,
      sourceUrl: `local://knowledge-text/${Date.now()}`,
      metadata: { fileName: filename, contentType: 'text/plain' },
      ownerId: req.authUser?.id ?? null,
      tenantId: null,
    });
    if (body.syncCloud === true) {
      try {
        const cloud = await this.syncLocalKnowledgeToCloud(req, item.id);
        return { items: [item], total: 1, local: true, cloud };
      } catch (error) {
        return {
          items: [item],
          total: 1,
          local: true,
          cloudWarning: await this.formatKnowledgeCloudWarning(req, error),
        };
      }
    }
    return { items: [item], total: 1, local: true };
  }

  @Post('knowledge/sync')
  @HttpCode(200)
  async syncKnowledge(
    @Req() req: AuthenticatedRequest,
    @Body() body: SyncKaypalKnowledgeDto,
  ) {
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) {
      throw new BadRequestException('本地知识 ID 不能为空');
    }
    try {
      const cloud = await this.syncLocalKnowledgeToCloud(req, id);
      return { ok: true, id, cloud };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      return {
        ok: false,
        id,
        cloud: null,
        cloudWarning: await this.formatKnowledgeCloudWarning(req, error),
      };
    }
  }

  @Post('link')
  @HttpCode(200)
  async linkKaypalAccount(
    @Req() req: AuthenticatedRequest,
    @Body() body: LinkByUserIdDto,
  ) {
    const localUserId = req.authUser?.id;
    if (!localUserId) {
      throw new BadRequestException('当前用户未登录');
    }
    const kaypalUserId = body.kaypalUserId.trim();
    if (!kaypalUserId) {
      throw new BadRequestException('kaypalUserId 不能为空');
    }
    const existing = await this.prisma.system.user.findUnique({
      where: { kaypalUserId },
      select: { id: true },
    });
    if (existing && existing.id !== localUserId) {
      throw new BadRequestException('该 Kaypal 账号已绑定到其他本地账号');
    }
    await this.prisma.system.user.update({
      where: { id: localUserId },
      data: { kaypalUserId },
    });
    return { ok: true, kaypalUserId };
  }

  @Post('bind-with-credentials')
  @HttpCode(200)
  async bindWithCredentials(
    @Req() req: AuthenticatedRequest,
    @Body() body: BindWithCredentialsDto,
  ) {
    const localUserId = req.authUser?.id;
    if (!localUserId) {
      throw new UnauthorizedException('当前用户未登录');
    }
    const identifier = body.identifier.trim();

    // KaypalAuthClient 已经把 401/400 转成 UnauthorizedException，其他转成 ServiceUnavailable
    const cloudUser = await this.kaypalClient.login(identifier, body.password);

    if (!cloudUser?.id) {
      throw new BadRequestException('Kaypal 登录返回数据不完整');
    }

    const existing = await this.prisma.system.user.findUnique({
      where: { kaypalUserId: cloudUser.id },
      select: { id: true },
    });
    if (existing && existing.id !== localUserId) {
      throw new BadRequestException('该 Kaypal 账号已绑定到其他本地账号');
    }

    const grant = resolveCommercialGrant({
      subscriptionPlan: cloudUser.subscriptionPlan,
      subscriptionPeriodEnd: cloudUser.subscriptionPeriodEnd,
    });
    await this.prisma.system.user.update({
      where: { id: localUserId },
      data: {
        kaypalUserId: cloudUser.id,
        commercialExecutionAllowed: grant.commercialExecutionAllowed,
        planMode: grant.planMode,
      },
    });

    return {
      ok: true,
      kaypalUserId: cloudUser.id,
      email: cloudUser.email,
      displayName: cloudUser.name,
    };
  }

  @Post('unlink')
  @HttpCode(200)
  async unlinkKaypalAccount(@Req() req: AuthenticatedRequest) {
    const localUserId = req.authUser?.id;
    if (!localUserId) {
      throw new UnauthorizedException('当前用户未登录');
    }
    await this.prisma.system.user.update({
      where: { id: localUserId },
      data: { kaypalUserId: null },
    });
    return { ok: true };
  }
}
