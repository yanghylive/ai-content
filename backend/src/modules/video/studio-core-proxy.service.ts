import { Injectable, Logger } from '@nestjs/common';
import { GenerateVideoDto } from './dto/generate-video.dto';
import { VideoProjectListQueryDto } from './dto/video-project-list-query.dto';

/**
 * studio_core 反代 service
 *
 * D1=B：通过 HTTP 反代到 studio_core dashboard (8600 stdlib / 8610 FastAPI SSE)
 * 边界清晰、热更新友好、不污染 NestJS 主进程
 */
@Injectable()
export class StudioCoreProxyService {
  private readonly logger = new Logger(StudioCoreProxyService.name);
  private readonly stdlibBaseUrl = process.env.STUDIO_CORE_STDLIB_URL || 'http://127.0.0.1:8600';
  private readonly sseBaseUrl = process.env.STUDIO_CORE_SSE_URL || 'http://127.0.0.1:8610';

  /**
   * 提交视频生成任务到 studio_core
   */
  async postGenerate(dto: GenerateVideoDto) {
    this.logger.log(`postGenerate: ${this.stdlibBaseUrl}/api/generate`);
    // TODO: 实际调用 studio_core 8600 的 /api/generate 端点
    // 当前为骨架，返回 mock 响应
    return {
      project_id: `proj-${Date.now()}`,
      pipeline: dto.pipeline,
      prompt: dto.prompt,
      status: 'queued',
      message: 'studio_core 反代骨架（待接入真实端点）',
    };
  }

  /**
   * 查询项目列表
   */
  async getProjects(query: VideoProjectListQueryDto) {
    this.logger.log(`getProjects: ${this.stdlibBaseUrl}/api/projects`);
    // TODO: 实际调用
    return {
      projects: [],
      total: 0,
      message: 'studio_core 反代骨架（待接入真实端点）',
    };
  }

  /**
   * 查询单个项目
   */
  async getProject(id: string) {
    this.logger.log(`getProject: ${this.stdlibBaseUrl}/api/projects/${id}`);
    // TODO: 实际调用
    return null;
  }

  /**
   * 获取 compose.mp4
   */
  async getComposeMp4(id: string) {
    this.logger.log(`getComposeMp4: ${this.stdlibBaseUrl}/api/projects/${id}/compose.mp4`);
    // TODO: 实际调用，返回文件流
    return null;
  }

  /**
   * 查询流水线列表
   */
  async getPipelines() {
    this.logger.log(`getPipelines: ${this.stdlibBaseUrl}/api/pipelines`);
    // TODO: 实际调用
    return {
      pipelines: [
        { name: 'short_form', description: '竖屏短视频（9:16，≤60s）' },
        { name: 'promo', description: '推广视频' },
        { name: 'tutorial', description: '教程视频' },
        { name: 'news_brief', description: '资讯简报' },
      ],
      message: 'studio_core 反代骨架（待接入真实端点）',
    };
  }

  /**
   * SSE 实时进度推送（反代 8610）
   */
  async proxySse(projectId: string) {
    this.logger.log(`proxySse: ${this.sseBaseUrl}/api/projects/${projectId}/events`);
    // TODO: 实际 SSE 反代
    // 当前返回 mock SSE 流
    return new ReadableStream({
      start(controller) {
        controller.enqueue(`data: {"status":"queued","project_id":"${projectId}"}\n\n`);
        setTimeout(() => {
          controller.enqueue(`data: {"status":"done","project_id":"${projectId}"}\n\n`);
          controller.close();
        }, 1000);
      },
    });
  }
}
