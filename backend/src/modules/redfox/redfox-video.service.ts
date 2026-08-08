import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedfoxService, RedfoxActor } from './redfox.service';
import { RedfoxClientService } from './redfox-client.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

const VIDEO_SUBMIT_PATH = '/story/api/parseWork/videoGen/submit';
const VIDEO_RESULT_PATH = '/story/api/parseWork/videoGen/result';
const SUBMIT_SKILL = 'seedance-video-submit';
const RESULT_SKILL = 'seedance-video-result';

export interface VideoGenTask {
  taskId: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  videoUrl?: string;
  filename?: string;
  sizeBytes?: number;
  error?: string;
}

interface SubmitResult {
  code: number;
  msg?: string;
  data?: { taskId?: string };
}

interface QueryResult {
  code: number;
  msg?: string;
  data?: {
    url?: string;
    videoUrl?: string;
    status?: string;
    progress?: number;
  };
}

/**
 * Seedance 视频生成（A7/M6，主文档 P2）
 *
 * 提交：POST videoGen/submit（150 积分）→ {taskId}
 * 查询：POST videoGen/result（0 积分）→ 视频 URL → done 后自动下载入素材库
 */
@Injectable()
export class RedfoxVideoService {
  private readonly logger = new Logger(RedfoxVideoService.name);
  private readonly taskCache = new Map<
    string,
    {
      authUser: RedfoxActor;
      input: Record<string, unknown>;
      done: boolean;
      fetchedAt: number;
    }
  >();

  constructor(
    private readonly redfoxService: RedfoxService,
    private readonly client: RedfoxClientService,
    private readonly autoUploadService: AutoUploadService,
  ) {}

  /**
   * 提交 Seedance 视频生成任务（异步；前端轮询 taskId）
   */
  async submit(
    authUser: RedfoxActor,
    input: {
      prompt: string;
      content?: string;
      duration?: number;
      ratio?: string;
      imageUrl?: string;
    },
  ): Promise<{ taskId: string }> {
    // RedFox videoGen/submit 契约：content 为必填（8-06 实测 prompt-only 报 missing content）
    const content = (input.content || input.prompt || '').trim();
    if (!content) throw new ServiceUnavailableException('请提供视频内容描述');

    const scope = await this.redfoxService.resolveScope(authUser);
    const connection = await this.redfoxService.getEffectiveConnection(scope);
    const submit = await this.client.request<SubmitResult>(scope, connection, {
      method: 'POST',
      path: VIDEO_SUBMIT_PATH,
      body: {
        content,
        ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
        ...(input.duration ? { duration: input.duration } : {}),
        ...(input.ratio ? { ratio: input.ratio } : {}),
      },
      operation: `redfox.skill.execute.video-gen.submit.${content.slice(0, 30)}`,
      skillCode: SUBMIT_SKILL,
      estimatedCostPoints: 150,
    });
    const taskId =
      submit?.data?.taskId || (submit as { taskId?: string })?.taskId;
    if (submit?.code !== 2000 || !taskId) {
      throw new ServiceUnavailableException(
        submit?.msg || 'Seedance 任务提交失败',
      );
    }
    this.taskCache.set(taskId, {
      authUser,
      input,
      done: false,
      fetchedAt: Date.now(),
    });
    this.logger.log(`Seedance 任务已提交：${taskId}`);
    return { taskId };
  }

  /**
   * 查询任务状态；done 后自动下载视频入素材库（首次查询触发）
   * taskCache 仅在会话内存中做入库幂等；超过 1 天的条目清理（防内存增长）
   */
  async query(authUser: RedfoxActor, taskId: string): Promise<VideoGenTask> {
    // 清理过期缓存（幂等标记最长保留 1 天）
    const now = Date.now();
    for (const [key, entry] of this.taskCache) {
      if (now - (entry.fetchedAt ?? 0) > 24 * 60 * 60 * 1000) {
        this.taskCache.delete(key);
      }
    }
    const scope = await this.redfoxService.resolveScope(authUser);
    const connection = await this.redfoxService.getEffectiveConnection(scope);
    const result = await this.client
      .request<QueryResult>(scope, connection, {
        method: 'POST',
        path: VIDEO_RESULT_PATH,
        body: { taskId },
        operation: `redfox.skill.execute.video-gen.result.${taskId}`,
        skillCode: RESULT_SKILL,
        estimatedCostPoints: 0,
      })
      .catch(() => null);

    const url = result?.data?.url || result?.data?.videoUrl || '';
    const statusText = (result?.data?.status || '').toLowerCase();
    if (!url) {
      if (statusText === 'fail' || statusText === 'failed') {
        return { taskId, status: 'failed', error: result?.msg || '生成失败' };
      }
      return { taskId, status: 'processing' };
    }

    // done：下载入库（幂等——只做一次）
    const cached = this.taskCache.get(taskId);
    if (cached && !cached.done) {
      cached.done = true;
      try {
        const filename = `seedance-${taskId}.mp4`;
        // 60s 超时（大文件下载防挂起）；AbortSignal.timeout 触发后 fetch 抛错进 catch
        const arrayBuf = await (
          await fetch(url, { signal: AbortSignal.timeout(60000) })
        ).arrayBuffer();
        const buffer = Buffer.from(new Uint8Array(arrayBuf));
        const saved = await this.autoUploadService.saveMaterialBuffer(
          buffer,
          filename,
        );
        this.logger.log(`Seedance 成片已入素材库：${saved.filename}`);
        return {
          taskId,
          status: 'done',
          videoUrl: url,
          filename: saved.filename,
          sizeBytes: buffer.byteLength,
        };
      } catch (error) {
        this.logger.warn(`Seedance 成片入库失败：${error}`);
        return { taskId, status: 'done', videoUrl: url };
      }
    }
    return { taskId, status: 'done', videoUrl: url };
  }
}
