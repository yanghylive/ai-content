import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type {
  ExecutorContext,
  RuntimeExecutionResult,
} from '../runtime/executor.interface';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { resolveProjectDataPath } from '../../common/project-paths';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import { VideoFaceSwapService as VideoFaceSwapExecutorService } from '../runtime/platforms/video/video-face-swap.service';

export type VideoFaceSwapMode =
  | 'face_swap'
  | 'deep_swap'
  | 'lip_sync'
  | 'face_enhance'
  | 'frame_enhance'
  | 'background_remove'
  | 'frame_colorize'
  | 'expression_restore'
  | 'face_edit'
  | 'age_modify';

export interface VideoFaceSwapJobInput {
  mode?: VideoFaceSwapMode;
  targetPath?: string;
  sourcePath?: string;
  audioPath?: string;
  outputName?: string;
  outputDir?: string;
  durationSeconds?: number;
  authorizationConfirmed?: boolean;
  lawfulUseConfirmed?: boolean;
  commercialLicenseConfirmed?: boolean;
  usagePurpose?: string;
  acceptedCostPoints?: number;
}

export interface VideoFaceSwapCostItem {
  label: string;
  amount: number;
  rule: string;
}

export interface VideoFaceSwapEstimate {
  mode: VideoFaceSwapMode;
  durationSeconds: number;
  estimatedCostPoints: number;
  items: VideoFaceSwapCostItem[];
  policyVersion: string;
}

export interface VideoFaceSwapMaterialFile {
  id: string;
  name: string;
  path: string;
  kind: 'video' | 'image' | 'audio';
  sizeBytes: number;
  updatedAt: string;
}

export interface VideoFaceSwapUploadFile {
  originalname?: string;
  buffer?: Buffer;
  size?: number;
  mimetype?: string;
}

export interface VideoFaceSwapJobSummary {
  id: string;
  outputPath: string;
  outputName: string;
  message: string;
  createdAt: string;
  mode: VideoFaceSwapMode;
}

export interface VideoFaceSwapPreviewClip {
  path: string;
  name: string;
  contentType: string;
}

export interface VideoFaceSwapBillingStatus {
  ok: boolean;
  status:
    | 'ready'
    | 'needs_login'
    | 'needs_account'
    | 'needs_authorization'
    | 'local_only';
  label: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
}

const BILLING_POLICY_VERSION = 'video-face-swap-credit-v1-2026-07-02';

const COST_RULES: Record<
  VideoFaceSwapMode,
  { label: string; base: number; step: number }
> = {
  face_swap: { label: '授权换脸', base: 30, step: 10 },
  deep_swap: { label: '深度替换', base: 50, step: 15 },
  lip_sync: { label: '口型同步', base: 25, step: 8 },
  face_enhance: { label: '人像修复', base: 18, step: 6 },
  frame_enhance: { label: '画质增强', base: 22, step: 8 },
  background_remove: { label: '背景处理', base: 20, step: 7 },
  frame_colorize: { label: '视频上色', base: 18, step: 6 },
  expression_restore: { label: '表情修复', base: 15, step: 5 },
  face_edit: { label: '面部微调', base: 15, step: 5 },
  age_modify: { label: '年龄效果', base: 15, step: 5 },
};

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.avi',
  '.mkv',
  '.webm',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac']);

