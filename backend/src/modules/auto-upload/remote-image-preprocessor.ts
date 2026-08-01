import { Injectable, Logger } from '@nestjs/common';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { AutoUploadPublishPayload } from './auto-upload.client';

const REMOTE_IMG_PATTERN = /<img\s[^>]*\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>/gi;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

export type PreprocessResult = {
  processed: number;
  failed: number;
  body: string;
};

@Injectable()
export class RemoteImagePreprocessor {
  private readonly logger = new Logger(RemoteImagePreprocessor.name);

  async preprocessPayloads(
    payloads: AutoUploadPublishPayload[],
  ): Promise<PreprocessResult> {
    let processed = 0;
    let failed = 0;

    for (const payload of payloads) {
      if (payload.contentKind !== 'article' || !payload.body) continue;
      const result = await this.preprocessBody(payload.body);
      if (result.processed > 0 || result.failed > 0) {
        payload.body = result.body;
      }
      processed += result.processed;
      failed += result.failed;
    }

    if (processed > 0 || failed > 0) {
      this.logger.log(
        `Image preprocessing: ${processed} downloaded, ${failed} failed.`,
      );
    }

    return { processed, failed, body: '' };
  }

  async preprocessBody(body: string): Promise<PreprocessResult> {
    const matches = [...body.matchAll(REMOTE_IMG_PATTERN)];
    if (matches.length === 0) {
      return { processed: 0, failed: 0, body };
    }

    let processed = 0;
    let failed = 0;
    let result = body;

    for (const match of matches) {
      const fullMatch = match[0];
      const url = match[1];
      if (!url || url.startsWith('data:')) continue;

      try {
        const dataUrl = await this.downloadAsDataUrl(url);
        if (dataUrl) {
          result = result.replace(fullMatch, fullMatch.replace(url, dataUrl));
          processed++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    return { processed, failed, body: result };
  }

  private async downloadAsDataUrl(
    url: string,
  ): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        FETCH_TIMEOUT_MS,
      );

      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JIUZHANG-AI/1.0)' },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`Image download failed (${response.status}): ${url}`);
        return null;
      }

      const contentType = (response.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        this.logger.warn(`Unsupported image type "${contentType}": ${url}`);
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
        this.logger.warn(
          `Image size ${buffer.length} out of range (max ${MAX_IMAGE_BYTES}): ${url}`,
        );
        return null;
      }

      const base64 = buffer.toString('base64');
      return `data:${contentType};base64,${base64}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Image download error for ${url}: ${message}`);
      return null;
    }
  }

  async downloadToTempFile(url: string): Promise<string | null> {
    try {
      const dataUrl = await this.downloadAsDataUrl(url);
      if (!dataUrl) return null;

      const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
      const ext = dataUrl.match(/data:image\/(\w+)/)?.[1] || 'jpg';
      const dir = join(tmpdir(), 'jz-remote-images');
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `${hash}.${ext}`);

      const base64 = dataUrl.split(',')[1] || '';
      await writeFile(filePath, Buffer.from(base64, 'base64'));
      return filePath;
    } catch {
      return null;
    }
  }
}
