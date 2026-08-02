import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { WanI2vService } from './wan-i2v.service';

/**
 * 视频生成（数字人）网关 — 对外暴露给九场工作台等消费端
 *
 * POST /api/video-generation/tasks  创建（body: imageData, prompt, duration, aspect）
 * GET  /api/video-generation/tasks/:id        查询状态/进度
 * GET  /api/video-generation/tasks/:id/file   下载成片 mp4
 */
@Controller('video-generation')
export class VideoGenerationController {
  constructor(
    private readonly wanI2v: WanI2vService,
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  private resolveUser(): Record<string, unknown> | undefined {
    try {
      const ctx = this.authRequestContext?.get() as { user?: Record<string, unknown> } | undefined;
      return ctx?.user;
    } catch {
      return undefined;
    }
  }

  @Post('tasks')
  async createTask(
    @Body() body: { imageData?: string; prompt?: string; duration?: number; aspect?: string },
  ) {
    if (!body?.imageData || !body?.prompt) {
      return { success: false, message: 'imageData 与 prompt 必填' };
    }
    const user = this.resolveUser();
    const result = await this.wanI2v.createTask(
      {
        imageDataUrl: body.imageData,
        prompt: body.prompt,
        duration: body.duration ?? 5,
        aspect: body.aspect ?? '9:16',
      },
      user,
    );
    return { success: true, ...result };
  }

  @Get('tasks/:id')
  async getTask(@Param('id') id: string) {
    const task = await this.wanI2v.getTask(id);
    return {
      success: true,
      task: {
        id: task.taskId,
        status: task.status,
        progress: task.progress,
        error: task.error,
        videoUrl: task.status === 'ready' ? `/api/video-generation/tasks/${task.taskId}/file` : null,
      },
    };
  }

  @Get('tasks/:id/file')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { stream, filename } = await this.wanI2v.download(id);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    (stream as unknown as NodeJS.ReadableStream).pipe(res);
  }
}