@Injectable()
export class VideoFaceSwapService {
  constructor(
    private readonly runtime: RuntimeOrchestrator,
    private readonly executor: VideoFaceSwapExecutorService,
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  capabilities() {
    return Object.entries(COST_RULES).map(([mode, rule]) => ({
      mode: mode as VideoFaceSwapMode,
      title: rule.label,
      description: this.modeDescription(mode as VideoFaceSwapMode),
      cost: {
        basePoints: rule.base,
        includedSeconds: 60,
        extraPointsPer30Seconds: rule.step,
      },
      requiredMaterials: this.requiredMaterials(mode as VideoFaceSwapMode),
    }));
  }

  estimate(input: VideoFaceSwapJobInput): VideoFaceSwapEstimate {
    const mode = this.readMode(input.mode);
    const durationSeconds = this.readDurationSeconds(input.durationSeconds);
    const rule = COST_RULES[mode];
    const extraBlocks = Math.ceil(Math.max(0, durationSeconds - 60) / 30);
    const extra = extraBlocks * rule.step;
    const amount = rule.base + extra;
    return {
      mode,
      durationSeconds,
      estimatedCostPoints: amount,
      policyVersion: BILLING_POLICY_VERSION,
      items: [
        {
          label: rule.label,
          amount,
          rule:
            extraBlocks > 0
              ? `前 60 秒 ${rule.base} 点，超出 ${extraBlocks} 个 30 秒加 ${extra} 点`
              : `60 秒内 ${rule.base} 点`,
        },
      ],
    };
  }

  async health() {
    const readiness = await this.executor.readiness();
    return {
      ok: readiness.ok,
      status: readiness.status,
      message: readiness.message,
      checkedAt: readiness.checkedAt,
      checks: readiness.checks.map((check) => ({
        key: check.key,
        label: check.label,
        ok: check.ok,
        message: check.message,
        required: check.required,
      })),
    };
  }

  billingStatus(): VideoFaceSwapBillingStatus {
    const user = this.authRequestContext?.get()?.user;
    const accountHref = '/capabilities/account';

    if (!user?.id) {
      return {
        ok: false,
        status: 'needs_login',
        label: '未登录',
        message: '请先登录当前系统账号，再生成视频。',
        actionLabel: '去登录',
        actionHref: '/login',
      };
    }

    if (!user.kaypalUserId?.trim()) {
      return {
        ok: false,
        status: 'needs_account',
        label: '需授权',
        message: '当前账号还不能正式扣点。请先到账号与设备完成授权。',
        actionLabel: '去账号与设备',
        actionHref: accountHref,
      };
    }

    if (user.kaypalLocalOnly) {
      return {
        ok: false,
        status: 'local_only',
        label: '需重新授权',
        message:
          '当前是本地测试授权，不能用于正式扣点生成。请重新完成账号与设备授权。',
        actionLabel: '重新授权',
        actionHref: accountHref,
      };
    }

    const hasAccessToken = Boolean(user.kaypalDesktopAccessToken?.trim());
    const hasRefreshToken = Boolean(
      user.kaypalDesktopRefreshToken?.trim() &&
      user.kaypalDesktopDeviceId?.trim(),
    );

    if (!hasAccessToken && !hasRefreshToken) {
      return {
        ok: false,
        status: 'needs_authorization',
        label: '需授权',
        message:
          '当前账号已绑定，但还没有完成正式扣点授权。请到账号与设备重新授权。',
        actionLabel: '去账号与设备',
        actionHref: accountHref,
      };
    }

    return {
      ok: true,
      status: 'ready',
      label: '可扣点',
      message: '生成前会先冻结预计点数，生成成功后扣除；失败不会扣点。',
    };
  }

  async createJob(input: VideoFaceSwapJobInput) {
    const health = await this.health();
    if (!health.ok) {
      throw new BadRequestException(health.message);
    }

    const mode = this.readMode(input.mode);
    const targetPath = this.requireText(input.targetPath, '请先选择视频素材');
    const target = this.resolveMaterial(targetPath);
    if (!target || target.kind !== 'video') {
      throw new BadRequestException('请上传或选择视频素材');
    }

    let sourcePath = this.readOptionalText(input.sourcePath);
    if (this.modeNeedsFaceSource(mode)) {
      sourcePath = this.requireText(input.sourcePath, '请先选择授权人脸图片');
      const source = this.resolveMaterial(sourcePath);
      if (!source || source.kind !== 'image') {
        throw new BadRequestException('人脸素材需要使用图片文件');
      }
    }

    let audioPath = this.readOptionalText(input.audioPath);
    if (mode === 'lip_sync') {
      audioPath = this.requireText(input.audioPath, '请先选择口型同步音频');
      const audio = this.resolveMaterial(audioPath);
      if (!audio || audio.kind !== 'audio') {
        throw new BadRequestException('口型同步需要使用音频文件');
      }
    }

    if (!input.authorizationConfirmed) {
      throw new BadRequestException('请先确认肖像和素材授权');
    }
    if (!input.lawfulUseConfirmed) {
      throw new BadRequestException('请先确认本次用途合规');
    }
    if (!input.commercialLicenseConfirmed) {
      throw new BadRequestException('请先确认商业使用限制和模型授权风险');
    }

    const usagePurpose = this.requireText(
      input.usagePurpose,
      '请填写本次视频用途',
    );
    const estimate = this.estimate(input);
    const accepted = this.readPositiveInteger(input.acceptedCostPoints);
    if (accepted < estimate.estimatedCostPoints) {
      throw new BadRequestException(
        `本次预计扣 ${estimate.estimatedCostPoints} 点，请确认后再生成`,
      );
    }

    const outputDir = resolve(
      this.readOptionalText(input.outputDir) ||
        resolveProjectDataPath('video-face-swap', 'exports'),
    );
    const outputName = this.normalizeOutputName(
      this.readOptionalText(input.outputName) ||
        `${COST_RULES[mode].label}-${Date.now()}${extname(target.path) || '.mp4'}`,
      extname(target.path) || '.mp4',
    );

    const result = await this.runtime.execute(
      {
        relatedId: `video-face-swap-${Date.now()}`,
        relatedType: 'agent-session',
        type: 'video-face-swap',
        platform: 'mixed',
        payload: {
          mode,
          targetPath: target.path,
          sourcePath,
          audioPath,
          outputName,
          outputDir,
          durationSeconds: estimate.durationSeconds,
          authorizationConfirmed: true,
          lawfulUseConfirmed: true,
          commercialLicenseConfirmed: true,
          usagePurpose,
          billingAmount: estimate.estimatedCostPoints,
          estimatedCostPoints: estimate.estimatedCostPoints,
          acceptedCostPoints: accepted,
          billingPolicyVersion: estimate.policyVersion,
          compliance: {
            authorizationConfirmed: true,
            lawfulUseConfirmed: true,
            commercialLicenseConfirmed: true,
            usagePurpose,
          },
        },
      },
      this.buildContext(),
    );

    return this.toResponse(result, estimate);
  }

  listJobs(limit = 20): VideoFaceSwapJobSummary[] {
    const outputDir = resolveProjectDataPath('video-face-swap', 'exports');
    if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
      return [];
    }

    return readdirSync(outputDir)
      .map((name) => join(outputDir, name))
      .filter((path) => existsSync(path) && statSync(path).isFile())
      .filter((path) => VIDEO_EXTENSIONS.has(extname(path).toLowerCase()))
      .map((path) => ({ path, stat: statSync(path) }))
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
      .slice(0, Math.max(1, Math.min(100, Math.round(limit))))
      .map((clip) => {
        const outputName = basename(clip.path);
        const createdAt = new Date(clip.stat.mtimeMs).toISOString();
        return {
          id: `video-face-swap-${Math.round(clip.stat.mtimeMs)}-${outputName}`,
          outputPath: outputName,
          outputName,
          message: `成片已生成：${outputName}`,
          createdAt,
          mode: 'face_swap',
        };
      });
  }

