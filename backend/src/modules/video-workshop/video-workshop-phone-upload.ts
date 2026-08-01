import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import {
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  mkdir,
} from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { networkInterfaces } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolveProjectDataPath } from '../../common/project-paths';
import { createQrDataUrl } from './video-workshop-qr';
import type {
  VideoWorkshopMaterialFile,
  VideoWorkshopPhoneUploadSession,
} from './video-workshop.types';

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const SESSION_TTL_MS = 10 * 60 * 1000;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

type StoredPhoneUploadSession = VideoWorkshopPhoneUploadSession & {
  tokenHash: string;
  claimedAt?: string;
};

@Injectable()
export class VideoWorkshopPhoneUploadService implements OnModuleDestroy {
  private readonly sessions = new Map<string, StoredPhoneUploadSession>();
  private readonly activeRequests = new Map<string, IncomingMessage>();
  private server: Server | null = null;
  private serverPort = 0;
  private initialization: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  async onModuleDestroy() {
    for (const request of this.activeRequests.values()) request.destroy();
    if (!this.server) return;
    await new Promise<void>((resolveClose) =>
      this.server?.close(() => resolveClose()),
    );
    this.server = null;
  }

  async createSession(maxBytes?: number) {
    await this.ensureInitialized();
    await this.ensureServer();
    const token = randomBytes(24).toString('base64url');
    const now = new Date();
    const session: StoredPhoneUploadSession = {
      id: randomUUID(),
      tokenHash: this.hashToken(token),
      status: 'pending',
      progress: 0,
      bytesReceived: 0,
      maxBytes: this.readMaxBytes(maxBytes),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    };
    const advertisedHost = this.advertisedHost();
    const uploadUrl = `http://${advertisedHost.host}:${this.serverPort}/upload/${token}`;
    const qrDataUrl = createQrDataUrl(uploadUrl);
    this.sessions.set(session.id, session);
    await this.persist();
    return this.toPublicSession(session, {
      uploadUrl,
      qrDataUrl,
      reachableFromPhone: advertisedHost.reachableFromPhone,
      networkHint: advertisedHost.reachableFromPhone
        ? '手机与电脑连接同一局域网后扫码上传。'
        : '未检测到局域网地址，此链接目前只能在本机打开。',
    });
  }

  async getSession(id: string) {
    await this.ensureInitialized();
    const session = this.requireSession(id);
    await this.expireIfNeeded(session);
    return this.toPublicSession(session);
  }

  async cancelSession(id: string) {
    await this.ensureInitialized();
    const session = this.requireSession(id);
    if (
      ['succeeded', 'failed', 'cancelled', 'expired'].includes(session.status)
    ) {
      return this.toPublicSession(session);
    }
    session.status = 'cancelled';
    session.updatedAt = new Date().toISOString();
    session.error = '手机上传已取消';
    this.activeRequests.get(id)?.destroy();
    await this.persist();
    return this.toPublicSession(session);
  }

  private async ensureInitialized() {
    if (!this.initialization) {
      this.initialization = this.loadSessions();
    }
    await this.initialization;
  }

  private async loadSessions() {
    try {
      const parsed = JSON.parse(
        await readFile(this.storePath(), 'utf8'),
      ) as unknown;
      if (!Array.isArray(parsed)) return;
      const now = Date.now();
      for (const value of parsed) {
        if (!value || typeof value !== 'object') continue;
        const session = value as StoredPhoneUploadSession;
        if (!session.id || !session.tokenHash || !session.expiresAt) continue;
        if (
          ['pending', 'uploading'].includes(session.status) ||
          new Date(session.expiresAt).getTime() <= now
        ) {
          session.status = 'expired';
          session.error = '上传链接已过期，请重新生成';
          session.updatedAt = new Date().toISOString();
        }
        this.sessions.set(session.id, session);
      }
      await this.persist();
    } catch {
      return;
    }
  }

