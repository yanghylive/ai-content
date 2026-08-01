import type {
  LocalBridgeErrorResponse,
  LocalBridgeResponse,
  LocalBridgeSuccessResponse,
  LocalBridgeStatus,
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
});
