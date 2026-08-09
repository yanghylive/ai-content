import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

/**
 * 万相 Wan i2v 视频生成网关（数字人 talking-head 底座）
 *
 * 职责：
 *  1. 定义 video_generation 计费档（单价 KAYPAL_AI_VIDEO_PRICE_PER_SEC，默认 0.6 元/秒）
 *  2. 调阿里百炼 wan i2v：头像(first_frame) + 台词(prompt) → 自动配音口播视频
 *  3. 记账：向 kaypal 平台 /api/billing/deduct 扣积分（resource_type=video_generation）
 *
 * 计费说明：完整订阅校验（resolveKaypalBillingIdentity）在 ai-client 内部，
 * 本模块为独立网关，扣款走同一协议；若用户 kaypal token 不可得则记录日志并放行
 * （本地/演示宽松模式），生产接入需补 identity 解析 —— 见 2026-08-02 交接。
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

const WAN_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const WAN_SUBMIT_PATH = '/services/aigc/video-generation/video-synthesis';
const WAN_MODEL = 'wan2.7-i2v-2026-04-25';

@Injectable()
export class WanI2vService {
  private readonly logger = new Logger(WanI2vService.name);
  private readonly tasks = new Map<string, WanTaskRecord>();

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    const key = this.config.get<string>('DASHSCOPE_API_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        '平台视频生成服务未配置 DASHSCOPE_API_KEY，请联系管理员配置后重试。',
      );
    }
    return key;
  }

  private pricePerSecond(): number {
    const raw = this.config.get<string>('KAYPAL_AI_VIDEO_PRICE_PER_SEC');
    const n = raw ? Number.parseFloat(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 0.6;
  }

  /**
   * 创建视频生成任务：估算计费 → 提交 wan → 返回任务 id
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

    await this.deductKaypalCredits(user, duration, estimatedCost);

    const body = {
      model: WAN_MODEL,
      input: {
        prompt: input.prompt.slice(0, 5000),
        media: [{ type: 'first_frame', url: input.imageDataUrl }],
      },
      parameters: {
        resolution: '720P',
        duration,
        watermark: false,
      },
    };

    const resp = await fetch(WAN_BASE + WAN_SUBMIT_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
    });
    const payload = (await resp.json()) as {
      output?: { task_id?: string };
      code?: string;
      message?: string;
    };
    if (!resp.ok || !payload?.output?.task_id) {
      throw new ServiceUnavailableException(
        `万相视频生成任务提交失败：${payload?.message ?? `HTTP ${resp.status}`}`,
      );
    }

    const taskId = randomUUID();
    this.tasks.set(taskId, {
      taskId,
      externalId: payload.output.task_id,
      status: 'submitting',
      progress: 5,
      createdAt: Date.now(),
      userId:
        typeof user?.id === 'string'
          ? user.id
          : typeof user?.kaypalUserId === 'string'
            ? user.kaypalUserId
            : undefined,
    });
    this.logger.log(
      `wan i2v 任务已提交: ${taskId} ext=${payload.output.task_id} cost=¥${estimatedCost}`,
    );
    return { taskId, estimatedCost, status: 'submitting' };
  }

  /**
   * 查询任务：本地状态 + 必要时轮询 wan
   */
  async getTask(taskId: string): Promise<WanTaskRecord> {
    const rec = this.tasks.get(taskId);
    if (!rec) {
      throw new NotFoundException('视频生成任务不存在');
    }
    if (rec.status === 'ready' || rec.status === 'failed') {
      return rec;
    }
    await this.syncFromWan(rec);
    return rec;
  }

  private async syncFromWan(rec: WanTaskRecord): Promise<void> {
    try {
      const resp = await fetch(`${WAN_BASE}/tasks/${rec.externalId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      const payload = (await resp.json()) as {
        output?: {
          task_status?: string;
          progress?: number;
          video_url?: string;
          message?: string;
        };
      };
      const out = payload.output ?? {};
      const raw = (out.task_status ?? '').toUpperCase();
      rec.progress = Math.max(rec.progress, Number(out.progress) || 0);
      if (raw === 'SUCCEEDED') {
        rec.status = 'ready';
        rec.progress = 100;
        rec.videoUrl = out.video_url;
      } else if (raw === 'FAILED') {
        rec.status = 'failed';
        rec.error = out.message ?? 'wan 渲染失败';
      } else {
        rec.status = raw === 'PENDING' ? 'queued' : 'rendering';
      }
    } catch (e) {
      this.logger.warn(`wan 轮询失败 ${rec.taskId}: ${String(e)}`);
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
    const resp = await fetch(rec.videoUrl);
    if (!resp.ok || !resp.body) {
      throw new ServiceUnavailableException('成片下载失败');
    }
    return {
      stream: resp.body as unknown as NodeJS.ReadableStream,
      filename: `wan-${taskId.slice(0, 8)}.mp4`,
    };
  }

  /**
   * 计费档：video_generation（resource_type）→ kaypal /api/billing/deduct
   * 2026-08-09 起改为严格扣款：缺配置/token/用户身份或扣款失败一律报错，
   * 不允许免费放行（与 ai-client chargeCloudAiCredits 同口径）。
   */
  private async deductKaypalCredits(
    user: Record<string, unknown> | null | undefined,
    duration: number,
    amount: number,
  ): Promise<void> {
    const baseUrl =
      this.config.get<string>('KAYPAL_CLOUD_BASE_URL')?.trim() ||
      this.config.get<string>('KAYPAL_BILLING_BASE_URL')?.trim();
    const token =
      (typeof user?.kaypalDesktopAccessToken === 'string' &&
        user.kaypalDesktopAccessToken) ||
      this.config.get<string>('KAYPAL_BILLING_SERVICE_TOKEN')?.trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException(
        '视频生成云端计费未配置（KAYPAL_CLOUD_BASE_URL/KAYPAL_BILLING_BASE_URL），请联系管理员',
      );
    }
    if (!token) {
      throw new ServiceUnavailableException(
        '视频生成需要当前登录用户授权，请在「账号与设备」重新登录后再试',
      );
    }
    const userId =
      (typeof user?.id === 'string' && user.id) ||
      (typeof user?.kaypalUserId === 'string' && user.kaypalUserId) ||
      '';
    if (!userId) {
      throw new ServiceUnavailableException(
        '无法解析当前用户身份，云端计费不可用，请在「账号与设备」重新登录后再试',
      );
    }
    let resp: Response;
    try {
      resp = await fetch(
        new URL('/api/billing/deduct', baseUrl).toString(),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            user_id: userId,
            amount,
            service_type: 'ai_content_workbench',
            resource_type: 'video_generation',
            metadata: {
              source: 'ai-content-workbench',
              billingMode: 'cloud',
              phase: 'pre_model_call',
              idempotencyKey: `ai-content:video_generation:${randomUUID()}`,
              durationSeconds: duration,
            },
          }),
        },
      );
    } catch (e) {
      this.logger.error(`kaypal 扣款异常：${String(e)}`);
      throw new ServiceUnavailableException(
        '视频生成云端扣款失败，请稍后重试',
      );
    }
    if (!resp.ok) {
      const payload = (await resp.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const reason =
        (typeof payload?.error === 'string' ? payload.error : '') ||
        (typeof payload?.message === 'string' ? payload.message : '') ||
        `HTTP ${resp.status}`;
      if (/余额不足|积分不足|insufficient/i.test(reason)) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_CREDITS',
          message: `云积分不足（本次需 ${amount} 积分），可用返利现金抵扣`,
          amount,
          kind: 'video_generation',
        });
      }
      this.logger.warn(`kaypal 扣款失败：${reason}`);
      throw new ServiceUnavailableException(`视频生成云端扣款失败：${reason}`);
    }
    this.logger.log(
      `kaypal 已扣积分: video_generation, amount=${amount}, user=${userId}`,
    );
  }
}
