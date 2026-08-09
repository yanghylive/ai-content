import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type {
  ExecutorCapability,
  ExecutorEvidence,
  ExecutorReasonCode,
  ExecutorTask,
  RuntimeExecutionResult,
  TaskExecutor,
} from '../../executor.interface';
import { resolveMediaToolPath } from './media-tool-paths';
import { resolveProjectDataPath } from '../../../../common/project-paths';

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type ResolvedMaterial = {
  path: string;
  kind: 'video' | 'image';
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

@Injectable()
export class VideoTemplateClipService implements TaskExecutor {
  readonly id = 'video-template-clip' as const;

  canHandle(task: ExecutorTask): ExecutorCapability {
    if (task.type !== 'video-template-clip') {
      return {
        ok: false,
        priority: 0,
        reason: `unsupported task ${task.type}`,
      };
    }
    return { ok: true, priority: 85 };
  }

  async execute(task: ExecutorTask): Promise<RuntimeExecutionResult> {
    const materialPath = this.readText(task.payload.materialPath);
    const templateName = this.readText(task.payload.templateName) || '默认模板';
    const titlePrompt = this.readText(task.payload.titlePrompt);
    const durationSeconds = this.readDurationSeconds(
      task.payload.durationSeconds,
    );

    if (!materialPath) {
      return this.blocked(
        'target_not_found',
        '请选择要剪辑的素材',
        'materialPath is empty',
      );
    }
    const resolved = this.resolveMaterial(materialPath);
    if (!resolved) {
      return this.blocked(
        'target_not_found',
        '找不到可用素材，请重新选择后再试',
        `materialPath=${materialPath}`,
      );
    }

    const ffmpegPath = resolveMediaToolPath('ffmpeg');
    const ffmpegHealth = await this.runProcess(ffmpegPath, ['-version'], 4000);
    if (ffmpegHealth.exitCode !== 0) {
      return this.blocked(
        'runtime_unavailable',
        '当前设备暂时无法剪辑视频',
        ffmpegHealth.stderr || ffmpegHealth.stdout || 'ffmpeg -version failed',
      );
    }

    const outputDir = resolve(
      this.readText(task.payload.outputDir) ||
        resolveProjectDataPath('video-workshop', 'exports'),
    );
    await mkdir(outputDir, { recursive: true });

    const outputName = this.normalizeOutputName(
      this.readText(task.payload.outputName) ||
        `${templateName}-${Date.now()}.mp4`,
    );
    const outputPath = join(outputDir, outputName);
    const args = this.buildFfmpegArgs(resolved, outputPath, durationSeconds);
    const clipResult = await this.runProcess(ffmpegPath, args, 120000);

    if (clipResult.exitCode !== 0 || !existsSync(outputPath)) {
      return this.blocked(
        'send_failed',
        '视频处理未完成，请检查素材后重试',
        this.truncate(
          clipResult.stderr || clipResult.stdout || 'ffmpeg failed',
        ),
        [
          {
            type: 'text',
            label: 'video-template-clip-error',
            value: this.truncate(clipResult.stderr || clipResult.stdout),
            createdAt: new Date().toISOString(),
            raw: {
              materialPath: resolved.path,
              templateName,
              args,
            },
          },
        ],
      );
    }

    const createdAt = new Date().toISOString();
    return {
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: `成片已生成：${outputName}`,
      technicalMessage: `ffmpeg generated ${outputPath}`,
      runtime: {
        mode: 'local-runtime',
        executor: 'video-template-clip',
        engineUrl: 'internal://runtime/video-template-clip',
      },
      evidence: [
        {
          type: 'text',
          label: 'video-template-clip-output',
          value: outputPath,
          path: outputPath,
          createdAt,
          raw: {
            materialPath: resolved.path,
            materialKind: resolved.kind,
            templateName,
            titlePrompt,
            durationSeconds,
            outputName,
            args,
          },
        },
      ],
      readback: {
        expectedText: outputName,
        actualText: outputPath,
        matched: true,
      },
    };
  }

  async isHealthy(): Promise<{ ok: boolean; details?: string }> {
    const result = await this.runProcess(
      resolveMediaToolPath('ffmpeg'),
      ['-version'],
      4000,
    );
    return {
      ok: result.exitCode === 0,
      details:
        result.exitCode === 0
          ? 'ffmpeg available'
          : this.truncate(
              result.stderr || result.stdout || 'ffmpeg unavailable',
            ),
    };
  }

  private buildFfmpegArgs(
    material: ResolvedMaterial,
    outputPath: string,
    durationSeconds = 30,
  ) {
    const duration = String(durationSeconds);
    if (material.kind === 'image') {
      return [
        '-y',
        '-loop',
        '1',
        '-i',
        material.path,
        '-t',
        duration,
        '-vf',
        'scale=1080:-2,format=yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-movflags',
        '+faststart',
        outputPath,
      ];
    }

    return [
      '-y',
      '-i',
      material.path,
      '-t',
      duration,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      outputPath,
    ];
  }

  private resolveMaterial(value: string): ResolvedMaterial | null {
    if (!value) return null;
    const materialPath = resolve(value);
    const existingPath = existsSync(materialPath)
      ? materialPath
      : this.findMaterialPathAlias(materialPath);
    if (!existingPath) return null;

    const stat = statSync(existingPath);
    if (stat.isFile()) {
      return this.classifyMaterial(existingPath);
    }

    if (!stat.isDirectory()) return null;

    const children = readdirSync(existingPath)
      .map((name) => join(existingPath, name))
      .filter((path) => existsSync(path) && statSync(path).isFile())
      .sort((a, b) => basename(a).localeCompare(basename(b)));

    for (const child of children) {
      const material = this.classifyMaterial(child);
      if (material) return material;
    }
    return null;
  }

  private findMaterialPathAlias(materialPath: string): string | null {
    const parent = dirname(materialPath);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) return null;
    const requestedName = basename(materialPath);
    const requestedExt = extname(requestedName).toLowerCase();
    if (
      !VIDEO_EXTENSIONS.has(requestedExt) &&
      !IMAGE_EXTENSIONS.has(requestedExt)
    ) {
      return null;
    }

    const candidates = readdirSync(parent)
      .map((name) => join(parent, name))
      .filter((path) => existsSync(path) && statSync(path).isFile())
      .filter((path) => extname(path).toLowerCase() === requestedExt)
      .map((path) => ({
        path,
        score: this.scoreMaterialAlias(requestedName, basename(path)),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    return candidates[0]?.path || null;
  }

  private scoreMaterialAlias(requestedName: string, candidateName: string) {
    if (requestedName === candidateName) return 100;
    const requestedBase = requestedName.replace(/\.[^.]+$/, '');
    const candidateBase = candidateName.replace(/\.[^.]+$/, '');
    const requestedTokens = this.materialAliasTokens(requestedBase);
    const candidateTokens = this.materialAliasTokens(candidateBase);
    if (!requestedTokens.length || !candidateTokens.length) return 0;

    const candidateSet = new Set(candidateTokens);
    const matched = requestedTokens.filter((token) => candidateSet.has(token));
    const requiredNumberTokens = requestedTokens.filter((token) =>
      /^\d+$/.test(token),
    );
    if (requiredNumberTokens.some((token) => !candidateSet.has(token))) {
      return 0;
    }

    return (
      matched.length / Math.max(requestedTokens.length, candidateTokens.length)
    );
  }

  private materialAliasTokens(value: string) {
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 || /^\d+$/.test(token));
  }

  private classifyMaterial(path: string): ResolvedMaterial | null {
    const ext = extname(path).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) {
      return { path, kind: 'video' };
    }
    if (IMAGE_EXTENSIONS.has(ext)) {
      return { path, kind: 'image' };
    }
    return null;
  }

  private normalizeOutputName(value: string) {
    const base = value
      .trim()
      .replace(/[\\/:"*?<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80);
    const name = base || `ai-employee-video-${Date.now()}`;
    return name.toLowerCase().endsWith('.mp4') ? name : `${name}.mp4`;
  }

  private readText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readDurationSeconds(value: unknown) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;
    if (!Number.isFinite(numeric)) return 30;
    return Math.min(180, Math.max(1, Math.round(numeric)));
  }

  private blocked(
    reasonCode: ExecutorReasonCode,
    userMessage: string,
    technicalMessage?: string,
    evidence: ExecutorEvidence[] = [],
  ): RuntimeExecutionResult {
    return {
      ok: false,
      status: 'blocked',
      reasonCode,
      userMessage,
      technicalMessage,
      runtime: {
        mode: 'local-runtime',
        executor: 'video-template-clip',
        engineUrl: 'internal://runtime/video-template-clip',
      },
      evidence,
    };
  }

  private runProcess(
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<ProcessResult> {
    return new Promise((resolveProcess) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        resolveProcess({
          exitCode: null,
          stdout,
          stderr: `${stderr}\nprocess timed out after ${timeoutMs}ms`.trim(),
        });
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = this.appendChunk(stdout, chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = this.appendChunk(stderr, chunk);
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveProcess({ exitCode: 1, stdout, stderr: error.message });
      });
      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveProcess({ exitCode, stdout, stderr });
      });
    });
  }

  private appendChunk(current: string, chunk: Buffer) {
    return this.truncate(`${current}${chunk.toString('utf8')}`);
  }

  private truncate(value: string, max = 4000) {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}...`;
  }
}
