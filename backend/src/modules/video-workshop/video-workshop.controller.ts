import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

/** 单个素材文件大小上限（视频素材 500MB，防磁盘 DoS） */
const MAX_MATERIAL_FILE_BYTES = 500 * 1024 * 1024;
import {
  VideoWorkshopService,
  type VideoWorkshopDownloadInput,
  type VideoWorkshopProductProfileInput,
  type VideoWorkshopTemplateClipInput,
  type VideoWorkshopUploadFile,
} from './video-workshop.service';
import { StudioCoreClient } from './studio-core.client';

@Controller('video-workshop')
export class VideoWorkshopController {
  constructor(
    private readonly videoWorkshop: VideoWorkshopService,
    private readonly studioCore: StudioCoreClient,
  ) {}

  /**
   * BGM 曲库预设（对标炼刀 /system/music/bgm）
   * GET /api/video-workshop/bgm-presets
   */
  @Get('bgm-presets')
  listBgmPresets() {
    return [
      { id: 'upbeat', name: '轻快节奏', style: '节奏明快', scenes: ['带货', '探店', '开箱'] },
      { id: 'narrative', name: '温和叙述', style: '平稳叙述', scenes: ['产品故事', '案例分享'] },
      { id: 'ambient', name: '氛围留白', style: '轻柔氛围', scenes: ['高级感', '品牌宣传'] },
      { id: 'energetic', name: '动感燃曲', style: '强节奏', scenes: ['促销', '活动'] },
      { id: 'vlog', name: '生活 Vlog', style: '轻松日常', scenes: ['日常记录', '探店'] },
      { id: 'corporate', name: '商务正式', style: '沉稳专业', scenes: ['企业宣传', '发布会'] },
    ];
  }

