import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { KaypalProviderResolver } from '../ai-models/kaypal-provider.resolver';

/**
 * 万相 Wan i2v 视频生成（数字人 talking-head 底座）
 *
 * 2026-08-09 起统一走 kaypal 云端网关：
 *  - 提交：POST {网关}/api/ai/v1/video/generations（云端转发百炼 video-synthesis）
 *  - 查询：GET  {网关}/api/ai/v1/video/generations?id=<taskId>
 *  - 鉴权：x-kaypal-api-key（服务商 Key）+ x-kaypal-user-id（计费归属）
 *  - 计费：由云端按用户归属统一记账，本地不再持有任何云厂商 Key，
 *    也不再本地预扣（避免与云端记账双扣）。
 */

interface WanTaskRecord {
  taskId: string;
  externalId: string;
  status: 'queued' | 'submitting' | 'rendering' | 'ready' | 'failed';
  progress: number;
  error?: string;
  videoUrl?: string;
  createdAt: number;
  userId?: string;
}

const DEFAULT_VIDEO_MODEL = 'wan2.7-i2v-2026-04-25';

@Injectable()
export class WanI2vService {
  private readonly logger = new Logger(WanI2vService.name);
  private readonly tasks = new Map<string, WanTaskRecord>();

  constructor(private readonly config: ConfigService) {}

  private readConfig(key: string): string {
    return (
      this.config?.get<string>(key)?.trim() || process.env[key]?.trim() || ''
    );
  }

  /** kaypal 云端网关地址（与 voice/ai-client 同源） */
  private getGatewayBaseUrl(): string {
    // Stage 1A：base url 统一经 KaypalProviderResolver 校验 host（fail-closed），
    // 避免 env 被改成第三方/恶意域名后请求带着凭据直接打过去。
    const authBase = KaypalProviderResolver.resolveBaseUrlFrom([
      this.readConfig('KAYPAL_AUTH_BASE_URL'),
    ]);
    return KaypalProviderResolver.resolveBaseUrlFrom([
      this.readConfig('KAYPAL_AI_PROXY_BASE_URL'),
      `${authBase}/api/ai`,
    ]);
  }

  /** 服务商 Key（x-kaypal-api-key），本地不持有云厂商 Key */
  private getServerApiKey(): string {
    return (
      this.readConfig('KAYPAL_AI_PROXY_API_KEY') ||
      this.readConfig('KAYPAL_API_KEY') ||
      ''
    );
  }

