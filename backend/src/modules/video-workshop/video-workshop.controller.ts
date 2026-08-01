import {
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
import {
  VideoWorkshopService,
  type VideoWorkshopDownloadInput,
  type VideoWorkshopProductProfileInput,
  type VideoWorkshopTemplateClipInput,
  type VideoWorkshopUploadFile,
} from './video-workshop.service';

@Controller('video-workshop')
export class VideoWorkshopController {
  constructor(private readonly videoWorkshop: VideoWorkshopService) {}

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
  @UseInterceptors(FileInterceptor('file'))
  importMaterialFile(@UploadedFile() file: VideoWorkshopUploadFile) {
    return this.videoWorkshop.importMaterialFile(file);
  }

  @Post('material-files/batch')
  @UseInterceptors(FilesInterceptor('files', 50))
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
