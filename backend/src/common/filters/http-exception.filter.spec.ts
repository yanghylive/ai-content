import { HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

function makeHost(requestOverrides: Record<string, unknown> = {}) {
  const json = jest.fn();
  const response = {
    clearCookie: jest.fn(),
    json,
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
  const request = {
    method: 'GET',
    url: '/api/intelligence/monitors',
    headers: {},
    ...requestOverrides,
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
  return { host, json, request, response };
}

describe('AllExceptionsFilter', () => {
  it('returns a traceable request id and explicitly public error details', () => {
    const filter = new AllExceptionsFilter();
    const { host, json, response } = makeHost({
      headers: { 'x-request-id': 'search-request-123' },
    });

    filter.catch(
      new HttpException(
        {
          code: 'INTELLIGENCE_SEARCH_ALL_SOURCES_FAILED',
          message: '数据查找暂时不可用',
          publicDetails: {
            failures: [
              {
                platform: 'douyin',
                error: '数据服务响应超时，请稍后重试。',
                callLogId: 'call-log-1',
              },
            ],
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
      host as never,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'search-request-123',
    );
    expect(response.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'INTELLIGENCE_SEARCH_ALL_SOURCES_FAILED',
        message: '数据查找暂时不可用',
        requestId: 'search-request-123',
        details: {
          failures: [
            expect.objectContaining({
              platform: 'douyin',
              callLogId: 'call-log-1',
            }),
          ],
        },
      }),
    );
  });

  it('generates a safe request id without exposing generic exception details', () => {
    const filter = new AllExceptionsFilter();
    const { host, json, response } = makeHost({
      headers: { 'x-request-id': 'unsafe request id\n' },
    });

    filter.catch(new Error('database connection string'), host as never);

    const requestId = response.setHeader.mock.calls[0][1] as string;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '服务器内部错误',
        requestId,
      }),
    );
    expect(json.mock.calls[0][0]).not.toHaveProperty('details');
  });
});
