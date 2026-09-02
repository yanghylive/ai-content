import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  StudioCoreBusinessError,
  StudioCoreProxyService,
} from './studio-core-proxy.service';
import { MultimodalService } from '../multimodal/multimodal.service';
import { GenerateVideoDto } from './dto/generate-video.dto';
import { VideoProjectListQueryDto } from './dto/video-project-list-query.dto';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

/**
 * 视频一键成片 service（复用 studio_core 引擎）
 *
 * 职责：
 *   1. 接收前端请求，转发到 studio_core dashboard (8600/8610)
 *   2. 双写：studio_core 写文件 + NestJS 同步到 Postgres（后续）
 *   3. 透传 user_id（多用户隔离）
 */
/** 发布计划里单个 payload 的结构（来自 runtimeJson envelope，字段动态） */
interface ReleasePlanPayload {
  enableTimer?: unknown;
  scheduleTime?: unknown;
  platform?: unknown;
  accountIdentity?: { platform?: string };
}

/** 发布计划行：runtimeExecution 查询结果，定时数据存在 runtimeJson（不是 envelope——schema 无 envelope 列） */
type ReleasePlanRow = {
  id: string;
  createdAt: Date;
  status: string;
  runtimeJson?: unknown;
};

interface ReleasePlanEnvelope {
  payloads?: ReleasePlanPayload[];
  title?: unknown;
  /** 改期后的计划发布时间（ISO 8601），未改期则缺省 */
  plannedAt?: string;
  /** 取消时间（ISO 8601），取消后写入 */
  cancelledAt?: string;
}

