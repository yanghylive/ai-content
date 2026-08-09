import {
  LOCAL_BRIDGE_ACTIONS,
  type LocalBridgeErrorResponse,
  type LocalBridgeExecutePublishRequest,
  type LocalBridgeResponse,
  type LocalBridgeSuccessResponse,
  type LocalBridgeStatus,
} from './local-bridge.contract';

describe('Local Bridge contract', () => {
  it('uses ok as the response discriminant', () => {
    const success: LocalBridgeSuccessResponse<LocalBridgeStatus> = {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-success',
      action: 'JZ_BRIDGE_CHECK_STATUS',
      ok: true,
      code: 200,
      message: 'ok',
      data: {
        online: true,
        status: 'ok',
        service: 'jiuzhang-local-bridge',
        version: '0.1.0',
        protocolVersion: 1,
        actions: ['JZ_BRIDGE_CHECK_STATUS'],
        checkedAt: '2026-08-01T00:00:00.000Z',
      },
      timestamp: 1,
    };
    const error: LocalBridgeErrorResponse = {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-error',
      action: 'JZ_BRIDGE_CHECK_STATUS',
      ok: false,
      code: 503,
      errorCode: 'ENGINE_UNAVAILABLE',
      message: 'engine unavailable',
      data: null,
      timestamp: 2,
    };

    const read = (response: LocalBridgeResponse<LocalBridgeStatus>) =>
      response.ok ? response.data.online : response.errorCode;

    expect(read(success)).toBe(true);
    expect(read(error)).toBe('ENGINE_UNAVAILABLE');
  });

  it('exposes Phase 3A publish task actions and typed execute payloads', () => {
    const request: LocalBridgeExecutePublishRequest = {
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
    };

    expect(request.payloads[0].type).toBe(3);
    expect(Object.values(LOCAL_BRIDGE_ACTIONS)).toEqual(
      expect.arrayContaining([
        'JZ_BRIDGE_EXECUTE_PUBLISH',
        'JZ_BRIDGE_GET_TASK_STATUS',
        'JZ_BRIDGE_CANCEL_TASK',
      ]),
    );
  });
});
