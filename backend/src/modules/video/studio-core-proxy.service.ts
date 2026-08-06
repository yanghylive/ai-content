import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  /** 登录拿 token（token 无过期时间则缓存 30 分钟） */
  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });
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
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
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
  async proxySse(): Promise<ReadableStream<Uint8Array>> {
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
    return res.body;
  }
}
