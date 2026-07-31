import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StudioCoreProxyService } from './studio-core-proxy.service';
import { GenerateVideoDto } from './dto/generate-video.dto';
import { VideoProjectListQueryDto } from './dto/video-project-list-query.dto';

/**
 * 视频一键成片 service（复用 studio_core 引擎）
 *
 * 职责：
 *   1. 接收前端请求，转发到 studio_core dashboard (8600/8610)
 *   2. 双写：studio_core 写文件 + NestJS 同步到 Postgres（后续）
 *   3. 透传 user_id（多用户隔离）
 */
@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(private readonly studioCoreProxy: StudioCoreProxyService) {}

  /**
   * 提交视频生成任务
   */
  async generate(dto: GenerateVideoDto) {
    this.logger.log(`generate: pipeline=${dto.pipeline} prompt=${dto.prompt.slice(0, 50)}...`);
    // 透传到 studio_core
    return this.studioCoreProxy.postGenerate(dto);
  }

  /**
   * 查询视频项目列表
   */
  async listProjects(query: VideoProjectListQueryDto) {
    return this.studioCoreProxy.getProjects(query);
  }

  /**
   * 查询单个视频项目详情
   */
  async getProject(id: string) {
    const project = await this.studioCoreProxy.getProject(id);
    if (!project) {
      throw new NotFoundException(`视频项目 ${id} 不存在`);
    }
    return project;
  }

  /**
   * 获取视频项目产物（compose.mp4）
   */
  async getComposeMp4(id: string) {
    return this.studioCoreProxy.getComposeMp4(id);
  }

  /**
   * 查询可用流水线列表
   */
  async listPipelines() {
    return this.studioCoreProxy.getPipelines();
  }
}