  listMaterialFiles(limit = 50): VideoFaceSwapMaterialFile[] {
    const materialDir = join(
      process.cwd(),
      'data',
      'video-face-swap',
      'materials',
    );
    if (!existsSync(materialDir) || !statSync(materialDir).isDirectory()) {
      return [];
    }

    return (
      readdirSync(materialDir)
        .map((name) => join(materialDir, name))
        .filter((path) => existsSync(path) && statSync(path).isFile())
        // 过滤内部文件：目录可写性 probe（.kaypal-runcheck-*.probe）与渲染中间文件（.partial.*）
        .filter((path) => {
          const name = basename(path);
          return !name.startsWith('.kaypal-') && !name.includes('.partial');
        })
        .map((path) => this.materialFileFromPath(path, 'public'))
        .filter((item): item is VideoFaceSwapMaterialFile => Boolean(item))
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        )
        .slice(0, Math.max(1, Math.min(100, Math.round(limit))))
    );
  }

  async importMaterialFile(
    file: VideoFaceSwapUploadFile,
  ): Promise<VideoFaceSwapMaterialFile> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请选择要上传的素材文件');
    }

    const safeName = this.safeMaterialFileName(
      file.originalname || `material-${Date.now()}`,
    );
    const kind = this.kindFromPath(safeName);
    if (!kind) {
      throw new BadRequestException('只支持视频、图片或音频素材');
    }

    const materialDir = join(
      process.cwd(),
      'data',
      'video-face-swap',
      'materials',
    );
    await mkdir(materialDir, { recursive: true });
    const outputPath = join(
      materialDir,
      this.uniqueMaterialFileName(materialDir, safeName),
    );
    await writeFile(outputPath, file.buffer);

    const material = this.materialFileFromPath(outputPath, 'public');
    if (!material) {
      throw new BadRequestException('素材上传失败');
    }
    return material;
  }

  resolvePreviewClip(path: unknown): VideoFaceSwapPreviewClip {
    const clipPath = this.requireText(path, '请选择要预览的成片');
    const resolvedPath = this.resolvePreviewPath(clipPath);
    if (!this.isAllowedPreviewPath(resolvedPath)) {
      throw new BadRequestException('只能预览视频换脸生成的成片');
    }
    if (!VIDEO_EXTENSIONS.has(extname(resolvedPath).toLowerCase())) {
      throw new BadRequestException('只能预览视频成片');
    }
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
      throw new NotFoundException('成片文件不存在');
    }
    return {
      path: resolvedPath,
      name: basename(resolvedPath),
      contentType: this.videoContentType(resolvedPath),
    };
  }

  private buildContext(): ExecutorContext {
    return {
      riskContext: {
        accountName: 'video-face-swap',
      },
      sendMode: 'auto-send',
    };
  }

  private toResponse(
    result: RuntimeExecutionResult,
    estimate: VideoFaceSwapEstimate,
  ) {
    return {
      ok: result.ok,
      status: result.status,
      reasonCode: result.reasonCode,
      message: result.userMessage,
      detail: result.technicalMessage,
      billing: result.billing,
      estimate,
      evidence: result.evidence.map((item) => ({
        type: item.type,
        label: item.label,
        url: this.publicOutputPath(item.path || item.value),
        path: this.publicOutputPath(item.path || item.value),
        createdAt: item.createdAt,
        raw: {
          outputName: item.raw?.outputName,
          mode: item.raw?.mode,
          durationSeconds: item.raw?.durationSeconds,
          billingAmount: item.raw?.billingAmount,
        },
      })),
      candidates: [],
    };
  }

  private modeDescription(mode: VideoFaceSwapMode) {
    const descriptions: Record<VideoFaceSwapMode, string> = {
      face_swap: '把授权人脸替换到指定视频中',
      deep_swap: '换脸后自动做人像修复，适合正式交付素材',
      lip_sync: '按音频自动生成口型同步结果',
      face_enhance: '修复人像清晰度和面部细节',
      frame_enhance: '提升视频画面清晰度',
      background_remove: '处理视频人物背景',
      frame_colorize: '为黑白或低色彩视频补色',
      expression_restore: '修复表情自然度',
      face_edit: '做轻量面部表情微调',
      age_modify: '生成年龄变化效果',
    };
    return descriptions[mode];
  }

  private requiredMaterials(mode: VideoFaceSwapMode) {
    if (this.modeNeedsFaceSource(mode)) return ['视频素材', '授权人脸图片'];
    if (mode === 'lip_sync') return ['视频素材', '音频文件'];
    return ['视频素材'];
  }

  private modeNeedsFaceSource(mode: VideoFaceSwapMode) {
    return mode === 'face_swap' || mode === 'deep_swap';
  }

  private readMode(value: unknown): VideoFaceSwapMode {
    const mode = this.readOptionalText(value) as VideoFaceSwapMode;
    return Object.prototype.hasOwnProperty.call(COST_RULES, mode)
      ? mode
      : 'face_swap';
  }

  private readDurationSeconds(value: unknown) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;
    if (!Number.isFinite(numeric)) return 60;
    return Math.min(1800, Math.max(1, Math.round(numeric)));
  }

  private readPositiveInteger(value: unknown) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  }

  private requireText(value: unknown, message: string) {
    const text = this.readOptionalText(value);
    if (!text) {
      throw new BadRequestException(message);
    }
    return text;
  }

  private readOptionalText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private resolveMaterial(path: string): VideoFaceSwapMaterialFile | null {
    const resolvedPath = this.resolveMaterialPath(path);
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
      return null;
    }
    return this.materialFileFromPath(resolvedPath, 'internal');
  }

  private materialFileFromPath(
    path: string,
    scope: 'internal' | 'public' = 'internal',
  ): VideoFaceSwapMaterialFile | null {
    const kind = this.kindFromPath(path);
    if (!kind || !existsSync(path) || !statSync(path).isFile()) return null;
    const stat = statSync(path);
    return {
      id: `${Math.round(stat.mtimeMs)}-${basename(path)}`,
      name: basename(path),
      path: scope === 'public' ? basename(path) : path,
      kind,
      sizeBytes: stat.size,
      updatedAt: new Date(stat.mtimeMs).toISOString(),
    };
  }

  private kindFromPath(path: string): VideoFaceSwapMaterialFile['kind'] | null {
    const ext = extname(path).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    return null;
  }

  private safeMaterialFileName(name: string) {
    const fileName = basename(name)
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();
    return fileName || `material-${Date.now()}.mp4`;
  }

  private uniqueMaterialFileName(materialDir: string, fileName: string) {
    if (!existsSync(join(materialDir, fileName))) return fileName;
    const ext = extname(fileName);
    const stem = basename(fileName, ext);
    return `${stem}-${Date.now()}${ext}`;
  }

  private normalizeOutputName(value: string, outputExtension = '.mp4') {
    const base = value
      .trim()
      .replace(/[\\/:"*?<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 100);
    const name = base || `video-face-swap-${Date.now()}`;
    const requestedExt = extname(name);
    if (requestedExt) {
      return `${basename(name, requestedExt)}${outputExtension}`;
    }
    return `${name}${outputExtension}`;
  }

  private isAllowedPreviewPath(path: string) {
    const roots = [resolveProjectDataPath('video-face-swap', 'exports')].map(
      (root) => resolve(root),
    );

    return roots.some((root) => path === root || path.startsWith(`${root}/`));
  }

  private resolveMaterialPath(path: string) {
    const text = this.readOptionalText(path);
    const direct = resolve(text);
    if (existsSync(direct)) return direct;
    return resolve(
      join(
        process.cwd(),
        'data',
        'video-face-swap',
        'materials',
        basename(text),
      ),
    );
  }

  private resolvePreviewPath(path: string) {
    const text = this.readOptionalText(path);
    const direct = resolve(text);
    if (this.isAllowedPreviewPath(direct)) return direct;
    return resolve(
      resolveProjectDataPath('video-face-swap', 'exports', basename(text)),
    );
  }

  private publicOutputPath(value: unknown) {
    const text = this.readOptionalText(value);
    return text ? basename(text) : undefined;
  }

  private videoContentType(path: string) {
    const ext = extname(path).toLowerCase();
    if (ext === '.webm') return 'video/webm';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.m4v') return 'video/x-m4v';
    if (ext === '.avi') return 'video/x-msvideo';
    if (ext === '.mkv') return 'video/x-matroska';
    return 'video/mp4';
  }
}
