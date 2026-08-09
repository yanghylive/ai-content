import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutorContext, ExecutorTask } from '../../executor.interface';
import { VideoFaceSwapService } from './video-face-swap.service';

type MockableVideoFaceSwapService = VideoFaceSwapService & {
  runProcess: (
    command: string,
    args: string[],
    timeoutMs?: number,
    cwd?: string,
  ) => Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>;
  isHealthy: () => Promise<{ ok: boolean; details?: string }>;
  resolveFaceFusionRoot: () => string;
  getPythonCommand: () => string;
};

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'auto-send',
};

function makeTask(payload: Record<string, unknown> = {}): ExecutorTask {
  return {
    relatedId: 'face-swap-task-1',
    relatedType: 'agent-session',
    type: 'video-face-swap',
    platform: 'mixed',
    payload: {
      authorizationConfirmed: true,
      mode: 'face_swap',
      durationSeconds: 60,
      billingAmount: 30,
      ...payload,
    },
  };
}

describe('VideoFaceSwapService', () => {
  let service: VideoFaceSwapService;

  beforeEach(() => {
    service = new VideoFaceSwapService();
  });

  it('only handles video-face-swap tasks', () => {
    expect(service.canHandle(makeTask()).ok).toBe(true);
    expect(
      service.canHandle({ ...makeTask(), type: 'video-template-clip' }).ok,
    ).toBe(false);
  });

  it('blocks when authorization is missing', async () => {
    const result = await service.execute(
      makeTask({ authorizationConfirmed: false }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('review_required');
  });

  it('builds an isolated FaceFusion run and returns output evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-face-swap-executor-'));
    const targetPath = join(dir, 'target.mp4');
    const sourcePath = join(dir, 'face.jpg');
    const outputDir = join(dir, 'out');
    writeFileSync(targetPath, 'fake video bytes');
    writeFileSync(sourcePath, 'fake image bytes');

    const mockable = service as MockableVideoFaceSwapService;
    jest
      .spyOn(mockable, 'isHealthy')
      .mockResolvedValue({ ok: true, details: 'ready' });
    jest
      .spyOn(mockable, 'runProcess')
      .mockImplementation(async (_command, args) => {
        const outputPath = args[args.indexOf('-o') + 1];
        writeFileSync(outputPath, 'generated');
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      });

    const result = await service.execute(
      makeTask({
        targetPath,
        sourcePath,
        outputDir,
        outputName: 'brand-output.mp4',
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.runtime.executor).toBe('video-face-swap');
    expect(result.evidence[0]).toMatchObject({
      label: 'video-face-swap-output',
      path: join(outputDir, 'brand-output.mp4'),
    });
    expect(mockable.runProcess).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'facefusion.py',
        'headless-run',
        '--jobs-path',
        '--temp-path',
        '--processors',
        'face_swapper',
        '-t',
        targetPath,
        '-s',
        sourcePath,
      ]),
      expect.any(Number),
      expect.any(String),
    );
  });

  it('reports missing generation dependencies before real execution', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-face-swap-health-'));
    writeFileSync(join(dir, 'facefusion.py'), 'print("ok")');

    const mockable = service as MockableVideoFaceSwapService;
    jest.spyOn(mockable, 'resolveFaceFusionRoot').mockReturnValue(dir);
    jest.spyOn(mockable, 'getPythonCommand').mockReturnValue('python3');
    jest
      .spyOn(mockable, 'runProcess')
      .mockImplementation(async (_command, args) => {
        if (args.includes('--version')) {
          return { exitCode: 0, stdout: 'Python 3.11.0', stderr: '' };
        }
        if (args.some((arg) => arg.includes('sys.version_info'))) {
          return { exitCode: 0, stdout: '3.11', stderr: '' };
        }
        if (args.some((arg) => arg.includes('onnxruntime'))) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'ModuleNotFoundError: No module named onnxruntime',
          };
        }
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      });

    const readiness = await service.readiness();

    expect(readiness.ok).toBe(false);
    expect(readiness.status).toBe('needs_setup');
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'dependencies',
          ok: false,
          message: '缺少运行依赖',
        }),
      ]),
    );
  });
});