  private async ensureServer() {
    if (this.server?.listening) return;
    const requestedPort = Number.parseInt(
      process.env.VIDEO_WORKSHOP_PHONE_UPLOAD_PORT || '0',
      10,
    );
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server.requestTimeout = 15 * 60 * 1000;
    this.server.headersTimeout = 15000;
    await new Promise<void>((resolveListen, rejectListen) => {
      this.server?.once('error', rejectListen);
      this.server?.listen(
        Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 0,
        '0.0.0.0',
        () => resolveListen(),
      );
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('无法启动手机上传服务');
    }
    this.serverPort = address.port;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    try {
      const url = new URL(request.url || '/', 'http://local-upload');
      const match = url.pathname.match(/^\/upload\/([A-Za-z0-9_-]{20,80})$/);
      if (!match) {
        this.sendText(response, 404, '上传链接不存在');
        return;
      }
      const session = this.findByToken(match[1]);
      if (!session) {
        this.sendText(response, 404, '上传链接无效');
        return;
      }
      await this.expireIfNeeded(session);
      if (request.method === 'GET') {
        if (session.status !== 'pending') {
          this.sendText(
            response,
            session.status === 'succeeded' ? 200 : 410,
            session.status === 'succeeded'
              ? '文件已经上传完成，可以关闭此页面。'
              : session.error || '上传链接已失效',
          );
          return;
        }
        this.sendUploadPage(response, session);
        return;
      }
      if (request.method === 'POST') {
        await this.receiveUpload(request, response, session);
        return;
      }
      response.setHeader('Allow', 'GET, POST');
      this.sendText(response, 405, '不支持该请求方式');
    } catch (error) {
      this.sendJson(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : '手机上传失败',
      });
    }
  }

  private async receiveUpload(
    request: IncomingMessage,
    response: ServerResponse,
    session: StoredPhoneUploadSession,
  ) {
    if (session.status !== 'pending' || session.claimedAt) {
      this.sendJson(response, 409, { ok: false, message: '上传链接已经使用' });
      return;
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.expireIfNeeded(session);
      this.sendJson(response, 410, { ok: false, message: '上传链接已过期' });
      return;
    }
    const parsedContentLength = Number(request.headers['content-length']);
    const contentLength =
      Number.isFinite(parsedContentLength) && parsedContentLength >= 0
        ? parsedContentLength
        : undefined;
    if (contentLength !== undefined && contentLength > session.maxBytes) {
      this.sendJson(response, 413, {
        ok: false,
        message: '文件超过上传大小限制',
      });
      return;
    }
    const contentType = String(request.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!this.isAllowedContentType(contentType)) {
      this.sendJson(response, 415, {
        ok: false,
        message: '只支持视频或图片文件',
      });
      return;
    }

    const rawName = this.decodeFileName(request.headers['x-file-name']);
    const safeName = this.safeFileName(rawName, contentType);
    if (!safeName || !this.kindFromPath(safeName)) {
      this.sendJson(response, 415, { ok: false, message: '文件格式不受支持' });
      return;
    }
    const materialDir = resolveProjectDataPath('materials');
    await mkdir(materialDir, { recursive: true });
    const outputPath = this.uniquePath(materialDir, safeName);
    const tempPath = join(
      materialDir,
      `.${basename(outputPath)}.${session.id}.partial`,
    );
    session.claimedAt = new Date().toISOString();
    session.updatedAt = session.claimedAt;
    this.activeRequests.set(session.id, request);
    await this.persist();

    let bytesReceived = 0;
    let lastPersistedAt = 0;
    try {
      const meter = new Transform({
        transform: (value, _encoding, callback) => {
          void (async () => {
            if (this.isCancelled(session)) throw new Error('手机上传已取消');
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            bytesReceived += chunk.length;
            if (bytesReceived > session.maxBytes) {
              throw new BadRequestException('文件超过上传大小限制');
            }
            if (session.status === 'pending') session.status = 'uploading';
            session.bytesReceived = bytesReceived;
            session.progress = contentLength
              ? Math.min(98, Math.round((bytesReceived / contentLength) * 98))
              : Math.min(
                  95,
                  Math.round((bytesReceived / session.maxBytes) * 95),
                );
            session.updatedAt = new Date().toISOString();
            if (Date.now() - lastPersistedAt >= 250) {
              lastPersistedAt = Date.now();
              await this.persist();
            }
            callback(null, chunk);
          })().catch((error) => callback(error as Error));
        },
      });
      await pipeline(
        request,
        meter,
        createWriteStream(tempPath, { flags: 'wx' }),
      );
      if (this.isCancelled(session)) throw new Error('手机上传已取消');
      if (!bytesReceived) throw new BadRequestException('上传文件为空');

      const detectedKind = await this.detectKind(tempPath);
      const expectedKind = this.kindFromPath(safeName);
      if (!detectedKind || detectedKind !== expectedKind) {
        throw new BadRequestException('文件内容与扩展名不匹配');
      }
      await rename(tempPath, outputPath);
      if (this.isCancelled(session)) {
        await rm(outputPath, { force: true });
        throw new Error('手机上传已取消');
      }
      const materialStat = await stat(outputPath);
      const material: VideoWorkshopMaterialFile = {
        id: `${Math.round(materialStat.mtimeMs)}-${basename(outputPath)}`,
        name: basename(outputPath),
        path: outputPath,
        kind: detectedKind,
        sizeBytes: materialStat.size,
        updatedAt: new Date(materialStat.mtimeMs).toISOString(),
      };
      session.status = 'succeeded';
      session.progress = 100;
      session.bytesReceived = materialStat.size;
      session.updatedAt = new Date().toISOString();
      session.material = material;
      delete session.error;
      await this.persist();
      this.sendJson(response, 201, {
        ok: true,
        message: '文件已上传到视频工坊素材库',
        material: { name: material.name, sizeBytes: material.sizeBytes },
      });
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      if (!this.isCancelled(session)) {
        session.status = 'failed';
        session.error =
          error instanceof Error
            ? error.message
            : '手机上传失败，请重新生成链接';
        session.updatedAt = new Date().toISOString();
        await this.persist();
      }
      if (!response.headersSent) {
        this.sendJson(
          response,
          error instanceof BadRequestException ? 400 : 500,
          {
            ok: false,
            message: session.error || '手机上传失败',
          },
        );
      } else {
        response.destroy();
      }
    } finally {
      this.activeRequests.delete(session.id);
    }
  }

