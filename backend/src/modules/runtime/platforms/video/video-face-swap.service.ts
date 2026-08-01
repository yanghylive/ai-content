import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type {
  ExecutorCapability,
  ExecutorContext,
  ExecutorEvidence,
  ExecutorReasonCode,
  ExecutorTask,
  RuntimeExecutionResult,
  TaskExecutor,
} from '../../executor.interface';
import { resolveProjectDataPath } from '../../../../common/project-paths';
import { resolveMediaToolPath } from './media-tool-paths';

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

type VideoFaceSwapMode =
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

type ResolvedMaterial = {
  path: string;
  kind: 'video' | 'image' | 'audio';
};

export interface VideoFaceSwapRuntimeCheck {
  key: string;
  label: string;
  ok: boolean;
  message: string;
  required: boolean;
}

export interface VideoFaceSwapRuntimeReadiness {
  ok: boolean;
  status: 'ready' | 'needs_setup';
  message: string;
  checkedAt: string;
  checks: VideoFaceSwapRuntimeCheck[];
}

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

const PROCESSOR_BY_MODE: Record<VideoFaceSwapMode, string[]> = {
  face_swap: ['face_swapper'],
  deep_swap: ['face_swapper', 'face_enhancer'],
  lip_sync: ['lip_syncer'],
  face_enhance: ['face_enhancer'],
  frame_enhance: ['frame_enhancer'],
  background_remove: ['background_remover'],
  frame_colorize: ['frame_colorizer'],
  expression_restore: ['expression_restorer'],
  face_edit: ['face_editor'],
  age_modify: ['age_modifier'],
};

const ALLOWED_PROCESSORS = new Set(
  Object.values(PROCESSOR_BY_MODE).flatMap((items) => items),
);

@Injectable()
export class VideoFaceSwapService implements TaskExecutor {
  readonly id = 'video-face-swap' as const;

  canHandle(task: ExecutorTask): ExecutorCapability {
    if (task.type !== 'video-face-swap') {
      return {
        ok: false,
        priority: 0,
        reason: `unsupported task ${task.type}`,
      };
    }
    return { ok: true, priority: 90 };
  }

  async execute(
    task: ExecutorTask,
    _ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    if (!this.readBoolean(task.payload.authorizationConfirmed)) {
      return this.blocked(
        'review_required',
        '请先确认素材已获得授权，再开始生成。',
        'authorizationConfirmed is required',
      );
    }

    const targetPath = this.readText(task.payload.targetPath);
    const target = this.resolveMaterial(targetPath, ['video']);
    if (!target) {
      return this.blocked(
        'target_not_found',
        '没有找到要处理的视频素材，请选择视频文件。',
        targetPath ? `targetPath=${targetPath}` : 'targetPath is empty',
      );
    }

    const mode = this.readMode(task.payload.mode);
    const processors = this.resolveProcessors(task.payload.processors, mode);
    if (processors.length === 0) {
      return this.blocked(
        'review_required',
        '请选择要生成的视频效果。',
        `mode=${mode} processors empty`,
      );
    }

    const source = this.resolveSource(task, processors);
    if (source.error) {
      return this.blocked(
        source.reasonCode,
        source.userMessage,
        source.technicalMessage,
      );
    }

    const health = await this.isHealthy();
    if (!health.ok) {
      return this.blocked(
        'runtime_unavailable',
        '本机视频换脸引擎不可用，不能执行真实生成。',
        health.details,
      );
    }

    const outputDir = resolve(
      this.readText(task.payload.outputDir) ||
        resolveProjectDataPath('video-face-swap', 'exports'),
    );
    await mkdir(outputDir, { recursive: true });

    const outputName = this.normalizeOutputName(
      this.readText(task.payload.outputName) ||
        `video-face-swap-${Date.now()}${extname(target.path) || '.mp4'}`,
      extname(target.path) || '.mp4',
    );
    const outputPath = join(outputDir, outputName);
    const root = this.resolveFaceFusionRoot();
    const runId = `${task.relatedId}-${Date.now()}`
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .slice(0, 120);
    const jobsPath = join(outputDir, '.jobs', runId);
    const tempPath = join(outputDir, '.temp', runId);
    await mkdir(jobsPath, { recursive: true });
    await mkdir(tempPath, { recursive: true });
    const args = this.buildFaceFusionArgs({
      mode,
      processors,
      targetPath: target.path,
      sourcePath: source.material?.path,
      outputPath,
      jobsPath,
      tempPath,
      payload: task.payload,
    });

    const python = this.getPythonCommand();
    const result = await this.runProcess(python, args, 30 * 60_000, root);
    if (result.exitCode !== 0 || !existsSync(outputPath)) {
      return this.blocked(
        'runtime_unavailable',
        '视频换脸生成失败，已保留错误信息。',
        this.truncate(result.stderr || result.stdout || 'face swap failed'),
        [
          {
            type: 'text',
            label: 'video-face-swap-error',
            value: this.truncate(result.stderr || result.stdout),
            createdAt: new Date().toISOString(),
            raw: {
              mode,
              processors,
              targetPath: target.path,
              sourcePath: source.material?.path,
              outputName,
              jobsPath,
              tempPath,
              args,
            },
          },
        ],
      );
    }

    const createdAt = new Date().toISOString();
    const durationSeconds = this.readDurationSeconds(
      task.payload.durationSeconds,
    );
    return {
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: `视频换脸已生成：${outputName}`,
      technicalMessage: `FaceFusion generated ${outputPath}`,
      runtime: {
        mode: 'local-runtime',
        executor: 'video-face-swap',
        engineUrl: 'internal://runtime/video-face-swap',
      },
      evidence: [
        {
          type: 'text',
          label: 'video-face-swap-output',
          value: outputPath,
          path: outputPath,
          createdAt,
          raw: {
            mode,
            processors,
            targetPath: target.path,
            sourcePath: source.material?.path,
            sourceKind: source.material?.kind,
            outputName,
            jobsPath,
            tempPath,
            durationSeconds,
            billingAmount: this.readPositiveInteger(task.payload.billingAmount),
            args,
          },
        },
      ],
      readback: {
        expectedText: outputName,
        actualText: outputPath,
        matched: true,
      },
      result: {
        outputPath,
        outputName,
        mode,
        processors,
      },
    };
  }

