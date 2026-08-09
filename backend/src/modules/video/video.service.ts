import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StudioCoreProxyService } from './studio-core-proxy.service';
import { GenerateVideoDto } from './dto/generate-video.dto';
import { VideoProjectListQueryDto } from './dto/video-project-list-query.dto';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

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

  constructor(
    private readonly studioCoreProxy: StudioCoreProxyService,
    private readonly autoUploadService: AutoUploadService,
  ) {}

  /**
   * 提交视频生成任务
   */
  async generate(dto: GenerateVideoDto) {
    this.logger.log(
      `generate: pipeline=${dto.pipeline} prompt=${dto.prompt.slice(0, 50)}...`,
    );
    // 透传到 studio_core
    return this.studioCoreProxy.postGenerate(dto);
  }

  /**
   * 查询视频项目列表
   */
  async listProjects(query: VideoProjectListQueryDto) {
    try {
      return await this.studioCoreProxy.getProjects(query);
    } catch (error) {
      this.logger.warn(
        `视频服务暂不可用，项目列表返回空结果：${this.errorMessage(error)}`,
      );
      return { projects: [], total: 0 };
    }
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
    try {
      return await this.studioCoreProxy.getPipelines();
    } catch (error) {
      this.logger.warn(
        `视频服务暂不可用，流水线列表返回空结果：${this.errorMessage(error)}`,
      );
      return [];
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * 导入项目成片（compose.mp4）到素材库
   * 复用 AutoUploadService.saveMaterialBuffer（与 video-workshop 的 import-material 同链路）
   */
  async importComposeMp4(
    id: string,
  ): Promise<{ filename: string; sizeBytes: number }> {
    const project = await this.studioCoreProxy.getProject(id);
    if (!project || !project.video) {
      throw new BadRequestException(
        `项目 ${id} 还没有成片文件（可能未完成或已失败）`,
      );
    }
    this.logger.log(`importComposeMp4: ${id}`);
    const { buffer, length } = await this.studioCoreProxy.getComposeMp4(id);
    const filename = `${id}.mp4`;
    const saved = this.autoUploadService.saveMaterialBuffer(buffer, filename);
    return { filename: saved.filename, sizeBytes: length };
  }
}
