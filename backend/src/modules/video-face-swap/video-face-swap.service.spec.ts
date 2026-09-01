import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import { VideoFaceSwapService as VideoFaceSwapExecutorService } from '../runtime/platforms/video/video-face-swap.service';
import { VideoFaceSwapService } from './video-face-swap.service';

function makeRuntimeMock() {
  return {
    execute: jest.fn().mockResolvedValue({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '视频换脸已生成：brand-output.mp4',
      runtime: { mode: 'local-runtime', executor: 'video-face-swap' },
      billing: {
        status: 'charged',
        amount: 50,
        reservationId: 'reserve-1',
        transactionId: 'tx-1',
      },
      evidence: [
        {
          type: 'text',
          label: 'video-face-swap-output',
          path: '/tmp/brand-output.mp4',
          createdAt: new Date().toISOString(),
          raw: {
            outputName: 'brand-output.mp4',
            mode: 'face_swap',
            durationSeconds: 95,
            billingAmount: 50,
          },
        },
      ],
    }),
  } as unknown as jest.Mocked<RuntimeOrchestrator>;
}

function makeExecutorMock(ok = true) {
  return {
    readiness: jest.fn().mockResolvedValue({
      ok,
      status: ok ? 'ready' : 'needs_setup',
      message: ok
        ? '本机生成环境已就绪。'
        : '本机生成环境未就绪，请先完成环境安装后再生成。',
      checkedAt: new Date().toISOString(),
      checks: [
        {
          key: 'dependencies',
          label: '生成依赖',
          ok,
          message: ok ? '已安装' : '缺少运行依赖',
          required: true,
        },
      ],
    }),
  } as unknown as jest.Mocked<VideoFaceSwapExecutorService>;
}

describe('VideoFaceSwapService', () => {
  let runtime: jest.Mocked<RuntimeOrchestrator>;
  let executor: jest.Mocked<VideoFaceSwapExecutorService>;
  let service: VideoFaceSwapService;

  beforeEach(() => {
    runtime = makeRuntimeMock();
    executor = makeExecutorMock();
    service = new VideoFaceSwapService(runtime, executor);
  });

  it('按模式和时长重算点数', () => {
    expect(
      service.estimate({
        mode: 'face_swap',
        durationSeconds: 95,
      }).estimatedCostPoints,
    ).toBe(50);
    expect(
      service.estimate({
        mode: 'deep_swap',
        durationSeconds: 95,
      }).estimatedCostPoints,
    ).toBe(80);
  });

  it('正式扣点授权缺失时返回明确处理动作', () => {
    service = new VideoFaceSwapService(runtime, executor, {
      get: jest.fn(() => ({
        user: {
          id: 'local-user-1',
          kaypalUserId: 'cloud-user-1',
        },
      })),
    } as any);

    expect(service.billingStatus()).toMatchObject({
      ok: false,
      status: 'needs_authorization',
      label: '需授权',
      actionHref: '/capabilities/account',
    });
  });

  it('账号具备正式扣点授权时返回可扣点状态', () => {
    service = new VideoFaceSwapService(runtime, executor, {
      get: jest.fn(() => ({
        user: {
          id: 'local-user-1',
          kaypalUserId: 'cloud-user-1',
          kaypalDesktopRefreshToken: 'refresh-token',
          kaypalDesktopDeviceId: 'device-1',
        },
      })),
    } as any);

    expect(service.billingStatus()).toMatchObject({
      ok: true,
      status: 'ready',
      label: '可扣点',
    });
  });

  it('创建任务时把后端计费金额写入 Runtime payload', async () => {
    mkdirSync(join(process.cwd(), 'data', 'video-face-swap', 'materials'), { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), 'data', 'video-face-swap', 'materials', 'spec-'));
    const targetPath = join(dir, 'target.mp4');
    const sourcePath = join(dir, 'face.jpg');
    writeFileSync(targetPath, 'fake video bytes');
    writeFileSync(sourcePath, 'fake image bytes');

    const response = await service.createJob({
      mode: 'face_swap',
      targetPath,
      sourcePath,
      outputName: 'brand-output.mp4',
      durationSeconds: 95,
      usagePurpose: '品牌授权数字人宣传片',
      authorizationConfirmed: true,
      lawfulUseConfirmed: true,
      commercialLicenseConfirmed: true,
      acceptedCostPoints: 50,
    });

    expect(response.ok).toBe(true);
    expect(response.estimate.estimatedCostPoints).toBe(50);
    expect(runtime.execute).toHaveBeenCalledTimes(1);
    expect(executor.readiness).toHaveBeenCalledTimes(1);
    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'video-face-swap',
        platform: 'mixed',
        payload: expect.objectContaining({
          mode: 'face_swap',
          targetPath,
          sourcePath,
          outputName: 'brand-output.mp4',
          billingAmount: 50,
          estimatedCostPoints: 50,
          acceptedCostPoints: 50,
          authorizationConfirmed: true,
          lawfulUseConfirmed: true,
          commercialLicenseConfirmed: true,
          usagePurpose: '品牌授权数字人宣传片',
        }),
      }),
      expect.objectContaining({
        sendMode: 'auto-send',
      }),
    );
  });

  it('前端确认点数低于后端估算时拒绝执行', async () => {
    mkdirSync(join(process.cwd(), 'data', 'video-face-swap', 'materials'), { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), 'data', 'video-face-swap', 'materials', 'spec-'));
    const targetPath = join(dir, 'target.mp4');
    const sourcePath = join(dir, 'face.jpg');
    writeFileSync(targetPath, 'fake video bytes');
    writeFileSync(sourcePath, 'fake image bytes');

    await expect(
      service.createJob({
        mode: 'face_swap',
        targetPath,
        sourcePath,
        durationSeconds: 95,
        usagePurpose: '品牌授权数字人宣传片',
        authorizationConfirmed: true,
        lawfulUseConfirmed: true,
        commercialLicenseConfirmed: true,
        acceptedCostPoints: 30,
      }),
    ).rejects.toThrow('本次预计扣 50 点');
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('本机生成环境未就绪时不进入 Runtime，也不会触发扣点', async () => {
    executor = makeExecutorMock(false);
    service = new VideoFaceSwapService(runtime, executor);
    mkdirSync(join(process.cwd(), 'data', 'video-face-swap', 'materials'), { recursive: true });
    const dir = mkdtempSync(join(process.cwd(), 'data', 'video-face-swap', 'materials', 'spec-'));
    const targetPath = join(dir, 'target.mp4');
    const sourcePath = join(dir, 'face.jpg');
    writeFileSync(targetPath, 'fake video bytes');
    writeFileSync(sourcePath, 'fake image bytes');

    await expect(
      service.createJob({
        mode: 'face_swap',
        targetPath,
        sourcePath,
        durationSeconds: 60,
        usagePurpose: '品牌授权数字人宣传片',
        authorizationConfirmed: true,
        lawfulUseConfirmed: true,
        commercialLicenseConfirmed: true,
        acceptedCostPoints: 30,
      }),
    ).rejects.toThrow('本机生成环境未就绪');
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('上传素材只接受视频、图片和音频文件', async () => {
    const originalCwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'video-face-swap-upload-'));
    process.chdir(dir);
    try {
      await expect(
        service.importMaterialFile({
          originalname: 'bad.txt',
          buffer: Buffer.from('bad'),
        }),
      ).rejects.toThrow('只支持视频、图片或音频素材');

      const material = await service.importMaterialFile({
        originalname: '../brand:face.jpg',
        buffer: Buffer.from('image'),
      });

      expect(material.kind).toBe('image');
      expect(material.name).toBe('brand_face.jpg');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
