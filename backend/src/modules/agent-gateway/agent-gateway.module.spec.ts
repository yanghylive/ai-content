import { ConfigService } from '@nestjs/config';
import { resolveAgentSecret } from './agent-gateway.module';

describe('resolveAgentSecret（P1 严格密钥策略，与原型一致）', () => {
  const cfg = (secret?: string) => new ConfigService(secret ? { AGENT_GATEWAY_SECRET: secret } : {});

  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.AGENT_GATEWAY_SECRET;
  });

  it('显式 AGENT_GATEWAY_SECRET 优先', () => {
    expect(resolveAgentSecret(cfg('cfg-secret'))).toBe('cfg-secret');
  });

  it('jest(test) 环境缺 secret → 允许默认密钥', () => {
    process.env.NODE_ENV = 'test';
    expect(resolveAgentSecret(cfg())).toBe('dev-only-secret-do-not-use-in-prod');
  });

  it('development 环境缺 secret → 允许默认密钥（本地开发）', () => {
    process.env.NODE_ENV = 'development';
    expect(resolveAgentSecret(cfg())).toBe('dev-only-secret-do-not-use-in-prod');
  });

  it('非开发环境（production/staging/未设）缺 secret → 启动失败', () => {
    for (const env of ['production', 'staging', undefined]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      expect(() => resolveAgentSecret(cfg())).toThrow(/AGENT_GATEWAY_SECRET/);
    }
  });
});
