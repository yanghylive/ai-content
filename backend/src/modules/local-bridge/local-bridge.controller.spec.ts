import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { DurablePublishCommandCoordinator } from '../auto-upload/durable-publish-command.coordinator';
import { PublishRecordStore } from '../auto-upload/publish-record.store';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';
import { LOCAL_BRIDGE_ACTIONS } from './local-bridge.contract';
import { LocalBridgeController } from './local-bridge.controller';
import { LocalBridgeService } from './local-bridge.service';

describe('LocalBridgeController', () => {
  const localBridgeService = {
    respond: jest.fn(),
    getStatus: jest.fn(),
    listCapabilities: jest.fn(),
    listAccounts: jest.fn(),
    executePublish: jest.fn(),
    getTaskStatus: jest.fn(),
    cancelTask: jest.fn(),
  };
  let controller: LocalBridgeController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new LocalBridgeController(
      localBridgeService as unknown as LocalBridgeService,
    );
  });

  it.each([
    ['status', LOCAL_BRIDGE_ACTIONS.CHECK_STATUS, 'getStatus', 'getStatus'],
    [
      'capabilities',
      LOCAL_BRIDGE_ACTIONS.LIST_CAPABILITIES,
      'listCapabilities',
      'listCapabilities',
    ],
    [
      'accounts',
      LOCAL_BRIDGE_ACTIONS.LIST_ACCOUNTS,
      'listAccounts',
      'listAccounts',
    ],
  ] as const)(
    'delegates %s through the transport envelope',
    (_route, action, controllerMethod, serviceMethod) => {
      const envelope = Promise.resolve({ ok: true });
      localBridgeService.respond.mockReturnValue(envelope);
      localBridgeService[serviceMethod].mockReturnValue({
        value: serviceMethod,
      });

      expect(controller[controllerMethod]('trace-1')).toBe(envelope);
      expect(localBridgeService.respond).toHaveBeenCalledWith(
        'trace-1',
        action,
        expect.any(Function),
      );

      const read = localBridgeService.respond.mock.calls[0][2];
      expect(read()).toEqual({ value: serviceMethod });
      expect(localBridgeService[serviceMethod]).toHaveBeenCalledTimes(1);
    },
  );

  it('delegates publish execution through the transport envelope', () => {
    const body = {
      confirmationId: 'confirmation-1',
      idempotencyKey: 'publish-1',
      payloads: [],
    };
    const envelope = Promise.resolve({ ok: false });
    localBridgeService.respond.mockReturnValue(envelope);

    expect(controller.executePublish(body, 'trace-publish')).toBe(envelope);
    expect(localBridgeService.respond).toHaveBeenCalledWith(
      'trace-publish',
      LOCAL_BRIDGE_ACTIONS.EXECUTE_PUBLISH,
      expect.any(Function),
    );
    const execute = localBridgeService.respond.mock.calls[0][2];
    execute();
    expect(localBridgeService.executePublish).toHaveBeenCalledWith(body);
  });

  it('delegates task status through the transport envelope', () => {
    const envelope = Promise.resolve({ ok: true });
    localBridgeService.respond.mockReturnValue(envelope);

    expect(controller.getTaskStatus('42', 'trace-status')).toBe(envelope);
    expect(localBridgeService.respond).toHaveBeenCalledWith(
      'trace-status',
      LOCAL_BRIDGE_ACTIONS.GET_TASK_STATUS,
      expect.any(Function),
    );
    const read = localBridgeService.respond.mock.calls[0][2];
    read();
    expect(localBridgeService.getTaskStatus).toHaveBeenCalledWith('42');
  });

  it('delegates task cancellation through the transport envelope', () => {
    const body = { reason: '用户取消' };
    const envelope = Promise.resolve({ ok: false });
    localBridgeService.respond.mockReturnValue(envelope);

    expect(controller.cancelTask('42', body, 'trace-cancel')).toBe(envelope);
    expect(localBridgeService.respond).toHaveBeenCalledWith(
      'trace-cancel',
      LOCAL_BRIDGE_ACTIONS.CANCEL_TASK,
      expect.any(Function),
    );
    const cancel = localBridgeService.respond.mock.calls[0][2];
    cancel();
    expect(localBridgeService.cancelTask).toHaveBeenCalledWith('42', body);
  });

  it.each([
    ['/local-bridge/status', LOCAL_BRIDGE_ACTIONS.CHECK_STATUS],
    ['/local-bridge/capabilities', LOCAL_BRIDGE_ACTIONS.LIST_CAPABILITIES],
    ['/local-bridge/accounts', LOCAL_BRIDGE_ACTIONS.LIST_ACCOUNTS],
  ] as const)(
    'returns a protocol envelope through authenticated HTTP for %s',
    async (path, action) => {
      const autoUploadService = {
        getHealth: jest.fn().mockResolvedValue({
          online: false,
          status: 'missing',
          version: '0.1.0',
          checkedAt: '2026-08-01T00:00:00.000Z',
        }),
        listAccounts: jest.fn().mockResolvedValue([]),
      };
      const moduleRef = await Test.createTestingModule({
        imports: [PlatformRegistryModule],
        controllers: [LocalBridgeController],
        providers: [
          LocalBridgeService,
          { provide: AutoUploadService, useValue: autoUploadService },
          {
            provide: DurablePublishCommandCoordinator,
            useValue: {
              executeDurablePublish: jest.fn().mockResolvedValue({
                kind: 'created',
                record: { publicId: 42, idempotencyKey: 'publish-1' },
              }),
              claimOrLoad: jest.fn(),
            },
          },
          {
            provide: PublishRecordStore,
            useValue: {
              resolveOwnerScope: jest.fn().mockResolvedValue({
                tenantId: 'tenant-1',
                userId: 'user-1',
              }),
              findClaimByIdempotencyKey: jest.fn(),
              createClaim: jest.fn(),
              claimNextQueued: jest.fn(),
            },
          },
          {
            provide: AuthRequestContextService,
            useValue: {
              get: () => ({ user: { id: 'user-1' }, sessionId: 'session-1' }),
            },
          },
          { provide: APP_GUARD, useValue: { canActivate: () => true } },
        ],
      }).compile();
      const app: INestApplication = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new TransformInterceptor());
      await app.init();

      const response = await request(app.getHttpServer())
        .get(path)
        .set('x-jiuzhang-trace-id', 'trace-http')
        .expect(200);

      expect(response.body).toMatchObject({
        protocol: 'jiuzhang-local-bridge',
        version: 1,
        type: 'response',
        traceId: 'trace-http',
        action,
        ok: true,
        code: 200,
        message: 'ok',
      });
      expect(response.body).toHaveProperty('data');
      expect(typeof response.body.timestamp).toBe('number');
      expect(response.body).not.toHaveProperty('success');
      if (action === LOCAL_BRIDGE_ACTIONS.CHECK_STATUS) {
        expect(response.body.data).toMatchObject({ online: false });
      }

      await app.close();
    },
  );

  it('serves Phase 3A task routes through protocol envelopes', async () => {
    const publishResult = {
      platforms: [
        { platform: 'douyin', accountId: '1', status: 'success' as const },
      ],
      summary: {
        total: 1,
        success: 1,
        failed: 0,
        accountExpired: 0,
        materialError: 0,
        loginRequired: 0,
        pendingManual: 0,
        blocked: 0,
        notIntegrated: 0,
      },
    };
    const autoUploadService = {
      getHealth: jest.fn(),
      listAccounts: jest.fn(),
      publishBatch: jest.fn(),
      getPublishBatchResults: jest.fn().mockResolvedValue(publishResult),
      deletePublishTask: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [PlatformRegistryModule],
      controllers: [LocalBridgeController],
      providers: [
        LocalBridgeService,
        { provide: AutoUploadService, useValue: autoUploadService },
        {
          provide: DurablePublishCommandCoordinator,
          useValue: {
            executeDurablePublish: jest.fn().mockResolvedValue({
              kind: 'created',
              record: { publicId: 42, idempotencyKey: 'publish-1' },
            }),
            claimOrLoad: jest.fn(),
          },
        },
        {
          provide: PublishRecordStore,
          useValue: {
            resolveOwnerScope: jest.fn().mockResolvedValue({
              tenantId: 'tenant-1',
              userId: 'user-1',
            }),
            findClaimByIdempotencyKey: jest.fn(),
            createClaim: jest.fn(),
            claimNextQueued: jest.fn(),
          },
        },
        {
          provide: AuthRequestContextService,
          useValue: {
            get: () => ({ user: { id: 'user-1' }, sessionId: 'session-1' }),
          },
        },
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    const publish = await request(app.getHttpServer())
      .post('/local-bridge/publish')
      .set('x-jiuzhang-trace-id', 'trace-publish')
      .send({
        confirmationId: 'confirmation-1',
        idempotencyKey: 'publish-1',
        payloads: [
          {
            type: 3,
            title: '标题',
            tags: [],
            fileList: ['/tmp/video.mp4'],
            accountList: ['account-1'],
          },
        ],
      })
      .expect(200);
    expect(publish.body).toMatchObject({
      action: LOCAL_BRIDGE_ACTIONS.EXECUTE_PUBLISH,
      ok: true,
      code: 200,
      data: {
        accepted: true,
        taskId: 42,
        status: 'waiting',
        idempotencyKey: 'publish-1',
      },
    });
    expect(autoUploadService.publishBatch).not.toHaveBeenCalled();

    const status = await request(app.getHttpServer())
      .get('/local-bridge/tasks/42')
      .set('x-jiuzhang-trace-id', 'trace-status')
      .expect(200);
    expect(status.body).toMatchObject({
      action: LOCAL_BRIDGE_ACTIONS.GET_TASK_STATUS,
      ok: true,
      code: 200,
      data: { taskId: 42, status: 'completed', result: publishResult },
    });

    const cancel = await request(app.getHttpServer())
      .post('/local-bridge/tasks/42/cancel')
      .set('x-jiuzhang-trace-id', 'trace-cancel')
      .send({ reason: '用户取消' })
      .expect(200);
    expect(cancel.body).toMatchObject({
      action: LOCAL_BRIDGE_ACTIONS.CANCEL_TASK,
      ok: false,
      code: 409,
      errorCode: 'CANCELLATION_UNSUPPORTED',
      data: null,
    });
    expect(autoUploadService.deletePublishTask).not.toHaveBeenCalled();

    await app.close();
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'contains spaces'],
  ] as const)(
    'returns a passthrough INVALID_REQUEST envelope for %s trace header',
    async (_case, traceId) => {
      const moduleRef = await Test.createTestingModule({
        imports: [PlatformRegistryModule],
        controllers: [LocalBridgeController],
        providers: [
          LocalBridgeService,
          {
            provide: AutoUploadService,
            useValue: { getHealth: jest.fn(), listAccounts: jest.fn() },
          },
          {
            provide: DurablePublishCommandCoordinator,
            useValue: {
              executeDurablePublish: jest.fn(),
              claimOrLoad: jest.fn(),
            },
          },
          {
            provide: PublishRecordStore,
            useValue: {
              resolveOwnerScope: jest.fn(),
              findClaimByIdempotencyKey: jest.fn(),
              createClaim: jest.fn(),
              claimNextQueued: jest.fn(),
            },
          },
          { provide: AuthRequestContextService, useValue: { get: () => null } },
          { provide: APP_GUARD, useValue: { canActivate: () => true } },
        ],
      }).compile();
      const app: INestApplication = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new TransformInterceptor());
      await app.init();

      let pendingRequest = request(app.getHttpServer()).get(
        '/local-bridge/status',
      );
      if (traceId) {
        pendingRequest = pendingRequest.set('x-jiuzhang-trace-id', traceId);
      }
      const response = await pendingRequest.expect(200);

      expect(response.body).toMatchObject({
        protocol: 'jiuzhang-local-bridge',
        version: 1,
        type: 'response',
        action: LOCAL_BRIDGE_ACTIONS.CHECK_STATUS,
        ok: false,
        code: 400,
        errorCode: 'INVALID_REQUEST',
        data: null,
      });
      expect(response.body.traceId).toMatch(
        /^srv-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(response.body).not.toHaveProperty('success');
      expect(typeof response.body.timestamp).toBe('number');

      await app.close();
    },
  );

  it('keeps the HTTP route behind authentication', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LocalBridgeController],
      providers: [
        { provide: LocalBridgeService, useValue: localBridgeService },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: () => {
              throw new UnauthorizedException('请先登录');
            },
          },
        },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get('/local-bridge/status')
      .set('x-jiuzhang-trace-id', 'trace-unauthorized')
      .expect(401);
    expect(localBridgeService.respond).not.toHaveBeenCalled();

    await app.close();
  });
});
