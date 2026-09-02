import {
  BadRequestException,
  Body,
  ForbiddenException,
  Controller,
  Patch,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  UnauthorizedException,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { VideoService } from './video.service';
import { StudioCoreProxyService } from './studio-core-proxy.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateVideoDto } from './dto/generate-video.dto';
import { VideoProjectListQueryDto } from './dto/video-project-list-query.dto';
import type { AuthenticatedRequest } from '../auth/auth.guard';

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
    private readonly authRequestContext?: AuthRequestContextService,
    private readonly prisma?: PrismaService,
  ) {}

  /**
   * 提交视频生成任务
   * POST /api/video/generate
   */
  @Post('generate')
  async generate(
    @Body() dto: GenerateVideoDto,
    @Req() request: AuthenticatedRequest,
  ) {
    // 2026-09-01 安全修复（审计 #8）：user_id 以服务端会话为准，忽略客户端传入值；
    // kaypalUserId 用于云端通道计费归属，避免成本静默记到固定主账号。
    dto.user_id = request.authUser?.id ?? '';
    // 2026-09-01（复核第四轮 P1）：认证用户缺失即拒绝（不创建无归属项目）
    return this.videoService.generate(
      dto,
      request.authUser?.kaypalUserId ?? undefined,
      this.resolveUserId(),
    );
  }

  /**
   * 商品带货文案生成（对标炼刀 video_creation 文案扩展）
   * POST /api/video/product-copy
   */
  @Post('product-copy')
  productCopy(
    @Body()
    body: {
      productName: string;
      sellingPoints?: string[];
      price?: number | string;
      audience?: string;
      durationSeconds?: number;
    },
  ) {
    return this.videoService.buildProductCopy(body);
  }

  /**
   * 商品视频自动剪辑：商品信息 → 带货文案 → 成片任务
   * POST /api/video/product-cut
   */
  /**
   * 商品剪辑配置 CRUD（对标炼刀 /auto/product_video_clip/config/*）
   * POST /api/video/product-clip-config
   */
  @Post('product-clip-config')
  createClipConfig(
    @Body()
    body: {
      name: string;
      productName: string;
      sellingPoints?: string[];
      price?: number | string;
      audience?: string;
      durationSeconds?: number;
      imageUrl?: string;
    },
  ) {
    return this.videoService.createClipConfig(body);
  }

  @Patch('product-clip-config/:id')
  updateClipConfig(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      productName?: string;
      sellingPoints?: string[];
      price?: number | string;
      audience?: string;
      durationSeconds?: number;
      imageUrl?: string;
    },
  ) {
    return this.videoService.updateClipConfig(id, body);
  }

  @Get('product-clip-config')
  listClipConfigs() {
    return this.videoService.listClipConfigs();
  }

  @Get('product-clip-config/:id')
  getClipConfig(@Param('id') id: string) {
    return this.videoService.getClipConfig(id);
  }

  @Delete('product-clip-config/:id')
  removeClipConfig(@Param('id') id: string) {
    return this.videoService.removeClipConfig(id);
  }

  /**
   * 视频发布计划（对标炼刀 /video_release_plan/*）：列出定时发布的视频任务
   * GET /api/video/release-plans
   */
  @Get('release-plans')
  listReleasePlans(@Query('limit') limit?: string) {
    return this.videoService.listReleasePlans(
      limit ? Number(limit) : undefined,
    );
  }

  @Post('product-cut')
  async productCut(
    @Body()
    body: {
      productName: string;
      sellingPoints?: string[];
      price?: number | string;
      audience?: string;
      durationSeconds?: number;
      imageUrl?: string;
      user_id?: string;
    },
  ) {
    return this.videoService.productCut(body, this.resolveUserId());
  }

  /**
   * 2026-09-01（复核 P1-D/第五轮 P1）：当前请求用户 id。
   * 认证上下文缺失/异常直接抛 401（项目端点均受 AuthGuard 保护），
   * 不再返回 undefined 退化为无过滤访问。
   */
  private resolveUserId(): string {
    try {
      const ctx = this.authRequestContext?.get() as
        { user?: { id?: string } } | undefined;
      const id = ctx?.user?.id?.trim();
      if (!id) {
        throw new UnauthorizedException('登录状态无效，请重新登录');
      }
      return id;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('登录状态无效，请重新登录');
    }
  }

  /**
   * 查询视频项目列表
   * GET /api/video/projects
   */
  @Get('projects')
  async listProjects(@Query() query: VideoProjectListQueryDto) {
    return this.videoService.listProjects(query, this.resolveUserId());
  }

  /**
   * 查询单个视频项目详情
   * GET /api/video/projects/:id
   */
  @Get('projects/:id')
  async getProject(@Param('id') id: string) {
    return this.videoService.getProject(id, this.resolveUserId());
  }

  /**
   * 获取视频项目产物（compose.mp4）
   * GET /api/video/projects/:id/compose.mp4
   */
  /**
   * 受控迁移项目归属（复核 P0）：仅平台管理员可调用。
   * POST /api/video/projects/:id/migrate-owner  { "userId": "..." }
   */
  @Post('projects/:id/migrate-owner')
  async migrateProjectOwner(
    @Param('id') id: string,
    @Body() body: { userId?: string },
  ) {
    const ownerId = body?.userId?.trim();
    if (!ownerId) {
      throw new BadRequestException('缺少目标 userId');
    }
    const ctx = this.authRequestContext?.get() as
      { user?: { role?: string } } | undefined;
    const role = ctx?.user?.role;
    // 2026-09-01（复核第四轮 P2）：收紧为平台管理员（去掉 owner）
    if (role !== 'admin' && role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('仅平台管理员可迁移项目归属');
    }
    await this.prisma!.migrateStudioProjectOwner(id, ownerId);
    return { success: true };
  }

  @Get('projects/:id/compose.mp4')
  async getComposeMp4(@Param('id') id: string, @Res() res: Response) {
    const { buffer, contentType, length } =
      await this.videoService.getComposeMp4(id, this.resolveUserId());
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
    });
    res.send(buffer);
  }

  /**
   * 导入项目成片（compose.mp4）到素材库
   * POST /api/video/projects/:id/import-material
   */
  @Post('projects/:id/import-material')
  async importMaterial(@Param('id') id: string) {
    return this.videoService.importComposeMp4(id, this.resolveUserId());
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
  async projectEvents(@Param('id') id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    // 2026-09-01（复核 P1-6）：SSE 按 :id 过滤帧内项目，不再转发全量快照
    // 2026-09-01（复核 P1-D）：SSE 订阅前同样校验项目归属
    await this.videoService.getProject(id, this.resolveUserId());
    const stream = await this.studioCoreProxy.proxySse(id);
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
