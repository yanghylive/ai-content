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
    {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-1',
      action: 'JZ_BRIDGE_CHECK_STATUS',
      ok: false,
      code: Number.NaN,
      errorCode: 'INVALID_REQUEST',
      message: 'invalid code',
      data: null,
      timestamp: 1,
    },
    {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: 'trace-1',
      action: 'JZ_BRIDGE_CHECK_STATUS',
      ok: true,
      code: 200,
      message: 'unexpected field',
      data: null,
      timestamp: 1,
      unexpected: true,
    },
    Object.assign(
      Object.create({
        protocol: 'jiuzhang-local-bridge',
        version: 1,
        type: 'response',
        traceId: 'trace-inherited',
        action: 'JZ_BRIDGE_CHECK_STATUS',
        ok: true,
        code: 200,
        message: 'inherited',
        data: null,
        timestamp: 1,
      }) as Record<string, unknown>,
      {},
    ),
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

  it.each([
    'JZ_BRIDGE_EXECUTE_PUBLISH',
    'JZ_BRIDGE_GET_TASK_STATUS',
    'JZ_BRIDGE_CANCEL_TASK',
  ])('preserves the Phase 3A %s envelope', (action, done) => {
    const envelope = {
      protocol: 'jiuzhang-local-bridge',
      version: 1,
      type: 'response',
      traceId: `trace-${action}`,
      action,
      ok: false,
      code: 503,
      errorCode: 'WRITE_PATH_NOT_READY',
      message: 'not ready',
      data: null,
      timestamp: 2,
    };

    interceptor.intercept(context, { handle: () => of(envelope) }).subscribe({
      next: (value) => expect(value).toBe(envelope),
      complete: done,
    });
  });

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