  async readiness(): Promise<VideoFaceSwapRuntimeReadiness> {
    const checkedAt = new Date().toISOString();
    const checks: VideoFaceSwapRuntimeCheck[] = [];
    const root = this.resolveFaceFusionRoot();
    if (!root || !existsSync(join(root, 'facefusion.py'))) {
      checks.push({
        key: 'engine',
        label: '本机生成引擎',
        ok: false,
        message: '未完成安装',
        required: true,
      });
      return {
        ok: false,
        status: 'needs_setup',
        message: '本机生成环境未就绪，请先完成生成引擎安装。',
        checkedAt,
        checks,
      };
    }

    checks.push({
      key: 'engine',
      label: '本机生成引擎',
      ok: true,
      message: '已安装',
      required: true,
    });

    const pythonCommand = this.getPythonCommand();
    const python = await this.runProcess(pythonCommand, ['--version']);
    if (python.exitCode !== 0) {
      checks.push({
        key: 'runtime',
        label: '运行环境',
        ok: false,
        message: '不可用',
        required: true,
      });
      return this.readinessResult(checks, checkedAt);
    }

    const pythonVersion = await this.runProcess(
      pythonCommand,
      [
        '-c',
        "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor)); raise SystemExit(0 if sys.version_info >= (3, 10) else 1)",
      ],
      4000,
      root,
    );
    const pythonOk = pythonVersion.exitCode === 0;
    checks.push({
      key: 'runtime',
      label: '运行环境',
      ok: pythonOk,
      message: pythonOk ? '已就绪' : '版本过低',
      required: true,
    });
    if (!pythonOk) return this.readinessResult(checks, checkedAt);

    const dependency = await this.runProcess(
      pythonCommand,
      [
        '-c',
        "import onnxruntime; print('onnxruntime '+onnxruntime.__version__)",
      ],
      8000,
      root,
    );
    checks.push({
      key: 'dependencies',
      label: '生成依赖',
      ok: dependency.exitCode === 0,
      message: dependency.exitCode === 0 ? '已安装' : '缺少运行依赖',
      required: true,
    });
    if (dependency.exitCode !== 0)
      return this.readinessResult(checks, checkedAt);

    const ffmpeg = await this.runProcess(
      resolveMediaToolPath('ffmpeg'),
      ['-version'],
      4000,
    );
    checks.push({
      key: 'video_tools',
      label: '视频处理工具',
      ok: ffmpeg.exitCode === 0,
      message: ffmpeg.exitCode === 0 ? '已就绪' : '不可用',
      required: true,
    });
    if (ffmpeg.exitCode !== 0) return this.readinessResult(checks, checkedAt);

    const curl = await this.runProcess('curl', ['--version'], 4000);
    checks.push({
      key: 'network_tool',
      label: '下载工具',
      ok: curl.exitCode === 0,
      message: curl.exitCode === 0 ? '已就绪' : '不可用',
      required: true,
    });

    return this.readinessResult(checks, checkedAt);
  }

