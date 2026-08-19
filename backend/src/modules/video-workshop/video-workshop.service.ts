import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type {
  ExecutorContext,
  RuntimeExecutionResult,
} from '../runtime/executor.interface';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import { resolveProjectDataPath } from '../../common/project-paths';
import {
  resolveVideoWorkshopClipSettings,
  VideoWorkshopRenderCancelledError,
  VideoWorkshopRenderError,
  VideoWorkshopRenderer,
} from './video-workshop-renderer';
import {
  VideoWorkshopDownloadCancelledError,
  VideoWorkshopDownloadError,
  VideoWorkshopDownloader,
} from './video-workshop-downloader';
import { VideoWorkshopPhoneUploadService } from './video-workshop-phone-upload';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import type {
  VideoWorkshopClipSettings,
  VideoWorkshopDownloadInput,
  VideoWorkshopFailureCode,
  VideoWorkshopLatestClip,
  VideoWorkshopMaterialFile,
  VideoWorkshopMaterialImportResult,
  VideoWorkshopPhoneUploadSession,
  VideoWorkshopPreviewClip,
  VideoWorkshopProductProfile,
  VideoWorkshopProductProfileInput,
  VideoWorkshopTask,
  VideoWorkshopTaskResult,
  VideoWorkshopTemplateClipInput,
  VideoWorkshopUploadFile,
} from './video-workshop.types';

export type {
  VideoWorkshopDownloadInput,
  VideoWorkshopProductProfileInput,
  VideoWorkshopTemplateClipInput,
  VideoWorkshopUploadFile,
} from './video-workshop.types';

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
export class VideoWorkshopService implements OnModuleInit {
  private readonly tasks = new Map<string, VideoWorkshopTask>();
  private readonly activeTaskControllers = new Map<string, AbortController>();
  private taskInitialization: Promise<void> | null = null;
  private taskWriteQueue: Promise<void> = Promise.resolve();
  private taskWorker: Promise<void> | null = null;

  constructor(
    private readonly runtime: RuntimeOrchestrator,
    private readonly renderer: VideoWorkshopRenderer,
    private readonly autoUploadService: AutoUploadService,
    private readonly downloader: VideoWorkshopDownloader,
    private readonly phoneUploads: VideoWorkshopPhoneUploadService,
  ) {}

