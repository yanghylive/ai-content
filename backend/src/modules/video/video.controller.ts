import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { VideoService } from './video.service';
import { StudioCoreProxyService } from './studio-core-proxy.service';
import { GenerateVideoDto } from './dto/generate-video.dto';
import { VideoProjectListQueryDto } from './dto/video-project-list-query.dto';

/**
 * 视频一键成片 controller（复用 studio_core 引擎）
 *
 * D1=B HTTP 反代：通过 StudioCoreProxyService 转发到 studio_core FastAPI dashboard (8610)
 * D3=B 鉴权：复用 JIUZHANG 会话（AuthGuard），studio_core 用独立账号鉴权（反代内部处理）
 */
@Controller('video')
export class VideoController {
  constructor(
    private readonly videoService: VideoService,
    private readonly studioCoreProxy: StudioCoreProxyService,
  ) {}

  /**
   * 提交视频生成任务
   * POST /api/video/generate
   */
  @Post('generate')
  async generate(@Body() dto: GenerateVideoDto) {
    return this.videoService.generate(dto);
  }

  /**
   * 查询视频项目列表
   * GET /api/video/projects
   */
  @Get('projects')
  async listProjects(@Query() query: VideoProjectListQueryDto) {
    return this.videoService.listProjects(query);
  }

  /**
   * 查询单个视频项目详情
   * GET /api/video/projects/:id
   */
  @Get('projects/:id')
  async getProject(@Param('id') id: string) {
    return this.videoService.getProject(id);
  }

  /**
   * 获取视频项目产物（compose.mp4）
   * GET /api/video/projects/:id/compose.mp4
   */
  @Get('projects/:id/compose.mp4')
  async getComposeMp4(@Param('id') id: string, @Res() res: Response) {
    const { buffer, contentType, length } =
      await this.videoService.getComposeMp4(id);
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=300',
    });
    res.send(buffer);
  }

  /**
   * SSE 实时进度推送（反代 studio_core 8610 /api/events）
   * GET /api/video/projects/:id/events
   *
   * 直接透传 8610 的原始 SSE 流（每 5s 全量项目快照）。
   * 用 @Res() 手动写流，绕开全局响应拦截器（否则 SSE 会被包装成 JSON）。
   */
  @Get('projects/:id/events')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  async projectEvents(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const stream = await this.studioCoreProxy.proxySse();
    const reader = stream.getReader();
    const pump = async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(Buffer.from(value));
        }
      } catch {
        res.end();
      }
    };
    res.on('close', () => {
      void reader.cancel();
    });
    void pump();
  }

  /**
   * 查询可用流水线列表
   * GET /api/video/pipelines
   */
  @Get('pipelines')
  async listPipelines() {
    return this.videoService.listPipelines();
  }
}
