import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as net from 'node:net';
import { GenerateVideoDto } from './dto/generate-video.dto';
import { VideoProjectListQueryDto } from './dto/video-project-list-query.dto';

/**
 * studio_core 反代 service（真实 HTTP 接入）
 *
 * D1=B：通过 HTTP 反代到 studio_core FastAPI dashboard (8610)
 * 边界清晰、热更新友好、不污染 NestJS 主进程。
 *
 * 真实端点（8610，比 8600 stdlib 多单项目详情/SSE/control）：
 *   POST /api/auth/login                {username,password} → {token,...}
 *   GET  /api/projects                  项目列表（scan_projects）
 *   GET  /api/projects/{pid}            单项目详情
 *   POST /api/projects                  {prompt,pipeline} → 202 {status,project}
 *   POST /api/projects/{pid}/control    {action: retry|approve|...}
 *   GET  /media/{pid}/{file_path}       项目产物（compose.mp4 等），需登录
 *   GET  /api/events                    SSE 全量项目快照（5s/次）
 *   GET  /api/pipelines                 流水线列表 [{value,label}]
 *
 * 鉴权：studio_core 用独立账号（STUDIO_CORE_USER/PASSWORD，默认 admin/admin123），
 * 与 JIUZHANG 会话解耦；token 缓存 + 401 自动重登一次。
 */
@Injectable()
export class StudioCoreProxyService {
  private readonly logger = new Logger(StudioCoreProxyService.name);
  private readonly baseUrl =
    process.env.STUDIO_CORE_SSE_URL?.replace(/\/+$/, '') ||
    'http://127.0.0.1:8610';
  private readonly username =
    process.env.STUDIO_CORE_USERNAME || process.env.STUDIO_CORE_USER || 'admin';
  private readonly password = process.env.STUDIO_CORE_PASSWORD || 'admin123';

  private token: string | null = null;
  private tokenExpiresAt = 0;

  /** base url 是否指向本机回环地址 */
  private isLoopbackBaseUrl(): boolean {
    try {
      const host = new URL(this.baseUrl).hostname;
      return host === '127.0.0.1' || host === 'localhost' || host === '::1';
    } catch {
      return false;
    }
  }

