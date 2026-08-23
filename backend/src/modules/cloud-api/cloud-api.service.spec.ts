import { CloudApiService } from './cloud-api.service';

/**
 * Stage 1A 回归：cloud-api 会外发客户消息/回复正文，endpoint 必须锁在
 * kaypal 网关域内。env 被改成第三方域名时要 fail-closed（不发请求），
 * 而不是把业务数据打出去之后再看响应。
 */
describe('CloudApiService endpoint 守卫', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const makeConfig = (endpoint?: string, extraHosts?: string) =>
    ({
      get: jest.fn((key: string) => {
        if (key === 'CLOUD_API_ENDPOINT') return endpoint;
        if (key === 'KAYPAL_EXTRA_ALLOWED_HOSTS') return extraHosts;
        return undefined;
      }),
    }) as never;

  const invokeGenerateReply = (service: CloudApiService) =>
    service.generateReply({
      platform: 'douyin',
      scene: 'comment',
      customerMessage: '这个多少钱',
    });

  it('默认 endpoint 指向 kaypal 网关，请求可正常发出', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ replyText: 'ok' }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const service = new CloudApiService(makeConfig(undefined));
    await invokeGenerateReply(service);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'https://kaypal.cn/cloud-api',
    );
  });

  it('非网关 host（子串绕过样本）被拒且不发出任何请求', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const service = new CloudApiService(
      makeConfig('https://kaypal.cn.evil.com/cloud-api'),
    );

    await expect(invokeGenerateReply(service)).rejects.toThrow(/非法/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('KAYPAL_EXTRA_ALLOWED_HOSTS 逃生阀可放行私有化部署 host', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ replyText: 'ok' }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const service = new CloudApiService(
      makeConfig('https://cloud.internal.example/cloud-api', 'cloud.internal.example'),
    );
    await invokeGenerateReply(service);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'https://cloud.internal.example/cloud-api',
    );
  });
});