  private pricePerSecond(): number {
    const raw = this.config.get<string>('KAYPAL_AI_VIDEO_PRICE_PER_SEC');
    const n = raw ? Number.parseFloat(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 0.6;
  }

  /**
   * 提交视频生成任务（图片首帧 → 视频）
   */
  async createTask(
    input: {
      imageDataUrl: string;
      prompt: string;
      duration: number;
      aspect?: string;
    },
    user?: Record<string, unknown> | null,
  ): Promise<{ taskId: string; estimatedCost: number; status: string }> {
    const duration = Math.min(Math.max(Math.round(input.duration) || 5, 2), 15);
    const estimatedCost = Number((duration * this.pricePerSecond()).toFixed(2));

    const serverKey = this.getServerApiKey();
    const userId =
      (typeof user?.kaypalUserId === 'string' && user.kaypalUserId) ||
      (typeof user?.id === 'string' && user.id) ||
      '';
    if (!serverKey) {
      throw new ServiceUnavailableException('视频生成服务暂不可用，请稍后重试');
    }
    if (!userId) {
      throw new ServiceUnavailableException(
        '视频生成需要当前登录用户授权，请在「账号与设备」重新登录后再试',
      );
    }

    const gatewayBase = this.getGatewayBaseUrl();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-kaypal-api-key': serverKey,
      'x-kaypal-user-id': userId,
    };

    let resp: Response;
    try {
      resp = await fetch(`${gatewayBase}/v1/video/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: DEFAULT_VIDEO_MODEL,
          input: {
            imageUrl: input.imageDataUrl,
            prompt: input.prompt.slice(0, 5000),
            duration,
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      this.logger.error(`视频生成网关提交异常：${String(e)}`);
      throw new ServiceUnavailableException('视频生成网关不可达，请稍后重试');
    }
    const payload = (await resp.json().catch(() => null)) as {
      taskId?: string;
      error?: { message?: string } | string;
      message?: string;
    } | null;
    if (!resp.ok || !payload?.taskId) {
      const message =
        (typeof payload?.error === 'object' && payload.error?.message) ||
        (typeof payload?.error === 'string' ? payload.error : '') ||
        payload?.message ||
        `HTTP ${resp.status}`;
      if (/余额不足|积分不足|insufficient/i.test(message)) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_CREDITS',
          message: `云积分不足（视频生成约 ${estimatedCost} 元/秒计费），请充值或稍后再试`,
          amount: estimatedCost,
          kind: 'video_generation',
        });
      }
      throw new ServiceUnavailableException(`视频生成失败：${message}`);
    }

    const taskId = randomUUID();
    this.tasks.set(taskId, {
      taskId,
      externalId: payload.taskId,
      status: 'submitting',
      progress: 5,
      createdAt: Date.now(),
      userId,
    });
    this.logger.log(
      `wan i2v 任务已提交(云端网关): ${taskId} ext=${payload.taskId} 约¥${estimatedCost}/次`,
    );
    return { taskId, estimatedCost, status: 'submitting' };
  }

  /**
   * 查询任务：本地状态 + 必要时轮询云端网关
   */
  async getTask(taskId: string): Promise<WanTaskRecord> {
    const rec = this.tasks.get(taskId);
    if (!rec) {
      throw new NotFoundException('视频生成任务不存在');
    }
    if (rec.status === 'ready' || rec.status === 'failed') {
      return rec;
    }
    await this.syncFromGateway(rec);
    return rec;
  }

  private async syncFromGateway(rec: WanTaskRecord): Promise<void> {
    const serverKey = this.getServerApiKey();
    if (!serverKey) return;
    try {
      const resp = await fetch(
        `${this.getGatewayBaseUrl()}/v1/video/generations?id=${encodeURIComponent(rec.externalId)}`,
        {
          headers: {
            'x-kaypal-api-key': serverKey,
            'x-kaypal-user-id': rec.userId || '',
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
      const payload = (await resp.json().catch(() => null)) as {
        status?: string;
        progress?: number | null;
        videoUrl?: string | null;
        error?: { message?: string } | string;
      } | null;
      if (!resp.ok || !payload) {
        this.logger.warn(`视频网关查询失败 ${rec.taskId}: HTTP ${resp.status}`);
        return;
      }
      const raw = (payload.status || '').toUpperCase();
      rec.progress = Math.max(rec.progress, Number(payload.progress) || 0);
      if (raw === 'SUCCEEDED') {
        rec.status = 'ready';
        rec.progress = 100;
        rec.videoUrl = payload.videoUrl || rec.videoUrl;
      } else if (raw === 'FAILED') {
        rec.status = 'failed';
        rec.error =
          (typeof payload.error === 'object' && payload.error?.message) ||
          '视频渲染失败';
      } else {
        rec.status =
          raw === 'PENDING' || raw === 'QUEUED' ? 'queued' : 'rendering';
      }
    } catch (e) {
      this.logger.warn(`视频网关轮询异常 ${rec.taskId}: ${String(e)}`);
    }
  }

  /**
   * 取成片文件流（ready 后调用）
   */
  async download(
    taskId: string,
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const rec = this.tasks.get(taskId);
    if (!rec) {
      throw new NotFoundException('视频生成任务不存在');
    }
    if (rec.status !== 'ready' || !rec.videoUrl) {
      throw new ServiceUnavailableException('成片尚未就绪');
    }
    const resp = await fetch(rec.videoUrl, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok || !resp.body) {
      throw new ServiceUnavailableException('成片下载失败');
    }
    return {
      stream: resp.body as unknown as NodeJS.ReadableStream,
      filename: `wan-${taskId.slice(0, 8)}.mp4`,
    };
  }
}