export interface ReleasePlan {
  id: string;
  createdAt: Date;
  status: string;
  scheduled: boolean;
  scheduleTime: string | null;
  platforms: string[];
  title: unknown;
}

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly studioCoreProxy: StudioCoreProxyService,
    private readonly autoUploadService: AutoUploadService,
    private readonly prisma: PrismaService,
    private readonly multimodal: MultimodalService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 提交视频生成任务
   * @param kaypalUserId 云端通道计费归属（服务端会话注入，2026-09-01 审计 #8）
   */
  async generate(
    dto: GenerateVideoDto,
    kaypalUserId?: string,
    ownerId?: string,
  ) {
    this.logger.log(
      `generate: pipeline=${dto.pipeline} prompt=${dto.prompt.slice(0, 50)}...`,
    );
    // 透传到 studio_core；本机 StudioCore 不可达（打包态典型）时回退
    // kaypal.cn 云端网关视频通道（/api/ai/v1/video/generations，统一计费）。
    let result: { project_id: string; status: string } | undefined;
    try {
      result = await this.studioCoreProxy.postGenerate(dto);
    } catch (error) {
      // 2026-09-01（复核第五轮 P1-3）：只捕获引擎连接失败回退云端；
      // owner 登记失败必须原样抛错（否则 StudioCore 已建项目 + 云端重复生成）
      // 2026-09-01（复核第六轮 P1）：业务拒绝（4xx）同样不得回退——原样抛
      if (error instanceof StudioCoreBusinessError) {
        throw error;
      }
      const message = this.errorMessage(error);
      this.logger.warn(
        `StudioCore 不可达，回退 kaypal 云端视频通道：${message}`,
      );
      return this.generateViaKaypalGateway(dto, message, kaypalUserId);
    }
    // 2026-09-01（复核第四轮 P1）：创建入口统一登记项目归属（服务端认证用户）。
    // 登记失败抛错并记录补偿（不进入云端回退，避免重复任务/孤儿项目）。
    if (ownerId && result?.project_id) {
      await this.prisma.registerStudioProjectOwner(result.project_id, ownerId);
    }
    return result;
  }

  /** 云端网关视频兜底：提交异步任务，返回任务受理信息 */
  private async generateViaKaypalGateway(
    dto: GenerateVideoDto,
    reason: string,
    kaypalUserId?: string,
  ) {
    if (!this.multimodal) {
      throw new Error(`视频服务不可达且云端通道未启用：${reason}`);
    }
    // 计费归属：优先当前会话用户；无会话用户时回退主账号（KAYPAL_BILLING_USER_ID）。
    // 2026-09-01 安全修复（审计 #8）：两者皆空时显式报错，不再静默记到空账号。
    const billingUserId =
      kaypalUserId?.trim() ||
      this.config.get<string>('KAYPAL_BILLING_USER_ID')?.trim() ||
      '';
    if (!billingUserId) {
      throw new Error(
        `视频服务不可达且无法确定计费用户（无会话 kaypalUserId、未配置 KAYPAL_BILLING_USER_ID）：${reason}`,
      );
    }
    const authUser = {
      kaypalUserId: billingUserId,
      id: dto.user_id ?? '',
    } as never;
    const result = await this.multimodal.generateVideo(authUser, {
      prompt: dto.prompt,
    });
    return {
      source: 'kaypal-gateway',
      ...result,
    };
  }

  /**
   * 查询视频项目列表
   */
  /** 项目归属查询（列表标注用） */
  async resolveProjectOwner(projectId: string): Promise<string | null> {
    const rows = await this.prisma.system.$queryRawUnsafe<
      Array<{ user_id: string }>
    >(
      `SELECT user_id FROM studio_project_owners WHERE project_id = ?`,
      projectId,
    );
    return rows.length > 0 ? rows[0].user_id : null;
  }

  /**
   * 2026-09-01（复核第六轮 P2）：项目归属迁移管理员判定（与 auth.guard 角色
   * 检查对齐：本地 admin / super_admin + 云角色 SUPER_ADMIN）。提取为公共方法可测。
   */
  isAdminForProjectMigration(
    user?: {
      role?: string;
      kaypalRole?: string;
      kaypalPlatformRole?: string;
    } | null,
  ): boolean {
    const role = user?.role ?? 'operator';
    const cloudRole = user?.kaypalRole ?? user?.kaypalPlatformRole ?? null;
    return (
      role === 'admin' || role === 'super_admin' || cloudRole === 'SUPER_ADMIN'
    );
  }

  async listProjects(query: VideoProjectListQueryDto, userId: string) {
    try {
      const result = await this.studioCoreProxy.getProjects(query);
      // 2026-09-01（复核 P0）：列表按创建者过滤——只返回当前用户拥有的项目
      const owned = await this.prisma.listStudioProjectOwnerIds(userId);
      const projects = result.projects.filter((p) =>
        owned.has(String((p as { id?: unknown })?.id)),
      );
      return { projects, total: projects.length };
    } catch (error) {
      this.logger.warn(`视频服务暂不可用：${this.errorMessage(error)}`);
      // 2026-09-01（复核 P2）：不再静默降级空列表——抛错让前端错误处理上屏
      throw new ServiceUnavailableException('视频服务暂不可用，请稍后重试');
    }
  }

  /**
   * 查询单个视频项目详情
   */
  async getProject(id: string, userId: string) {
    // 2026-09-01（复核 P0）：项目 ID 操作前校验归属（无记录/不匹配拒绝，不认领）
    await this.prisma.assertStudioProjectOwner(id, userId);
    const project = await this.studioCoreProxy.getProject(id);
    if (!project) {
      throw new NotFoundException(`视频项目 ${id} 不存在`);
    }
    return project;
  }

  /**
   * 获取视频项目产物（compose.mp4）
   */
  async getComposeMp4(id: string, userId: string) {
    // 2026-09-01（复核 P0）：成片下载同样校验归属（不认领）
    await this.prisma.assertStudioProjectOwner(id, userId);
    return this.studioCoreProxy.getComposeMp4(id);
  }

  /**
   * 查询可用流水线列表
   */
  async listPipelines() {
    try {
      return await this.studioCoreProxy.getPipelines();
    } catch (error) {
      this.logger.warn(`视频服务暂不可用：${this.errorMessage(error)}`);
      // 2026-09-01（复核第三轮 P2）：不再静默降级空列表
      throw new ServiceUnavailableException('视频服务暂不可用，请稍后重试');
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
    userId: string,
  ): Promise<{ filename: string; sizeBytes: number }> {
    // 2026-09-01（复核 P0）：导入成片同样校验归属（不认领）
    await this.prisma.assertStudioProjectOwner(id, userId);
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
    const points = (input.sellingPoints ?? [])
      .filter((p) => p?.trim())
      .slice(0, 5);
    const price =
      input.price === undefined || input.price === ''
        ? ''
        : `只要 ${input.price}`;
    const audience = input.audience?.trim() || '家人们';
    const targetSeconds = Math.min(
      Math.max(input.durationSeconds ?? 20, 10),
      60,
    );

    // 分镜：钩子 → 卖点（每点一个镜头）→ 价格锚点 → CTA
    const segments: Array<{
      subtitle: string;
      visual: string;
      seconds: number;
    }> = [];
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
  async productCut(
    input: {
      productName: string;
      sellingPoints?: string[];
      price?: number | string;
      audience?: string;
      durationSeconds?: number;
      imageUrl?: string;
      user_id?: string;
    },
    ownerId?: string,
  ) {
    const script = this.buildProductCopy(input);
    const prompt = [
      `商品：${input.productName}`,
      `带货口播脚本：\n${script.copy}`,
      input.imageUrl ? `商品主图：${input.imageUrl}` : '',
      '画面要求：短视频带货风格，节奏明快，每个卖点一个镜头。',
    ]
      .filter(Boolean)
      .join('\n');
    this.logger.log(
      `productCut: ${input.productName} segments=${script.segments.length}`,
    );
    let result: { project_id: string; status: string } | undefined;
    try {
      result = await this.studioCoreProxy.postGenerate({
        pipeline: 'promo',
        prompt,
        user_id: input.user_id,
      });
    } catch (error) {
      // 2026-09-01（复核第五轮 P1-3）：只捕获引擎连接失败（引擎离线可降级）；
      // owner 登记失败不伪装成"引擎离线"
      // 2026-09-01（复核第六轮 P1）：业务拒绝（4xx）原样抛，不降级
      if (error instanceof StudioCoreBusinessError) {
        throw error;
      }
      this.logger.warn(`productCut 成片引擎不可用: ${error}`);
      return {
        queued: false,
        reason: 'studio_core_offline',
        message:
          '成片引擎暂不可用，文案已生成；请确认 studio_core 已启动后重试',
        copy: script.copy,
        segments: script.segments,
      };
    }
    // 2026-09-01（复核第四轮 P1）：创建入口统一登记归属（服务端认证用户）。
    // 登记失败原样抛错（不留无归属项目）
    if (ownerId && result?.project_id) {
      await this.prisma.registerStudioProjectOwner(result.project_id, ownerId);
    }
    return result;
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
    if (!input.productName?.trim())
      throw new BadRequestException('商品名称不能为空');
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
        durationSeconds: Math.min(
          Math.max(input.durationSeconds ?? 20, 10),
          60,
        ),
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
    const existing = await this.prisma.productClipConfig.findUnique({
      where: { id },
    });
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
          ? {
              durationSeconds: Math.min(
                Math.max(input.durationSeconds, 10),
                60,
              ),
            }
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
    const row = await this.prisma.productClipConfig.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('剪辑配置不存在');
    return {
      ...row,
      sellingPoints: this.parseSellingPoints(row.sellingPoints),
    };
  }

  async removeClipConfig(id: string) {
    const existing = await this.prisma.productClipConfig.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('剪辑配置不存在');
    await this.prisma.productClipConfig.delete({ where: { id } });
    return { id, deleted: true };
  }

  private parseSellingPoints(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
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
    return (rows as ReleasePlanRow[])
      .map((row): ReleasePlan => {
        const raw = row.runtimeJson;
        let payloads: ReleasePlanPayload[] = [];
        let title: unknown = null;
        let plannedAt: string | null = null;
        let cancelled = false;
        try {
          const parsedEnvelope = (
            typeof raw === 'string' ? JSON.parse(raw) : raw
          ) as ReleasePlanEnvelope;
          if (parsedEnvelope !== null && typeof parsedEnvelope === 'object') {
            payloads = Array.isArray(parsedEnvelope.payloads)
              ? parsedEnvelope.payloads
              : [];
            title = parsedEnvelope.title ?? null;
            plannedAt =
              typeof parsedEnvelope.plannedAt === 'string'
                ? parsedEnvelope.plannedAt
                : null;
            cancelled = Boolean(parsedEnvelope.cancelledAt);
          }
        } catch {
          payloads = [];
        }
        const timer = payloads.find(
          (p) => p.enableTimer === 1 || Boolean(p.scheduleTime),
        );
        return {
          id: row.id,
          createdAt: row.createdAt,
          status: row.status,
          scheduled: (Boolean(timer) || Boolean(plannedAt)) && !cancelled,
          scheduleTime: plannedAt ?? (timer?.scheduleTime as string) ?? null,
          platforms: payloads
            .map((p) => p.accountIdentity?.platform ?? p.platform)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
          title,
        };
      })
      .filter((plan) => plan.scheduled);
  }
}
