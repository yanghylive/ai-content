import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorator';
import {
  VideoFaceSwapService,
  type VideoFaceSwapJobInput,
  type VideoFaceSwapUploadFile,
} from './video-face-swap.service';

@Controller('video-face-swap')
export class VideoFaceSwapController {
  constructor(private readonly videoFaceSwap: VideoFaceSwapService) {}

  @Get('capabilities')
  capabilities() {
    return this.videoFaceSwap.capabilities();
  }

  @Post('estimate')
  estimate(@Body() body: VideoFaceSwapJobInput) {
    return this.videoFaceSwap.estimate(body);
  }

  @Get('health')
  @Public()
  health() {
    return this.videoFaceSwap.health();
  }

  @Get('billing-status')
  billingStatus() {
    return this.videoFaceSwap.billingStatus();
  }

  @Get('jobs')
  jobs(@Query('limit') limit?: string) {
    return this.videoFaceSwap.listJobs(limit ? Number.parseInt(limit, 10) : 20);
  }

  @Get('material-files')
  materialFiles(@Query('limit') limit?: string) {
    return this.videoFaceSwap.listMaterialFiles(
      limit ? Number.parseInt(limit, 10) : 50,
    );
  }

  @Post('material-files')
  @UseInterceptors(
    FileInterceptor('file', {
      // multipart 层限制，避免超大素材先整文件进内存（P1-9）
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    }),
  )
  importMaterialFile(@UploadedFile() file: VideoFaceSwapUploadFile) {
    return this.videoFaceSwap.importMaterialFile(file);
  }

  @Get('preview')
  previewClip(
    @Query('path') path: string | undefined,
    @Res() response: Response,
  ) {
    const clip = this.videoFaceSwap.resolvePreviewClip(path);
    response.type(clip.contentType);
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(clip.name)}"`,
    );
    response.sendFile(clip.path);
  }

  @Post('jobs')
  createJob(@Body() body: VideoFaceSwapJobInput) {
    return this.videoFaceSwap.createJob(body);
  }
}