  /**
   * 成片导入素材库：写入 auto-upload 素材目录 + 注册索引，
   * 之后发布流程（publish-flow 选素材）可直接选用。
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- 方法体当前同步，保留 async 签名以兼容调用方/生命周期/路由契约
  async importMaterialBuffer(buffer: Buffer, filename: string) {
    const result = this.autoUploadService.saveMaterialBuffer(buffer, filename);
    return result;
  }

  onModuleInit() {
    void this.ensureTasksInitialized();
  }

  async clipWithTemplate(input: VideoWorkshopTemplateClipInput) {
    const materialPath = this.requireText(input.materialPath, '请填写素材路径');
    const templateName = this.requireText(input.templateName, '请填写剪辑模板');
    const outputName = this.readOptionalText(input.outputName);
    const titlePrompt = this.readOptionalText(input.titlePrompt);
    const durationSeconds = this.readDurationSeconds(input.durationSeconds);
    const productName = this.readOptionalText(input.productName);
    const settings = this.normalizeClipSettings(input.settings, templateName);
    const source =
      input.source === 'ai-employee' ? 'ai-employee' : 'video-workshop';
    const outputDir =
      this.readOptionalText(input.outputDir) ||
      resolveProjectDataPath(
        'video-workshop',
        source === 'ai-employee' ? 'ai-employee' : 'workbench',
      );

    const result = await this.runtime.execute(
      {
        relatedId: `${source}-video-clip-${Date.now()}`,
        relatedType: 'agent-session',
        type: 'video-template-clip',
        platform: 'mixed',
        payload: {
          materialPath,
          templateName,
          titlePrompt,
          outputName,
          outputDir,
          durationSeconds,
          source,
          productName,
          settings,
          titleText: this.readOptionalText(input.titleText),
          subtitleText: this.readOptionalText(input.subtitleText),
        },
      },
      this.buildContext(source),
    );

    const response = this.toResponse(result);
    const outputPath = response.evidence.find(
      (item) => item.label === 'video-template-clip-output',
    )?.path;
    if (response.ok && outputPath && existsSync(outputPath)) {
      await this.writeClipRecord(outputPath, {
        templateName,
        materialPath,
        source,
        titlePrompt,
        productName,
        settings,
        message: response.message,
      });
    }
    return response;
  }

  async createRenderTask(
    input: VideoWorkshopTemplateClipInput,
  ): Promise<VideoWorkshopTask> {
    await this.ensureTasksInitialized();
    const source =
      input.source === 'ai-employee' ? 'ai-employee' : 'video-workshop';
    const renderInput: VideoWorkshopTemplateClipInput = {
      materialPath: this.requireText(input.materialPath, '请选择要剪辑的素材'),
      templateName: this.requireText(input.templateName, '请选择剪辑模板'),
      titlePrompt: this.requireText(input.titlePrompt, '请填写创作目标'),
      titleText: this.readOptionalText(input.titleText),
      subtitleText: this.readOptionalText(input.subtitleText),
      outputName:
        this.readOptionalText(input.outputName) ||
        `video-workshop-${Date.now()}.mp4`,
      durationSeconds: this.readDurationSeconds(input.durationSeconds),
      source,
      productName: this.readOptionalText(input.productName),
      settings: this.normalizeClipSettings(
        input.settings,
        this.readOptionalText(input.templateName),
      ),
    };
    const task = this.newTask('render');
    task.renderInput = renderInput;
    task.stage = '剪辑任务已进入处理队列';
    this.tasks.set(task.id, task);
    await this.persistTasks();
    this.scheduleTaskWorker();
    return this.cloneTask(task);
  }

  async createDownloadTask(
    input: VideoWorkshopDownloadInput,
  ): Promise<VideoWorkshopTask> {
    await this.ensureTasksInitialized();
    const url = this.requireText(input.url, '请填写视频链接');
    const task = this.newTask('download');
    task.downloadInput = {
      url,
      outputName: this.readOptionalText(input.outputName),
      maxBytes: this.readOptionalPositiveNumber(
        input.maxBytes,
        '下载大小限制必须大于 0',
      ),
    };
    task.stage = '下载任务已进入安全检查队列';
    this.tasks.set(task.id, task);
    await this.persistTasks();
    this.scheduleTaskWorker();
    return this.cloneTask(task);
  }

  async listTasks(limit = 50): Promise<VideoWorkshopTask[]> {
    await this.ensureTasksInitialized();
    await this.reconcileCompletedTaskOutputs();
    this.scheduleTaskWorker();
    return Array.from(this.tasks.values())
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      )
      .slice(0, Math.max(1, Math.min(100, Math.round(limit))))
      .map((task) => this.cloneTask(task));
  }

  async getTask(id: string): Promise<VideoWorkshopTask> {
    await this.ensureTasksInitialized();
    await this.reconcileCompletedTaskOutputs();
    return this.cloneTask(this.requireTask(id));
  }

  async retryTask(id: string): Promise<VideoWorkshopTask> {
    await this.ensureTasksInitialized();
    const task = this.requireTask(id);
    if (!['failed', 'cancelled'].includes(task.status)) {
      throw new BadRequestException('只有失败或已取消的任务可以重试');
    }
    if (task.attempts >= task.maxAttempts) {
      throw new BadRequestException('该任务已达到最大重试次数');
    }
    task.status = 'queued';
    task.progress = 0;
    task.stage = '任务已重新进入队列';
    task.updatedAt = new Date().toISOString();
    delete task.startedAt;
    delete task.finishedAt;
    delete task.error;
    delete task.outputPath;
    delete task.material;
    delete task.result;
    await this.persistTasks();
    this.scheduleTaskWorker();
    return this.cloneTask(task);
  }

  async cancelTask(id: string): Promise<VideoWorkshopTask> {
    await this.ensureTasksInitialized();
    const task = this.requireTask(id);
    if (['succeeded', 'failed', 'cancelled'].includes(task.status)) {
      return this.cloneTask(task);
    }
    const now = new Date().toISOString();
    task.status = 'cancelled';
    task.progress = 0;
    task.stage = '任务已取消';
    task.error = '任务已由用户取消';
    task.updatedAt = now;
    task.finishedAt = now;
    task.result = this.cancelledTaskResult(task);
    await this.persistTasks();
    this.activeTaskControllers.get(id)?.abort();
    return this.cloneTask(task);
  }

  downloadPolicy() {
    return this.downloader.policy();
  }

  createPhoneUploadSession(maxBytes?: number) {
    return this.phoneUploads.createSession(maxBytes);
  }

  phoneUploadSession(id: string): Promise<VideoWorkshopPhoneUploadSession> {
    return this.phoneUploads.getSession(id);
  }

  cancelPhoneUploadSession(
    id: string,
  ): Promise<VideoWorkshopPhoneUploadSession> {
    return this.phoneUploads.cancelSession(id);
  }

  private newTask(kind: VideoWorkshopTask['kind']): VideoWorkshopTask {
    const now = new Date().toISOString();
    return {
      id: `video-workshop-${kind}-${randomUUID()}`,
      kind,
      status: 'queued',
      progress: 0,
      stage: '等待执行',
      attempts: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async ensureTasksInitialized() {
    if (!this.taskInitialization) {
      this.taskInitialization = this.loadTasks();
    }
    await this.taskInitialization;
  }

  private async loadTasks() {
    let recovered = false;
    try {
      const parsed = JSON.parse(
        readFileSync(this.taskStorePath(), 'utf8'),
      ) as unknown;
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          if (!value || typeof value !== 'object') continue;
          const task = value as VideoWorkshopTask;
          if (!task.id || !task.kind || !task.status || !task.createdAt)
            continue;
          if (task.status === 'running') {
            task.status =
              task.attempts >= task.maxAttempts ? 'failed' : 'queued';
            task.progress = 0;
            task.stage =
              task.status === 'queued'
                ? '服务恢复后已重新进入队列'
                : '服务中断且已达到最大重试次数';
            task.error =
              task.status === 'failed' ? '任务在服务重启前中断' : undefined;
            if (task.status === 'failed') {
              task.result = this.failedTaskResult(
                'processing_failure',
                '任务在服务重启前中断，请重新创建任务',
              );
            }
            task.updatedAt = new Date().toISOString();
            recovered = true;
          }
          this.tasks.set(task.id, task);
        }
      }
    } catch {
      // The first run has no task store yet.
    }
    const reconciled = this.reconcileCompletedTaskOutputsInMemory();
    if (recovered || reconciled) await this.persistTasks();
    this.scheduleTaskWorker();
  }

  private scheduleTaskWorker() {
    if (this.taskWorker) return;
    this.taskWorker = Promise.resolve()
      .then(() => this.drainTaskQueue())
      .catch(() => undefined)
      .finally(() => {
        this.taskWorker = null;
        if (
          Array.from(this.tasks.values()).some(
            (task) => task.status === 'queued',
          )
        ) {
          this.scheduleTaskWorker();
        }
      });
  }

  private async drainTaskQueue() {
    while (true) {
      const task = Array.from(this.tasks.values())
        .filter((item) => item.status === 'queued')
        .sort(
          (left, right) =>
            new Date(left.createdAt).getTime() -
            new Date(right.createdAt).getTime(),
        )[0];
      if (!task) return;
      await this.processTask(task);
    }
  }

  private async processTask(task: VideoWorkshopTask) {
    const controller = new AbortController();
    this.activeTaskControllers.set(task.id, controller);
    const now = new Date().toISOString();
    task.status = 'running';
    task.progress = 1;
    task.stage =
      task.kind === 'render' ? '正在准备视频剪辑' : '正在校验下载链接';
    task.attempts += 1;
    task.startedAt = now;
    task.updatedAt = now;
    delete task.finishedAt;
    delete task.error;
    await this.persistTasks();

    const updateProgress = async (progress: number, stage: string) => {
      if (task.status !== 'running') return;
      task.progress = Math.max(
        task.progress,
        Math.min(99, Math.round(progress)),
      );
      task.stage = stage;
      task.updatedAt = new Date().toISOString();
      await this.persistTasks();
    };

    try {
      if (task.kind === 'render') {
        if (!task.renderInput) throw new Error('剪辑任务缺少输入参数');
        const rendered = await this.renderer.render(task.renderInput, {
          taskId: task.id,
          signal: controller.signal,
          onProgress: (progress, stage) => updateProgress(progress, stage),
        });
        if (this.isTaskCancelled(task)) {
          await rm(rendered.outputPath, { force: true }).catch(() => undefined);
          return;
        }
        const message = `成片已生成：${basename(rendered.outputPath)}`;
        task.outputPath = rendered.outputPath;
        task.result = {
          ok: true,
          status: 'success',
          reasonCode: 'success',
          message,
          evidence: [
            {
              type: 'text',
              label: 'video-template-clip-output',
              url: rendered.outputPath,
              path: rendered.outputPath,
              createdAt: new Date().toISOString(),
              raw: {
                args: rendered.args,
                settings: rendered.settings,
                unsupportedSettings: rendered.unsupportedSettings,
              },
            },
          ],
          candidates: [],
        };
        await this.writeClipRecord(rendered.outputPath, {
          templateName: this.readOptionalText(task.renderInput.templateName),
          materialPath: this.readOptionalText(task.renderInput.materialPath),
          source:
            task.renderInput.source === 'ai-employee'
              ? 'ai-employee'
              : 'video-workshop',
          titlePrompt: this.readOptionalText(task.renderInput.titlePrompt),
          productName: this.readOptionalText(task.renderInput.productName),
          settings: rendered.settings,
          message,
        });
        if (this.isTaskCancelled(task) || controller.signal.aborted) {
          await this.removeRenderedOutput(rendered.outputPath);
          return;
        }
      } else {
        if (!task.downloadInput) throw new Error('下载任务缺少链接参数');
        const material = await this.downloader.download(task.downloadInput, {
          taskId: task.id,
          signal: controller.signal,
          onProgress: (progress, stage) => updateProgress(progress, stage),
        });
        if (this.isTaskCancelled(task)) {
          await rm(material.path, { force: true }).catch(() => undefined);
          return;
        }
        task.material = material;
        task.outputPath = material.path;
        task.result = {
          ok: true,
          status: 'success',
          reasonCode: 'success',
          message: `视频已安全下载到素材库：${material.name}`,
          evidence: [
            {
              type: 'file',
              label: 'video-workshop-downloaded-material',
              path: material.path,
              createdAt: new Date().toISOString(),
              raw: {
                sizeBytes: material.sizeBytes,
                sourceHost: this.downloadHost(task.downloadInput.url),
              },
            },
          ],
          candidates: [],
        };
      }

      if (this.isTaskCancelled(task) || controller.signal.aborted) return;
      const finishedAt = new Date().toISOString();
      task.status = 'succeeded';
      task.progress = 100;
      task.stage = task.kind === 'render' ? '成片已生成' : '素材已下载';
      task.updatedAt = finishedAt;
      task.finishedAt = finishedAt;
      delete task.error;
      await this.persistTasks();
    } catch (error) {
      if (
        this.isTaskCancelled(task) ||
        error instanceof VideoWorkshopRenderCancelledError ||
        error instanceof VideoWorkshopDownloadCancelledError ||
        controller.signal.aborted
      ) {
        if (!this.isTaskCancelled(task)) {
          const finishedAt = new Date().toISOString();
          task.status = 'cancelled';
          task.progress = 0;
          task.stage = '任务已取消';
          task.error = '任务已由用户取消';
          task.updatedAt = finishedAt;
          task.finishedAt = finishedAt;
          task.result = this.cancelledTaskResult(task);
          await this.persistTasks();
        }
        return;
      }
      const failure = this.classifyTaskFailure(error, task.kind);
      const finishedAt = new Date().toISOString();
      task.status = 'failed';
      task.progress = 0;
      task.stage = this.failureStage(failure.reasonCode, task.kind);
      task.error = failure.message;
      task.updatedAt = finishedAt;
      task.finishedAt = finishedAt;
      task.result = this.failedTaskResult(failure.reasonCode, failure.message);
      await this.persistTasks();
    } finally {
      this.activeTaskControllers.delete(task.id);
    }
  }

  private cancelledTaskResult(
    task: VideoWorkshopTask,
  ): VideoWorkshopTaskResult {
    return {
      ok: false,
      status: 'cancelled',
      reasonCode: 'cancelled',
      message: task.error || '任务已取消',
      evidence: [],
      candidates: [],
    };
  }

  private failedTaskResult(
    reasonCode: Exclude<VideoWorkshopFailureCode, 'cancelled'>,
    message: string,
  ): VideoWorkshopTaskResult {
    return {
      ok: false,
      status: 'failed',
      reasonCode,
      message,
      evidence: [],
      candidates: [],
    };
  }

  private classifyTaskFailure(
    error: unknown,
    kind: VideoWorkshopTask['kind'],
  ): {
    reasonCode: Exclude<VideoWorkshopFailureCode, 'cancelled'>;
    message: string;
  } {
    if (
      error instanceof VideoWorkshopRenderError ||
      error instanceof VideoWorkshopDownloadError
    ) {
      return { reasonCode: error.reasonCode, message: error.message };
    }
    if (error instanceof BadRequestException) {
      return {
        reasonCode: 'invalid_input',
        message: this.publicExceptionMessage(error, '提交内容需要修改'),
      };
    }
    return {
      reasonCode: 'processing_failure',
      message:
        kind === 'render'
          ? '视频处理未完成，请检查素材后重试'
          : '视频下载未完成，请稍后重试',
    };
  }

  private failureStage(
    reasonCode: Exclude<VideoWorkshopFailureCode, 'cancelled'>,
    kind: VideoWorkshopTask['kind'],
  ) {
    switch (reasonCode) {
      case 'invalid_input':
        return '提交内容需要修改';
      case 'missing_asset':
        return kind === 'render' ? '剪辑素材不可用' : '下载素材不可用';
      case 'runtime_unavailable':
        return '当前设备无法完成剪辑';
      default:
        return kind === 'render' ? '视频处理未完成' : '视频下载未完成';
    }
  }

  private publicExceptionMessage(error: BadRequestException, fallback: string) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object') {
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message.trim();
      if (Array.isArray(message)) {
        const first = message.find(
          (item): item is string => typeof item === 'string' && Boolean(item),
        );
        if (first) return first;
      }
    }
    return fallback;
  }

  private async removeRenderedOutput(outputPath: string) {
    await Promise.all([
      rm(outputPath, { force: true }).catch(() => undefined),
      rm(`${outputPath}.video-workshop.json`, { force: true }).catch(
        () => undefined,
      ),
    ]);
  }

  private isTaskCancelled(task: VideoWorkshopTask) {
    return task.status === 'cancelled';
  }

  private async reconcileCompletedTaskOutputs() {
    if (this.reconcileCompletedTaskOutputsInMemory()) {
      await this.persistTasks();
    }
  }

  private reconcileCompletedTaskOutputsInMemory() {
    let changed = false;
    for (const task of this.tasks.values()) {
      if (task.status !== 'succeeded') continue;
      const outputPath =
        task.kind === 'render'
          ? this.readOptionalText(task.outputPath)
          : this.readOptionalText(task.material?.path || task.outputPath);
      if (outputPath && this.isExistingFile(outputPath)) continue;

      const finishedAt = new Date().toISOString();
      const message =
        task.kind === 'render'
          ? '已完成的成片文件已不存在，请重新生成'
          : '已下载的素材文件已不存在，请重新下载';
      task.status = 'failed';
      task.progress = 0;
      task.stage =
        task.kind === 'render' ? '成片文件已不存在' : '素材文件已不存在';
      task.error = message;
      task.updatedAt = finishedAt;
      task.finishedAt = finishedAt;
      task.result = this.failedTaskResult('missing_asset', message);
      delete task.outputPath;
      if (task.kind === 'download') delete task.material;
      changed = true;
    }
    return changed;
  }

  private isExistingFile(path: string) {
    try {
      return existsSync(path) && statSync(path).isFile();
    } catch {
      return false;
    }
  }

  private taskStorePath() {
    return resolveProjectDataPath('video-workshop', 'tasks.json');
  }

  private persistTasks() {
    const snapshot = JSON.stringify(Array.from(this.tasks.values()), null, 2);
    this.taskWriteQueue = this.taskWriteQueue.then(async () => {
      const path = this.taskStorePath();
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, path);
    });
    return this.taskWriteQueue;
  }

  private requireTask(id: string) {
    const task = this.tasks.get(id);
    if (!task) throw new NotFoundException('视频工坊任务不存在');
    return task;
  }

  private cloneTask(task: VideoWorkshopTask) {
    return structuredClone(task);
  }

  private downloadHost(value: unknown) {
    if (typeof value !== 'string') return '';
    try {
      return new URL(value).hostname;
    } catch {
      return '';
    }
  }

  latestClip(
    input: {
      source?: 'video-workshop' | 'ai-employee';
    } = {},
  ): VideoWorkshopLatestClip | null {
    return this.listClips(input, 1)[0] || null;
  }

  listClips(
    input: {
      source?: 'video-workshop' | 'ai-employee';
    } = {},
    limit = 20,
  ): VideoWorkshopLatestClip[] {
    const source =
      input.source === 'ai-employee' ? 'ai-employee' : 'video-workshop';
    const outputDir = resolveProjectDataPath(
      'video-workshop',
      source === 'ai-employee' ? 'ai-employee' : 'workbench',
    );
    if (!existsSync(outputDir) || !statSync(outputDir).isDirectory()) {
      return [];
    }

    return readdirSync(outputDir)
      .map((name) => join(outputDir, name))
      .filter((path) => path.toLowerCase().endsWith('.mp4'))
      .filter((path) => existsSync(path) && statSync(path).isFile())
      .map((path) => ({ path, stat: statSync(path) }))
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
      .slice(0, Math.max(1, Math.min(100, Math.round(limit))))
      .map((clip) => {
        const outputName = basename(clip.path);
        const createdAt = new Date(clip.stat.mtimeMs).toISOString();
        const record = this.readClipRecord(clip.path);
        return {
          id: `${source}-${Math.round(clip.stat.mtimeMs)}-${outputName}`,
          outputPath: clip.path,
          outputName,
          templateName: record?.templateName || '视频工坊模板',
          materialPath: record?.materialPath || '',
          source,
          titlePrompt: record?.titlePrompt || '',
          productName: record?.productName || '',
          settings: record?.settings || {},
          message: record?.message || `成片已生成：${outputName}`,
          createdAt,
        };
      });
  }

  listMaterialFiles(limit = 30): VideoWorkshopMaterialFile[] {
    const materialDir = resolveProjectDataPath('materials');
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
        .map((path) => this.materialFileFromPath(path))
        .filter((item): item is VideoWorkshopMaterialFile => Boolean(item))
        .sort((left, right) =>
          left.kind === right.kind
            ? new Date(right.updatedAt).getTime() -
              new Date(left.updatedAt).getTime()
            : left.kind === 'video'
              ? -1
              : 1,
        )
        .slice(0, Math.max(1, Math.min(100, Math.round(limit))))
    );
  }

  async importMaterialFile(
    file: VideoWorkshopUploadFile,
  ): Promise<VideoWorkshopMaterialFile> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请选择要导入的素材文件');
    }

    const safeName = this.safeMaterialFileName(
      file.originalname || `material-${Date.now()}`,
    );
    const kind = this.kindFromPath(safeName);
    if (!kind) {
      throw new BadRequestException('只支持视频或图片素材');
    }

    const materialDir = resolveProjectDataPath('materials');
    await mkdir(materialDir, { recursive: true });
    const outputPath = join(
      materialDir,
      this.uniqueMaterialFileName(materialDir, safeName),
    );
    await writeFile(outputPath, file.buffer);

    const material = this.materialFileFromPath(outputPath);
    if (!material) {
      throw new BadRequestException('素材导入失败');
    }
    return material;
  }

  async importMaterialFiles(
    files: VideoWorkshopUploadFile[] | undefined,
  ): Promise<VideoWorkshopMaterialImportResult> {
    const selectedFiles = (files || []).filter(Boolean).slice(0, 50);
    if (!selectedFiles.length) {
      throw new BadRequestException('请选择要导入的素材文件');
    }

    const items: VideoWorkshopMaterialFile[] = [];
    const rejected: VideoWorkshopMaterialImportResult['rejected'] = [];
    for (const file of selectedFiles) {
      try {
        items.push(await this.importMaterialFile(file));
      } catch (error) {
        rejected.push({
          name: this.readOptionalText(file.originalname) || '未命名素材',
          reason: error instanceof Error ? error.message : '该素材无法导入',
        });
      }
    }
    return { items, rejected };
  }

  listProductProfiles(): VideoWorkshopProductProfile[] {
    return this.readProductProfiles().sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    );
  }

  async saveProductProfile(
    input: VideoWorkshopProductProfileInput,
  ): Promise<VideoWorkshopProductProfile> {
    const name = this.requireText(input.name, '请填写产品名称');
    const highlights = this.normalizeHighlights(input.highlights);
    const description = this.readOptionalText(input.description);
    const now = new Date().toISOString();
    const profiles = this.readProductProfiles();
    const existingIndex = input.id
      ? profiles.findIndex((profile) => profile.id === input.id)
      : -1;
    const profile: VideoWorkshopProductProfile = {
      id:
        existingIndex >= 0
          ? profiles[existingIndex].id
          : `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      highlights,
      description,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }
    const profilePath = this.productProfilePath();
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(profilePath, JSON.stringify(profiles, null, 2), 'utf8');
    return profile;
  }

  resolvePreviewClip(path: unknown): VideoWorkshopPreviewClip {
    const clipPath = this.requireText(path, '请选择要预览的成片');
    const resolvedPath = resolve(clipPath);
    if (!this.isAllowedPreviewPath(resolvedPath)) {
      throw new BadRequestException('只能预览视频工坊生成的成片');
    }
    if (!resolvedPath.toLowerCase().endsWith('.mp4')) {
      throw new BadRequestException('只能预览 mp4 成片');
    }
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
      throw new NotFoundException('成片文件不存在');
    }
    return {
      path: resolvedPath,
      name: basename(resolvedPath),
    };
  }

  private isAllowedPreviewPath(path: string) {
    const roots = [
      resolveProjectDataPath('video-workshop', 'workbench'),
      resolveProjectDataPath('video-workshop', 'ai-employee'),
      resolveProjectDataPath('video-workshop', 'exports'),
    ].map((root) => resolve(root));

    return roots.some((root) => path === root || path.startsWith(`${root}/`));
  }

  private buildContext(source: string): ExecutorContext {
    return {
      riskContext: {
        accountName: source,
      },
      sendMode: 'draft-only',
    };
  }

  private toResponse(result: RuntimeExecutionResult) {
    return {
      ok: result.ok,
      status: result.status,
      reasonCode:
        result.reasonCode === 'success'
          ? 'success'
          : result.reasonCode === 'target_not_found'
            ? 'missing_asset'
            : result.reasonCode === 'runtime_unavailable'
              ? 'runtime_unavailable'
              : 'processing_failure',
      message: result.userMessage,
      detail: result.ok ? undefined : result.userMessage,
      evidence: result.evidence.map((item) => ({
        type: item.type,
        label: item.label,
        url: item.value,
        path: item.path,
        createdAt: item.createdAt,
        raw: item.raw,
      })),
      candidates: [],
    };
  }

  private async writeClipRecord(
    outputPath: string,
    record: Omit<
      VideoWorkshopLatestClip,
      'id' | 'outputPath' | 'outputName' | 'createdAt'
    >,
  ) {
    const path = `${outputPath}.video-workshop.json`;
    await writeFile(
      path,
      JSON.stringify(
        {
          ...record,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  private readClipRecord(
    outputPath: string,
  ): Partial<VideoWorkshopLatestClip> | null {
    try {
      const raw = readFileSync(`${outputPath}.video-workshop.json`, 'utf8');
      const parsed = JSON.parse(raw) as Partial<VideoWorkshopLatestClip>;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  private productProfilePath() {
    return resolveProjectDataPath('video-workshop', 'product-profiles.json');
  }

  private readProductProfiles(): VideoWorkshopProductProfile[] {
    try {
      const parsed = JSON.parse(
        readFileSync(this.productProfilePath(), 'utf8'),
      ) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item): VideoWorkshopProductProfile | null => {
          if (!item || typeof item !== 'object') return null;
          const value = item as Partial<VideoWorkshopProductProfile>;
          const id = this.readOptionalText(value.id);
          const name = this.readOptionalText(value.name);
          if (!id || !name) return null;
          return {
            id,
            name,
            highlights: this.normalizeHighlights(value.highlights),
            description: this.readOptionalText(value.description),
            updatedAt:
              this.readOptionalText(value.updatedAt) ||
              new Date(0).toISOString(),
          };
        })
        .filter((item): item is VideoWorkshopProductProfile => Boolean(item));
    } catch {
      return [];
    }
  }

  private normalizeHighlights(value: unknown) {
    const values = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[\n,，]/)
        : [];
    return values
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  private normalizeClipSettings(
    settings: VideoWorkshopClipSettings | undefined,
    templateName?: string,
  ): VideoWorkshopClipSettings {
    try {
      return resolveVideoWorkshopClipSettings(settings, templateName);
    } catch (error) {
      if (error instanceof VideoWorkshopRenderError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
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

  private readDurationSeconds(value: unknown) {
    if (value === undefined || value === null || value === '') return 30;
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 180) {
      throw new BadRequestException('视频时长需为 1 到 180 秒');
    }
    return Math.round(numeric);
  }

  private readOptionalPositiveNumber(value: unknown, message: string) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(message);
    }
    return value;
  }

  private materialFileFromPath(path: string): VideoWorkshopMaterialFile | null {
    const kind = this.kindFromPath(path);
    if (!kind || !existsSync(path) || !statSync(path).isFile()) return null;
    const stat = statSync(path);
    return {
      id: `${Math.round(stat.mtimeMs)}-${basename(path)}`,
      name: basename(path),
      path,
      kind,
      sizeBytes: stat.size,
      updatedAt: new Date(stat.mtimeMs).toISOString(),
    };
  }

  private kindFromPath(path: string): VideoWorkshopMaterialFile['kind'] | null {
    const ext = extname(path).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
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
  /**
   * 素材删除/重命名（对标炼刀 /video_creation/material_lib/remove + rename）
   */
  async removeMaterialFile(name: string) {
    const materialDir = resolveProjectDataPath('materials');
    const safeName = name.split(/[\\/]/).pop() || '';
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new BadRequestException('素材名不合法');
    }
    const target = join(materialDir, safeName);
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new NotFoundException('素材不存在');
    }
    await rm(target, { force: true });
    return { name: safeName, deleted: true };
  }

  async renameMaterialFile(name: string, newName: string) {
    const materialDir = resolveProjectDataPath('materials');
    const safeName = name.split(/[\\/]/).pop() || '';
    const safeNewName = newName.split(/[\\/]/).pop() || '';
    if (
      !safeName ||
      !safeNewName ||
      safeNewName === '.' ||
      safeNewName === '..'
    ) {
      throw new BadRequestException('素材名不合法');
    }
    const target = join(materialDir, safeName);
    const next = join(materialDir, safeNewName);
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new NotFoundException('素材不存在');
    }
    if (existsSync(next)) {
      throw new BadRequestException('目标素材名已存在');
    }
    await rename(target, next);
    return { from: safeName, to: safeNewName, renamed: true };
  }
}
