import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutorContext, ExecutorTask } from '../../executor.interface';
import { VideoTemplateClipService } from './video-template-clip.service';

type ProcessMock = {
  runProcess: () => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  buildFfmpegArgs: (
    material: { path: string; kind: 'video' | 'image' },
    outputPath: string,
    durationSeconds?: number,
  ) => string[];
};

const baseCtx: ExecutorContext = {
  riskContext: {},
  sendMode: 'draft-only',
};

function makeTask(payload: Record<string, unknown> = {}): ExecutorTask {
  return {
    relatedId: 'video-task-1',
    relatedType: 'agent-session',
    type: 'video-template-clip',
    platform: 'mixed',
    payload: {
      templateName: '测试模板',
      outputName: '测试视频',
      ...payload,
    },
  };
}

describe('VideoTemplateClipService', () => {
  let service: VideoTemplateClipService;

  beforeEach(() => {
    service = new VideoTemplateClipService();
  });

  it('only handles video-template-clip tasks', () => {
    expect(service.canHandle(makeTask()).ok).toBe(true);
    expect(
      service.canHandle({ ...makeTask(), type: 'platform-publish-video' }).ok,
    ).toBe(false);
  });

  it('blocks when material path is missing', async () => {
    const result = await service.execute(
      makeTask({ materialPath: '' }),
      baseCtx,
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.reasonCode).toBe('target_not_found');
    expect(result.userMessage).toContain('素材');
  });

  it('distinguishes an unavailable video tool from a processing failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-template-failures-'));
    const input = join(dir, 'source.mp4');
    writeFileSync(input, 'fake video bytes');
    const mockable = service as unknown as ProcessMock;
    jest.spyOn(mockable, 'runProcess').mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'command unavailable',
    });

    const unavailable = await service.execute(
      makeTask({ materialPath: input, outputDir: join(dir, 'unavailable') }),
      baseCtx,
    );
    expect(unavailable).toMatchObject({
      ok: false,
      reasonCode: 'runtime_unavailable',
      userMessage: '当前设备暂时无法剪辑视频',
    });

    jest.restoreAllMocks();
    jest
      .spyOn(mockable, 'runProcess')
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '' })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'processing failed',
      });
    const failed = await service.execute(
      makeTask({ materialPath: input, outputDir: join(dir, 'failed') }),
      baseCtx,
    );
    expect(failed).toMatchObject({
      ok: false,
      reasonCode: 'send_failed',
      userMessage: '视频处理未完成，请检查素材后重试',
    });
  });

  it('generates output evidence when ffmpeg succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-template-clip-'));
    const input = join(dir, 'source.mp4');
    const outputDir = join(dir, 'out');
    writeFileSync(input, 'fake video bytes');

    const mockable = service as unknown as ProcessMock;
    jest
      .spyOn(mockable, 'runProcess')
      .mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    jest
      .spyOn(mockable, 'buildFfmpegArgs')
      .mockImplementation((_material, outputPath, durationSeconds) => {
        expect(durationSeconds).toBe(10);
        writeFileSync(outputPath, 'generated');
        return ['mock-ffmpeg'];
      });

    const result = await service.execute(
      makeTask({
        materialPath: input,
        outputName: '成片.mp4',
        outputDir,
        durationSeconds: 10,
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe('success');
    expect(result.reasonCode).toBe('success');
    expect(result.runtime.executor).toBe('video-template-clip');
    expect(result.evidence[0]).toMatchObject({
      label: 'video-template-clip-output',
      path: join(outputDir, '成片.mp4'),
    });
    expect(result.evidence[0].raw).toMatchObject({
      durationSeconds: 10,
    });
  });

  it('can resolve the first media file from a material folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-template-folder-'));
    const input = join(dir, 'a-product.jpg');
    const outputDir = join(dir, 'out');
    writeFileSync(input, 'fake image bytes');

    const mockable = service as unknown as ProcessMock;
    jest
      .spyOn(mockable, 'runProcess')
      .mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    jest
      .spyOn(mockable, 'buildFfmpegArgs')
      .mockImplementation((material, outputPath) => {
        expect(material).toMatchObject({ path: input, kind: 'image' });
        writeFileSync(outputPath, 'generated');
        return ['mock-ffmpeg'];
      });

    const result = await service.execute(
      makeTask({
        materialPath: dir,
        outputName: 'folder-output',
        outputDir,
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.evidence[0].path).toBe(join(outputDir, 'folder-output.mp4'));
  });

  it('resolves a normal Chinese material name to a mojibake file with the same media number', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-template-alias-'));
    const actualInput = join(dir, 'æ¤°è®äºº-è§é¢ç´-æ-09-IPå¨ç».mp4');
    const requestedInput = join(dir, '椰蛮人-视频素材-09-IP动画.mp4');
    const outputDir = join(dir, 'out');
    writeFileSync(actualInput, 'fake video bytes');

    const mockable = service as unknown as ProcessMock;
    jest
      .spyOn(mockable, 'runProcess')
      .mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });
    jest
      .spyOn(mockable, 'buildFfmpegArgs')
      .mockImplementation((material, outputPath) => {
        expect(material).toMatchObject({ path: actualInput, kind: 'video' });
        writeFileSync(outputPath, 'generated');
        return ['mock-ffmpeg'];
      });

    const result = await service.execute(
      makeTask({
        materialPath: requestedInput,
        outputName: 'alias-output',
        outputDir,
      }),
      baseCtx,
    );

    expect(result.ok).toBe(true);
    expect(result.evidence[0]).toMatchObject({
      label: 'video-template-clip-output',
      path: join(outputDir, 'alias-output.mp4'),
    });
  });
});