  async isHealthy(): Promise<{ ok: boolean; details?: string }> {
    const readiness = await this.readiness();
    return {
      ok: readiness.ok,
      details: readiness.message,
    };
  }

  private readinessResult(
    checks: VideoFaceSwapRuntimeCheck[],
    checkedAt: string,
  ): VideoFaceSwapRuntimeReadiness {
    const ok = checks.every((check) => check.ok || !check.required);
    return {
      ok,
      status: ok ? 'ready' : 'needs_setup',
      message: ok
        ? '本机生成环境已就绪。'
        : '本机生成环境未就绪，请先完成环境安装后再生成。',
      checkedAt,
      checks,
    };
  }

  private buildFaceFusionArgs(input: {
    mode: VideoFaceSwapMode;
    processors: string[];
    targetPath: string;
    sourcePath?: string;
    outputPath: string;
    jobsPath: string;
    tempPath: string;
    payload: Record<string, unknown>;
  }) {
    const args = [
      'facefusion.py',
      'headless-run',
      '--jobs-path',
      input.jobsPath,
      '--temp-path',
      input.tempPath,
      '--execution-providers',
      this.readText(input.payload.executionProvider) || 'cpu',
      '--execution-thread-count',
      String(this.readBoundedNumber(input.payload.threadCount, 4, 1, 8)),
      '-t',
      input.targetPath,
      '-o',
      input.outputPath,
      '--processors',
      ...input.processors,
      '--log-level',
      'info',
    ];

    if (input.sourcePath) {
      args.push('-s', input.sourcePath);
    }

    args.push(...this.modeSpecificArgs(input.mode, input.payload));
    return args;
  }

  private modeSpecificArgs(
    mode: VideoFaceSwapMode,
    payload: Record<string, unknown>,
  ) {
    switch (mode) {
      case 'face_swap':
        return [
          '--face-swapper-model',
          this.readText(payload.faceSwapperModel) || 'hyperswap_1a_256',
          '--face-swapper-weight',
          String(this.readBoundedNumber(payload.faceSwapperWeight, 0.5, 0, 1)),
        ];
      case 'deep_swap':
        return [
          '--face-swapper-model',
          this.readText(payload.faceSwapperModel) || 'hyperswap_1a_256',
          '--face-swapper-weight',
          String(this.readBoundedNumber(payload.faceSwapperWeight, 0.6, 0, 1)),
          '--face-enhancer-model',
          this.readText(payload.faceEnhancerModel) || 'gfpgan_1.4',
          '--face-enhancer-blend',
          String(this.readBoundedNumber(payload.faceEnhancerBlend, 80, 1, 100)),
        ];
      case 'lip_sync':
        return [
          '--lip-syncer-model',
          this.readText(payload.lipSyncerModel) || 'wav2lip_gan_96',
        ];
      case 'face_enhance':
        return [
          '--face-enhancer-model',
          this.readText(payload.faceEnhancerModel) || 'gfpgan_1.4',
          '--face-enhancer-blend',
          String(this.readBoundedNumber(payload.faceEnhancerBlend, 80, 1, 100)),
        ];
      case 'frame_enhance':
        return [
          '--frame-enhancer-model',
          this.readText(payload.frameEnhancerModel) || 'span_kendata_x4',
          '--frame-enhancer-blend',
          String(
            this.readBoundedNumber(payload.frameEnhancerBlend, 80, 1, 100),
          ),
        ];
      case 'background_remove':
        return [
          '--background-remover-model',
          this.readText(payload.backgroundRemoverModel) || 'modnet',
        ];
      case 'frame_colorize':
        return [
          '--frame-colorizer-model',
          this.readText(payload.frameColorizerModel) || 'ddcolor',
          '--frame-colorizer-size',
          this.readText(payload.frameColorizerSize) || '256x256',
          '--frame-colorizer-blend',
          String(
            this.readBoundedNumber(payload.frameColorizerBlend, 100, 1, 100),
          ),
        ];
      case 'age_modify':
        return [
          '--age-modifier-direction',
          String(this.readBoundedNumber(payload.ageDirection, 20, -100, 100)),
        ];
      case 'expression_restore':
        return [
          '--expression-restorer-factor',
          String(
            this.readBoundedNumber(
              payload.expressionRestorerFactor,
              80,
              1,
              100,
            ),
          ),
        ];
      case 'face_edit':
        return [
          '--face-editor-mouth-smile',
          String(
            this.readBoundedNumber(payload.faceEditorMouthSmile, 0.5, -1, 1),
          ),
        ];
      default:
        return [];
    }
  }