  /** studio_core 视频引擎状态（代理 8600 /health，D3 对接起点） */
  @Get('engine-status')
  async engineStatus() {
    const baseUrl = (
      process.env.STUDIO_CORE_URL || 'http://127.0.0.1:8600'
    ).replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
      };
      return {
        online: response.ok,
        ok: body.ok === true,
        url: baseUrl,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        online: false,
        ok: false,
        url: baseUrl,
        error:
          error instanceof Error && error.name === 'AbortError'
            ? '引擎响应超时'
            : '引擎不可达',
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /** 创建视频任务（studio_core）：通用流水线走 dashboard 自动跑；corporate 走 workbench 真渲染 */
  @Post('jobs')
  async createVideoJob(@Body() input: { type: string; prompt: string }) {
    if (!input?.type || !input?.prompt) {
      throw new BadRequestException(
        '需要提供流水线类型（type）和选题（prompt）',
      );
    }
    const project = await this.studioCore.createProject({
      prompt: input.prompt,
      pipeline: input.type === 'corporate' ? 'corporate' : input.type,
    });
    // 企业宣传片：workbench 任务走 real executor（真 TTS/画面/合成）
    if (input.type === 'corporate') {
      await this.studioCore.createWorkbenchTask(project.id, {
        type: 'corporate',
        brief: input.prompt,
        executor: 'real',
        shots: 3,
      });
    }
    return { projectId: project.id, status: 'running' };
  }

  /** 成片导入素材库（发布流程可用）：取 deliverables 视频文件 → 存素材目录 */
  @Post('jobs/:projectId/import-material')
  async importVideoMaterial(@Param('projectId') projectId: string) {
    const deliverables = await this.studioCore.getDeliverables(projectId);
    const video = (deliverables.deliverables || []).find(
      (item) =>
        item.category === 'video' || /^\.(mp4|webm|mov)$/i.test(item.ext || ''),
    );
    if (!video) {
      throw new BadRequestException('该项目还没有可导入的成片文件');
    }
    const buffer = await this.studioCore.fetchMedia(projectId, video.rel_path);
    const filename = `${projectId}${video.ext || '.mp4'}`;
    const saved = await this.videoWorkshop.importMaterialBuffer(
      buffer,
      filename,
    );
    return { filename: saved.filename, sizeBytes: video.size_bytes };
  }

  /** 查询视频任务状态（含 stages 进度） */
  @Get('jobs/:projectId')
  async getVideoJob(@Param('projectId') projectId: string) {
    return this.studioCore.getProject(projectId);
  }

  /** 批准视频任务 Gate（脚本确认后放行生成） */
  @Post('jobs/:projectId/approve')
  async approveVideoJob(@Param('projectId') projectId: string) {
    return this.studioCore.approveGate(projectId);
  }

  /** 视频任务产物（成片） */
  @Get('projects/:projectId/deliverables')
  async getVideoDeliverables(@Param('projectId') projectId: string) {
    return this.studioCore.getDeliverables(projectId);
  }

  @Get('latest-clip')
  latestClip(@Query('source') source?: string) {
    return this.videoWorkshop.latestClip({
      source: source === 'ai-employee' ? 'ai-employee' : 'video-workshop',
    });
  }

  @Get('clips')
  clips(@Query('source') source?: string, @Query('limit') limit?: string) {
    return this.videoWorkshop.listClips(
      {
        source: source === 'ai-employee' ? 'ai-employee' : 'video-workshop',
      },
      limit ? Number.parseInt(limit, 10) : 20,
    );
  }

  @Get('material-files')
  materialFiles(@Query('limit') limit?: string) {
    return this.videoWorkshop.listMaterialFiles(
      limit ? Number.parseInt(limit, 10) : 30,
    );
  }

  @Post('material-files')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_MATERIAL_FILE_BYTES } }),
  )
  importMaterialFile(@UploadedFile() file: VideoWorkshopUploadFile) {
    return this.videoWorkshop.importMaterialFile(file);
  }

  @Post('material-files/batch')
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      limits: { fileSize: MAX_MATERIAL_FILE_BYTES },
    }),
  )
  importMaterialFiles(@UploadedFiles() files: VideoWorkshopUploadFile[]) {
    return this.videoWorkshop.importMaterialFiles(files);
  }

  @Get('product-profiles')
  productProfiles() {
    return this.videoWorkshop.listProductProfiles();
  }

  @Post('product-profiles')
  saveProductProfile(@Body() body: VideoWorkshopProductProfileInput) {
    return this.videoWorkshop.saveProductProfile(body);
  }

  @Get('download-policy')
  downloadPolicy() {
    return this.videoWorkshop.downloadPolicy();
  }

  @Get('tasks')
  tasks(@Query('limit') limit?: string) {
    return this.videoWorkshop.listTasks(
      limit ? Number.parseInt(limit, 10) : 50,
    );
  }

  @Get('tasks/:id')
  task(@Param('id') id: string) {
    return this.videoWorkshop.getTask(id);
  }

  @Post('tasks/render')
  createRenderTask(@Body() body: VideoWorkshopTemplateClipInput) {
    return this.videoWorkshop.createRenderTask({
      ...body,
      source: body.source === 'ai-employee' ? 'ai-employee' : 'video-workshop',
    });
  }

  @Post('tasks/download')
  createDownloadTask(@Body() body: VideoWorkshopDownloadInput) {
    return this.videoWorkshop.createDownloadTask(body);
  }

  @Post('tasks/:id/retry')
  retryTask(@Param('id') id: string) {
    return this.videoWorkshop.retryTask(id);
  }

  @Post('tasks/:id/cancel')
  cancelTask(@Param('id') id: string) {
    return this.videoWorkshop.cancelTask(id);
  }

  @Post('phone-upload/sessions')
  createPhoneUploadSession(@Body() body: { maxBytes?: number } = {}) {
    return this.videoWorkshop.createPhoneUploadSession(body.maxBytes);
  }

  @Get('phone-upload/sessions/:id')
  phoneUploadSession(@Param('id') id: string) {
    return this.videoWorkshop.phoneUploadSession(id);
  }

  @Post('phone-upload/sessions/:id/cancel')
  cancelPhoneUploadSession(@Param('id') id: string) {
    return this.videoWorkshop.cancelPhoneUploadSession(id);
  }

  @Get('preview')
  previewClip(
    @Query('path') path: string | undefined,
    @Res() response: Response,
  ) {
    const clip = this.videoWorkshop.resolvePreviewClip(path);
    response.type('video/mp4');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(clip.name)}"`,
    );
    response.sendFile(clip.path);
  }

  @Post('template-clip')
  clipWithTemplate(@Body() body: VideoWorkshopTemplateClipInput) {
    return this.videoWorkshop.clipWithTemplate({
      ...body,
      source: body.source === 'ai-employee' ? 'ai-employee' : 'video-workshop',
    });
  }
}