  /** 快速探测本地端口是否可连（不可连立即 reject，避免长挂） */
  private assertPortOpen(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl);
      const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
      const socket = new net.Socket();
      const done = (err: Error | null) => {
        socket.destroy();
        if (err) reject(err);
        else resolve();
      };
      socket.setTimeout(timeoutMs);
      socket.once('error', () =>
        done(new Error(`studio_core 不可达（${this.baseUrl}）`)),
      );
      socket.once('timeout', () =>
        done(new Error(`studio_core 连接超时（${this.baseUrl}）`)),
      );
      socket.connect(port, url.hostname, () => done(null));
    });
  }

  /** 登录拿 token（token 无过期时间则缓存 30 分钟） */
  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }
    // 2026-08-28：本机/打包态通常没有 studio_core（默认 127.0.0.1:8610），
    // 原先无超时保护会把用户请求挂到 TCP 超时（数分钟）才回退云端通道。
    // 这里对「本地地址」先做 1.5s 端口探测，连不上立即抛错交给上层回退。
    if (this.isLoopbackBaseUrl()) {
      await this.assertPortOpen(1500);
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.username,
          password: this.password,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      // 2026-08-28 Win 真机：原生 fetch 失败抛 TypeError(fetch failed)，
      // 若直接冒泡会绕过 VideoService 的回退 catch（未处理异常 → 500）。
      // 统一规范化为 ServiceUnavailableException，保证上层按「不可达」回退云端通道。
      const cause =
        (error as { cause?: { code?: string; message?: string } })?.cause
          ?.code ||
        (error as { cause?: { message?: string } })?.cause?.message ||
        (error instanceof Error ? error.message : String(error));
      throw new ServiceUnavailableException(
        `studio_core 不可达（${this.baseUrl}）：${cause}`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `studio_core 登录失败（${res.status}）: ${await res.text()}`,
      );
    }
    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      throw new Error('studio_core 登录响应缺少 token');
    }
    this.token = data.token;
    this.tokenExpiresAt = Date.now() + 30 * 60 * 1000;
    return data.token;
  }

  /** 通用请求：带 token，401 时重登重试一次 */
  private async request(
    path: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<Response> {
    const token = await this.ensureToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...((init.headers as Record<string, string>) || {}),
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const cause =
        (error as { cause?: { code?: string } })?.cause?.code ||
        (error instanceof Error ? error.message : String(error));
      throw new ServiceUnavailableException(
        `studio_core 请求失败（${this.baseUrl}${path}）：${cause}`,
      );
    }
    if (res.status === 401 && !retried) {
      this.token = null;
      this.tokenExpiresAt = 0;
      return this.request(path, init, true);
    }
    return res;
  }

  /** 提交视频生成任务：POST /api/projects {prompt, pipeline} */
  async postGenerate(dto: GenerateVideoDto): Promise<{
    project_id: string;
    status: string;
    message?: string;
  }> {
    this.logger.log(
      `postGenerate: ${this.baseUrl}/api/projects pipeline=${dto.pipeline}`,
    );
    const res = await this.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: dto.prompt, pipeline: dto.pipeline }),
    });
    if (!res.ok) {
      throw new Error(
        `studio_core 创建项目失败（${res.status}）: ${await res.text()}`,
      );
    }
    const data = (await res.json()) as { status: string; project: string };
    return {
      project_id: data.project,
      status: data.status || 'queued',
      message: `studio_core 已受理（${data.status}）`,
    };
  }

  /** 查询项目列表：GET /api/projects */
  async getProjects(query: VideoProjectListQueryDto): Promise<{
    projects: Array<Record<string, unknown>>;
    total: number;
  }> {
    this.logger.log(`getProjects: ${this.baseUrl}/api/projects`);
    const res = await this.request('/api/projects');
    if (!res.ok) {
      throw new Error(
        `studio_core 查询项目失败（${res.status}）: ${await res.text()}`,
      );
    }
    const projects = (await res.json()) as Array<Record<string, unknown>>;
    // 客户端筛选：pipeline / status（scan_projects 的 pipeline 字段是中文 label，宽松匹配）
    let filtered = projects;
    if (query.pipeline) {
      const needle = query.pipeline.toLowerCase();
      filtered = filtered.filter((p) => {
        const label = typeof p.pipeline === 'string' ? p.pipeline : '';
        return label.toLowerCase().includes(needle);
      });
    }
    if (query.status) {
      filtered = filtered.filter((p) => this.projectStatus(p) === query.status);
    }
    // 分页
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;
    const start = (page - 1) * pageSize;
    const pageItems = filtered.slice(start, start + pageSize);
    return { projects: pageItems, total: filtered.length };
  }

  /** 项目总体状态（用于 status 筛选）：done / failed / running / queued */
  private projectStatus(p: Record<string, unknown>): string {
    if (p.halted) return 'failed';
    const stages = Array.isArray(p.stages)
      ? (p.stages as Array<Record<string, unknown>>)
      : [];
    if (stages.length === 0) return 'queued';
    if (stages.every((s) => s.status === 'done' || s.status === 'skipped'))
      return 'done';
    if (stages.some((s) => s.status === 'running')) return 'running';
    if (stages.some((s) => s.status === 'pending')) return 'running';
    return 'failed';
  }

  /** 查询单个项目：GET /api/projects/{pid} */
  async getProject(id: string): Promise<Record<string, unknown> | null> {
    this.logger.log(`getProject: ${this.baseUrl}/api/projects/${id}`);
    const res = await this.request(`/api/projects/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `studio_core 查询项目失败（${res.status}）: ${await res.text()}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  }

  /** 获取项目产物（compose.mp4）：GET /media/{pid}/compose.mp4 */
  async getComposeMp4(id: string): Promise<{
    buffer: Buffer;
    contentType: string;
    length: number;
  }> {
    this.logger.log(`getComposeMp4: ${this.baseUrl}/media/${id}/compose.mp4`);
    const res = await this.request(
      `/media/${encodeURIComponent(id)}/compose.mp4`,
    );
    if (res.status === 404) {
      throw new NotFoundException(
        `视频项目 ${id} 无 compose.mp4 产物（可能未完成或已失败）`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `studio_core 获取产物失败（${res.status}）: ${await res.text()}`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: res.headers.get('content-type') || 'video/mp4',
      length: arrayBuffer.byteLength,
    };
  }

  /** 查询流水线列表：GET /api/pipelines */
  async getPipelines(): Promise<Array<{ value: string; label: string }>> {
    this.logger.log(`getPipelines: ${this.baseUrl}/api/pipelines`);
    const res = await this.request('/api/pipelines');
    if (!res.ok) {
      throw new Error(
        `studio_core 查询流水线失败（${res.status}）: ${await res.text()}`,
      );
    }
    return (await res.json()) as Array<{ value: string; label: string }>;
  }

  /**
   * SSE 实时进度推送：反代 8610 /api/events（每 5s 全量快照）
   * 返回可迭代的原始 SSE 文本块（由 controller 透传或包装）。
   */
  async proxySse(projectId?: string): Promise<ReadableStream<Uint8Array>> {
    this.logger.log(`proxySse: ${this.baseUrl}/api/events`);
    const token = await this.ensureToken();
    const res = await fetch(`${this.baseUrl}/api/events`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `studio_core SSE 连接失败（${res.status}）: ${await res.text()}`,
      );
    }
    if (!res.body) {
      throw new Error('studio_core SSE 响应无 body');
    }
    // 2026-09-01（复核 P1-6）：原实现忽略 :id 透传全量项目快照——账号 A 订阅
    // :id 会收到所有项目的事件。指定 projectId 时解析 SSE 帧，只透传该项目的
    // 快照（数组/含 projects 字段/单对象三种形态都处理；ping/心跳帧不转发）。
    if (!projectId) {
      return res.body;
    }
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    const filterFrame = (frame: string): Uint8Array | null =>
      this.filterSseFrame(frame, projectId, encoder);
    return res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const forwarded = filterFrame(frame);
            if (forwarded) {
              controller.enqueue(forwarded);
            }
          }
        },
        flush(controller) {
          if (buffer.trim()) {
            const forwarded = filterFrame(buffer);
            if (forwarded) {
              controller.enqueue(forwarded);
            }
          }
        },
      }),
    );
  }

  /** 按项目 id 过滤单个 SSE 帧；不匹配返回 null */
  private filterSseFrame(
    frame: string,
    projectId: string,
    encoder: TextEncoder,
  ): Uint8Array | null {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) {
      return null;
    }
    const raw = dataLine.slice(5).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null; // 非 JSON 帧（注释/心跳）不转发
    }
    const match = (item: unknown): boolean =>
      String((item as { id?: unknown })?.id) === projectId;
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter(match);
      if (filtered.length === 0) return null;
      return encoder.encode(`data: ${JSON.stringify(filtered)}\n\n`);
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { projects?: unknown }).projects)
    ) {
      const record = parsed as { projects: Array<unknown> };
      const filtered = record.projects.filter(match);
      if (filtered.length === 0) return null;
      return encoder.encode(
        `data: ${JSON.stringify({ ...record, projects: filtered })}\n\n`,
      );
    }
    if (match(parsed)) {
      return encoder.encode(`${frame}\n\n`);
    }
    return null;
  }
}
