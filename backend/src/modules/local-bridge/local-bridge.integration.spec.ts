import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { DurablePublishCommandCoordinator } from '../auto-upload/durable-publish-command.coordinator';
import { PublishRecordStore } from '../auto-upload/publish-record.store';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';
import { LocalBridgeController } from './local-bridge.controller';
import { LocalBridgeService } from './local-bridge.service';

describe('LocalBridge Phase 3A integration', () => {
  let app: INestApplication;

  const coordinator = {
    executeDurablePublish: jest.fn(),
    claimOrLoad: jest.fn(),
  };
  const publishRecordStore = {
    resolveOwnerScope: jest.fn(),
    findClaimByIdempotencyKey: jest.fn(),
    createClaim: jest.fn(),
    claimNextQueued: jest.fn(),
    completeClaimedTask: jest.fn(),
    renewLease: jest.fn(),
    reclaimStaleClaims: jest.fn(),
  };
  const autoUploadService = {
    getHealth: jest.fn(),
    listAccounts: jest.fn(),
    getPublishBatchResults: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformRegistryModule],
      controllers: [LocalBridgeController],
      providers: [
        LocalBridgeService,
        { provide: AutoUploadService, useValue: autoUploadService },
        { provide: DurablePublishCommandCoordinator, useValue: coordinator },
        { provide: PublishRecordStore, useValue: publishRecordStore },
        {
          provide: AuthRequestContextService,
          useValue: {
            get: () => ({ user: { id: 'user-1' }, sessionId: 'session-1' }),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    autoUploadService.getHealth.mockResolvedValue({
      online: true,
      status: 'ok',
      service: 'test',
      version: '1',
      engineUrl: '',
      checkedAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('EXECUTE_PUBLISH → creates durable task and returns stable task id', async () => {
    publishRecordStore.resolveOwnerScope.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    coordinator.executeDurablePublish.mockResolvedValue({
      kind: 'created',
      record: { publicId: 42, idempotencyKey: 'pub-1' },
    });

    const res = await request(app.getHttpServer())
      .post('/local-bridge/publish')
      .set('x-jiuzhang-trace-id', 'trace-1')
      .send({
        confirmationId: 'conf-1',
        idempotencyKey: 'pub-1',
        payloads: [
          {
            type: 3,
            title: '测试',
            tags: [],
            fileList: ['/tmp/v.mp4'],
            accountList: ['acc-1'],
          },
        ],
      })
      .expect(200);

    expect(res.body).toMatchObject({
      protocol: 'jiuzhang-local-bridge',
      action: 'JZ_BRIDGE_EXECUTE_PUBLISH',
      ok: true,
      code: 200,
      data: {
        accepted: true,
        taskId: 42,
        status: 'waiting',
        idempotencyKey: 'pub-1',
      },
    });
    expect(coordinator.executeDurablePublish).toHaveBeenCalledTimes(1);
  });

  it('GET_TASK_STATUS → returns durable task status', async () => {
    autoUploadService.getPublishBatchResults.mockResolvedValue({
      taskId: 42,
      platforms: [
        {
          platform: 'douyin',
          accountId: 'acc-1',
          accountName: '测试',
          articleId: 'art-1',
          status: 'success',
          publishUrl: 'https://douyin.com/123',
        },
      ],
      summary: { total: 1, success: 1, failed: 0 },
    });

    const res = await request(app.getHttpServer())
      .get('/local-bridge/tasks/42')
      .set('x-jiuzhang-trace-id', 'trace-2')
      .expect(200);

    expect(res.body).toMatchObject({
      protocol: 'jiuzhang-local-bridge',
      action: 'JZ_BRIDGE_GET_TASK_STATUS',
      ok: true,
      data: { taskId: 42, status: 'completed' },
    });
  });

  it('CANCEL_TASK → returns CANCELLATION_UNSUPPORTED', async () => {
    const res = await request(app.getHttpServer())
      .post('/local-bridge/tasks/42/cancel')
      .set('x-jiuzhang-trace-id', 'trace-3')
      .send({ reason: '用户取消' })
      .expect(200);

    expect(res.body).toMatchObject({
      protocol: 'jiuzhang-local-bridge',
      action: 'JZ_BRIDGE_CANCEL_TASK',
      ok: false,
      code: 409,
      errorCode: 'CANCELLATION_UNSUPPORTED',
    });
  });

  it('full flow: publish → status → cancel through protocol envelopes', async () => {
    // Step 1: Publish
    publishRecordStore.resolveOwnerScope.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
    coordinator.executeDurablePublish.mockResolvedValue({
      kind: 'created',
      record: { publicId: 99, idempotencyKey: 'flow-1' },
    });

    const publishRes = await request(app.getHttpServer())
      .post('/local-bridge/publish')
      .set('x-jiuzhang-trace-id', 'flow-publish')
      .send({
        confirmationId: 'conf-flow',
        idempotencyKey: 'flow-1',
        payloads: [
          {
            type: 5,
            title: '全链路',
            tags: [],
            fileList: ['/tmp/v.mp4'],
            accountList: ['acc-1'],
          },
        ],
      })
      .expect(200);

    expect(publishRes.body.data).toMatchObject({
      accepted: true,
      taskId: 99,
      status: 'waiting',
    });

    // Step 2: Status
    autoUploadService.getPublishBatchResults.mockResolvedValue({
      taskId: 99,
      platforms: [],
      summary: { total: 0, success: 0, failed: 0, pendingManual: 0 },
    });

    const statusRes = await request(app.getHttpServer())
      .get('/local-bridge/tasks/99')
      .set('x-jiuzhang-trace-id', 'flow-status')
      .expect(200);

    expect(statusRes.body.data).toMatchObject({
      taskId: 99,
      status: 'waiting',
    });

    // Step 3: Cancel (unsupported)
    const cancelRes = await request(app.getHttpServer())
      .post('/local-bridge/tasks/99/cancel')
      .set('x-jiuzhang-trace-id', 'flow-cancel')
      .send({ reason: '测试取消' })
      .expect(200);

    expect(cancelRes.body).toMatchObject({
      ok: false,
      errorCode: 'CANCELLATION_UNSUPPORTED',
    });
  });
});
