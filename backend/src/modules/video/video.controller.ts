import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { VideoService } from './video.service';
import { StudioCoreProxyService } from './studio-core-proxy.service';
import { GenerateVideoDto } from './dto/generate-video.dto';
import { VideoProjectListQueryDto } from './dto/video-project-list-query.dto';

/**
 * 视频一键成片 controller（复用 studio_core 引擎）
 *
 * D1=B HTTP 反代：通过 StudioCoreProxyService 转发到 studio_core dashboard (8600/8610)
 * D3=B 鉴权：复用 JIUZHANG 会话（AuthGuard），studio_core 鉴权旁路
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
  async getComposeMp4(@Param('id') id: string) {
    return this.videoService.getComposeMp4(id);
  }

  /**
   * SSE 实时进度推送（反代 studio_core 8610）
   * GET /api/video/projects/:id/events
   */
  @Sse('projects/:id/events')
  async projectEvents(@Param('id') id: string) {
    return this.studioCoreProxy.proxySse(id);
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
