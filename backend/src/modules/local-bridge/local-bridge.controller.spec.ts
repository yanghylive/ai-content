import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { LOCAL_BRIDGE_ACTIONS } from './local-bridge.contract';
import { LocalBridgeController } from './local-bridge.controller';
import { LocalBridgeService } from './local-bridge.service';

describe('LocalBridgeController', () => {
  const localBridgeService = {
    respond: jest.fn(),
    getStatus: jest.fn(),
    listCapabilities: jest.fn(),
    listAccounts: jest.fn(),
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
        controllers: [LocalBridgeController],
        providers: [
          LocalBridgeService,
          { provide: AutoUploadService, useValue: autoUploadService },
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

  it.each([
    ['missing', undefined],
    ['invalid', 'contains spaces'],
  ] as const)(
    'returns a passthrough INVALID_REQUEST envelope for %s trace header',
    async (_case, traceId) => {
      const moduleRef = await Test.createTestingModule({
        controllers: [LocalBridgeController],
        providers: [
          LocalBridgeService,
          {
            provide: AutoUploadService,
            useValue: { getHealth: jest.fn(), listAccounts: jest.fn() },
          },
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