  private sendUploadPage(
    response: ServerResponse,
    session: StoredPhoneUploadSession,
  ) {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    );
    response.end(this.uploadPageHtml(session.maxBytes));
  }

  private uploadPageHtml(maxBytes: number) {
    const maxMb = Math.floor(maxBytes / 1024 / 1024);
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>视频工坊手机上传</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#172033;font:16px/1.5 system-ui,-apple-system,sans-serif}.wrap{max-width:560px;margin:0 auto;padding:24px 18px}.panel{background:#fff;border:1px solid #dfe3ea;border-radius:8px;padding:22px}.eyebrow{margin:0 0 4px;color:#687386;font-size:13px}.title{margin:0;font-size:24px}.hint{margin:10px 0 20px;color:#5d687a}.picker{display:block;width:100%;padding:18px;border:1px dashed #9aa5b5;border-radius:8px;background:#f8fafc}.button{width:100%;min-height:48px;margin-top:14px;border:0;border-radius:7px;background:#2563eb;color:#fff;font-weight:700;font-size:16px}.button:disabled{opacity:.45}.status{min-height:24px;margin:16px 0 0;color:#4b5563}.bar{height:10px;margin-top:10px;overflow:hidden;border:1px solid #dfe3ea;border-radius:5px;background:#eef1f5}.fill{height:100%;width:0;background:#2563eb;transition:width .15s}.done{color:#147d46}.error{color:#b42318}
  </style>
</head>
<body><main class="wrap"><section class="panel">
  <p class="eyebrow">Kaypal Video Workshop</p><h1 class="title">上传手机素材</h1>
  <p class="hint">选择视频或图片，文件会传到当前电脑的本机素材库。单个文件最大 ${maxMb} MB。</p>
  <input id="file" class="picker" type="file" accept="video/*,image/jpeg,image/png,image/webp">
  <button id="upload" class="button" type="button" disabled>开始上传</button>
  <div class="bar" aria-hidden="true"><div id="fill" class="fill"></div></div>
  <p id="status" class="status">尚未选择文件</p>
</section></main>
<script>
const fileInput=document.getElementById('file');const button=document.getElementById('upload');const status=document.getElementById('status');const fill=document.getElementById('fill');
fileInput.addEventListener('change',()=>{const file=fileInput.files&&fileInput.files[0];button.disabled=!file;status.className='status';status.textContent=file?file.name:'尚未选择文件';fill.style.width='0%'});
button.addEventListener('click',()=>{const file=fileInput.files&&fileInput.files[0];if(!file)return;button.disabled=true;fileInput.disabled=true;status.className='status';status.textContent='正在上传，请不要关闭页面';const xhr=new XMLHttpRequest();xhr.open('POST',location.pathname);xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));xhr.upload.onprogress=(event)=>{if(event.lengthComputable){const percent=Math.min(98,Math.round(event.loaded/event.total*98));fill.style.width=percent+'%';status.textContent='正在上传 '+percent+'%'}};xhr.onload=()=>{let payload={};try{payload=JSON.parse(xhr.responseText)}catch{}if(xhr.status>=200&&xhr.status<300){fill.style.width='100%';status.className='status done';status.textContent=payload.message||'上传完成，可以关闭此页面'}else{status.className='status error';status.textContent=payload.message||'上传失败，请在电脑端重新生成链接'}};xhr.onerror=()=>{status.className='status error';status.textContent='网络中断，请在电脑端重新生成链接'};xhr.send(file)});
</script></body></html>`;
  }

  private async detectKind(path: string) {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
        return 'video' as const;
      }
      if (
        bytesRead >= 4 &&
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
      ) {
        return 'video' as const;
      }
      if (
        bytesRead >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      ) {
        return 'image' as const;
      }
      if (
        bytesRead >= 8 &&
        buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ) {
        return 'image' as const;
      }
      if (
        bytesRead >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
      ) {
        return 'image' as const;
      }
      return null;
    } finally {
      await handle.close();
    }
  }

  private isCancelled(session: StoredPhoneUploadSession) {
    return session.status === 'cancelled';
  }

  private advertisedHost() {
    const configured = process.env.VIDEO_WORKSHOP_PHONE_UPLOAD_HOST?.trim();
    if (configured && configured !== '0.0.0.0') {
      return {
        host: configured.replace(/^\[|\]$/g, ''),
        reachableFromPhone:
          configured !== '127.0.0.1' && configured !== 'localhost',
      };
    }
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) {
          return { host: entry.address, reachableFromPhone: true };
        }
      }
    }
    return { host: '127.0.0.1', reachableFromPhone: false };
  }

  private findByToken(token: string) {
    const hash = this.hashToken(token);
    return Array.from(this.sessions.values()).find(
      (session) => session.tokenHash === hash,
    );
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private requireSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException('手机上传会话不存在');
    return session;
  }

  private async expireIfNeeded(session: StoredPhoneUploadSession) {
    if (
      ['pending', 'uploading'].includes(session.status) &&
      new Date(session.expiresAt).getTime() <= Date.now()
    ) {
      session.status = 'expired';
      session.error = '上传链接已过期，请重新生成';
      session.updatedAt = new Date().toISOString();
      this.activeRequests.get(session.id)?.destroy();
      await this.persist();
    }
  }

  private toPublicSession(
    session: StoredPhoneUploadSession,
    transient: Partial<VideoWorkshopPhoneUploadSession> = {},
  ): VideoWorkshopPhoneUploadSession {
    return {
      id: session.id,
      status: session.status,
      progress: session.progress,
      bytesReceived: session.bytesReceived,
      maxBytes: session.maxBytes,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      error: session.error,
      material: session.material,
      ...transient,
    };
  }

  private storePath() {
    return resolveProjectDataPath(
      'video-workshop',
      'phone-upload-sessions.json',
    );
  }

  private persist() {
    const snapshot = JSON.stringify(
      Array.from(this.sessions.values()),
      null,
      2,
    );
    this.writeQueue = this.writeQueue.then(async () => {
      const path = this.storePath();
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, path);
    });
    return this.writeQueue;
  }

  private readMaxBytes(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_MAX_BYTES;
    return Math.max(
      1024 * 1024,
      Math.min(DEFAULT_MAX_BYTES, Math.round(parsed)),
    );
  }

  private decodeFileName(value: string | string[] | undefined) {
    const raw = Array.isArray(value) ? value[0] : value || '';
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  private safeFileName(value: string, contentType: string) {
    const fallbackExtension: Record<string, string> = {
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/webm': '.webm',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    const baseName = basename(value || `phone-upload-${Date.now()}`);
    const withoutControlCharacters = Array.from(baseName)
      .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .join('');
    const cleaned = withoutControlCharacters
      .replace(/[\\/:"*?<>|]+/g, '-')
      .trim()
      .slice(0, 100);
    const extension = extname(cleaned).toLowerCase();
    if (VIDEO_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension)) {
      return cleaned;
    }
    return `${basename(cleaned, extension) || `phone-upload-${Date.now()}`}${fallbackExtension[contentType] || ''}`;
  }

  private kindFromPath(path: string): VideoWorkshopMaterialFile['kind'] | null {
    const extension = extname(path).toLowerCase();
    if (VIDEO_EXTENSIONS.has(extension)) return 'video';
    if (IMAGE_EXTENSIONS.has(extension)) return 'image';
    return null;
  }

  private isAllowedContentType(value: string) {
    return (
      value.startsWith('video/') ||
      [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/octet-stream',
      ].includes(value)
    );
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

  private sendText(response: ServerResponse, status: number, message: string) {
    response.statusCode = status;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(message);
  }

  private sendJson(response: ServerResponse, status: number, value: unknown) {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(value));
  }
}
