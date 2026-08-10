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
import { PrismaService } from '../../prisma/prisma.service';

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
    private readonly prisma: PrismaService,
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

  // ============ 商品视频自动剪辑（对标炼刀 video_creation 商品视频剪辑） ============

  /**
   * 生成商品带货口播文案（模板生成，确定性、可测；AI 增强由上层可选接入）
   * 返回分镜结构：每段 { 字幕, 画面提示 }，可直供 studio_core 成片 prompt
   */
  buildProductCopy(input: {
    productName: string;
    sellingPoints?: string[];
    price?: number | string;
    audience?: string;
    durationSeconds?: number;
  }): {
    title: string;
    copy: string;
    usedAi: false;
    segments: Array<{ subtitle: string; visual: string; seconds: number }>;
  } {
    const name = input.productName.trim();
    if (!name) {
      throw new BadRequestException('商品名称不能为空');
    }
    const points = (input.sellingPoints ?? []).filter((p) => p?.trim()).slice(0, 5);
    const price =
      input.price === undefined || input.price === ''
        ? ''
        : `只要 ${input.price}`;
    const audience = input.audience?.trim() || '家人们';
    const targetSeconds = Math.min(Math.max(input.durationSeconds ?? 20, 10), 60);

    // 分镜：钩子 → 卖点（每点一个镜头）→ 价格锚点 → CTA
    const segments: Array<{ subtitle: string; visual: string; seconds: number }> = [];
    const hookVisual = '商品特写开场，快节奏转场';
    if (points.length === 0) {
      segments.push({
        subtitle: `${audience}，今天必须给你们安利这款${name}！`,
        visual: hookVisual,
        seconds: 4,
      });
    } else {
      segments.push({
        subtitle: `${audience}，这款${name}真的绝了！`,
        visual: hookVisual,
        seconds: 3,
      });
      for (const point of points) {
        segments.push({
          subtitle: point,
          visual: `卖点镜头：${point}`,
          seconds: Math.max(Math.round(targetSeconds / (points.length + 2)), 3),
        });
      }
    }
    if (price) {
      segments.push({
        subtitle: `现在入手${price}，错过再等一年！`,
        visual: '价格卡片动画，商品主图展示',
        seconds: 4,
      });
    }
    segments.push({
      subtitle: `想要的直接在评论区扣1，马上安排！`,
      visual: 'CTA 画面 + 引导关注',
      seconds: 3,
    });

    const copy = segments.map((s) => s.subtitle).join('\n');
    return {
      title: `${name} 带货短视频`,
      copy,
      usedAi: false,
      segments,
    };
  }

  /**
   * 商品视频自动剪辑：商品信息 → 带货文案 → 提交成片任务（promo 管线）
   */
  async productCut(input: {
    productName: string;
    sellingPoints?: string[];
    price?: number | string;
    audience?: string;
    durationSeconds?: number;
    imageUrl?: string;
    user_id?: string;
  }) {
    const script = this.buildProductCopy(input);
    const prompt = [
      `商品：${input.productName}`,
      `带货口播脚本：\n${script.copy}`,
      input.imageUrl ? `商品主图：${input.imageUrl}` : '',
      '画面要求：短视频带货风格，节奏明快，每个卖点一个镜头。',
    ]
      .filter(Boolean)
      .join('\n');
    this.logger.log(`productCut: ${input.productName} segments=${script.segments.length}`);
    try {
      return await this.studioCoreProxy.postGenerate({
        pipeline: 'promo',
        prompt,
        user_id: input.user_id,
      });
    } catch (error) {
      // studio_core 引擎离线时返回可操作的降级信息（文案已生成，可稍后重试成片）
      this.logger.warn(`productCut 成片引擎不可用: ${error}`);
      return {
        queued: false,
        reason: 'studio_core_offline',
        message: '成片引擎暂不可用，文案已生成；请确认 studio_core 已启动后重试',
        copy: script.copy,
        segments: script.segments,
      };
    }
  }
  // ============ 商品剪辑配置（对标炼刀 /auto/product_video_clip/config） ============

  async createClipConfig(input: {
    name: string;
    productName: string;
    sellingPoints?: string[];
    price?: number | string;
    audience?: string;
    durationSeconds?: number;
    imageUrl?: string;
  }) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('配置名不能为空');
    if (!input.productName?.trim()) throw new BadRequestException('商品名称不能为空');
    const price =
      typeof input.price === 'number'
        ? input.price
        : input.price !== undefined && input.price !== ''
          ? Number(input.price)
          : undefined;
    return this.prisma.productClipConfig.create({
      data: {
        name,
        productName: input.productName.trim(),
        sellingPoints: JSON.stringify(input.sellingPoints ?? []),
        price: Number.isFinite(price) ? price : null,
        audience: input.audience ?? null,
        durationSeconds: Math.min(Math.max(input.durationSeconds ?? 20, 10), 60),
        imageUrl: input.imageUrl ?? null,
      },
    });
  }

  async updateClipConfig(
    id: string,
    input: {
      name?: string;
      productName?: string;
      sellingPoints?: string[];
      price?: number | string;
      audience?: string;
      durationSeconds?: number;
      imageUrl?: string;
    },
  ) {
    const existing = await this.prisma.productClipConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('剪辑配置不存在');
    const price =
      input.price === undefined
        ? undefined
        : typeof input.price === 'number'
          ? input.price
          : input.price === ''
            ? null
            : Number(input.price);
    return this.prisma.productClipConfig.update({
      where: { id },
      data: {
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.productName?.trim()
          ? { productName: input.productName.trim() }
          : {}),
        ...(input.sellingPoints !== undefined
          ? { sellingPoints: JSON.stringify(input.sellingPoints) }
          : {}),
        ...(price !== undefined
          ? { price: Number.isFinite(price) ? price : null }
          : {}),
        ...(input.audience !== undefined ? { audience: input.audience } : {}),
        ...(input.durationSeconds !== undefined
          ? { durationSeconds: Math.min(Math.max(input.durationSeconds, 10), 60) }
          : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        updatedAt: new Date(),
      },
    });
  }

  async listClipConfigs() {
    const rows = await this.prisma.productClipConfig.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      ...row,
      sellingPoints: this.parseSellingPoints(row.sellingPoints),
    }));
  }

  async getClipConfig(id: string) {
    const row = await this.prisma.productClipConfig.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('剪辑配置不存在');
    return { ...row, sellingPoints: this.parseSellingPoints(row.sellingPoints) };
  }

  async removeClipConfig(id: string) {
    const existing = await this.prisma.productClipConfig.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('剪辑配置不存在');
    await this.prisma.productClipConfig.delete({ where: { id } });
    return { id, deleted: true };
  }

  private parseSellingPoints(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * 视频发布计划视图（对标炼刀 /video_release_plan/*）：列出定时发布的视频任务
   */
  async listReleasePlans(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = await this.prisma.runtimeExecution.findMany({
      where: { taskType: { contains: 'publish' } },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    return rows
      .map((row: any) => {
        let payloads: any[] = [];
        try {
          payloads = Array.isArray(row.envelope?.payloads)
            ? row.envelope.payloads
            : JSON.parse(row.envelope || '{}').payloads || [];
        } catch {
          payloads = [];
        }
        const timer = payloads.find(
          (p: any) => p?.enableTimer === 1 || p?.scheduleTime,
        );
        return {
          id: row.id,
          createdAt: row.createdAt,
          status: row.status,
          scheduled: Boolean(timer),
          scheduleTime: timer?.scheduleTime ?? null,
          platforms: payloads.map((p: any) => p?.platform).filter(Boolean),
          title: row.envelope?.title ?? null,
        };
      })
      .filter((plan: any) => plan.scheduled);
  }
}

