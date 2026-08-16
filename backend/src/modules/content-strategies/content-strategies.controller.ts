import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ContentStrategiesService,
  type ContentStrategyPayload,
} from './content-strategies.service';

@Controller('content-strategies')
export class ContentStrategiesController {
  constructor(
    private readonly contentStrategiesService: ContentStrategiesService,
  ) {}

  @Get()
  findAll() {
    return this.contentStrategiesService.findAll();
  }

  @Get('default')
  getDefault() {
    return this.contentStrategiesService.getDefaultStrategy();
  }

  /* ===== 行业模板库（2026-08-09 商用能力补齐 R1） =====
     注意：静态路由必须先于 @Get(':id') 声明，否则被 :id 捕获 */

  @Get('industries')
  listIndustries() {
    return this.contentStrategiesService.listIndustries();
  }

  @Get('templates')
  listTemplates(
    @Query('industry') industry?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contentStrategiesService.listTemplates({
      industry,
      type,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contentStrategiesService.findOne(id);
  }

  @Post()
  create(@Body() dto: ContentStrategyPayload) {
    return this.contentStrategiesService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: Partial<ContentStrategyPayload>,
  ) {
    return this.contentStrategiesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contentStrategiesService.remove(id);
  }

  @Patch(':id/default')
  setDefault(@Param('id') id: string) {
    return this.contentStrategiesService.setDefault(id);
  }

  /* ===== 版本化（报告 16.3 第 8 项） ===== */

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.contentStrategiesService.listVersions(id);
  }

  @Post(':id/rollback')
  rollback(
    @Param('id') id: string,
    @Body() dto: { versionNo: number },
  ) {
    return this.contentStrategiesService.rollback(id, dto.versionNo);
  }

  @Post('templates')
  createTemplate(
    @Body()
    dto: {
      industry: string;
      type: string;
      scene?: string;
      hook?: string;
      title?: string;
      content?: string;
      toneHint?: string;
      source?: string;
    },
  ) {
    return this.contentStrategiesService.createTemplate(dto);
  }

  @Post('templates/feedback')
  templateFeedback(
    @Body()
    dto: {
      industry: string;
      type: string;
      title?: string;
      content?: string;
    },
  ) {
    // 用户改稿/爆款沉淀回库（防滥用：仅记录，超阈值标 hot 由管理员审核）
    return this.contentStrategiesService.templateFeedback(dto);
  }
}
