import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * studio_core（8600）视频引擎客户端 —— D3 对接
 *
 * 链路：login(admin) → createProject → createTask(type=流水线, brief=选题)
 * → 轮询 getTask（script 阶段后 awaiting_approval）→ approveGate
 * → getDeliverables（成片下载）
 *
 * executor 用 real_demo（真实厂商 API 跑全流程）；dry_run 仅模拟。
 */
@Injectable()
export class StudioCoreClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('STUDIO_CORE_URL') || 'http://127.0.0.1:8600'
    ).replace(/\/+$/, '');
    this.username =
      this.configService.get<string>('STUDIO_CORE_USERNAME') || 'admin';
    this.password =
      this.configService.get<string>('STUDIO_CORE_PASSWORD') || 'admin123';
  }

  /** 获取有效 token（缓存 50 分钟，过期自动重登） */
  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt) return this.token;
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        throw new Error(`studio_core 登录失败（${response.status}）`);
      }
      const data = (await response.json()) as { token?: string };
      if (!data.token) throw new Error('studio_core 登录返回异常');
      this.token = data.token;
      this.tokenExpiresAt = now + 50 * 60 * 1000;
      return data.token;
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : '视频引擎不可用',
      );
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401) {
      this.token = null;
      throw new ServiceUnavailableException('视频引擎会话失效，请重试');
    }
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new ServiceUnavailableException(
        detail.detail || `视频引擎请求失败（${response.status}）`,
      );
    }
    return response.json();
  }

  /** 创建项目（dashboard 链路：prompt + pipeline，创建即自动生成） */
  async createProject(input: { prompt: string; pipeline: string }) {
    const data = (await this.request('POST', '/api/projects', {
      prompt: input.prompt,
      pipeline: input.pipeline,
    })) as { status?: string; project?: string };
    if (!data.project) throw new ServiceUnavailableException('视频引擎创建项目失败');
    return { id: data.project };
  }

  /** 查询项目状态（含 stages 各阶段进度） */
  async getProject(projectId: string) {
    return (await this.request(
      'GET',
      `/api/projects/${projectId}`,
    )) as {
      id: string;
      title: string;
      pipeline: string;
      status?: string;
      stages?: Array<{ name: string; status: string }>;
    };
  }

  /** 批准/重试 Gate（approve 过 script Gate 继续生成） */
  async approveGate(projectId: string, action = 'approve') {
    return (await this.request('POST', `/api/projects/${projectId}/control`, {
      action,
      actor: 'jiuzhang-ai',
    })) as Record<string, unknown>;
  }

  /** 项目产物（成片清单） */
  async getDeliverables(projectId: string) {
    return (await this.request(
      'GET',
      `/api/projects/${projectId}/deliverables`,
    )) as unknown[];
  }
}
