import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoWorkshopService } from './video-workshop.service';
import type { VideoWorkshopDownloader } from './video-workshop-downloader';
import type { VideoWorkshopPhoneUploadService } from './video-workshop-phone-upload';
import {
  VideoWorkshopRenderCancelledError,
  VideoWorkshopRenderError,
  type VideoWorkshopRenderer,
} from './video-workshop-renderer';
import type { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';

function makeRuntime() {
  return {
    execute: jest.fn().mockResolvedValue({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '已生成剪辑结果：/tmp/out.mp4',
      technicalMessage: 'ffmpeg generated /tmp/out.mp4',
      runtime: {
        mode: 'local-runtime',
        executor: 'video-template-clip',
      },
      evidence: [
        {
          type: 'text',
          label: 'video-template-clip-output',
          value: '/tmp/out.mp4',
          path: '/tmp/out.mp4',
          createdAt: '2026-06-16T00:00:00.000Z',
        },
      ],
    }),
  };
}

function makeService(
  runtime = makeRuntime(),
  renderer: Partial<VideoWorkshopRenderer> = {},
  downloader: Partial<VideoWorkshopDownloader> = {},
  phoneUploads: Partial<VideoWorkshopPhoneUploadService> = {},
) {
  return new VideoWorkshopService(
    runtime as unknown as RuntimeOrchestrator,
    renderer as VideoWorkshopRenderer,
    {
      policy: jest.fn().mockReturnValue({
        allowedHosts: ['media.example.com'],
        maxBytes: 1024 * 1024,
        timeoutMs: 5000,
        maxRedirects: 3,
      }),
      ...downloader,
    } as VideoWorkshopDownloader,
    phoneUploads as VideoWorkshopPhoneUploadService,
  );
}

async function waitForTask(
  service: VideoWorkshopService,
  id: string,
  status: 'running' | 'succeeded' | 'failed' | 'cancelled',
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await service.getTask(id);
    if (task.status === status) return task;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Task ${id} did not reach ${status}`);
}

describe('VideoWorkshopService', () => {
  it('routes workbench template clips through the shared runtime executor', async () => {
    const runtime = makeRuntime();
    const service = makeService(runtime);

    const result = await service.clipWithTemplate({
      materialPath: '/tmp/material.mp4',
      templateName: '产品卖点模板',
      titlePrompt: '突出优惠',
      outputName: 'workbench-output.mp4',
      durationSeconds: 10,
      source: 'video-workshop',
    });

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedId: expect.stringContaining('video-workshop-video-clip-'),
        type: 'video-template-clip',
        platform: 'mixed',
        payload: expect.objectContaining({
          materialPath: '/tmp/material.mp4',
          templateName: '产品卖点模板',
          titlePrompt: '突出优惠',
          outputName: 'workbench-output.mp4',
          durationSeconds: 10,
          source: 'video-workshop',
        }),
      }),
      expect.objectContaining({
        sendMode: 'draft-only',
        riskContext: expect.objectContaining({
          accountName: 'video-workshop',
        }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.evidence[0]).toMatchObject({
      label: 'video-template-clip-output',
      path: '/tmp/out.mp4',
    });
  });

  it.each([
    ['target_not_found', 'missing_asset'],
    ['send_failed', 'processing_failure'],
    ['runtime_unavailable', 'runtime_unavailable'],
  ] as const)(
    'maps the shared video result %s to %s',
    async (runtimeReason, workshopReason) => {
      const runtime = {
        execute: jest.fn().mockResolvedValue({
          ok: false,
          status: 'blocked',
          reasonCode: runtimeReason,
          userMessage: '视频暂时无法处理',
          technicalMessage: 'internal video detail',
          runtime: { mode: 'local-runtime', executor: 'video-template-clip' },
          evidence: [],
        }),
      };
      const service = makeService(runtime);

      const result = await service.clipWithTemplate({
        materialPath: '/tmp/material.mp4',
        templateName: '产品卖点模板',
      });

      expect(result).toMatchObject({
        ok: false,
        reasonCode: workshopReason,
        message: '视频暂时无法处理',
        detail: '视频暂时无法处理',
      });
    },
  );

  it('uses an ai-employee source only when explicitly requested', async () => {
    const runtime = makeRuntime();
    const service = makeService(runtime);

    await service.clipWithTemplate({
      materialPath: '/tmp/material.mp4',
      templateName: '产品卖点模板',
      source: 'ai-employee',
    });

    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedId: expect.stringContaining('ai-employee-video-clip-'),
        payload: expect.objectContaining({
          source: 'ai-employee',
        }),
      }),
      expect.objectContaining({
        riskContext: expect.objectContaining({
          accountName: 'ai-employee',
        }),
      }),
    );
  });

  it('returns the latest workbench mp4 from the shared video workshop folder', () => {
    const runtime = makeRuntime();
    const service = makeService(runtime);
    const cwd = process.cwd();
    const projectDir = mkdtempSync(join(tmpdir(), 'video-workshop-latest-'));
    process.chdir(projectDir);
    try {
      const outputDir = join(projectDir, 'data', 'video-workshop', 'workbench');
      mkdirSync(outputDir, { recursive: true });
      const olderPath = join(outputDir, 'older.mp4');
      writeFileSync(olderPath, 'old', { flag: 'w' });
      const latestPath = join(outputDir, 'latest.mp4');
      writeFileSync(latestPath, 'latest', { flag: 'w' });
      utimesSync(
        olderPath,
        new Date('2026-06-15T00:00:00.000Z'),
        new Date('2026-06-15T00:00:00.000Z'),
      );
      utimesSync(
        latestPath,
        new Date('2026-06-16T00:00:00.000Z'),
        new Date('2026-06-16T00:00:00.000Z'),
      );

      const latest = service.latestClip();

      expect(latest).toMatchObject({
        outputName: 'latest.mp4',
        source: 'video-workshop',
      });
      expect(
        latest?.outputPath.endsWith(
          '/data/video-workshop/workbench/latest.mp4',
        ),
      ).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it('imports an uploaded local material file into the backend materials folder', async () => {
    const runtime = makeRuntime();
    const service = makeService(runtime);
    const cwd = process.cwd();
    const projectDir = mkdtempSync(join(tmpdir(), 'video-workshop-material-'));
    process.chdir(projectDir);
    try {
      const material = await service.importMaterialFile({
        originalname: 'local-product.mov',
        buffer: Buffer.from('video-bytes'),
        size: 11,
        mimetype: 'video/quicktime',
      });

      expect(material).toMatchObject({
        name: 'local-product.mov',
        kind: 'video',
        sizeBytes: 11,
      });
      expect(material.path.endsWith('/data/materials/local-product.mov')).toBe(
        true,
      );
      expect(existsSync(material.path)).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it('imports valid files in a batch and reports unsupported files separately', async () => {
    const runtime = makeRuntime();
    const service = makeService(runtime);
    const cwd = process.cwd();
    const projectDir = mkdtempSync(join(tmpdir(), 'video-workshop-batch-'));
    process.chdir(projectDir);
    try {
      const result = await service.importMaterialFiles([
        {
          originalname: 'product-a.mp4',
          buffer: Buffer.from('video-a'),
        },
        {
          originalname: 'not-a-video.txt',
          buffer: Buffer.from('text'),
        },
        {
          originalname: 'product-b.jpg',
          buffer: Buffer.from('image-b'),
        },
      ]);

      expect(result.items.map((item) => item.name)).toEqual([
        'product-a.mp4',
        'product-b.jpg',
      ]);
      expect(result.rejected).toEqual([
        expect.objectContaining({ name: 'not-a-video.txt' }),
      ]);
    } finally {
      process.chdir(cwd);
    }
  });

  it('persists product information for later clip tasks', async () => {
    const runtime = makeRuntime();
    const service = makeService(runtime);
    const cwd = process.cwd();
    const projectDir = mkdtempSync(join(tmpdir(), 'video-workshop-product-'));
    process.chdir(projectDir);
    try {
      const product = await service.saveProductProfile({
        name: '夏季防晒衣',
        highlights: 'UPF50+\n轻薄透气',
        description: '适合夏季通勤和户外使用',
      });

      expect(product).toMatchObject({
        name: '夏季防晒衣',
        highlights: ['UPF50+', '轻薄透气'],
      });
      expect(service.listProductProfiles()).toEqual([
        expect.objectContaining({ id: product.id, name: '夏季防晒衣' }),
      ]);
    } finally {
      process.chdir(cwd);
    }
  });

  it('resolves only generated video workshop mp4 files for preview', () => {
    const runtime = makeRuntime();
    const service = makeService(runtime);
    const cwd = process.cwd();
    const projectDir = mkdtempSync(join(tmpdir(), 'video-workshop-preview-'));
    process.chdir(projectDir);
    try {
      const outputDir = join(
        process.cwd(),
        'data',
        'video-workshop',
        'workbench',
      );
      mkdirSync(outputDir, { recursive: true });
      const clipPath = join(outputDir, 'preview.mp4');
      writeFileSync(clipPath, 'mp4');

      expect(service.resolvePreviewClip(clipPath)).toMatchObject({
        path: clipPath,
        name: 'preview.mp4',
      });
      expect(() =>
        service.resolvePreviewClip(join(process.cwd(), 'outside.mp4')),
      ).toThrow('只能预览视频工坊生成的成片');
    } finally {
      process.chdir(cwd);
    }
  });

  it('persists a render task and retries the original settings after failure', async () => {
    const cwd = process.cwd();
    const projectDir = mkdtempSync(
      join(tmpdir(), 'video-workshop-task-retry-'),
    );
    process.chdir(projectDir);
    try {
      const outputDir = join(projectDir, 'data', 'video-workshop', 'workbench');
      const outputPath = join(outputDir, 'retry-output.mp4');
      const render = jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary ffmpeg failure'))
        .mockImplementationOnce(async (input, options) => {
          mkdirSync(outputDir, { recursive: true });
          writeFileSync(outputPath, 'mp4');
          await options.onProgress(75, 'rendering');
          return {
            outputPath,
            args: ['-vf', 'drawtext,eq,fade'],
            settings: input.settings,
            unsupportedSettings: [],
          };
        });
      const service = makeService(makeRuntime(), { render });
      const queued = await service.createRenderTask({
        materialPath: '/tmp/material.mp4',
        templateName: '产品卖点模板',
        titlePrompt: '突出优惠',
        outputName: 'retry-output.mp4',
        settings: {
          musicPreset: '温和叙述',
          titleStyle: '标题：高亮重点',
          subtitleStyle: '字幕：重点高亮',
          fontPreset: '宋体',
          filterPreset: '暖调生活',
          transitionPreset: '淡入淡出',
          aspectRatio: '16:9 横版',
        },
      });

      const failed = await waitForTask(service, queued.id, 'failed');
      expect(failed.attempts).toBe(1);
      await service.retryTask(queued.id);
      const succeeded = await waitForTask(service, queued.id, 'succeeded');

      expect(succeeded.attempts).toBe(2);
      expect(succeeded.outputPath).toBe(outputPath);
      expect(render).toHaveBeenLastCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            musicPreset: '温和叙述',
            fontPreset: '宋体',
            filterPreset: '暖调生活',
            transitionPreset: '淡入淡出',
          }),
        }),
        expect.objectContaining({ taskId: queued.id }),
      );
      expect(
        existsSync(join(projectDir, 'data', 'video-workshop', 'tasks.json')),
      ).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });

  it('aborts a running render and leaves a durable cancelled task', async () => {
    const cwd = process.cwd();
    const projectDir = mkdtempSync(
      join(tmpdir(), 'video-workshop-task-cancel-'),
    );
    process.chdir(projectDir);
    try {
      const render = jest.fn(
        (_input, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => reject(new VideoWorkshopRenderCancelledError()),
              { once: true },
            );
          }),
      );
      const service = makeService(makeRuntime(), { render });
      const queued = await service.createRenderTask({
        materialPath: '/tmp/material.mp4',
        templateName: '产品卖点模板',
        titlePrompt: '突出优惠',
      });

      await waitForTask(service, queued.id, 'running');
      await service.cancelTask(queued.id);
      const cancelled = await waitForTask(service, queued.id, 'cancelled');

      expect(cancelled).toMatchObject({
        status: 'cancelled',
        progress: 0,
        result: { status: 'cancelled', reasonCode: 'cancelled' },
      });
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(cwd);
    }
  });

  it('classifies missing assets, unavailable tools, and processing failures separately', async () => {
    const cwd = process.cwd();
    const projectDir = mkdtempSync(
      join(tmpdir(), 'video-workshop-task-failures-'),
    );
    process.chdir(projectDir);
    try {
      const render = jest
        .fn()
        .mockRejectedValueOnce(
          new VideoWorkshopRenderError(
            'missing_asset',
            '找不到可用素材，请重新选择后再试',
          ),
        )
        .mockRejectedValueOnce(
          new VideoWorkshopRenderError(
            'runtime_unavailable',
            '当前设备暂时无法剪辑视频',
          ),
        )
        .mockRejectedValueOnce(new Error('low-level processing detail'));
      const service = makeService(makeRuntime(), { render });

      const expected = [
        ['missing_asset', '找不到可用素材，请重新选择后再试'],
        ['runtime_unavailable', '当前设备暂时无法剪辑视频'],
        ['processing_failure', '视频处理未完成，请检查素材后重试'],
      ] as const;
      for (const [index, [reasonCode, message]] of expected.entries()) {
        const queued = await service.createRenderTask({
          materialPath: `/tmp/material-${index}.mp4`,
          templateName: '产品卖点模板',
          titlePrompt: '突出优惠',
          outputName: `failure-${index}.mp4`,
        });
        const failed = await waitForTask(service, queued.id, 'failed');
        expect(failed).toMatchObject({
          status: 'failed',
          error: message,
          result: { status: 'failed', reasonCode, message },
        });
      }
    } finally {
      process.chdir(cwd);
    }
  });

  it('rejects invalid render settings before creating a task', async () => {
    const cwd = process.cwd();
    const projectDir = mkdtempSync(
      join(tmpdir(), 'video-workshop-task-invalid-input-'),
    );
    process.chdir(projectDir);
    try {
      const service = makeService();
      await expect(
        service.createRenderTask({
          materialPath: '/tmp/material.mp4',
          templateName: '产品卖点模板',
          titlePrompt: '突出优惠',
          settings: { filterPreset: '不存在的滤镜' },
        }),
      ).rejects.toThrow('滤镜不受支持，请重新选择');
      await expect(service.listTasks()).resolves.toEqual([]);
    } finally {
      process.chdir(cwd);
    }
  });

  it('does not keep a completed task when its backend output is absent', async () => {
    const cwd = process.cwd();
    const projectDir = mkdtempSync(
      join(tmpdir(), 'video-workshop-task-missing-output-'),
    );
    process.chdir(projectDir);
    try {
      const taskDir = join(projectDir, 'data', 'video-workshop');
      const missingOutput = join(taskDir, 'workbench', 'missing.mp4');
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(
        join(taskDir, 'tasks.json'),
        JSON.stringify([
          {
            id: 'video-workshop-render-missing-output',
            kind: 'render',
            status: 'succeeded',
            progress: 100,
            stage: '成片已生成',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2026-07-10T00:00:00.000Z',
            updatedAt: '2026-07-10T00:01:00.000Z',
            finishedAt: '2026-07-10T00:01:00.000Z',
            outputPath: missingOutput,
            renderInput: {
              materialPath: '/tmp/material.mp4',
              templateName: '产品卖点模板',
              titlePrompt: '突出优惠',
            },
            result: {
              ok: true,
              status: 'success',
              reasonCode: 'success',
              message: '成片已生成',
              evidence: [],
              candidates: [],
            },
          },
        ]),
      );
      const service = makeService();

      await expect(service.listTasks()).resolves.toEqual([
        expect.objectContaining({
          id: 'video-workshop-render-missing-output',
          status: 'failed',
          progress: 0,
          error: '已完成的成片文件已不存在，请重新生成',
          result: expect.objectContaining({
            status: 'failed',
            reasonCode: 'missing_asset',
          }),
        }),
      ]);
      expect(
        (await service.getTask('video-workshop-render-missing-output'))
          .outputPath,
      ).toBeUndefined();
    } finally {
      process.chdir(cwd);
    }
  });

  it('recovers an interrupted running task from the durable store', async () => {
    const cwd = process.cwd();
    const projectDir = mkdtempSync(
      join(tmpdir(), 'video-workshop-task-recover-'),
    );
    process.chdir(projectDir);
    try {
      const taskDir = join(projectDir, 'data', 'video-workshop');
      const outputDir = join(taskDir, 'workbench');
      const outputPath = join(outputDir, 'recovered.mp4');
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(
        join(taskDir, 'tasks.json'),
        JSON.stringify([
          {
            id: 'video-workshop-render-interrupted',
            kind: 'render',
            status: 'running',
            progress: 42,
            stage: 'rendering',
            attempts: 1,
            maxAttempts: 3,
            createdAt: '2026-07-10T00:00:00.000Z',
            updatedAt: '2026-07-10T00:01:00.000Z',
            renderInput: {
              materialPath: '/tmp/material.mp4',
              templateName: '产品卖点模板',
              titlePrompt: '突出优惠',
              outputName: 'recovered.mp4',
              source: 'video-workshop',
              settings: {},
            },
          },
        ]),
      );
      const render = jest.fn(async (input) => {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(outputPath, 'mp4');
        return {
          outputPath,
          args: ['ffmpeg'],
          settings: input.settings,
          unsupportedSettings: [],
        };
      });
      const service = makeService(makeRuntime(), { render });

      await service.listTasks();
      const recovered = await waitForTask(
        service,
        'video-workshop-render-interrupted',
        'succeeded',
      );

      expect(recovered.attempts).toBe(2);
      expect(recovered.outputPath).toBe(outputPath);
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(cwd);
    }
  });
});
