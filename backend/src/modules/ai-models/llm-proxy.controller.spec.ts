import { LlmProxyController } from './llm-proxy.controller';

describe('LlmProxyController', () => {
  const ORIGINAL_KEY = process.env.MEMORY_LLM_PROXY_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.MEMORY_LLM_PROXY_KEY;
    } else {
      process.env.MEMORY_LLM_PROXY_KEY = ORIGINAL_KEY;
    }
  });

  const buildController = () => {
    const aiClient = { generate: jest.fn().mockResolvedValue('你好') };
    const prisma = {
      aIModel: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'model-1',
          modelId: 'gpt-x',
          enabled: true,
        }),
      },
    };
    return {
      controller: new LlmProxyController(aiClient as any, prisma as any),
      aiClient,
    };
  };

  const buildReq = (ip: string) =>
    ({ ip, socket: { remoteAddress: ip } }) as any;

  const body = {
    model: 'gpt-x',
    messages: [{ role: 'user', content: 'hi' }],
  };

  it('远程请求未配置凭据时拒绝', async () => {
    const { controller } = buildController();
    delete process.env.MEMORY_LLM_PROXY_KEY;
    await expect(
      controller.chatCompletions(buildReq('1.2.3.4'), undefined, body),
    ).rejects.toThrow('LLM 代理未配置凭据');
  });

  it('远程请求凭据错误时拒绝', async () => {
    const { controller } = buildController();
    process.env.MEMORY_LLM_PROXY_KEY = 'secret-key';
    await expect(
      controller.chatCompletions(buildReq('1.2.3.4'), 'Bearer wrong', body),
    ).rejects.toThrow('无效的 LLM 代理凭据');
  });

  it('远程请求凭据正确时通过', async () => {
    const { controller } = buildController();
    process.env.MEMORY_LLM_PROXY_KEY = 'secret-key';
    await expect(
      controller.chatCompletions(buildReq('1.2.3.4'), 'Bearer secret-key', body),
    ).resolves.toMatchObject({ model: 'gpt-x' });
  });

  it('本地 loopback 未配置凭据时免认证通过', async () => {
    const { controller } = buildController();
    delete process.env.MEMORY_LLM_PROXY_KEY;
    await expect(
      controller.chatCompletions(buildReq('127.0.0.1'), undefined, body),
    ).resolves.toMatchObject({ model: 'gpt-x' });
  });
});