  private resolveSource(
    task: ExecutorTask,
    processors: string[],
  ):
    | { material?: ResolvedMaterial; error?: false }
    | {
        error: true;
        reasonCode: ExecutorReasonCode;
        userMessage: string;
        technicalMessage: string;
      } {
    if (processors.includes('face_swapper')) {
      const sourcePath = this.readText(task.payload.sourcePath);
      const source = this.resolveMaterial(sourcePath, ['image']);
      if (!source) {
        return {
          error: true,
          reasonCode: 'target_not_found',
          userMessage: '请先选择要替换的人脸图片。',
          technicalMessage: sourcePath
            ? `sourcePath=${sourcePath}`
            : 'sourcePath is empty',
        };
      }
      return { material: source };
    }

    if (processors.includes('lip_syncer')) {
      const audioPath = this.readText(task.payload.audioPath);
      const audio = this.resolveMaterial(audioPath, ['audio']);
      if (!audio) {
        return {
          error: true,
          reasonCode: 'target_not_found',
          userMessage: '请先选择口型同步要使用的音频文件。',
          technicalMessage: audioPath
            ? `audioPath=${audioPath}`
            : 'audioPath is empty',
        };
      }
      return { material: audio };
    }

    return { material: undefined };
  }

  private resolveMaterial(
    value: string,
    allowedKinds: Array<ResolvedMaterial['kind']>,
  ): ResolvedMaterial | null {
    if (!value) return null;
    const materialPath = resolve(value);
    if (!existsSync(materialPath) || !statSync(materialPath).isFile()) {
      return null;
    }

    const ext = extname(materialPath).toLowerCase();
    const kind = VIDEO_EXTENSIONS.has(ext)
      ? 'video'
      : IMAGE_EXTENSIONS.has(ext)
        ? 'image'
        : AUDIO_EXTENSIONS.has(ext)
          ? 'audio'
          : null;
    if (!kind || !allowedKinds.includes(kind)) return null;
    return { path: materialPath, kind };
  }

  private resolveProcessors(value: unknown, mode: VideoFaceSwapMode) {
    const raw = Array.isArray(value) ? value : [];
    const fromPayload = raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => ALLOWED_PROCESSORS.has(item));
    return fromPayload.length
      ? [...new Set(fromPayload)]
      : PROCESSOR_BY_MODE[mode] || [];
  }

  private resolveFaceFusionRoot() {
    const candidates = [
      this.readText(process.env.FACEFUSION_ROOT),
      join(process.cwd(), 'engines', 'facefusion'),
      join(process.cwd(), 'vendor', 'facefusion'),
      join(process.cwd(), '..', 'engines', 'facefusion'),
      join(process.cwd(), '..', 'facefusion'),
      '/tmp/facefusion-inspect',
    ].filter(Boolean);

    for (const candidate of candidates) {
      const resolved = resolve(candidate);
      if (existsSync(join(resolved, 'facefusion.py'))) {
        return resolved;
      }
    }
    return resolve(
      candidates[0] || join(process.cwd(), 'engines', 'facefusion'),
    );
  }

  private getPythonCommand() {
    const configured = this.readText(process.env.FACEFUSION_PYTHON);
    if (configured) return configured;

    const root = this.resolveFaceFusionRoot();
    const candidates = [
      join(process.cwd(), '.facefusion-venv', 'bin', 'python'),
      join(root, '.venv', 'bin', 'python'),
      join(root, 'venv', 'bin', 'python'),
      '/opt/homebrew/bin/python3.12',
      '/usr/local/bin/python3.12',
      join(process.env.HOME || '', '.local', 'bin', 'python3.11'),
      '/opt/homebrew/bin/python3.11',
      '/usr/local/bin/python3.11',
      '/opt/homebrew/bin/python3.10',
      '/usr/local/bin/python3.10',
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return 'python3.12';
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

  private readMode(value: unknown): VideoFaceSwapMode {
    const mode = this.readText(value) as VideoFaceSwapMode;
    return Object.prototype.hasOwnProperty.call(PROCESSOR_BY_MODE, mode)
      ? mode
      : 'face_swap';
  }

  private readText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readBoolean(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return false;
  }

  private readPositiveInteger(value: unknown) {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
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

  private readBoundedNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseFloat(value)
          : Number.NaN;
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
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
        executor: 'video-face-swap',
        engineUrl: 'internal://runtime/video-face-swap',
      },
      evidence,
    };
  }

  private runProcess(
    command: string,
    args: string[],
    timeoutMs = 8000,
    cwd?: string,
  ): Promise<ProcessResult> {
    return new Promise((resolveProcess) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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
