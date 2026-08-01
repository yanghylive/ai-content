import { of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();
  const context = {} as never;

  it('preserves Local Bridge protocol envelopes on the HTTP path', (done) => {
    const envelope = {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-1',
      action: 'JZ_BRIDGE_CHECK_STATUS',
      ok: true,
      code: 200,
      message: 'ok',
      data: { online: true },
      timestamp: 1,
    };

    interceptor.intercept(context, { handle: () => of(envelope) }).subscribe({
      next: (value) => expect(value).toBe(envelope),
      complete: done,
    });
  });

  it.each([
    { protocol: 'jiuzhang-local-bridge' },
    {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-1',
      action: 'JZ_BRIDGE_CHECK_STATUS',
      ok: true,
      code: 500,
      message: 'invalid success',
      data: null,
      timestamp: 1,
    },
    {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-1',
      action: 'UNKNOWN_ACTION',
      ok: false,
      code: 400,
      errorCode: 'INVALID_REQUEST',
      message: 'invalid action',
      data: null,
      timestamp: 1,
    },
    {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-1',
      action: 'JZ_BRIDGE_CHECK_STATUS',
      ok: false,
      code: 500,
      errorCode: 'UNKNOWN_ERROR_CODE',
      message: 'unknown error',
      data: null,
      timestamp: 1,
    },
  ])(
    'does not bypass wrapping for malformed bridge-shaped payloads',
    (payload, done) => {
      interceptor.intercept(context, { handle: () => of(payload) }).subscribe({
        next: (value) =>
          expect(value).toMatchObject({ success: true, data: payload }),
        complete: done,
      });
    },
  );

  it('preserves a consistent Local Bridge error envelope', (done) => {
    const envelope = {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-error',
      action: 'JZ_BRIDGE_LIST_ACCOUNTS',
      ok: false,
      code: 503,
      errorCode: 'ENGINE_UNAVAILABLE',
      message: 'unavailable',
      data: null,
      timestamp: 2,
    };

    interceptor.intercept(context, { handle: () => of(envelope) }).subscribe({
      next: (value) => expect(value).toBe(envelope),
      complete: done,
    });
  });

  it('continues wrapping ordinary API payloads', (done) => {
    interceptor.intercept(context, { handle: () => of({ id: 1 }) }).subscribe({
      next: (value) =>
        expect(value).toMatchObject({ success: true, data: { id: 1 } }),
      complete: done,
    });
  });
});
